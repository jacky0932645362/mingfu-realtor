/**
 * 主程式：把 posts/ 裡的一篇貼文發到 FB —— 個人主頁與／或多個社團
 *
 * 跑法：
 *   node post.mjs                  → 撈「時間到了但還沒發」的最早一篇，貼好停住等你按發布
 *   node post.mjs 檔名.md           → 指定某一篇
 *   node post.mjs --list           → 只列出佇列，什麼都不做
 *   node post.mjs --publish        → 🔴 真的按下發布
 *   node post.mjs --force          → 忽略間隔與一天上限的擋
 *   node post.mjs --headless       → 不開視窗（排程用；第一次接上去前不要用）
 *   node post.mjs --to=<網址>       → 只發到指定的那一個地方（測單一社團用）
 *
 * 📌 預設是「貼好停住，發布那一下你自己按」。
 *    理由跟 591 那支一樣：第一次接上去的時候，壞掉的後果應該是「沒發出去」，
 *    而不是「發錯東西出去」—— FB 貼文刪掉了，看到的人也已經看到了。
 *    等實跑過幾次確認穩定，再加 --publish 交給排程器。
 *
 * 📌 一篇文案可以發到多個地方（個人主頁 ＋ 社團），但**一個一個來**：
 *    每發完一個就立刻寫回檔案，中間隔 FB_GROUP_GAP_MINUTES 分鐘，
 *    整體受 FB_MAX_PER_DAY（一天最多幾次）約束。
 *    中途壞掉不會重發已經發過的 —— 誰發過了記在檔案的「發過了」裡。
 */
import { chromium } from "playwright";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  AUTH_FILE,
  FB_HOME,
  SHOTS_DIR,
  MIN_GAP_MINUTES,
  MAX_PER_DAY,
  GROUP_GAP_MINUTES,
  POSTS_DIR,
  askLine,
  ensureDir,
  firstVisible,
  humanDelay,
  listPosts,
  loadSelectors,
  localTimestamp,
  minutesSinceLastPost,
  pickDuePost,
  stamp,
  updatePostStatus,
  waitForEnter,
  preparePhotos,
  prepareVideo,
  個人主頁,
  社團名稱,
  目標清單,
  已發目標,
  已跳過目標,
  還沒發的目標,
  記下發過了,
  記下跳過了,
  今天發了幾次,
  找出FB不支援的語法,
} from "./_shared.mjs";
// 擬真模式（2026-09-18）：滑鼠曲線、分段打字、進頁面先看一下、社團間隔隨機。
// 每個動作都有退路（退回 Playwright 原本的 click），擬真失敗不會害貼文發不出去。
import { humanizeSummary, humanClick, humanType, humanBrowse, idle, jitterGapMinutes } from "./humanize.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const target = argv.find((a) => !a.startsWith("--"));

const DO_PUBLISH = flag("publish");
const HEADLESS = flag("headless");
const FORCE = flag("force");
const 指定目標 = argv.find((a) => a.startsWith("--to="))?.slice(5);

/* ────────────────── 先挑要發哪一篇（還沒開瀏覽器）────────────────── */

const posts = listPosts();

if (flag("list") || posts.length === 0) {
  console.log(`\n貼文佇列（${POSTS_DIR}）\n${"─".repeat(60)}`);
  if (posts.length === 0) {
    console.log("（空的）\n\n用 `npm run draft` 產一篇草稿，或直接在 posts/ 底下手寫一個 .md。");
  } else {
    posts.forEach((p, i) => {
      const when = p.meta.publishAt || "（沒排時間，隨時可發）";
      const icon = p.status === "posted" ? "✅" : p.status === "failed" ? "❌" : "🔲";
      const 全部 = 目標清單(p).length;
      const 已處理 = 已發目標(p).length + 已跳過目標(p).length;
      // 開頭編號 —— `node post.mjs <編號>` 可以直接挑這一篇（.bat 選單用得到）
      console.log(`${String(i + 1).padStart(2)}. ${icon} ${p.file}`);
      console.log(
        `    ${when}｜${p.photos.length} 筆照片來源${p.video ? "｜含影片" : ""}｜發到 ${已處理}/${全部} 個地方｜` +
          `${p.body.slice(0, 24).replace(/\n/g, " ")}…`,
      );
    });
    console.log(`\n今天已經發出去 ${今天發了幾次(posts)} 次（一天上限 ${MAX_PER_DAY > 0 ? MAX_PER_DAY : "不設限"}）。`);
  }
  process.exit(0);
}

