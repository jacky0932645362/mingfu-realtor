#!/usr/bin/env node
/**
 * Marketplace 自動填表單 ＋ 自動勾社團上架（2026-09-06，Phase 2＋3）
 *
 * 跑法：
 *   node post-marketplace.mjs --draft=<fb_draft的id>                   填好停在「儲存草稿」，不會上架
 *   node post-marketplace.mjs --draft=<id> --publish                  真的按「發佈」（會真的上架 Marketplace！）
 *   node post-marketplace.mjs --draft=<id> --publish --crosspost      發佈＋真的勾選貼文庫存的社團清單一起上架
 *   node post-marketplace.mjs --draft=<id> --headless                 不開視窗（先手動測過穩了再用）
 *   node post-marketplace.mjs --draft=<id> --photos=<資料夾路徑>        自己指定照片，跳過從物件庫抓網址
 *
 * <id> 就是後台「貼文庫」網址列 /admin/fb/library/<這一段> 的那串。
 * --photos= 可以是一個資料夾（會用裡面全部圖片，依檔名排序）或單一圖片檔的路徑。
 *
 * 🔴 --publish 跟 --crosspost 是兩道獨立的門，不是同一件事：
 *    ・只有 --publish：一樣會走到「在更多地方上架」那頁，但社團 checkbox 全部維持原狀
 *      不勾（跟 Phase 2 時期行為相同），只上架到 Marketplace 本身。
 *      這樣可以先看 `config/group-crosspost-debug.json`／`5b-社團勾好` 截圖，
 *      確認「比對到哪個社團」比對得對不對，再放心讓它真的去點。
 *    ・--publish --crosspost 才會真的點下去勾社團。**社團勾錯＝真的公開發到錯的社團**，
 *      比填表單階段的失敗嚴重很多（發錯了要手動去那個社團刪文），所以刻意拆成兩道門，
 *      不是 --publish 就自動包含勾社團。
 *
 * 🔴 為什麼預設不 --publish：這是全新自動化，Marketplace 表單比一般發文複雜、
 *    FB 對商業性刊登的異常偵測也更敏感。跟 post.mjs 當初上線同一個節奏——
 *    先確定「填得對」，多測幾次穩了，才談「要不要自動按下去」。
 *
 * 🔴 「狀況」（全新／二手…）2026-09-06 起要在貼文庫的 Marketplace 分頁選好——房子沒有
 *    一個選項是真正對的，所以不自動猜，貼文庫沒選、也沒設 FB_MP_CONDITION 環境變數的話
 *    這支會直接擋下來不開瀏覽器（跟「類別」固定選「其他商品」不一樣，那個 2026-08-25
 *    本人親口拍板固定死，狀況沒辦法比照，因為真的沒有哪個選項算對）。
 *
 * 🔴 「說明」欄位在 selectors.json 裡刻意沒有寫死的 selector（harvest 只抓到不可靠的
 *    「旁邊的標籤」heuristic）。這裡改成「用已驗證的『更多詳情』按鈕當錨點，找它後面
 *    第一個 textarea」——錨點是真的驗證過的元素，不是憑空猜的 CSS combinator。
 */
import path from "node:path";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import {
  AUTH_FILE,
  PROJECT_ROOT,
  SHOTS_DIR,
  authSessionStatus,
  ensureDir,
  firstVisible,
  humanDelay,
  loadEnv,
  loadSelectors,
  preparePhotos,
  registerAliasHooks,
  stamp,
  從捲動清單選,
  登入問題說明,
} from "./_shared.mjs";
// 擬真模式（2026-09-18）：滑鼠曲線、分段打字、進頁面先看一下。點不到會自己退回 Playwright 的 click。
import { humanizeSummary, humanClick, humanType, humanBrowse, idle } from "./humanize.mjs";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const arg = (n) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(`--${n}=`.length) : null;
};

const DRAFT_ID = arg("draft");
const DO_PUBLISH = flag("publish");
const DO_CROSSPOST = flag("crosspost");
const HEADLESS = flag("headless");

if (!DRAFT_ID) {
  console.error("\n❌ 要給 --draft=<fb_draft 的 id>（貼文庫那則文案的 id）。\n");
  console.error("   例：node post-marketplace.mjs --draft=abcd1234...\n");
  process.exit(1);
}

if (!process.env.FB_SKIP_AUTH_CHECK && !authSessionStatus().有登入) {
  console.error(`\n❌ 現在跑不了。\n   ${登入問題說明()}\n`);
  process.exit(1);
}

/* ────────────────── 讀草稿（沿用 new-post.mjs 的 alias hook 做法，不重寫查詢邏輯） ────────────────── */

