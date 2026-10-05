/**
 * 抄「第二步」—— 發文與 Marketplace 各一次
 *
 * 跑法：node probe-step2.mjs        （或點桌面的「FB抄第二步.bat」）
 *       node probe-step2.mjs feed        只抄發文那條
 *       node probe-step2.mjs marketplace 只抄 Marketplace 那條
 *
 * ⭐ 為什麼要單獨一支：FB 這兩個流程都是**兩段式**。
 *    ・發文：打完字之後藍色按鈕寫「繼續」，按了才到有「發佈」的那一步
 *    ・Marketplace：填完標題／價格／類別之後也有一顆「繼續」
 *    第二步長什麼樣，只有按過才知道。
 *
 * 🔴 這支**不會**幫你按「繼續」，更**絕對不會**按「發佈」或「上架」。
 *    按繼續那一下由你自己來。程式只負責在你按完之後把畫面結構抄下來。
 *
 * 📌 Marketplace 這段會自己填測試用的標題與價格（不填的話「繼續」不會亮），
 *    類別固定選「其他商品」（2026-08-25 本人拍板，跟他現有 20+ 筆刊登一致）。
 *    抄完直接關掉瀏覽器 —— 沒按上架的東西不會出現在 Marketplace 上。
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  AUTH_FILE,
  FB_HOME,
  SHOTS_DIR,
  HARVEST,
  authSessionStatus,
  ensureDir,
  firstVisible,
  humanDelay,
  loadSelectors,
  stamp,
  waitForEnter,
  從捲動清單選,
  登入問題說明,
} from "./_shared.mjs";

const 只跑 = (process.argv[2] || "").toLowerCase();
const 要跑發文 = !只跑 || 只跑 === "feed";
const 要跑MP = !只跑 || 只跑 === "marketplace";

if (!authSessionStatus().有登入) {
  console.error("\n❌ 現在跑不了。");
  console.error(`   ${登入問題說明()}\n`);
  process.exit(1);
}

const cfg = loadSelectors();
const S = cfg.steps;
const MP = cfg.marketplace.steps;
const DUMP_FILE = path.join(import.meta.dirname, "config", "step2-dump.json");

const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--start-maximized"] });
const context = await browser.newContext({ storageState: AUTH_FILE, viewport: null, locale: "zh-TW" });
const page = await context.newPage();

ensureDir(SHOTS_DIR);
ensureDir(path.dirname(DUMP_FILE));

const 結果 = { 抄的時間: stamp(), 說明: "貼回對話給 Claude。裡面沒有帳密。" };
const shot = (n) => page.screenshot({ path: path.join(SHOTS_DIR, `${stamp()}-${n}.png`) }).catch(() => {});

/** 按了「繼續」之後，把畫面上重要的東西抄下來。 */
async function 抄目前畫面(標記) {
  await humanDelay(1200, 1800);
  await shot(標記);
  const 整頁 = await page.evaluate(HARVEST, null);
  const 視窗 = await page.locator('div[role="dialog"]').last().elementHandle().catch(() => null);
  return {
    網址: page.url(),
    視窗內部: 視窗 ? await page.evaluate(HARVEST, 視窗) : [],
    滿版按鈕: 整頁.filter((r) => r.role === "button" && r.w > 200 && r.h < 70),
    所有有標籤的按鈕: 整頁
      .filter((r) => r.role === "button" && (r.ariaLabel || (r.text || "").trim()))
      .map((r) => ({ aria: r.ariaLabel, text: (r.text || "").slice(0, 24), w: r.w, h: r.h })),
    輸入欄位: 整頁.filter(
      (r) => ["input", "textarea"].includes(r.tag) || r.role === "textbox" || r.role === "combobox",
    ),
    // 🔴 2026-09-06 補：「在更多地方上架」那頁的社團清單是一排 role="checkbox"，
    //    原本這裡沒收，HARVEST 本身抓得到、但這個函式的篩選漏了它。
    勾選方塊: 整頁.filter((r) => r.role === "checkbox" || r.role === "radio"),
  };
}

