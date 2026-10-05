/**
 * 第 2 步：把 FB 的畫面結構抄下來
 *
 * 跑法：
 *   npm run inspect              → 抄首頁發文框（個人主頁貼文）
 *   node inspect-composer.mjs marketplace  → 抄 Marketplace 刊登表單
 *   node inspect-composer.mjs marketplace-crosspost → 抄「在更多地方上架」對話框
 *   node inspect-composer.mjs group        → 抄「分享到社團」的畫面
 *
 * ⭐ 為什麼一定要有這一步（跟 591 那支同樣的教訓）：
 *    FB 的 class name 是每次改版都會變的亂碼（`x1i10hfl x1qjc9v5 …`），照抄一定壞；
 *    aria-label 又會跟著介面語言變（中文「在想些什麼」／英文 "What's on your mind"）。
 *    而且 Marketplace 的房地產類別在各國開放程度不一樣，你的帳號實際看得到哪些欄位，
 *    只有你的畫面知道。Claude 看不到你的 FB，硬猜 selector 的結果就是點錯按鈕、填錯格子。
 *    所以改成讓程式自己去問那一頁。
 *
 * 產出：config/composer-dump.json（或 marketplace / group 版本）
 *       把這個檔貼回對話，我照它填 selectors.json。
 *
 * ⚠️ 這支只讀不寫，不會發任何文、不會刊登任何東西。
 */
import { chromium } from "playwright";
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  ACTIVITY_LOG_URL,
  AUTH_FILE,
  FB_HOME,
  SHOTS_DIR,
  ensureDir,
  humanDelay,
  stamp,
  waitForEnter,
  HARVEST,
  authSessionStatus,
  啟用的社團,
  登入問題說明,
} from "./_shared.mjs";