let post;
if (target && /^\d+$/.test(target)) {
  // 純數字 ＝ --list 上的編號
  post = posts[Number(target) - 1];
  if (!post) {
    console.error(`\n❌ 沒有第 ${target} 篇。用 --list 看有幾篇。\n`);
    process.exit(1);
  }
} else if (target) {
  post = posts.find((p) => p.file === target || p.file === `${target}.md`);
  if (!post) {
    console.error(`\n❌ posts/ 裡找不到「${target}」。用 --list 看有哪些（或用開頭的編號）。\n`);
    process.exit(1);
  }
} else {
  post = pickDuePost(posts);
  if (!post) {
    console.log("\n目前沒有「時間到了但還沒發」的貼文，什麼都不做。");
    console.log("（用 --list 看佇列狀態；要指定某一篇就 `node post.mjs <編號>`）\n");
    process.exit(0);
  }
}

if (post.status === "posted") {
  console.error(`\n❌ 「${post.file}」已經發過了（${post.meta.postedAt}）。`);
  console.error("   真的要再發一次的話，把檔案裡的 status 改回 pending。\n");
  process.exit(1);
}

if (!post.body.trim()) {
  console.error(`\n❌ 「${post.file}」沒有內文，不發空白貼文。\n`);
  process.exit(1);
}

// 🔴 FB 不吃 Markdown，寫了只會原樣印出來（`**簽約前**` 會變成有四個星號的醜貼文）。
//    這種錯發出去才會發現，所以在開瀏覽器之前就擋住。
const 語法問題 = 找出FB不支援的語法(post.body);
if (語法問題.length && !FORCE) {
  console.error(`\n❌ 「${post.file}」裡有 FB 不支援的格式，發出去會原樣顯示：\n`);
  for (const p of 語法問題) console.error(`   第 ${p.行號} 行  ${p.語法}\n     ${p.內容}`);
  console.error("\n   FB 的貼文框沒有粗體／標題／超連結語法，寫了就是印出符號本身。");
  console.error("   把符號拿掉再跑一次。真的要保留：加 --force。\n");
  process.exit(1);
}

/* ────────────────── 這次要發到哪些地方 ────────────────── */

let 待發 = 指定目標 ? [指定目標] : 還沒發的目標(post);

if (待發.length === 0) {
  console.log(`\n「${post.file}」該發的地方都發完了（${已發目標(post).length} 個）。`);
  console.log("（要加發別的社團，改檔案裡的 targets，或在 config/groups.json 勾更多社團）\n");
  process.exit(0);
}

// MAX_PER_DAY = 0 ＝ 不設限（2026-09-19 本人拍板；間隔還是照 GROUP_GAP／MIN_GAP 走）
const 今天已發 = 今天發了幾次(posts);
if (!FORCE && MAX_PER_DAY > 0 && 今天已發 >= MAX_PER_DAY) {
  console.error(`\n❌ 今天已經發出去 ${今天已發} 次，到上限了（FB_MAX_PER_DAY=${MAX_PER_DAY}）。`);
  console.error("   短時間灌太多篇最容易被判定成濫發，所以這裡先擋住。");
  console.error("   真的要繼續：加 --force。\n");
  process.exit(1);
}
if (!FORCE && MAX_PER_DAY > 0 && 待發.length > MAX_PER_DAY - 今天已發) {
  const 可發 = MAX_PER_DAY - 今天已發;
  console.log(`⚠ 這篇還有 ${待發.length} 個地方要發，但今天只剩 ${可發} 次額度 —— 這次先發 ${可發} 個。`);
  console.log(`  剩下的明天再跑一次就會接著發（誰發過了記在檔案裡，不會重複）。`);
  待發 = 待發.slice(0, 可發);
}

// 排除自己：同一篇文接著發剩下的社團，該受的是 GROUP_GAP 不是 MIN_GAP
const gap = minutesSinceLastPost(posts, post.file);
if (gap < MIN_GAP_MINUTES && !FORCE) {
  console.error(`\n❌ 上一篇是 ${Math.round(gap)} 分鐘前發的，還沒隔滿 ${MIN_GAP_MINUTES} 分鐘。`);
  console.error("   連續發文最容易被判定成異常帳號，所以這裡先擋住。");
  console.error("   真的要現在發：加 --force。\n");
  process.exit(1);
}