loadEnv();
registerAliasHooks();
const base = pathToFileURL(PROJECT_ROOT).href;
const { getFbDraft, parseMarketplace, parseFacts, setDraftStatus, getFbGroup } = await import(
  `${base}/src/lib/fb-factory.ts`
);
const { getProperty } = await import(`${base}/src/lib/property.ts`);
const { directImageUrl, parseImageList } = await import(`${base}/src/lib/media-url.ts`);
const { checkCopy, findMarkdownSyntax } = await import(`${base}/src/lib/fb-copy.ts`);

const draft = await getFbDraft(DRAFT_ID);
if (!draft) {
  console.error(`\n❌ 貼文庫裡找不到 id=${DRAFT_ID}\n`);
  process.exit(1);
}
const mp = parseMarketplace(draft.marketplace_json);
if (!mp || !mp.title || mp.priceTwd == null) {
  console.error(`\n❌ 「${draft.title}」沒有可用的 Marketplace 版本（標題或價格是空的）。\n`);
  console.error("   去後台貼文庫那則文案的 Marketplace 分頁確認欄位都填了。\n");
  process.exit(1);
}

// 🔴 2026-09-06 本人要求改成寫文案的時候就要選好「狀況」，不要留到這裡才用暫定值頂著
// （之前這裡是寫死選「全新」，本人測完第一則之後才發現該挑但沒得挑）。
// 貼文庫沒選的話，用 FB_MP_CONDITION 環境變數當最後備援（給還沒補選的舊草稿一條路），
// 兩邊都沒有就直接擋下來，不用猜。
const 狀況清單 = ["全新", "二手 - 近全新", "二手 - 良好", "二手 - 普通"];
const 狀況 = mp.condition || process.env.FB_MP_CONDITION || "";
if (!狀況清單.includes(狀況)) {
  console.error(`\n❌ 「${draft.title}」的 Marketplace 版本沒有選「狀況」。\n`);
  console.error(`   去貼文庫那則的 Marketplace 分頁選一個：${狀況清單.join("／")}\n`);
  process.exit(1);
}

// 🔴 2026-09-06 本人實測拍板：Marketplace 的「地點」只要填「城市＋區」（例：台中市梧棲區），
// 不要填到路名——FB 這個欄位是地區級的自動完成，不是街道地址，跟一般貼文的「路名」規則不一樣。
// 用 facts_json 現成的 city／district（已經是「梧棲區」這種帶區的格式），不重新解析 mp.location。
const facts = parseFacts(draft.facts_json);
const 地點輸入值 = [facts.city, facts.district].filter(Boolean).join("") || mp.location || "";

const prop = draft.source_property_id ? await getProperty(draft.source_property_id) : null;

// 🔴 2026-09-06 實測抓到：這則草稿的 marketplace_json.location 存了完整門牌「７７７號」
// （物件庫的 address_public 本來就有門牌，這則草稿產生的當下沒有經過 roadLevelAddress 過濾，
//  是舊資料留下來的，不是這次才發生）。post.mjs／一般貼文那邊本來就有 checkCopy() 這道關卡，
//  Marketplace 這邊之前沒有——差點就把完整門牌自動打進真的 FB 公開商品頁。
//  現在補上同一道關卡，開瀏覽器之前就擋，不要等填到一半才發現。
if (prop) {
  const 合併檢查文字 = [mp.title, mp.description, mp.location].filter(Boolean).join("\n");
  const 問題 = checkCopy(合併檢查文字, prop).filter((w) => w.startsWith("🔴"));
  if (問題.length > 0) {
    console.error(`\n❌ 「${draft.title}」的 Marketplace 內容沒過合規檢查：`);
    for (const w of 問題) console.error(`   ${w}`);
    console.error("   回後台貼文庫那則文案的 Marketplace 分頁改掉再跑，這支不會幫你判斷要不要送出去。\n");
    process.exit(1);
  }
} else {
  console.log("⚠ 這則文案沒連結物件，跳過門牌／內部備註的合規檢查（沒有物件資料可以比對）。");
}

// 說明沿用文案，發出去之前一樣要擋 Markdown（跟一般貼文同一套規矩，FB 不吃 ** # [] ` ）。
const md = findMarkdownSyntax(mp.description || "");
if (md.length > 0) {
  console.error(`\n❌ 「說明」裡有 FB 不支援的語法：`);
  for (const m of md) console.error(`   第 ${m.line} 行 ${m.kind}：${m.text}`);
  console.error("   FB 只會原樣印出符號，先回後台改掉再跑。\n");
  process.exit(1);
}