const TARGETS = {
  feed: {
    名稱: "首頁發文框（個人主頁貼文）",
    網址: FB_HOME,
    檔名: "composer-dump.json",
    指示: [
      "請在剛剛打開的瀏覽器裡，**自己用滑鼠點開發文框**",
      "（首頁中間那個「在想些什麼？」，點下去會跳出「建立貼文」的視窗）",
      "",
      "⚠️ 點開就好，不要打字、不要按發布。",
    ],
  },
  marketplace: {
    名稱: "Marketplace 刊登表單（出售商品）",
    網址: "https://www.facebook.com/marketplace/create/item",
    檔名: "marketplace-dump.json",
    // 📌 2026-08-25 本人拍板：走「出售商品」，不走「出售或出租房屋」。
    //    「選擇商品類型」那頁有三個：出售商品／出售車輛／出售或出租房屋。
    // 🔴 2026-09-06 補：「狀況」下拉的選項、「更多詳情」展開後裡面是什麼，之前都沒抄到——
    //    不是漏寫程式，是之前沒請本人點開這兩個。程式本身（下面的 HARVEST／portals 掃描）
    //    早就會抓 dialog 內容跟 portal 裡的下拉選項，只要本人這次多點開這兩個地方，
    //    「操作後」那份自然就會抄到，不用另外寫函式。
    指示: [
      "剛剛打開的應該是 Marketplace 的「出售商品」表單",
      "（左邊有：新增相片、標題、價格，最底下一顆「繼續」）。",
      "",
      "  ⚠️ 如果跑出來的是「選擇商品類型」那一頁（三張卡片），",
      "     請自己點**最左邊那張「出售商品」**進去。",
      "     不要點「出售或出租房屋」—— 已經決定不走那條。",
      "",
      "  進到表單之後，隨便填個標題跟價格讓「繼續」亮起來，然後這次多做兩件事：",
      "  ① 點開「狀況」那個下拉選單，把選項留在畫面上（不用選，開著就好）",
      "  ② 找到「更多詳情」（或類似「顯示更多」的展開區塊），點開它",
      "",
      "  **兩個都點開之後，不要收起來，直接回這裡按 Enter**——",
      "  程式會在這個當下抄一次畫面，兩邊都開著才抄得到裡面有什麼。",
      "",
      "  ⚠️ 全程不要按「繼續」、不要按「發佈」。（要按也只按「儲存草稿」，那個不會上架）",
      "",
      "⚠️ 這支只會看，不會幫你填、不會幫你送出。",
    ],
  },
  "marketplace-crosspost": {
    名稱: "Marketplace「在更多地方上架」對話框（一次勾多個社團）",
    網址: "https://www.facebook.com/marketplace/you/selling",
    檔名: "marketplace-crosspost-dump.json",
    // 🔴 2026-09-06 新增：這個對話框到現在完全沒抄過，連「要在建立商品時才會跳出來，
    //    還是要在已經上架的商品那邊才有」都還不確定——這次順便查清楚。
    指示: [
      "剛剛打開的應該是「你的商品」（Marketplace 賣家後台，列出你刊登過的商品）。",
      "",
      "  ① 點開任何一則你已經刊登過的商品",
      "  ② 找「在更多地方上架」（本人截圖看過的那個功能，通常在商品頁面某個按鈕或選單裡）",
      "  ③ 點開它，讓「在更多地方上架」的對話框（列出可以勾選的社團）顯示在畫面上",
      "",
      "  如果在既有商品裡找不到這個功能，改成：開始建立一則新商品、填到快完成的那幾步，",
      "  看看「在更多地方上架」是不是在建立過程中的某一步跳出來——兩種都有可能，",
      "  這次就是要搞清楚是哪一種。**不管哪種都不要真的按下上架／發佈**。",
      "",
      "  對話框開著、看得到社團清單的時候，回這裡按 Enter。",
      "",
      "⚠️ 這支只會看，不會幫你勾、不會幫你送出。",
    ],
  },
  group: {
    名稱: "社團裡的發文框",
    // 抄哪個社團用 FB_GROUP_URL 指定；沒指定就用 config/groups.json 裡第一個啟用的。
    網址: process.env.FB_GROUP_URL || null,
    檔名: "group-dump.json",
    指示: [
      "剛剛打開的是社團頁。請你自己**點開社團裡的發文框**",
      "（社團頁上方那個「寫點什麼吧…」之類的框，點下去會跳出「建立貼文」視窗）。",
      "",
      "⚠️ 點開就好，不要打字、不要按發布。",
      "",
      "（如果這個社團不讓你發文，換一個社團再跑一次：",
      "  set FB_GROUP_URL=<社團網址> 之後再執行）",
    ],
  },
  activity: {
    名稱: "活動紀錄 → 社團貼文和留言（批次刪文用）",
    網址: ACTIVITY_LOG_URL,
    檔名: "activity-dump.json",
    // 📌 給 delete-groups.mjs 用。網址直接就是「社團貼文和留言」（category_key=GROUPPOSTS）。
    //    程式會自己去點第一則貼文的「⋯」把刪除選單抄下來；點不到才叫本人自己點。
    指示: [
      "剛剛打開的應該就是「社團貼文和留言」清單了。",
      "",
      "  ・如果程式上面說「選單開起來了」→ 你什麼都不用做，直接按 Enter。",
      "  ・如果沒有 → 自己挑一則社團貼文，點它右邊的「⋯」，選單跳出來就停手。",
      "",
      "⚠️ 只是把選單點開讓我看結構。**不要點選單裡的「刪除」，不要刪任何東西。**",
    ],
  },
};

const key = (process.argv[2] || "feed").toLowerCase();
const target = TARGETS[key];
if (!target) {
  console.error(`\n❌ 不認得「${key}」。可以用：${Object.keys(TARGETS).join(" / ")}\n`);
  process.exit(1);
}

// 抄社團的話要先知道抄哪一個。沒指定就用 groups.json 裡第一個勾選的，
// 一個都沒勾就直接講，不要開了瀏覽器才發現沒地方去。
if (key === "group" && !target.網址) {
  const 第一個 = 啟用的社團()[0];
  if (!第一個) {
    console.error("\n❌ 不知道要抄哪個社團。");
    console.error("   先跑 `npm run groups` 把社團抓下來，再到 config/groups.json 把要發的社團「啟用」改成 true。");
    console.error("   或是直接指定：FB_GROUP_URL=<社團網址> npm run inspect:group\n");
    process.exit(1);
  }
  target.網址 = 第一個.網址;
  target.名稱 = `社團裡的發文框（${第一個.名稱}）`;
}

// 開瀏覽器之前先看登入檔，沒 session 的話開了也是白開。
// （FB_SKIP_AUTH_CHECK 是拿假頁面煙霧測試時用的，正式跑不會設。）
if (!process.env.FB_SKIP_AUTH_CHECK && !authSessionStatus().有登入) {
  console.error("\n❌ 現在抄不了。");
  console.error(`   ${登入問題說明()}\n`);
  process.exit(1);
}