if (!existsSync(AUTH_FILE)) {
  console.error(`\n❌ 找不到登入狀態：${AUTH_FILE}`);
  console.error("   先跑 `npm run login`（或點桌面的「FB登入.bat」）。\n");
  process.exit(1);
}

const cfg = loadSelectors();
const selectors = cfg.steps;
// 社團的發文框跟首頁長得幾乎一樣（同一個「建立貼文」視窗），
// 只有「點開它」那一顆不同。沒特別設定就沿用首頁那組。
const 社團觸發器 = cfg.group?.steps?.["開啟社團發文框"]?.候選 || selectors["開啟發文框"].候選;

console.log(`\n要發：${post.file}`);
console.log(`模式：${DO_PUBLISH ? "🔴 會真的按發布" : "草稿（貼好停住，發布你自己按）"}`);
console.log(humanizeSummary());
console.log(`內文 ${post.body.length} 字、照片來源 ${post.photos.length} 筆${post.video ? "、含 1 支影片" : ""}`);
console.log(`這次要發到 ${待發.length} 個地方：`);
for (const t of 待發) console.log(`   ・${社團名稱(t)}`);
console.log("");

/* ────────────────── 照片先備好（網址抓下來、本機檔／資料夾就地展開）────────────────── */

let photoFiles = [];
if (post.photos.length) {
  console.log("準備照片…");
  const { files, failed } = await preparePhotos(post.photos);
  photoFiles = files;
  for (const f of failed) console.warn(`  ⚠ ${f.來源}（${f.reason}），這筆跳過`);
  if (!photoFiles.length && failed.length) {
    // photos 有寫，但一張都備不出來 —— 多半是路徑打錯。停下來問，不要默默發成沒圖的。
    console.error("\n❌ photos 有列來源，但一張都準備不出來（看上面的原因）。");
    console.error("   路徑對嗎？網址開得起來嗎？改好再跑一次。真的要發沒圖的：把 photos 清空。\n");
    process.exit(1);
  }
  console.log(`  ✓ ${photoFiles.length} 張準備好了`);
  if (photoFiles.length > 20) {
    console.log(`  ⚠ ${photoFiles.length} 張有點多，FB 可能會壓縮或擋。一般物件文 8～15 張就夠。`);
  }
}

/**
 * 影片（2026-09-22，一支就好）跟照片同一顆 FB 上傳欄位一起塞
 * （selectors.json 的「照片上傳欄位」已驗證那顆 input 的 accept 同時吃圖片與影片）。
 *
 * 跟照片「少一張可以接受」的容錯態度不一樣：video 通常就是這篇貼文的重點，
 * 準備不出來就整篇擋下來，不要默默發一篇「說好有影片結果沒有」的文，事後也沒人會發現。
 */
let videoFile = null;
if (post.video) {
  console.log("準備影片…");
  const { file, failed } = await prepareVideo(post.video);
  if (failed) {
    console.error(`\n❌ 影片準備不出來：${failed}`);
    console.error("   路徑對嗎？網址是「直接可下載的檔案」嗎（不是 YouTube 觀看頁、不是 Drive 分享頁）？");
    console.error("   改好再跑一次。真的要發沒影片的：回貼文庫把「影片」欄位清空。\n");
    process.exit(1);
  }
  videoFile = file;
  console.log(`  ✓ 影片準備好了：${path.basename(videoFile)}`);
}

// FB 那顆上傳欄位圖片跟影片一起收，所以塞給 setInputFiles 的是合併後的清單。
// 順序：照片在前、影片接在後面——維持「第一張照片＝封面」這個既有說法不被打亂。
const mediaFiles = [...photoFiles, ...(videoFile ? [videoFile] : [])];

/* ────────────────── 開瀏覽器 ────────────────── */

ensureDir(SHOTS_DIR);

const browser = await chromium.launch({
  channel: "chrome",
  headless: HEADLESS,
  args: ["--start-maximized"],
});
const context = await browser.newContext({
  storageState: AUTH_FILE,
  viewport: HEADLESS ? { width: 1440, height: 900 } : null,
  locale: "zh-TW",
});
const page = await context.newPage();