try {
  /* ══════════════ A. 發文的第二步 ══════════════ */
  if (要跑發文) {
    console.log("\n【1/2】發文 —— 抄「繼續」之後那一步\n");
    await page.goto(FB_HOME, { waitUntil: "domcontentloaded" });
    await humanDelay(2500, 3500);

    if (await firstVisible(page, S["登入過期偵測"].候選, 2500)) {
      throw new Error(`FB 給的是登出畫面。\n   ${登入問題說明()}`);
    }

    const trigger = await firstVisible(page, S["開啟發文框"].候選, 12000);
    if (!trigger) throw new Error("找不到首頁的發文框。FB 大概改版了，重跑 `npm run inspect`。");
    await trigger.click();
    await humanDelay(1500, 2200);

    const dialog = await firstVisible(page, S["發文視窗"].候選, 10000);
    if (!dialog) throw new Error("「建立貼文」視窗沒出現。");

    const box = await firstVisible(dialog, S["內文輸入框"].候選, 8000);
    if (!box) throw new Error("找不到內文輸入框。");
    await box.click();
    await humanDelay(400, 800);
    await page.keyboard.insertText("測試用文字，等一下直接關掉，不會發出去。");
    await humanDelay(800, 1200);
    await shot("step2-發文-打完字");

    await waitForEnter(
      [
        "─".repeat(60),
        "【發文】請你在瀏覽器裡，**自己按一次那顆藍色的「繼續」**。",
        "",
        "  ⚠️ 只按「繼續」。看到下一頁就停手，**不要按「發佈」**。",
        "",
        "按完之後回這個視窗按 Enter。",
        "─".repeat(60),
      ].join("\n"),
    );

    結果.發文_按繼續之後 = await 抄目前畫面("step2-發文-按繼續之後");
    console.log("  ✓ 抄好了");
  }

  /* ══════════════ B. Marketplace 的第二步 ══════════════ */
  if (要跑MP) {
    console.log("\n【2/2】Marketplace —— 抄「繼續」之後那一步\n");
    await page.goto(cfg.marketplace._網址, { waitUntil: "domcontentloaded" });
    await humanDelay(3500, 4500);

    console.log("填測試用的標題與價格（不填「繼續」不會亮）…");
    const 標題 = await firstVisible(page, MP["標題"].候選, 10000);
    const 價格 = await firstVisible(page, MP["價格"].候選, 8000);
    if (!標題 || !價格) throw new Error("找不到標題或價格欄位。Marketplace 改版了，重跑 `npm run inspect:marketplace`。");
    await 標題.fill("測試用，請忽略");
    await humanDelay(400, 800);
    await 價格.fill("100");
    await humanDelay(600, 1000);

    // 📌 類別固定「其他商品」。這是本人現有 20+ 筆刊登在用的類別。
    console.log("選類別「其他商品」…");
    const 類別 = page.locator(MP["類別"].候選[0]).first();
    const 選到了 = await 從捲動清單選(page, 類別, "其他商品");
    console.log(選到了 ? "  ✓ 選到了" : "  ⚠ 沒選到，等一下麻煩你自己選");
    結果.類別_程式選得到嗎 = 選到了;

    await humanDelay(800, 1200);
    await shot("step2-MP-填好");

    結果.Marketplace_第一步填好之後 = await 抄目前畫面("step2-MP-第一步");

    await waitForEnter(
      [
        "─".repeat(60),
        "【Marketplace】畫面上現在應該有：標題「測試用，請忽略」、價格 100。",
        "",
        "  1. 如果「類別」還是空的，請自己選成 **其他商品**",
        "  2. 「狀況」如果是必填，也隨便選一個",
        "  3. 🔴 加一張隨便的相片（沒有相片「繼續」不會亮，2026-09-06 本人實測發現的）",
        "  4. 然後**自己按一次「繼續」**",
        "",
        "  ⚠️ 只按「繼續」。這次應該會跳到「在更多地方上架」（社團清單）那一頁，看到就停手，",
        "     **不要勾社團、不要按「發佈」**。",
        "",
        "按完之後回這個視窗按 Enter。",
        "─".repeat(60),
      ].join("\n"),
    );

    結果.Marketplace_按繼續之後 = await 抄目前畫面("step2-MP-按繼續之後");
    console.log("  ✓ 抄好了");
  }

  writeFileSync(DUMP_FILE, JSON.stringify(結果, null, 2), "utf8");
  console.log(`\n✅ 已抄到：${DUMP_FILE}`);
  for (const [k, v] of Object.entries(結果)) {
    if (v && v.滿版按鈕) {
      console.log(`\n   【${k}】停在 ${v.網址}`);
      for (const b of v.滿版按鈕) console.log(`     ・${b.ariaLabel || b.text || "(沒有標籤)"}（${b.w}×${b.h}）`);
    }
  }
  console.log(`\n下一步：把 config/step2-dump.json 貼回對話給我。`);
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  await shot("step2-失敗");
  console.error(`   截圖在 ${SHOTS_DIR}`);
  process.exitCode = 1;
} finally {
  // 直接關掉。沒按上架／發佈的東西不會留在 FB 上。
  await browser.close().catch(() => {});
}

process.exit(process.exitCode || 0);