// 正式跑一律寫進 config/。環境變數是給測試用的，免得拿假頁面煙霧測試時
// 把真的抄回來的那份蓋掉（貼錯檔案給 Claude 比抄不到還糟）。
const DUMP_FILE = path.join(
  process.env.FB_CONFIG_DIR || path.join(import.meta.dirname, "config"),
  target.檔名,
);

const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--start-maximized"] });
const context = await browser.newContext({ storageState: AUTH_FILE, viewport: null, locale: "zh-TW" });
const page = await context.newPage();

ensureDir(SHOTS_DIR);
ensureDir(path.dirname(DUMP_FILE));

console.log(`抄的目標：${target.名稱}`);
console.log(`開啟 ${target.網址} …`);
await page.goto(target.網址, { waitUntil: "domcontentloaded" });
await humanDelay(2500, 3500);

// 登入過期的話畫面上會是登入表單，先擋掉，不然抄回來的是登入頁的欄位
const loginBox = await page
  .locator('input[name="pass"], input[type="password"]')
  .first()
  .isVisible({ timeout: 3000 })
  .catch(() => false);
if (loginBox) {
  console.error("\n❌ FB 給的是登出畫面（畫面上出現密碼欄位），抄不到東西。");
  console.error(`   ${登入問題說明()}\n`);
  await browser.close();
  process.exit(1);
}

await page.screenshot({ path: path.join(SHOTS_DIR, `${stamp()}-${key}-1-進入時.png`) });
const before = await page.evaluate(HARVEST, null);
console.log(`進入時掃到 ${before.filter((e) => e.visible).length} 個候選元素。`);

/**
 * 先讓程式自己試著點開發文框。
 *
 * 出廠的那組候選 selector 是照 FB 目前介面寫的語意選擇器（role／aria-label），
 * 有相當機會直接就中 —— 中了的話這一步完全不用人動手。
 * 沒中才退回「請你自己點」，那時候人點開的畫面正好就是我們要抄的東西。
 *
 * ⚠️ 只點「開啟發文框」這一顆。不會打字、不會上傳、更不會碰發布。
 */
let 自己點開了 = false;
if (key === "feed") {
  try {
    const { loadSelectors, firstVisible } = await import("./_shared.mjs");
    const 候選 = loadSelectors().steps["開啟發文框"].候選;
    const trigger = await firstVisible(page, 候選, 8000);
    if (trigger) {
      console.log("試著自己點開發文框…");
      await trigger.click();
      await humanDelay(1500, 2200);
      const dlg = await page.locator('[role="dialog"]').first().isVisible({ timeout: 5000 }).catch(() => false);
      if (dlg) {
        自己點開了 = true;
        console.log("  ✓ 開起來了，不用你動手。");
      }
    }
  } catch (err) {
    console.log(`  （自己點沒成功：${err.message}）`);
  }
}

// activity：自己去點第一則社團貼文的「⋯」，把刪除選單抄下來 ——
// batch 刪文最需要知道的就是「選單裡『刪除』確切寫什麼字」，本人手動抄常常忘了點開。
if (key === "activity") {
  try {
    const 更多鈕 = page
      .locator('div[role="button"][aria-label*="社團發佈了貼文"][aria-label*="的選項"]')
      .first();
    if (await 更多鈕.isVisible({ timeout: 8000 }).catch(() => false)) {
      console.log("試著自己點開第一則社團貼文的「⋯」選單…");
      await 更多鈕.scrollIntoViewIfNeeded().catch(() => {});
      await humanDelay(600, 1000);
      await 更多鈕.click();
      await humanDelay(1200, 1800);
      const menu = await page.locator('[role="menu"]').first().isVisible({ timeout: 4000 }).catch(() => false);
      if (menu) {
        自己點開了 = true;
        console.log("  ✓ 選單開起來了，把它抄下來（不會點選單裡任何一項）。");
      }
    }
  } catch (err) {
    console.log(`  （自己點 ⋯ 沒成功：${err.message}）`);
  }
}

if (!自己點開了) {
  await waitForEnter(
    ["─".repeat(60), ...target.指示, "", "弄好之後回到這個視窗按 Enter。", "─".repeat(60)].join("\n"),
  );
}

await humanDelay(800, 1200);
await page.screenshot({
  path: path.join(SHOTS_DIR, `${stamp()}-${key}-2-操作後.png`),
  fullPage: key === "marketplace",
});

const after = await page.evaluate(HARVEST, null);