const shot = (name) => page.screenshot({ path: path.join(SHOTS_DIR, `${stamp()}-${name}.png`) }).catch(() => {});

/** 這一輪掛了。記進檔案然後把整個流程停掉 —— 不要硬著頭皮往下發。 */
class 發文失敗 extends Error {}
const 失敗 = (msg) => {
  throw new 發文失敗(msg);
};

/**
 * 這個社團發不進去，但**不是程式壞了** —— 跳過它，繼續下一個。
 *
 * 🔴 為什麼要跟「失敗」分開（2026-09-02 實際踩到）：
 *    本人挑的 4 個社團裡，`台中海線專攻房地產買賣` 沒有「討論」分頁，
 *    只有「商品買賣」（社團版 Marketplace）。以前這種情況會 `失敗()`，
 *    結果**整批中止** —— 後面兩個明明發得進去的社團連試都沒試到，
 *    而且整篇被標成 failed。抽查 14 個社團有 6 個是這樣，不能讓它擋住其他社團。
 */
class 跳過此社團 extends Error {}
const 跳過 = (msg) => {
  throw new 跳過此社團(msg);
};

/**
 * 把這篇文發到「一個」地方。
 *
 * 目標 ＝ 個人主頁，或某個社團的網址。
 * 成功就回 true；草稿模式下他說「沒按」就回 false（不算發過）。
 */
