/**
 * 第 3 步：把一筆物件填進 591 刊登表單
 *
 * 跑法：node fill.mjs <物件id>
 *   例：node fill.mjs 2002450b-6a82-40fc-9d88-351b17de29a6
 *   （物件 id 在後台網址列裡：/admin/properties/<這一段>）
 *
 * ⚠️ 這支腳本刻意做了四件「慢一點但不會出事」的設計：
 *
 *   1. **只填，不送出。** 填完就停在那裡等你看過，送出鍵永遠由你自己按。
 *      程式填錯一格、591 改版換了欄位，你都還有機會在送出前發現。
 *   2. **一次一筆。** 沒有批次迴圈、不吃檔案清單。批次連發是被判定異常
 *      最快的方式，而你一天也不會上架 50 間房子。
 *   3. **人工節奏。** 每格之間停 0.2～0.6 秒。除了不像機器人之外，
 *      更實際的理由是 591 有連動欄位（選了縣市才載入行政區），
 *      填太快會在下一格還沒生出來的時候就去點它。
 *   4. **照片不自動傳。** 591 是上傳檔案不是貼網址，程式手上只有網址。
 *      照片請自己拖進去 —— 順序照終端機印出來的那份清單。
 */
import { chromium } from "playwright";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  applyTransform,
  askLine,
  AUTH_FILE,
  SHOTS_DIR,
  ensureDir,
  humanDelay,
  listPickableProperties,
  loadPackage,
  loadSelectors,
  resolveValue,
  stamp,
  waitForEnter,
} from "./_shared.mjs";

if (!existsSync(AUTH_FILE)) {
  console.error(`找不到登入狀態 ${AUTH_FILE}\n先跑：npm run login`);
  process.exit(1);
}

/**
 * 沒給 id 就列出物件讓你選編號。
 *
 * 物件 id 是 uuid，從網址列複製一長串進終端機第一次就會貼錯，所以在真的終端機裡
 * （TTY）改成列清單。非互動環境（測試、排程）維持原本的「沒給就報錯」，
 * 免得對著沒人看的 stdin 空等。
 */
let propertyId = process.argv[2];
if (!propertyId) {
  if (!process.stdin.isTTY) {
    console.error("用法：node fill.mjs <物件id>");
    console.error("物件 id 在後台網址列：/admin/properties/<這一段>");
    process.exit(1);
  }
  const rows = await listPickableProperties();
  if (rows.length === 0) {
    console.error("資料庫裡一件物件都沒有。先去後台 /admin/properties 建一筆。");
    process.exit(1);
  }
  console.log("\n資料庫裡的物件：\n");
  rows.forEach((r, i) => {
    const price = r.price ? `${r.price}萬` : "未定價";
    console.log(`  ${String(i + 1).padStart(2, " ")}. [${r.status}] ${price}　${r.district || ""}　${r.title}`);
  });
  const answer = await askLine(`\n要填哪一筆？輸入編號 1-${rows.length}：`);
  const pick = Number(answer.trim());
  if (!Number.isInteger(pick) || pick < 1 || pick > rows.length) {
    console.error(`「${answer.trim()}」不是有效的編號。`);
    process.exit(1);
  }
  propertyId = rows[pick - 1].id;
}

/* ────────────────── 開跑 ────────────────── */

const config = loadSelectors();
const { property, pkg } = await loadPackage(propertyId);

console.log(`\n物件：${property.title}`);
console.log(`標題：${pkg.titleFull}`);
if (pkg.warnings.length) {
  console.log("\n⚠️  上架前檢查有 " + pkg.warnings.length + " 條沒過：");
  for (const w of pkg.warnings) console.log(`   ・${w}`);
  console.log("   （還是會照填，但送出前自己斟酌）");
}

if (!config.formUrl) {
  console.error("\nconfig/selectors.json 裡的 formUrl 是空的 —— 先跑 npm run inspect 拿到刊登表單網址。");
  process.exit(1);
}

// FILL_HEADLESS 只給 test-fill-e2e.mjs 用。實際上架一定要看得到瀏覽器
// （你得自己檢查、自己拖照片、自己按送出），所以正常跑一律 headed。
const headless = process.env.FILL_HEADLESS === "1";
const browser = await chromium.launch({ channel: "chrome", headless, args: ["--start-maximized"] });
const context = await browser.newContext({ storageState: AUTH_FILE, viewport: null });
const page = await context.newPage();

