/**
 * 抄「發布」那一步的結構
 *
 * 跑法：node probe-publish.mjs   （或點桌面的「FB抄發布鈕.bat」）
 *
 * ⭐ 為什麼要單獨一支：
 *    2026-08-25 實測發現 FB 的發文框是**兩段式**——打完字之後那顆藍色滿版按鈕
 *    寫的是「繼續」不是「發佈」，按下去才會到第二步。第二步長什麼樣、
 *    發佈鈕叫什麼，只有按過才知道。
 *
 * 🔴 這支**不會**幫你按「繼續」，也**絕對不會**按發佈。
 *    按繼續那一下由你自己來 —— 我不知道按下去會發生什麼，而這是你的真實帳號。
 *    程式只負責在你按完之後，把畫面上的結構抄下來。
 *
 * 產出：config/publish-dump.json —— 貼回對話，我照它把發布那一步寫完。
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
  登入問題說明,
} from "./_shared.mjs";

if (!authSessionStatus().有登入) {
  console.error("\n❌ 現在跑不了。");
  console.error(`   ${登入問題說明()}\n`);
  process.exit(1);
}

const DUMP_FILE = path.join(import.meta.dirname, "config", "publish-dump.json");
const selectors = loadSelectors().steps;

const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--start-maximized"] });
const context = await browser.newContext({ storageState: AUTH_FILE, viewport: null, locale: "zh-TW" });
const page = await context.newPage();

ensureDir(SHOTS_DIR);
ensureDir(path.dirname(DUMP_FILE));

try {
  console.log("開啟 Facebook…");
  await page.goto(FB_HOME, { waitUntil: "domcontentloaded" });
  await humanDelay(2500, 3500);

  if (await firstVisible(page, selectors["登入過期偵測"].候選, 2500)) {
    throw new Error(`FB 給的是登出畫面。\n   ${登入問題說明()}`);
  }

  console.log("點開發文框…");
  const trigger = await firstVisible(page, selectors["開啟發文框"].候選, 12000);
  if (!trigger) throw new Error("找不到首頁的發文框。FB 大概改版了，重跑 `npm run inspect`。");
  await trigger.click();
  await humanDelay(1500, 2200);

  const dialog = await firstVisible(page, selectors["發文視窗"].候選, 10000);
  if (!dialog) throw new Error("「建立貼文」視窗沒出現。重跑 `npm run inspect` 換 selector。");

  // 打幾個字進去。FB 的按鈕文字會隨內容變，空白的發文框問不出真正的答案。
  console.log("打幾個字進去（不會送出）…");
  const box = await firstVisible(dialog, selectors["內文輸入框"].候選, 8000);
  if (!box) throw new Error("找不到內文輸入框。重跑 `npm run inspect` 換 selector。");
  await box.click();
  await humanDelay(400, 800);
  await page.keyboard.insertText("測試用文字，等一下會直接關掉，不會發出去。");
  await humanDelay(800, 1200);

  await page.screenshot({ path: path.join(SHOTS_DIR, `${stamp()}-publish-1-打完字.png`) });
  const 第一步 = await page.evaluate(HARVEST, await dialog.elementHandle());

  await waitForEnter(
    [
      "─".repeat(60),
      "現在請你在瀏覽器裡，**自己按一次那顆藍色的「繼續」**。",
      "",
      "  ⚠️ 只按「繼續」。看到下一頁之後就停手，",
      "     **不要按「發佈」**（按了就真的發出去了）。",
      "",
      "按完、看到下一個畫面之後，回到這個視窗按 Enter。",
      "（我會把那一頁的結構抄下來，然後直接關掉，不會留下任何東西）",
      "─".repeat(60),
    ].join("\n"),
  );

  await humanDelay(1000, 1600);
  await page.screenshot({ path: path.join(SHOTS_DIR, `${stamp()}-publish-2-按繼續之後.png`) });

  // 按了繼續之後可能換了一個 dialog，重新找一次，找不到就退回抄整頁
  const 第二步視窗 = await page.locator('div[role="dialog"]').last().elementHandle().catch(() => null);
  const 第二步 = await page.evaluate(HARVEST, 第二步視窗);
  const 整頁 = await page.evaluate(HARVEST, null);

  const 滿版按鈕 = 整頁.filter((r) => r.role === "button" && r.w > 200 && r.h < 60);

  writeFileSync(
    DUMP_FILE,
    JSON.stringify(
      {
        抄的是: "發布那一步（FB 是兩段式發文框）",
        抄的時間: stamp(),
        最後停在的網址: page.url(),
        說明: "貼回對話，Claude 會照它把 selectors.json 的『發布按鈕』寫完。裡面沒有帳密。",
        按繼續之前的視窗: 第一步,
        按繼續之後的視窗: 第二步,
        按繼續之後整頁的滿版按鈕: 滿版按鈕,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`\n✅ 已抄到：${DUMP_FILE}`);
  console.log(`   按繼續之後找到 ${滿版按鈕.length} 顆滿版按鈕：`);
  for (const b of 滿版按鈕) console.log(`     ・${b.ariaLabel || b.text || "(沒有標籤)"}（${b.w}×${b.h}）`);
  console.log(`\n下一步：把 config/publish-dump.json 貼回對話給我。`);
  console.log(`（截圖在 shots/，看起來不對的話也一起貼過來）`);
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  await page.screenshot({ path: path.join(SHOTS_DIR, `${stamp()}-publish-失敗.png`) }).catch(() => {});
  process.exitCode = 1;
} finally {
  // 直接關掉。沒按發佈的貼文不會留在 FB 上。
  await browser.close().catch(() => {});
}

process.exit(process.exitCode || 0);