// dialog 裡面的東西才是真正要對映的目標，單獨抄一份比較好認
let dialog = [];
const dialogEl = await page.locator('[role="dialog"]').last().elementHandle().catch(() => null);
if (dialogEl) dialog = await page.evaluate(HARVEST, dialogEl);

// input[type=file] 常常是隱藏的（visible=false），但上傳照片就是要它，所以單獨列
const fileInputs = await page.evaluate(() =>
  Array.from(document.querySelectorAll('input[type="file"]')).map((el) => ({
    accept: el.getAttribute("accept") || "",
    multiple: el.hasAttribute("multiple"),
    ariaLabel: el.getAttribute("aria-label") || "",
    hidden: el.getBoundingClientRect().width === 0,
  })),
);

/**
 * ③ 下拉選單的選項 render 在 body 的 portal，不在表單裡面。
 * 在表單範圍內找不到選項時，八成就是被丟到這裡了 —— 要用 page 層級去找。
 */
const portals = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('[role="listbox"],[role="menu"],[role="tooltip"]')) {
    // 往上看是不是掛在 body 底下的獨立節點（portal），而不是長在表單裡
    let depth = 0;
    let n = el;
    while (n.parentElement && n.parentElement !== document.body) {
      n = n.parentElement;
      depth++;
    }
    const options = Array.from(el.querySelectorAll('[role="option"],[role="menuitem"]'))
      .map((o) => (o.innerText || "").trim().replace(/\s+/g, " ").slice(0, 40))
      .filter(Boolean)
      .slice(0, 30);
    out.push({
      role: el.getAttribute("role"),
      掛在body底下第幾層: depth,
      選項數: options.length,
      前幾個選項: options,
    });
  }
  return out;
});

/**
 * 批次刪文要認的是「清單裡每一列」——一個會重複 N 次的容器。
 * 這裡把幾個常見候選各數一數重複幾次，最接近清單長度的那個八成就是。
 */
let 清單分析 = null;
if (key === "activity") {
  清單分析 = await page.evaluate(() => {
    const 候選 = [
      'div[role="main"] div[role="article"]',
      'div[role="main"] div[role="listitem"]',
      'div[aria-label="活動紀錄"] div[role="listitem"]',
      'div[role="feed"] > div',
      'div[role="list"] > div',
    ];
    const 重複數 = 候選.map((sel) => ({ selector: sel, 出現次數: document.querySelectorAll(sel).length }));
    // 「⋯」選單（role="menu"）現在應該是開著的，把裡面每一項的字抄下來
    const 選單 = [...document.querySelectorAll('[role="menu"]')].map((m) => ({
      項目: [...m.querySelectorAll('[role="menuitem"]')]
        .map((it) => (it.innerText || "").trim().replace(/\s+/g, " ").slice(0, 40))
        .filter(Boolean),
    }));
    return { 重複容器候選: 重複數, 更多動作選單內容: 選單 };
  });
}

const dump = {
  抄的是: target.名稱,
  抄的時間: stamp(),
  最後停在的網址: page.url(),
  說明: "把這個檔整份貼回對話，Claude 會照它填 config/selectors.json。裡面沒有帳密。",
  操作前: before.filter((e) => e.visible),
  操作後: after.filter((e) => e.visible),
  視窗內部: dialog,
  檔案上傳欄位: fileInputs,
  下拉選項的portal: portals,
  ...(清單分析 ? { 清單分析 } : {}),
  給Claude的提醒: [
    "id能不能用=false 的不要拿去寫 selector（自動產生的流水號，改版會整排位移）",
    "旁邊的標籤 是往上找幾層撿到的，可能撿錯，跟截圖對一下",
    "下拉選項的portal 有東西的話，選項要用 page 層級找，不是在表單裡找",
    ...(key === "activity"
      ? ["清單分析.重複容器候選 裡『出現次數』最接近清單長度的，就是 activity_delete.貼文列項 的正選"]
      : []),
  ],
};

writeFileSync(DUMP_FILE, JSON.stringify(dump, null, 2), "utf8");

console.log(`\n✅ 已抄到：${DUMP_FILE}`);
console.log(`   操作後看得到 ${dump.操作後.length} 個元素、視窗內部 ${dialog.length} 個、檔案欄位 ${fileInputs.length} 個。`);
console.log(`\n下一步：把 config/${target.檔名} 貼回對話給我，我填 selectors.json。`);
console.log(`（截圖在 shots/，抄出來看起來不對的話也一起貼過來）`);

await browser.close();
process.exit(0);