console.log(`\n開啟刊登表單：${config.formUrl}`);
await page.goto(config.formUrl, { waitUntil: "domcontentloaded" });
await humanDelay(900, 1400);

// 登入狀態過期的話，這裡會被踢回登入頁 —— 先講清楚，不要讓他對著空表單發呆
if (/login|signin|passport/i.test(page.url())) {
  console.error(`\n❌ 被導到登入頁（${page.url()}）—— 登入狀態過期了。`);
  console.error("   重跑一次：npm run login");
  await browser.close();
  process.exit(1);
}

const filled = [];
const skipped = [];
const failed = [];

for (const [name, spec] of Object.entries(config.fields)) {
  const raw = resolveValue(spec.from, pkg);
  const value = applyTransform(raw, spec.transform);

  if (!value) {
    skipped.push({ name, why: "資料庫這欄是空的" });
    continue;
  }
  if (!spec.selector) {
    skipped.push({ name, why: "selectors.json 這欄還沒填 selector" });
    continue;
  }

  try {
    const el = page.locator(spec.selector).first();
    await el.waitFor({ state: "visible", timeout: spec.timeout ?? 8000 });

    const action = spec.action || "fill";
    if (action === "select") {
      // 先試「照選項文字選」，再退回「照 value 選」—— 591 的下拉兩種都有
      try {
        await el.selectOption({ label: value });
      } catch {
        await el.selectOption(value);
      }
    } else if (action === "click") {
      await el.click();
    } else if (action === "type") {
      await el.click();
      await el.fill("");
      await el.type(value, { delay: 30 });
    } else {
      await el.fill(value);
    }

    filled.push({ name, value: value.length > 40 ? `${value.slice(0, 40)}…` : value });
    console.log(`  ✓ ${name.padEnd(12)} ${value.length > 50 ? `${value.slice(0, 50)}…` : value}`);
  } catch (err) {
    failed.push({ name, selector: spec.selector, why: err.message.split("\n")[0] });
    console.log(`  ✗ ${name.padEnd(12)} 失敗：${err.message.split("\n")[0]}`);
  }

  await humanDelay();
}

/* ────────────────── 收尾 ────────────────── */

ensureDir(SHOTS_DIR);
const shot = path.join(SHOTS_DIR, `filled-${stamp()}.png`);
await page.screenshot({ path: shot, fullPage: true });

// 把表單上每一格的實際值抓回來。給 test-fill-e2e.mjs 對答案用，
// 真的填壞的時候也可以打開 FILL_DUMP_VALUES 看到底填了什麼進去。
if (process.env.FILL_DUMP_VALUES) {
  const values = await page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll("input, select, textarea")) {
      if (el.id) out[el.id] = el.value;
    }
    return out;
  });
  writeFileSync(process.env.FILL_DUMP_VALUES, JSON.stringify(values, null, 2), "utf8");
}

console.log(`\n${"─".repeat(60)}`);
console.log(`填好 ${filled.length} 格　跳過 ${skipped.length} 格　失敗 ${failed.length} 格`);
console.log(`截圖：${shot}`);

if (skipped.length) {
  console.log("\n跳過的：");
  for (const s of skipped) console.log(`  ・${s.name} —— ${s.why}`);
}
if (failed.length) {
  console.log("\n❌ 失敗的（這幾格要自己填，或是 591 改版了要重跑 npm run inspect）：");
  for (const f of failed) console.log(`  ・${f.name}　selector=${f.selector}\n     ${f.why}`);
}

console.log(`\n📷 照片要自己拖進去，順序照這份（第 1 張就是封面）：`);
if (pkg.photos.length === 0) {
  console.log("   （這件物件沒有照片）");
} else {
  pkg.photos.forEach((url, i) => console.log(`   ${String(i + 1).padStart(2, "0")}. ${url}`));
}

await waitForEnter(
  [
    "─".repeat(60),
    "瀏覽器停在這裡不會動了。現在請你自己：",
    "",
    "  1. 從頭到尾看一遍每一格填得對不對",
    "  2. 把照片拖進去（順序照上面那份清單）",
    "  3. 確認沒問題之後，自己按 591 的送出／儲存",
    "",
    "⚠️ 這支腳本不會幫你按送出 —— 那一下永遠是你自己的決定。",
    "",
    "全部弄完之後回來按 Enter 關掉瀏覽器。",
    "─".repeat(60),
  ].join("\n"),
);

await browser.close();
process.exit(0);