// fb_draft 沒有照片欄位。連物件庫的：從物件帶網址（見 /api/fb/runner claim 的做法）。
// 手動填的：照片自己帶在 facts_json.photos（產文案那頁就編排好，2026-09-06）。
// 給 --photos=<本機資料夾或檔案路徑> 可以直接指定本機照片，跳過網址下載那一步。
const PHOTOS_OVERRIDE = arg("photos");
const photoUrls = PHOTOS_OVERRIDE
  ? [PHOTOS_OVERRIDE]
  : prop
    ? [...(prop.cover_url ? [directImageUrl(prop.cover_url.trim())] : []), ...parseImageList(prop.photo_urls)]
        .filter((u, i, a) => u && a.indexOf(u) === i)
        .slice(0, 10) // Marketplace 上限 10 張
    : // 手動填的：facts.photos 存的時候（parseFbPhotoLines）已經正規化過 ——
      // 網址是直連、本機路徑原樣。這裡直接交給 preparePhotos（它會下載網址、展開資料夾）。
      (facts.photos || []).map(String).filter(Boolean).slice(0, 10);
if (photoUrls.length === 0) {
  console.error(`\n❌ 「${draft.title}」沒有照片可以上傳（物件庫沒有照片，或這則文案沒連結物件）。`);
  console.error("   Marketplace 沒有照片「繼續」按不下去，先回物件庫補照片，");
  console.error("   或加 --photos=<本機資料夾路徑> 直接指定要用的照片。\n");
  process.exit(1);
}

console.log(`\n草稿：「${draft.title}」`);
console.log(`  標題　${mp.title}`);
console.log(`  價格　實際 NT$${mp.priceTwd.toLocaleString("en-US")}，會填進 FB 的簡化數字：${Math.round(mp.priceTwd / 10_000)}`);
console.log(`  地點　${mp.location || "（空）"}`);
console.log(`  照片　${PHOTOS_OVERRIDE ? `本機：${PHOTOS_OVERRIDE}` : "物件庫的照片網址"}`);
console.log(`  狀況　${狀況}`);
console.log(`  ${humanizeSummary()}`);

/* ────────────────── 照片先備好（跟 post.mjs 同一個 preparePhotos，不重寫） ────────────────── */

console.log("\n照片先抓下來（Marketplace 只吃本機檔案）…");
const { files: photoFilesAll, failed: photoFailed } = await preparePhotos(photoUrls);
if (photoFailed.length) {
  for (const f of photoFailed) console.log(`  ⚠ 備不出來：${f.來源}（${f.reason}）`);
}
// 🔴 Marketplace 上限 10 張。網址來源在 photoUrls 那邊就 slice(0,10) 過了，但
// --photos=<資料夾> 那條沒有（資料夾裡塞幾張算幾張），這裡統一再砍一次 —— 多的
// 傳到一半失敗、或 FB 只收前幾張，會刊出「照片對不上」的商品。依檔名排序取前 10。
const photoFiles = photoFilesAll.slice(0, 10);
if (photoFilesAll.length > 10) {
  console.log(`  ⚠ 來源有 ${photoFilesAll.length} 張，Marketplace 上限 10 張，只用前 10 張（依檔名排序）。`);
}
if (photoFiles.length === 0) {
  console.error("\n❌ 一張照片都備不出來，不繼續（免得刊出一張圖都沒有的商品）。\n");
  process.exit(1);
}
console.log(`  ✓ 備好 ${photoFiles.length} 張`);

/* ────────────────── 開瀏覽器 ────────────────── */

const cfg = loadSelectors();
const MP = cfg.marketplace.steps;
const AUD = cfg.marketplace_audience;

const browser = await chromium.launch({ channel: "chrome", headless: HEADLESS, args: ["--start-maximized"] });
const context = await browser.newContext({
  storageState: AUTH_FILE,
  viewport: HEADLESS ? { width: 1440, height: 900 } : null,
  locale: "zh-TW",
});
const page = await context.newPage();
ensureDir(SHOTS_DIR);

const shot = (name) =>
  page.screenshot({ path: path.join(SHOTS_DIR, `${stamp()}-mp-${name}.png`) }).catch(() => {});

/** 找不到東西、或按了但沒有預期反應——乾淨中止，不要硬著頭皮往下按。 */
class 刊登失敗 extends Error {}
const 失敗 = (msg) => {
  throw new 刊登失敗(msg);
};