async function 發到一個地方(目標) {
  const 是社團 = 目標 !== 個人主頁;
  const 名字 = 社團名稱(目標);
  const 標籤 = 名字.slice(0, 14).replace(/[\\/:*?"<>|]/g, "");

  console.log(`\n${"─".repeat(60)}`);
  console.log(`📍 ${名字}`);
  console.log("─".repeat(60));

  await page.goto(是社團 ? 目標 : FB_HOME, { waitUntil: "domcontentloaded" });
  await humanDelay(2500, 3800);

  const expired = await firstVisible(page, selectors["登入過期偵測"].候選, 2500);
  if (expired) 失敗("登入狀態過期了（畫面上出現密碼欄位）。重跑 `npm run login` 再來。");

  // 擬真：進到頁面先「看一下」（游標晃進來、往下捲一兩次、再捲回頂），人不會一進來零點幾秒就開始打字
  await humanBrowse(page);

  /* ---- 點開發文框 ---- */
  console.log("點開發文框…");
  const trigger = await firstVisible(page, 是社團 ? 社團觸發器 : selectors["開啟發文框"].候選, 12000);
  if (!trigger) {
    // 社團沒有一般發文框 ＝ 那個社團就長那樣（只有「商品買賣」分頁／被限制發文），
    // 不是程式壞了 → 跳過它、繼續下一個社團。首頁找不到才是真的壞了。
    if (是社團) {
      await shot(`${標籤}-跳過`);
      跳過(
        "這個社團沒有一般發文框（多半是只有「商品買賣」分頁，沒有「討論」；\n" +
          "     也可能是被限制發文／要先審核）。截圖已存，看一眼就知道是哪種。",
      );
    }
    失敗(
      "找不到首頁的發文框。\n" +
        "   十之八九是 FB 改版了 → 重跑 `npm run inspect`，把 dump 貼回對話換 selector。",
    );
  }
  // 點一下 → 等視窗。沒反應就再試，最多三次。
  //
  // 不是為了讓測試過才加的：FB 的發文框是 React 掛上去的，
  // 頁面「看起來」載好了但事件還沒接上時，第一次點會**完全沒反應**，
  // 而且畫面上什麼都不會顯示。第三次改用 JS 直接派送 click 事件 ——
  // 那招不受「元素還在動／被蓋住」影響，是最後一道保險。
  let dialog = null;
  for (let 第幾次 = 1; 第幾次 <= 3 && !dialog; 第幾次++) {
    if (第幾次 > 1) {
      console.log(`  （第 ${第幾次 - 1} 次點沒反應，再試一次）`);
      await humanDelay(1200, 2000);
    }
    if (第幾次 < 3) {
      // 擬真：游標沿曲線移過去再點；點不到會自己退回 Playwright 的 click
      await humanClick(page, trigger, { timeout: 8000 }).catch(() => {});
    } else {
      await trigger.evaluate((el) => el.click()).catch(() => {});
    }
    await humanDelay(1200, 2000);
    dialog = await firstVisible(page, selectors["發文視窗"].候選, 第幾次 === 1 ? 6000 : 10000);
  }
  if (!dialog) 失敗("點下去了但「建立貼文」視窗沒出現。重跑 inspect 換 selector。");
  await shot(`${標籤}-1-發文框開啟`);

  /* ---- 打字 ---- */
  console.log("輸入內文…");
  const box = await firstVisible(dialog, selectors["內文輸入框"].候選, 8000);
  if (!box) 失敗("找不到內文輸入框。重跑 inspect 換 selector。");

  await humanClick(page, box);
  await humanDelay(400, 800);

  // FB 用 contenteditable（Lexical），不是 textarea，所以不能 fill()。
  // insertText + Shift+Enter：insertText 會觸發 FB 需要的 beforeinput/input 事件，
  // 又不會像 type() 那樣一個字一個字送（中文長文會慢到爆）。
  // 擬真模式下切成「一次 2～6 個字」的小段、標點後停一下（同一種事件，只是切細＋有節奏）；
  // 擬真關掉就是原本的一行一次。
  await humanType(page, post.body);
  await humanDelay(600, 1000);

  // 🔴 一定要對答案。打進去的字如果被 FB 的編輯器吃掉一半，
  //    後面照樣會按下發布，然後發出一篇殘缺的文，而且沒人會發現。
  const typed = (await box.innerText()).replace(/\s+/g, "");
  const expect = post.body.replace(/\s+/g, "");
  if (typed.length < expect.length * 0.9) {
    失敗(
      `內文沒有完整打進去（預期 ${expect.length} 字，實際 ${typed.length} 字）。\n` +
        "   不繼續往下做，免得發出殘缺的貼文。",
    );
  }
  console.log(`  ✓ ${typed.length} 字`);

  /* ---- 照片／影片 ---- */
  if (mediaFiles.length) {
    console.log(videoFile ? "上傳照片／影片…" : "上傳照片…");
    // 先直接找隱藏的 input[type=file]：多數情況根本不用點「相片/影片」那顆按鈕。
    let input = await dialog.locator(selectors["照片上傳欄位"].候選[0]).first();
    let has = await input.count().then((n) => n > 0).catch(() => false);

    if (!has) {
      const photoBtn = await firstVisible(dialog, selectors["照片按鈕"].候選, 5000);
      if (photoBtn) {
        await humanClick(page, photoBtn);
        await humanDelay(900, 1500);
      }
      for (const sel of selectors["照片上傳欄位"].候選) {
        const cand = dialog.locator(sel).first();
        if (await cand.count().then((n) => n > 0).catch(() => false)) {
          input = cand;
          has = true;
          break;
        }
      }
    }

    if (!has) {
      // 上不去不該讓整篇卡死 —— 文字已經打好了，讓他自己補圖/補影片再按發布比較實際
      console.warn("  ⚠ 找不到上傳欄位，這篇只會有文字。要圖／影片的話等一下自己拖進去。");
    } else {
      await input.setInputFiles(mediaFiles);
      // 🔴 影片需要 FB 處理（轉檔／產生縮圖）的時間比照片久很多，這裡的等待秒數是推算，
      //    還沒對真的 FB 跑過——第一次接真帳號務必用 `--attended` 邊看畫面邊確認影片真的
      //    附上去了再放行排程（autoPublish），不要一開始就交給無人值守的 runner。
      await idle(page, videoFile ? 9000 : 2500, videoFile ? 14000 : 4000);
      console.log(
        `  ✓ 丟了 ${photoFiles.length} 張照片${videoFile ? `＋ 1 支影片（${path.basename(videoFile)}）` : ""}`,
      );
    }
  }

  await shot(`${標籤}-2-填好`);

  // 端對端測試用：把「真的填進去的東西」倒出來，測試才對得了答案。
  // 正式跑不會設這個環境變數，所以不會留下任何檔案。
  if (process.env.FB_DUMP_VALUES) {
    // 順便把「這個當下」發文視窗裡有哪些按鈕記下來。
    // 用途很具體：FB 的主按鈕在空白時寫「繼續」，打完字才知道會不會變成「發佈」，
    // 而這是唯一能安全問出答案的時機 —— 草稿模式永遠不會去點它。
    const 視窗按鈕 = await dialog
      .locator('div[role="button"]')
      .evaluateAll((els) =>
        els
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              aria: el.getAttribute("aria-label") || "",
              text: (el.innerText || "").trim().slice(0, 20),
              w: Math.round(r.width),
              h: Math.round(r.height),
            };
          })
          // 滿版的那顆才是主要動作，小圖示鈕不用看
          .filter((b) => b.w > 200),
      )
      .catch(() => []);

    writeFileSync(
      process.env.FB_DUMP_VALUES,
      JSON.stringify(
        {
          file: post.file,
          目標,
          text: await box.innerText(),
          photoCount: photoFiles.length,
          photoNames: photoFiles.map((f) => path.basename(f)),
          videoName: videoFile ? path.basename(videoFile) : null,
          willPublish: DO_PUBLISH,
          打完字之後視窗裡的主要按鈕: 視窗按鈕,
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  /* ---- 送出 ---- */
  if (!DO_PUBLISH) {
    console.log("\n" + "─".repeat(60));
    // cmd 視窗不會渲染 Markdown，寫 ** 只會多出兩堆星號（跟貼文那個坑同一種）
    console.log(`✅ 已經幫你貼好了（${名字}），沒有送出。`);
    console.log("   去瀏覽器看一下內容和照片，沒問題就自己按「發佈」。");
    console.log("─".repeat(60));
    await waitForEnter("按完（或決定不發）之後，回這裡按 Enter。");

    // 不要自作主張標記發過了 —— 標錯的後果是同一篇再發一次，或是該發的永遠不發
    const answer = (await askLine("剛剛真的按下發布了嗎？(y = 發了 / 其他 = 沒發)")).toLowerCase();
    return answer === "y" || answer === "yes";
  }

  /* ---- 送出 ----
   * 🔴 FB 的發文流程有兩種，打完字才知道是哪一種：
   *   ・個人主頁：打字 →「繼續」→「貼文設定」頁（選分享對象）→「發佈」（兩段式）
   *   ・社團　　：打字 →「發佈」（一段式，社團不用選分享對象，沒有「繼續」這一步）
   *              2026-09-08 實測抓到：以前寫死兩段式，發社團一律卡在「找不到繼續按鈕」。
   * 做法：先找「繼續」，找得到 → 走兩段式；找不到 → 當一段式，直接在這個視窗找「發佈」。
   */
  console.log("找主要動作按鈕…");
  // 8 秒：個人主頁打完字後「繼續」通常 1~3 秒就出現，給到 8 秒是保險；
  // 社團一段式根本沒有這顆，等滿 8 秒才往下走（可接受，總比誤判成「找不到發佈」好）。
  const nextBtn = await firstVisible(dialog, selectors["繼續按鈕"].候選, 8000);

  let 發佈範圍 = dialog;
  if (nextBtn) {
    console.log("  兩段式：先按「繼續」進「貼文設定」…");
    await humanClick(page, nextBtn);
    await humanDelay(1500, 2400);
    // 🔴 換頁之後那張視窗**沒有內文輸入框**了，
    //    所以不能再用 `發文視窗` 那組（它是靠 :has(textbox) 認的），要另外找。
    const 設定頁 = await firstVisible(page, selectors["貼文設定頁"].候選, 10000);
    if (!設定頁) {
      失敗("按了「繼續」但「貼文設定」那一頁沒出現。看截圖確認卡在哪。（文字已經打好了，可以自己按發佈）");
    }
    await shot(`${標籤}-3-貼文設定`);
    發佈範圍 = 設定頁;
  } else {
    console.log("  一段式（社團）：這個視窗直接就有「發佈」…");
  }

  /* ---- 真的發出去 ---- */
  console.log("🔴 按下發布…");
  const publishBtn = await firstVisible(發佈範圍, selectors["發布按鈕"].候選, 8000);
  if (!publishBtn) {
    失敗("找不到發布按鈕。重跑 inspect 換 selector。（文字已經打好了，可以自己按）");
  }

  await humanClick(page, publishBtn);

  // 視窗關掉＝送出成功。等不到就當作沒發成功，不要樂觀地標記發過了。
  const gone = await 發佈範圍
    .waitFor({ state: "detached", timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  await humanDelay(2000, 3000);
  await shot(`${標籤}-4-送出後`);

  if (!gone) {
    失敗("按了發布但視窗沒關掉。可能被擋、或還在上傳照片。看截圖確認到底發出去沒有。");
  }

  // ⚠️ 送出 ≠ 已經貼上去了。社團有 9/14 需要管理員審核，
  //    那種情況下貼文會先進審核佇列，不會馬上出現在社團裡。
  if (是社團) console.log("   （這個社團如果要審核，會先進審核佇列，不會馬上看到）");
  return true;
}

/* ────────────────── 一個一個發 ────────────────── */

let 成功幾個 = 0;
let 跳過幾個 = 0;

try {
  for (const [i, 目標] of 待發.entries()) {
    // 兩個目標之間要隔開。同一篇文短時間灌到一堆社團，是最容易被盯上的行為。
    // （被跳過的社團沒有真的發文，所以不算在間隔裡）
    if (成功幾個 > 0 && i > 0 && GROUP_GAP_MINUTES > 0 && !FORCE) {
      // 擬真：不是每次都剛好 8 分，是基準 × 0.8～1.8 的隨機值（固定間隔是排程器的特徵，不是人的）
      const 分鐘 = jitterGapMinutes(GROUP_GAP_MINUTES);
      const 註 = 分鐘 === GROUP_GAP_MINUTES ? "" : `基準 ${GROUP_GAP_MINUTES} 分、擬真隨機；`;
      console.log(`\n⏳ 等 ${分鐘} 分鐘再發下一個（${註}避免被判定成濫發）…`);
      await new Promise((r) => setTimeout(r, 分鐘 * 60_000));
    }

    let 發出去了 = false;
    try {
      發出去了 = await 發到一個地方(目標);
    } catch (err) {
      // 🔴 這個社團發不進去 ≠ 程式壞了。記下來、繼續下一個社團，
      //    不要讓一個「只有商品買賣分頁」的社團擋掉後面所有社團。
      if (!(err instanceof 跳過此社團)) throw err;
      跳過幾個++;
      const 剩 = 記下跳過了(post, 目標, "跳過-沒有一般發文框");
      console.log(`\n⏭️  ${社團名稱(目標)}：${err.message}`);
      console.log(`   → 記為「跳過」，之後不會再試。這篇還剩 ${剩.length} 個地方。`);
      continue;
    }

    if (發出去了) {
      成功幾個++;
      const 剩 = 記下發過了(post, 目標, DO_PUBLISH ? "--publish" : "手動按發布");
      console.log(`✅ ${社團名稱(目標)} 完成。這篇還剩 ${剩.length} 個地方沒發。`);
    } else {
      console.log(`⏭️  ${社團名稱(目標)} 沒發出去，維持「還沒發」，下次會再撈到。`);
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(
    `這一輪發出去 ${成功幾個}/${待發.length} 個地方` + (跳過幾個 ? `，跳過 ${跳過幾個} 個。` : "。"),
  );
  // 從檔案重讀，不要用記憶體裡那份舊的 —— 發的過程中已經寫回去好幾次了
  const 最新 = listPosts().find((p) => p.file === post.file);
  if (最新) {
    const 剩 = 還沒發的目標(最新);
    const 跳 = 已跳過目標(最新);
    console.log(`${post.file}：${已發目標(最新).length}/${目標清單(最新).length} 個地方發完了。`);
    if (跳.length) console.log(`發不進去（已跳過）：${跳.map(社團名稱).join("、")}`);
    if (剩.length) console.log(`還沒發的：${剩.map(社團名稱).join("、")}`);
  }
  console.log("─".repeat(60) + "\n");
} catch (err) {
  if (!(err instanceof 發文失敗)) throw err;
  console.error(`\n❌ ${err.message}`);
  await shot("失敗");
  console.error(`   截圖在 ${SHOTS_DIR}，看一下卡在哪。`);
  if (成功幾個 > 0) {
    console.error(`   ⚠ 這一輪之前已經成功發出去 ${成功幾個} 個地方，那些已經記進檔案，不會重發。`);
  }
  updatePostStatus(post, { status: "failed", lastError: err.message, lastTriedAt: localTimestamp() });
  await browser.close().catch(() => {});
  process.exit(1);
} finally {
  await browser.close().catch(() => {});
}

process.exit(0);
