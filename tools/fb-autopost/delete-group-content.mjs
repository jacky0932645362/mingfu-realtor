/**
 * 從社團的「你的內容」（/groups/<id>/my_posted_content/）刪掉自己在**這一個社團**發過的貼文
 *
 * 跑法：
 *   node delete-group-content.mjs --group=<社團網址或編號>                → 只看：列出這個社團裡會被刪的，什麼都不刪
 *   node delete-group-content.mjs --group=… --match="698萬海景"          → 只刪內文含這串字的（強烈建議一定要給）
 *   node delete-group-content.mjs --group=… --match=… --confirm          → 🔴 真的刪
 *   node delete-group-content.mjs --group=… --max=10                     → 這次最多刪幾篇（預設 5）
 *   node delete-group-content.mjs --group=… --gap-secs=10                → 每篇之間固定隔幾秒（預設隨機 6～8）
 *   node delete-group-content.mjs --group=… --headless                   → 不開視窗
 *
 * 📌 為什麼有這支、跟 delete-groups.mjs 什麼關係（2026-09-20）：
 *    delete-groups.mjs 走的是「活動紀錄 → 社團貼文和留言」。**帶照片的社團貼文不會出現在那裡**
 *    （9/8 富宇 15 篇、9/10 清水透天 4 篇全部找不到，活動紀錄從 9/14 直接跳 9/7；
 *    9/2 禾盛晶綻那篇是純文字才找得到、才刪得掉）。但社團自己的「你的內容」頁一定列得出來。
 *    所以「按社團清空」／「按工作流清空」現在改走這條：一個社團開一次「你的內容」，
 *    找到我們發的那幾則 → 逐一開貼文本身 → ⋯ →「刪除貼文」→ 確認。
 *    delete-groups.mjs 留著當「不知道發到哪個社團」時的備援。
 *
 * 📌 「你的內容」卡片右上角的 ⋯ 選單裡**沒有刪除**（只有關通知／關翻譯／暫停追蹤社團），
 *    一定要先進貼文本身的頁面（/groups/<id>/posts/<postId>/，開在「蕭茗馥的貼文」dialog 裡）才有「刪除貼文」。
 *    整條路 2026-09-20 對真 FB 抄過（按到確認框的「取消」為止），selector 在 config/selectors.json 的 group_content_delete。
 *
 * 📌 跟 delete-groups.mjs 同一套規矩：預設只看不刪、--confirm 才真的刪、刪之前先寫 deleted-log/、
 *    每篇之間 6～8 秒、每 20 篇停 15 秒（2026-09-20 本人拍板）、任何一步結構找不到就停下來不硬做。
 *
 * ⚠️ 「處理中」（等管理員審核）的貼文不在「已發佈」分頁裡，這支不會碰；只會在輸出裡提醒有幾篇。
 */
import { chromium } from "playwright";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  AUTH_FILE,
  DELETED_LOG_DIR,
  SHOTS_DIR,
  authSessionStatus,
  ensureDir,
  firstVisible,
  humanDelay,
  loadSelectors,
  localTimestamp,
  stamp,
  指紋正規化,
  登入問題說明,
} from "./_shared.mjs";