/**
 * Fisher–Yates 洗牌後取前 n 個。
 *
 * 本人 2026-09-22 要求：貼文庫勾超過 20 個社團時，不要每次都固定取清單排在前面的
 * 20 個（那樣排後面的社團永遠不會被選到），改成每次跑都隨機抽 20 個。不改動原陣列。
 */
function 隨機抽(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

try {
  console.log(`\n開啟 ${cfg.marketplace._網址} …`);
  await page.goto(cfg.marketplace._網址, { waitUntil: "domcontentloaded" });
  await humanDelay(2500, 3500);

  if (await firstVisible(page, cfg.steps["登入過期偵測"].候選, 3000)) {
    失敗(`FB 給的是登出畫面。\n   ${登入問題說明()}`);
  }
  await shot("1-進入時");
  await humanBrowse(page); // 擬真：先看一下表單再動手

  console.log("填標題／價格…");
  const 標題 = await firstVisible(page, MP["標題"].候選, 10000);
  const 價格 = await firstVisible(page, MP["價格"].候選, 8000);
  if (!標題 || !價格) 失敗("找不到標題或價格欄位，Marketplace 大概改版了，重跑 `npm run inspect:marketplace`。");
  // 標題：先點進去（曲線）、清空、再分段打（一般 <input>，insertText 跟 fill 觸發的是同一種 input 事件）
  await humanClick(page, 標題);
  await 標題.fill("");
  await humanType(page, String(mp.title).split(/\r?\n/).join(" ").trim()); // <input> 裡不能有換行（Shift+Enter 可能會送出表單）
  await humanDelay(400, 700);
  // 🔴 2026-09-06 本人拍板：價格欄故意不填真的元（768萬填 7680000），
  //    改填簡化數字（768萬→768、1000萬→1000、1.15億→11500）——海線 Marketplace 房地產
  //    貼文都這樣貼，客戶看習慣簡化數字。這是「填進 FB 的字」跟真實金額的落差，
  //    只在這支自動化腳本做轉換，資料庫的 priceTwd 欄位本身還是存真的元、意義不變。
  const 價格簡化 = Math.round(mp.priceTwd / 10_000);
  await humanClick(page, 價格);
  await 價格.fill(String(價格簡化));
  await humanDelay(400, 700);

  console.log(`選類別「${MP["類別"].固定選}」…`);
  const 類別Combo = page.locator(MP["類別"].候選[0]).first();
  if (!(await 從捲動清單選(page, 類別Combo, MP["類別"].固定選))) {
    失敗(`「類別」選不到「${MP["類別"].固定選}」，畫面可能改版了。`);
  }
  await humanDelay(400, 700);

  console.log(`選狀況「${狀況}」…`);
  const 狀況Combo = page.locator(MP["狀況"].候選[0]).first();
  if (!(await 從捲動清單選(page, 狀況Combo, 狀況))) {
    失敗(`「狀況」選不到「${狀況}」，選項可能改了（原本是：${MP["狀況"].選項.join("／")}）。`);
  }
  await humanDelay(400, 700);
  await shot("2-標題價格類別狀況填好");

  console.log("展開「更多詳情」…");
  const 更多詳情 = await firstVisible(page, MP["更多詳情"].候選, 8000);
  if (!更多詳情) 失敗("找不到「更多詳情」，Marketplace 大概改版了。");
  const 說明Textarea = 更多詳情.locator("xpath=following::textarea[1]");

  // 🔴 2026-09-06 實測抓到：點一次不保證真的展開（第一次真的自動點這顆，之前兩次抄畫面
  //    都是本人自己手動點的，沒被驗證過）。改成「點了就檢查有沒有真的長出東西，
  //    沒有就再點一次」，不要點一次就假設成功往下衝。
  let 展開了 = false;
  for (let i = 0; i < 3 && !展開了; i++) {
    await humanClick(page, 更多詳情);
    await humanDelay(900, 1400);
    展開了 = (await 說明Textarea.count()) > 0 && (await 說明Textarea.isVisible().catch(() => false));
  }
  if (!展開了) 失敗("點了「更多詳情」但沒有展開出「說明」欄位，畫面可能改版了。");

  // 「說明」沒有已驗證的 selector（見檔頭說明）。用已驗證的「更多詳情」按鈕當錨點，
  // 找它在 DOM 順序上後面第一個 textarea —— 這是實測過的相對位置，不是憑空猜的字串。
  console.log("填「說明」…");
  await humanClick(page, 說明Textarea);
  await humanDelay(300, 500);
  await humanType(page, mp.description || ""); // 擬真：分段打、標點後停；textarea 換行走 Shift+Enter 一樣是換行
  await humanDelay(500, 900);

  // 打完字對答案，跟一般貼文同一個門檻——少超過一成就中止，不要送出殘缺的說明。
  const 說明實際 = ((await 說明Textarea.inputValue().catch(() => null)) ?? (await 說明Textarea.textContent()) ?? "").replace(
    /\s+/g,
    "",
  );
  const 說明預期 = (mp.description || "").replace(/\s+/g, "");
  if (說明預期.length > 0 && 說明實際.length < 說明預期.length * 0.9) {
    失敗(`「說明」沒有完整打進去（預期 ${說明預期.length} 字，實際 ${說明實際.length} 字）。不繼續，免得刊出殘缺的說明。`);
  }

  if (地點輸入值) {
    // 🔴 2026-09-06 第四輪實測抓到：地點沒選到自動完成建議清單裡的項目時，FB 直接把這欄
    // 判定成無效（畫面出現紅框＋「請輸入有效的地點」），這才是真正卡住「繼續」的原因——
    // 照片已經證實沒問題了（filechooser 那招修好、縮圖也確認跑出來了）。懷疑是原本用
    // insertText() 一次貼上整串文字，但 FB 這個地區自動完成是逐字監聽輸入才觸發查詢的
    // 即時搜尋元件，整串貼上不會觸發——改成 pressSequentially() 逐字打，模擬真人打字節奏。
    // 如果打了完整「城市＋區」還是叫不出建議，退而求其次只打城市（本人建議「地點只要台中市
    // 就好」）——精確度差一點，但總比卡在「繼續」按不下去好，而且沒有違反「地點不要填到路名」
    // 那條限制（城市本來就比「城市＋區」更粗略，不是更細）。
    const 試填地點 = async (文字) => {
      await 地點.fill("");
      await humanDelay(200, 400);
      await 地點.pressSequentially(文字, { delay: 120 });
      await humanDelay(300, 600);
      const 建議 = page.locator('[role="listbox"] [role="option"], [role="listbox"] li').first();
      const 有建議 = await 建議.isVisible({ timeout: 4000 }).catch(() => false);
      if (有建議) {
        await humanClick(page, 建議).catch(() => {});
        await humanDelay(400, 700);
      }
      return 有建議;
    };

    console.log(`填「地點」「${地點輸入值}」…`);
    const 地點 = await firstVisible(page, MP["更多詳情"].地點欄位候選, 5000);
    const 地點結果 = { 找到欄位: Boolean(地點), 最終嘗試文字: null, 選到建議: false };
    if (地點) {
      地點結果.最終嘗試文字 = 地點輸入值;
      地點結果.選到建議 = await 試填地點(地點輸入值);
      if (!地點結果.選到建議 && facts.city && facts.city !== 地點輸入值) {
        console.log(`  ⚠ 「${地點輸入值}」沒跳出建議清單，改試只打「${facts.city}」…`);
        地點結果.最終嘗試文字 = facts.city;
        地點結果.選到建議 = await 試填地點(facts.city);
      }
      if (!地點結果.選到建議) {
        console.log("  ⚠ 兩種寫法都沒看到地區建議清單，保留手打的文字（FB 可能不算數，發佈前自己確認）。");
      }
    } else {
      console.log("  ⚠ 找不到地點欄位，跳過（不影響繼續，發佈前自己補）。");
    }
    try {
      writeFileSync(
        path.join(import.meta.dirname, "config", "location-debug.json"),
        JSON.stringify({ 時間: new Date().toISOString(), ...地點結果 }, null, 2),
      );
    } catch {}
  }
  await shot("3-更多詳情填好");

  // 🔴 2026-09-06 本人實測拍板：「面交偏好設定」（公開面交／到府取貨／送至門口）**不用勾**，
  // 不是必填——之前那一輪判斷錯了，真正卡住「繼續」的是下面的照片上傳。
  console.log(`上傳 ${photoFiles.length} 張照片…`);
  const 上傳前圖片數 = await page.locator("img").count().catch(() => 0);

  // 🔴 2026-09-06 第一輪實測：直接對隱藏 input setInputFiles() 選對了欄位、瀏覽器也真的收到
  // 檔案（evaluate 讀回 el.files.length 是對的），但 FB 畫面完全沒反應（縮圖不出現、「繼續」不亮）。
  // 這個上傳區塊文案是「新增相片或是拖放至此」，是 dropzone 類元件，猜測它不是單純聽 input 的
  // change 事件在動作。改用 Playwright 官方建議的手法：點畫面上真正看得到的「新增相片」按鈕，
  // 攔截 FB 自己觸發的原生檔案選擇視窗——不管 FB 內部怎麼接這個 dropzone，
  // 只要點下去真的會跳出檔案選擇窗，攔截到的這個事件保證就是正確的那個 input。
  console.log("  點「新增相片」、攔截 FB 的檔案選擇視窗…");
  const 新增相片按鈕 = await firstVisible(page, MP["新增相片按鈕"].候選, 8000);
  let 上傳方式 = "";
  let input實際檔案數 = null;
  if (新增相片按鈕) {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 8000 }).catch(() => null),
      humanClick(page, 新增相片按鈕),
    ]);
    if (chooser) {
      await chooser.setFiles(photoFiles);
      上傳方式 = "filechooser";
    }
  }
  if (上傳方式 !== "filechooser") {
    console.log("  ⚠ 沒攔截到 FB 的檔案選擇視窗，改用備援做法：直接對隱藏的 <input> 塞檔案…");
    const 相片input候選 = page.locator(MP["相片上傳欄位"].候選[0]);
    console.log(`    找到 ${await 相片input候選.count()} 個符合「${MP["相片上傳欄位"].候選[0]}」的欄位`);
    const 相片input = 相片input候選.first();
    await 相片input.setInputFiles(photoFiles);
    input實際檔案數 = await 相片input.evaluate((el) => el.files?.length ?? -1).catch(() => -1);
    console.log(`    瀏覽器回報這個 <input> 收到 ${input實際檔案數} 個檔案（應該要是 ${photoFiles.length}）`);
    上傳方式 = "備援input";
  }

  // 🔴 2026-09-06 實測抓到：本人手動測試發現「有沒有照片」是「繼續」亮起來的關鍵，
  // 但上一輪自動跑明明看得到預覽圖、「繼續」還是灰的——不能只看檔案有沒有交出去就
  // 假設 FB 真的收到了，要等縮圖真的多出來再往下走，最多等 10 秒、每秒查一次。
  let 上傳確認 = false;
  for (let i = 0; i < 10 && !上傳確認; i++) {
    await idle(page, 900, 1100); // 等的時候游標小幅晃一晃
    const 現在圖片數 = await page.locator("img").count().catch(() => 上傳前圖片數);
    上傳確認 = 現在圖片數 > 上傳前圖片數;
  }
  await shot("4-照片上傳後");

  // 🔴 診斷用：不管成功失敗都留一份到固定檔名（不是時間戳檔名），下次直接讀這個檔就好，
  // 不用再請本人把終端機文字複製貼過來——這輪除錯來回好幾次都卡在「終端機文字沒傳到」。
  try {
    writeFileSync(
      path.join(import.meta.dirname, "config", "photo-upload-debug.json"),
      JSON.stringify(
        { 時間: new Date().toISOString(), 上傳方式, 預期張數: photoFiles.length, input實際檔案數, 上傳前圖片數, 上傳確認 },
        null,
        2,
      ),
    );
  } catch {}

  if (!上傳確認) {
    失敗(
      `上傳照片後畫面上沒有多出縮圖，FB 可能沒有真的收到照片（這次用的方式：${上傳方式 || "（都失敗）"}），看截圖確認。`,
    );
  }

  console.log("等「繼續」亮起來…");
  const 繼續 = await firstVisible(page, MP["繼續"].候選, 15000);
  if (!繼續) 失敗("找不到「繼續」按鈕。");

  // 🔴 2026-09-06 第三輪實測抓到：filechooser 那招修好之後，10 張縮圖真的跑出來了
  // （畫面「相片．10/10」），但當下每張縮圖都還在轉圈圈處理中——這時候查一次 isEnabled()
  // 太早，FB 大概要等照片處理完才會放行。改成跟「更多詳情」展開同一個精神：
  // 沒亮就再等，最多等 20 秒。
  let 繼續可按 = false;
  for (let i = 0; i < 13 && !繼續可按; i++) {
    繼續可按 = await 繼續.isEnabled().catch(() => false);
    if (!繼續可按) await humanDelay(1300, 1700);
  }
  if (!繼續可按) {
    失敗(
      "「繼續」等了 20 秒還是灰的——標題／價格／類別／狀況／照片應該都填了，" +
        "可能是「地點」欄位沒有真的選到自動完成清單裡的項目（只是手打文字，FB 可能不算數），" +
        "或有其他必填欄位漏掉，看截圖確認。",
    );
  }

  if (!DO_PUBLISH) {
    console.log("停在這裡（沒有 --publish）。按「儲存草稿」——不會上架，之後自己去 Marketplace 打開草稿發佈。");
    const 存草稿 = await firstVisible(page, MP["儲存草稿"].候選, 8000);
    if (!存草稿) 失敗("找不到「儲存草稿」按鈕。");
    await humanClick(page, 存草稿);
    await humanDelay(1500, 2200);
    await shot("5-已存草稿");
    console.log("\n✅ 填好了，已存成草稿（沒有上架）。去 FB Marketplace →「你的商品」找草稿確認內容。\n");
    await browser.close();
    process.exit(0);
  }

  console.log("🔴 --publish：按「繼續」進到「在更多地方上架」…");
  await humanClick(page, 繼續);
  await humanDelay(1800, 2600);
  if (!page.url().includes("step=audience")) {
    失敗(`按了「繼續」但沒有跳到「在更多地方上架」（目前網址：${page.url()}）。畫面可能改版了，停下來。`);
  }
  await shot("5-在更多地方上架");

  // 🔴 Phase 3（2026-09-06）：依貼文庫存的 marketplace_json.groupIds 勾選「在社團上架」。
  // FB 這排 checkbox 沒有 aria-label，只能用文字比對（見 selectors.json 的
  // marketplace_audience._🔴社團 checkbox 沒有 aria-label）。但直接用 Playwright 的
  // :has-text()（子字串比對）會誤傷——本人帳號裡「台中大小事」剛好是「台中大小事買賣分享」
  // 的字首，:has-text("台中大小事") 兩個都會中。改成自己讀每個 checkbox 的 innerText，
  // 要求社團全名之後緊接著的下一個字元是空白或數字（人數開頭的第一個字）才算真的比對到，
  // 不是恰好撞到另一個更長社團名稱的字首。
  const 社團IDs原始 = mp.groupIds || [];
  // FB 本身上限 20 個（本人截圖確認過，見 selectors.json）。超過的話隨機抽 20 個
  // ——不是永遠取清單前 20 個，那樣排後面的社團永遠上不了架（本人 2026-09-22 要求）。
  const 社團IDs = 社團IDs原始.length > 20 ? 隨機抽(社團IDs原始, 20) : 社團IDs原始;
  if (社團IDs原始.length > 20) {
    console.log(
      `  ⚠ 貼文庫勾了 ${社團IDs原始.length} 個社團，FB 一次最多只能勾 20 個，隨機抽 20 個上架（每次跑抽到的不一定一樣）。`,
    );
  }

  let 社團比對結果 = [];
  let 捲動次數 = 0;
  if (社團IDs.length > 0) {
    console.log(
      `在社團上架：比對 ${社團IDs.length} 個社團${DO_CROSSPOST ? "，比對到就真的勾" : "（--dry-run，只比對不勾，沒加 --crosspost）"}…`,
    );
    const 待找 = [];
    for (const gid of 社團IDs) {
      const g = await getFbGroup(gid);
      if (!g) {
        console.log(`  ⚠ 貼文庫記的社團 id=${gid} 在資料庫裡找不到了（可能被刪除），跳過。`);
        社團比對結果.push({ id: gid, 名稱: null, 結果: "資料庫找不到" });
        continue;
      }
      待找.push(g);
    }

    // 🔴 2026-09-06 第一次真的測 --publish 抓到：截圖照到「在社團上架」清單畫面上一次只
    // 看得到 5 個左右，是可以捲動的（跟本人帳號 30+ 個社團兜不起來），但清單一開始只掃一次
    // 就判定「找不到」——沒捲動過，只看得到最前面幾個，後面的社團當然比對不到，不是真的沒有。
    // 改成邊捲邊比對：每捲一段就重新掃一次畫面上現有的 checkbox，比對到「還沒處理過」的
    // 目標社團就立刻處理（不要留到捲完再統一點——虛擬化清單捲了之後，之前存的 locator
    // 用 .nth(index) 抓，位置可能已經被別的社團頂替，捲完再點會點錯）。
    const 已處理 = new Map();
    const 全部checkbox = page.locator('div[role="checkbox"]');
    const 掃目前畫面 = async () => {
      const n = await 全部checkbox.count();
      for (let i = 0; i < n; i++) {
        const cb = 全部checkbox.nth(i);
        const text = (await cb.innerText().catch(() => "")).trim();
        for (const g of 待找) {
          if (已處理.has(g.id)) continue;
          if (!text.startsWith(g.name)) continue;
          const 下一字 = text[g.name.length] ?? "";
          if (下一字 !== "" && !/[\s\d]/.test(下一字)) continue;
          const 原始狀態 = await cb.getAttribute("aria-checked").catch(() => null);
          let 動作 = "只比對(dry-run)";
          if (DO_CROSSPOST) {
            if (原始狀態 !== "true") {
              await humanClick(page, cb).catch(() => {});
              // 本人 2026-09-24 要求：勾社團之間隔 1～3 秒、隨機（不要每次都固定同一個間隔）。
              await humanDelay(1000, 3000);
              動作 = "已勾選";
            } else {
              動作 = "本來就是勾的";
            }
          }
          console.log(`  ✓ 比對到「${g.name}」（畫面文字：${text.slice(0, 40)}…）— ${動作}`);
          已處理.set(g.id, { id: g.id, 名稱: g.name, 命中文字: text, 原始aria_checked: 原始狀態, 結果: 動作 });
        }
      }
    };

    await 掃目前畫面();
    let 連續沒變 = 0;
    for (let i = 0; i < 40 && 已處理.size < 待找.length && 連續沒變 < 2; i++) {
      捲動次數++;
      const 到底了 = await page.evaluate(() => {
        const cands = Array.from(document.querySelectorAll("div")).filter(
          (d) => d.scrollHeight > d.clientHeight + 20 && d.clientHeight > 100,
        );
        const el = cands[cands.length - 1];
        if (!el) return true;
        const before = el.scrollTop;
        el.scrollTop += el.clientHeight * 0.6;
        return el.scrollTop === before;
      });
      await humanDelay(400, 700);
      await 掃目前畫面();
      連續沒變 = 到底了 ? 連續沒變 + 1 : 0;
    }

    for (const g of 待找) {
      if (已處理.has(g.id)) {
        社團比對結果.push(已處理.get(g.id));
      } else {
        console.log(`  ⚠ 捲完整個清單還是找不到「${g.name}」（可能沒標記能上架 Marketplace，或名字跟抓的時候不一樣了），跳過。`);
        社團比對結果.push({ id: g.id, 名稱: g.name, 結果: "畫面上找不到" });
      }
    }
    await shot("5b-社團比對後");
  } else {
    console.log("（貼文庫沒有勾任何社團——只上架到 Marketplace 本身）");
  }

  try {
    writeFileSync(
      path.join(import.meta.dirname, "config", "group-crosspost-debug.json"),
      JSON.stringify({ 時間: new Date().toISOString(), 真的勾選: DO_CROSSPOST, 捲動次數, 社團比對結果 }, null, 2),
    );
  } catch {}

  const 發佈 = await firstVisible(page, AUD.steps["發佈"].候選, 8000);
  if (!發佈) 失敗("找不到「發佈」按鈕，畫面可能改版了。");
  await humanClick(page, 發佈);

  // 🔴 2026-09-06 第一次真的測 --publish 抓到：點下去只等 2~3 秒就查網址太早了——
  // 截圖照到「發佈」變灰＋轉圈圈（處理中，不是失敗），10 張照片＋最多 20 個社團要送出去，
  // FB 後端顯然需要更久。改成跟「更多詳情」展開、「繼續」變亮同一個精神：
  // 沒變就再等，最多等 30 秒。
  let 發佈完成 = false;
  for (let i = 0; i < 15 && !發佈完成; i++) {
    await humanDelay(1800, 2200);
    發佈完成 = !page.url().includes("/marketplace/create/item");
  }
  await shot("6-發佈後");

  // 發佈後 FB 通常會導回商品頁或「你的商品」，不再是 create/item 那個網址。
  if (!發佈完成) {
    失敗("按了「發佈」等了 30 秒，畫面還停在建立商品頁，可能沒有真的送出，看截圖確認。");
  }

  await setDraftStatus(draft.id, "marketplace", "posted");
  console.log(`\n✅ 已發佈到 Marketplace！網址：${page.url()}\n`);
  const 已勾數 = 社團比對結果.filter((r) => r.結果 === "已勾選" || r.結果 === "本來就是勾的").length;
  if (社團IDs.length === 0) {
    console.log("   沒有設定要上架的社團（貼文庫那則的清單是空的）。\n");
  } else if (!DO_CROSSPOST) {
    console.log(
      `   沒有勾任何社團——這次是 dry-run（沒加 --crosspost），比對結果在 config/group-crosspost-debug.json，看對了再加 --crosspost 重跑。\n`,
    );
  } else {
    console.log(`   同時上架到 ${已勾數} / ${社團IDs.length} 個社團。\n`);
  }
} catch (err) {
  if (!(err instanceof 刊登失敗)) throw err;
  console.error(`\n❌ ${err.message}`);
  await shot("失敗");
  console.error(`   截圖在 ${SHOTS_DIR}，看一下卡在哪。\n`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}

process.exit(process.exitCode || 0);