const argv = process.argv.slice(2);
const FAST = !!process.env.FB_FAST; // 端對端測試：跑本機假頁面，該等的元素早就在了
const flag = (name) => argv.includes(`--${name}`);
const num = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  const v = Number(hit.split("=")[1]);
  return Number.isFinite(v) ? v : dflt;
};
const str = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length).replace(/^["']|["']$/g, "") : null;
};

const DO_DELETE = flag("confirm");
const HEADLESS = flag("headless");
const FORCE = flag("force");
const MAX = num("max", 5);
const GROUP_ARG = str("group");
const MATCH = str("match");
const MATCH_KEY = MATCH ? 指紋正規化(MATCH) : null;
const MATCH_顯示 = MATCH_KEY ? `${MATCH_KEY.slice(0, 24)}${MATCH_KEY.length > 24 ? "…" : ""}` : null;

/** 一次最多刪幾篇的硬上限。--force 才解得開。 */
const HARD_CAP = 50;
const GAP_SECS = num("gap-secs", null);
// 節奏跟 delete-groups.mjs 一樣：每篇 6～8 秒、每 20 篇停 15 秒（2026-09-20 本人拍板，原本 8～15 秒／每 10 篇 45 秒）
const PAUSE_EVERY = num("pause-every", 20);
const PAUSE_SECS = num("pause-secs", 15);
const RUN_STAMP = stamp();

if (!GROUP_ARG) {
  console.error("\n❌ 要給 --group=<社團網址或編號>。這支一次只處理一個社團。\n");
  process.exit(1);
}
/** 社團編號或 slug（/groups/ 後面那段）。 */
const GROUP_ID = (() => {
  const m = GROUP_ARG.match(/(?:facebook|fb)\.com\/groups\/([^/?#\s]+)/i);
  if (m) return decodeURIComponent(m[1]);
  return GROUP_ARG.replace(/^https?:\/\//, "").replace(/\/+$/, "");
})();
const GROUP_URL = `https://www.facebook.com/groups/${GROUP_ID}`;
/** 「你的內容 → 已發佈」。測試用 FB_GROUP_CONTENT_URL 指到本機假頁面。 */
const CONTENT_URL = process.env.FB_GROUP_CONTENT_URL || `${GROUP_URL}/my_posted_content/`;
/** 貼文本身的網址樣板。測試用 FB_POST_URL_TEMPLATE 指到本機假頁面。 */
const POST_URL_TEMPLATE = process.env.FB_POST_URL_TEMPLATE || `https://www.facebook.com/groups/{groupId}/posts/{postId}/`;
const 貼文網址 = (postId) => POST_URL_TEMPLATE.replace("{groupId}", GROUP_ID).replace("{postId}", postId);

if (MAX > HARD_CAP && !FORCE) {
  console.error(`\n❌ --max=${MAX} 超過一次 ${HARD_CAP} 篇的上限。`);
  console.error("   一次刪太多是最容易被 FB 盯上的行為。真的要：加 --force。\n");
  process.exit(1);
}
if (DO_DELETE && !MATCH_KEY) {
  // 這支是給「清掉這套系統發的」用的；沒給內文比對就是「這個社團裡本人發的全部貼文」——含手動貼的。
  console.log("\n⚠️  沒給 --match —— 這個社團「你的內容」裡本人發過的貼文**全部**都會刪，不管是不是這套系統發的。");
}
if (!process.env.FB_SKIP_AUTH_CHECK && !authSessionStatus().有登入) {
  console.error("\n❌ 現在跑不了。");
  console.error(`   ${登入問題說明()}\n`);
  process.exit(1);
}
if (!existsSync(AUTH_FILE)) {
  console.error(`\n❌ 找不到登入狀態：${AUTH_FILE}`);
  process.exit(1);
}

const cfg = loadSelectors();
const sel = cfg.group_content_delete?.steps;
if (!sel) {
  console.error("\n❌ config/selectors.json 裡沒有 group_content_delete 那一段。\n");
  process.exit(1);
}
const 候選 = (key) => {
  const s = sel[key];
  if (!s || !Array.isArray(s.候選)) throw new Error(`selectors.json 的 group_content_delete 少了「${key}」`);
  return s.候選;
};
const 登入過期候選 = cfg.steps?.["登入過期偵測"]?.候選 || ['input[name="pass"]', 'input[type="password"]'];
const 查看連結 = 候選("卡片的查看連結").join(", ");
const 卡片更多動作 = 候選("卡片的更多動作").join(", ");
const 貼文更多動作 = 候選("貼文更多動作").join(", ");

console.log(`\n模式：${DO_DELETE ? "🔴 會真的刪" : "只看不刪（要真的刪加 --confirm）"}`);
console.log(`社團：${GROUP_URL}`);
console.log(`條件：${MATCH_顯示 ? `內文含「${MATCH_顯示}」` : "不比對內文（本人在這個社團發的全部）"}｜這次最多 ${MAX} 篇`);

ensureDir(SHOTS_DIR);
ensureDir(DELETED_LOG_DIR);

class 刪除中止 extends Error {}
const 中止 = (msg) => {
  throw new 刪除中止(msg);
};

const 刪除紀錄 = [];
function 寫刪除紀錄() {
  if (!刪除紀錄.length) return;
  writeFileSync(
    path.join(DELETED_LOG_DIR, `${RUN_STAMP}-group.md`),
    [
      `# 從社團「你的內容」刪掉的貼文`,
      `時間：${localTimestamp()}`,
      `社團：${GROUP_URL}`,
      `條件：${MATCH_顯示 ? `內文含「${MATCH_顯示}」` : "不比對內文"}，最多 ${MAX} 篇`,
      ``,
      ...刪除紀錄.flatMap((d) => [`## ${d.序}.`, d.連結, ``, d.內文, ``, `（刪除時間 ${d.刪除時間}）`, ``]),
    ].join("\n"),
    "utf8",
  );
}

/* ────────────────── 開瀏覽器 ────────────────── */

const browser = await chromium.launch({ channel: "chrome", headless: HEADLESS, args: ["--start-maximized"] });
const context = await browser.newContext({
  storageState: AUTH_FILE,
  viewport: HEADLESS ? { width: 1440, height: 900 } : null,
  locale: "zh-TW",
});
const page = await context.newPage();
const shot = (name) =>
  page.screenshot({ path: path.join(SHOTS_DIR, `${stamp()}-gdel-${name}.png`) }).catch(() => {});

async function 確認沒被登出() {
  if (await firstVisible(page, 登入過期候選, FAST ? 300 : 2500)) {
    中止("FB 給的是登出畫面（出現密碼欄位）。重跑 `npm run login` 再來。");
  }
}

/* ────────────────── 讀「你的內容 → 已發佈」 ────────────────── */

/** 把卡片文字砍成「貼文內文」那段：去掉開頭「蕭茗馥 發佈到 XXX ·」跟結尾「查看更多／在社團中查看」。 */
function 內文摘要(raw) {
  return raw
    .replace(/^.*?發佈到\s.*?\s[·・]\s*/s, "")
    .replace(/…+\s*查看更多.*$/s, "")
    .replace(/\s*在社團中查看\s*$/s, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function 讀卡片() {
  console.log(`\n開啟你的內容：${CONTENT_URL}`);
  await page.goto(CONTENT_URL, { waitUntil: "domcontentloaded" });
  await humanDelay(FAST ? 300 : 3500, FAST ? 500 : 5000);
  await 確認沒被登出();

  // 往下捲到卡片數不再增加（連續兩次沒變才停，FB 是邊捲邊載）
  let 上次 = -1;
  let 連續沒變 = 0;
  for (let i = 0; i < 25; i++) {
    const n = await page.locator(查看連結).count().catch(() => 0);
    if (n >= Math.max(MAX * 3, 30)) break;
    連續沒變 = n === 上次 ? 連續沒變 + 1 : 0;
    if (連續沒變 >= 2 && i > 2) break;
    上次 = n;
    await page.mouse.wheel(0, 2400);
    await humanDelay(FAST ? 20 : 1000, FAST ? 40 : 1600);
  }
  await humanDelay(FAST ? 30 : 1200, FAST ? 60 : 2000);

  // 左側「處理中」的數字（等審核的，這支不碰，只提醒）。
  // 🔴 沒有待審的時候左側是「處理中 已發佈 新內容指標 2 則貼文」——那個 2 是「已發佈」的，
  //    中間不能跨過「已發佈」去抓（2026-09-20 對真 FB 預覽時抓錯過一次）。
  const 處理中 = await page
    .evaluate(() => document.body.innerText.match(/處理中(?:(?!已發佈|已拒)[^\d]){0,12}(\d+\+?)\s*則貼文/)?.[1] || null)
    .catch(() => null);

  // ⚠️ 這裡在瀏覽器裡跑，只能用純 CSS，selectors.json 裡的 `:has-text()` 是 Playwright 專用語法——
  //    所以「在社團中查看」用文字／aria-label 自己比，不拿 查看連結 進來 querySelectorAll。
  const rows = await page.evaluate(
    ({ 卡片更多動作 }) => {
      const out = [];
      const seen = new Set();
      const links = [...document.querySelectorAll("a")].filter(
        (a) => a.getAttribute("aria-label") === "在社團中查看" || (a.innerText || "").trim() === "在社團中查看",
      );
      for (const a of links) {
        const r = a.getBoundingClientRect();
        if (r.width === 0) continue;
        const href = a.getAttribute("href") || "";
        const postId = href.match(/multi_permalinks=(\d+)/)?.[1] || href.match(/\/posts\/(\d+)/)?.[1] || href.match(/[?&]id=(\d+)/)?.[1] || "";
        if (!postId || seen.has(postId)) continue;
        // 往上找到「含 ⋯ 的祖先」＝一張卡片
        let card = a;
        let ok = false;
        for (let i = 0; i < 15 && card.parentElement; i++) {
          card = card.parentElement;
          if (card.querySelector(卡片更多動作)) {
            ok = true;
            break;
          }
        }
        if (!ok) continue;
        const raw = (card.innerText || "").replace(/\s+/g, " ").trim();
        // 往上抓過頭會抓到整包清單（文字長到離譜）——那不是一張卡片，跳過（跟 delete-groups.mjs 同一個防線）
        if (raw.length > 1500) continue;
        seen.add(postId);
        out.push({ postId, href, raw: raw.slice(0, 600) });
      }
      return out;
    },
    { 查看連結, 卡片更多動作 },
  );
  return { rows: rows.map((r) => ({ ...r, 摘要: 內文摘要(r.raw) })), 處理中 };
}

function 挑出要刪的(rows) {
  const 挑中 = [];
  const 略過 = [];
  for (const r of rows) {
    if (挑中.length >= MAX) break;
    if (MATCH_KEY && !指紋正規化(r.raw).includes(MATCH_KEY)) {
      略過.push({ ...r, 原因: "內文不含指定字串" });
      continue;
    }
    挑中.push(r);
  }
  return { 挑中, 略過 };
}

/* ────────────────── 刪一則：開貼文本身 → ⋯ → 刪除貼文 → 確認 ────────────────── */

/**
 * 在貼文頁上認出「我們這一則」用的一小段字。
 * 🔴 FB 把 emoji 畫成 <img>，innerText 裡**沒有** emoji——所以一定要先把 emoji 去掉再拿去比，
 *    而且優先用「你的內容」卡片抄回來的摘要（那是 FB 自己的渲染結果），--match 只是備援。
 */
const 去emoji = (s) =>
  String(s || "")
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}️⃣‍]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
const 定位字of = (row) => (去emoji(row.摘要) || 去emoji(MATCH)).slice(0, 12);

/** 貼文頁裡「我們這一則」的 ⋯。🔴 用內文定位——同一頁底下動態牆也有別人貼文的同名按鈕。 */
async function 找貼文的更多動作(row) {
  const 定位字 = 定位字of(row);
  // 先找含內文的 dialog（真 FB 是開在「蕭茗馥的貼文」dialog 裡）
  const inDialog = page.locator('[role="dialog"]').filter({ hasText: 定位字 }).locator(貼文更多動作).first();
  if ((await inDialog.count().catch(() => 0)) > 0 && (await inDialog.isVisible().catch(() => false))) return inDialog;
  // 沒有 dialog 的版面（假頁面／FB 改版）：從含內文的最小容器往上找
  const handle = await page.evaluateHandle(
    ({ 定位字, 貼文更多動作 }) => {
      const all = [...document.querySelectorAll("div, span")].filter((d) => (d.innerText || "").includes(定位字));
      let node = all.sort((a, b) => a.innerText.length - b.innerText.length)[0];
      for (let i = 0; i < 20 && node; i++) {
        const b = node.querySelector(貼文更多動作);
        if (b) return b;
        node = node.parentElement;
      }
      return null;
    },
    { 定位字, 貼文更多動作 },
  );
  const el = handle.asElement();
  if (!el) return null;
  return el;
}

async function 刪一則(row) {
  const url = 貼文網址(row.postId);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await humanDelay(FAST ? 300 : 3500, FAST ? 500 : 5000);
  await 確認沒被登出();

  // 🔴 刪之前再核對一次：這一頁真的有我們要的內文才動手
  const 定位字 = 定位字of(row);
  const 頁上有 = await page.locator("body").innerText().then((t) => 指紋正規化(t).includes(指紋正規化(定位字))).catch(() => false);
  if (!頁上有) {
    await shot(`貼文頁沒有內文-${row.postId}`);
    中止(`開了 ${url}，頁面上找不到「${定位字}」——可能已經被刪、或被審核退回。停下來。`);
  }

  const more = await 找貼文的更多動作(row);
  if (!more) {
    await shot(`找不到更多動作-${row.postId}`);
    中止(`貼文頁找不到「⋯」（貼文更多動作）。看截圖確認版面有沒有變。`);
  }
  await more.click();
  await humanDelay(FAST ? 200 : 900, FAST ? 300 : 1600);

  const 刪除項 = await firstVisible(page, 候選("刪除選單項"), FAST ? 1500 : 5000);
  if (!刪除項) {
    await shot(`選單沒有刪除貼文-${row.postId}`);
    中止("⋯ 選單開了，但找不到「刪除貼文」。可能不是自己的貼文、或 FB 改了字。把截圖回來看。");
  }
  await 刪除項.click();
  await humanDelay(FAST ? 200 : 900, FAST ? 300 : 1600);

  const 確認框 = await firstVisible(page, 候選("確認對話框"), FAST ? 1500 : 5000);
  if (!確認框) {
    await shot(`沒有確認框-${row.postId}`);
    中止("按了「刪除貼文」但沒出現「永久刪除貼文？」確認框。停下來。");
  }
  const 確認鈕 = await firstVisible(確認框, 候選("確認刪除按鈕"), FAST ? 1500 : 4000);
  if (!確認鈕) {
    await shot(`確認框找不到刪除鈕-${row.postId}`);
    中止("確認框出現了，但找不到裡面的「刪除」鈕。");
  }
  await 確認鈕.click();

  // 確認框消失＝FB 收到了
  const gone = await 確認框
    .waitFor({ state: "detached", timeout: FAST ? 3000 : 15000 })
    .then(() => true)
    .catch(() => false);
  if (!gone) {
    await shot(`確認框沒關-${row.postId}`);
    中止("按了「刪除」但確認框沒關掉。看截圖確認到底刪了沒。");
  }
  await humanDelay(FAST ? 200 : 1500, FAST ? 300 : 2500);

  // 再開一次貼文頁核對：內文應該不見了
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await humanDelay(FAST ? 300 : 3000, FAST ? 500 : 4500);
  const 還在 = await page.locator("body").innerText().then((t) => 指紋正規化(t).includes(指紋正規化(定位字))).catch(() => false);
  if (還在) {
    await shot(`刪完還在-${row.postId}`);
    中止(`按完刪除，重開 ${url} 內文還在。停下來，不要繼續。`);
  }
}

/* ────────────────── 主流程 ────────────────── */

let 刪了幾篇 = 0;
try {
  const { rows, 處理中 } = await 讀卡片();
  await shot("1-你的內容");
  console.log(`\n「你的內容 → 已發佈」讀到 ${rows.length} 則${處理中 ? `（另外有 ${處理中} 則在「處理中」等審核，這支不碰）` : ""}。`);

  const { 挑中, 略過 } = 挑出要刪的(rows);
  console.log(`\n${"─".repeat(64)}`);
  console.log(`這次會刪這 ${挑中.length} 則${DO_DELETE ? "" : "（要真的刪，加 --confirm 重跑）"}：`);
  console.log("─".repeat(64));
  挑中.forEach((r, n) => {
    console.log(`${String(n + 1).padStart(2)}. ${r.摘要.slice(0, 64)}`);
    console.log(`     ${貼文網址(r.postId)}`);
  });
  if (略過.length) console.log(`\n略過 ${略過.length} 則（${[...new Set(略過.map((r) => r.原因))].join("、")}）`);

  const items = (list) => list.map((r) => ({ postId: r.postId, link: 貼文網址(r.postId), group: GROUP_URL, snippet: r.摘要.slice(0, 80) }));

  if (!挑中.length) {
    console.log("\n沒有符合條件的貼文，什麼都不做。\n");
    console.log(`RESULT_JSON:${JSON.stringify({ deleted: 0, previewCount: 0, scanned: rows.length, pending: 處理中, confirmed: DO_DELETE, group: GROUP_URL, items: [] })}`);
    await browser.close();
    process.exit(0);
  }

  if (!DO_DELETE) {
    const preview = path.join(DELETED_LOG_DIR, `DRYRUN-${RUN_STAMP}-group.md`);
    writeFileSync(
      preview,
      [
        `# 從社團「你的內容」刪貼文 —— 預覽（沒有真的刪）`,
        `時間：${localTimestamp()}`,
        `社團：${GROUP_URL}`,
        `條件：${MATCH_顯示 ? `內文含「${MATCH_顯示}」` : "不比對內文"}，最多 ${MAX} 篇`,
        ``,
        `## 加 --confirm 之後會刪這 ${挑中.length} 篇`,
        ...挑中.map((r, n) => `${n + 1}. ${r.摘要.slice(0, 80)}\n   ${貼文網址(r.postId)}`),
      ].join("\n"),
      "utf8",
    );
    console.log(`\n這是「只看不刪」。清單也寫了一份到：${preview}\n`);
    console.log(
      `RESULT_JSON:${JSON.stringify({ deleted: 0, previewCount: 挑中.length, scanned: rows.length, pending: 處理中, confirmed: false, group: GROUP_URL, previewFile: preview, items: items(挑中) })}`,
    );
    await browser.close();
    process.exit(0);
  }

  for (const [n, row] of 挑中.entries()) {
    if (n > 0) {
      const 停 = n % PAUSE_EVERY === 0;
      const ms = 停 ? PAUSE_SECS * 1000 : GAP_SECS != null ? GAP_SECS * 1000 : 6000 + Math.random() * 2000;
      if (ms > 0) {
        console.log(`\n⏳ 等 ${Math.round(ms / 1000)} 秒${停 ? `（每 ${PAUSE_EVERY} 則停久一點）` : ""}…`);
        await new Promise((r) => setTimeout(r, ms));
      }
    }
    console.log(`\n🗑️  第 ${n + 1}/${挑中.length} 則：${row.摘要.slice(0, 64)}`);
    // 🔴 刪之前先記下來。刪完就查不到了。
    刪除紀錄.push({ 序: n + 1, 連結: 貼文網址(row.postId), 內文: row.摘要.slice(0, 200), 刪除時間: localTimestamp() });
    寫刪除紀錄();
    await 刪一則(row);
    刪了幾篇++;
    console.log(`   ✅ 刪掉了（累計 ${刪了幾篇} 則）`);
  }

  console.log(`\n${"─".repeat(64)}`);
  console.log(`這次刪了 ${刪了幾篇} 則。清單在 ${DELETED_LOG_DIR}。`);
  console.log("─".repeat(64) + "\n");
  console.log(
    `RESULT_JSON:${JSON.stringify({ deleted: 刪了幾篇, previewCount: 0, scanned: rows.length, pending: 處理中, confirmed: true, group: GROUP_URL, items: items(挑中.slice(0, 刪了幾篇)) })}`,
  );
} catch (err) {
  if (!(err instanceof 刪除中止)) throw err;
  console.error(`\n❌ ${err.message}`);
  await shot("失敗");
  console.error(`   截圖在 ${SHOTS_DIR}，看一下卡在哪。`);
  if (刪了幾篇 > 0) console.error(`   ⚠ 中止前已經刪了 ${刪了幾篇} 篇，清單在 ${DELETED_LOG_DIR}。`);
  console.log(`RESULT_JSON:${JSON.stringify({ deleted: 刪了幾篇, previewCount: 0, scanned: null, confirmed: DO_DELETE, group: GROUP_URL, aborted: err.message.slice(0, 200), items: 刪除紀錄.slice(0, 刪了幾篇).map((d) => ({ link: d.連結, group: GROUP_URL, snippet: d.內文.slice(0, 80) })) })}`);
  await browser.close().catch(() => {});
  process.exit(1);
} finally {
  await browser.close().catch(() => {});
}

process.exit(0);
