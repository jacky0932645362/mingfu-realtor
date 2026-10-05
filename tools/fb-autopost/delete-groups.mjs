/**
 * 從「活動紀錄 → 社團貼文和留言」批次刪掉自己在社團發過的貼文
 *
 * 跑法：
 *   node delete-groups.mjs                       → 只看：列出會被刪的貼文，什麼都不刪
 *   node delete-groups.mjs --confirm             → 🔴 真的刪
 *   node delete-groups.mjs --from-post=檔名.md    → 只刪「那一篇文案」發出去的（比對開頭文字）
 *   node delete-groups.mjs --match="698萬海景"    → 只刪內文含這串字的（--from-post 的手動版）
 *   node delete-groups.mjs --group="吾愛梧棲"      → 只處理這一個社團的（2026-09-19，「按社團清空」用；
 *                                                    跟 --match/--from-post 是 AND 關係，不是取代）
 *   node delete-groups.mjs --older-than=30       → 只處理 30 天前的貼文（預設不限）
 *   node delete-groups.mjs --from=2025-05-31 --to=2025-07-22
 *                                                → 只處理這個日期區間的（兩端都含；2026-09-20 本人要清 2025 年那批）
 *   node delete-groups.mjs --months=2025-05,2025-06,2025-07
 *                                                → 網址帶 &year=&month= 一個月開一次（活動紀錄從最新往下捲
 *                                                  常卡在「載入中」到不了 2025，跳月份才到得了）；配 --from/--to 用
 *                                                  ⚠️ 帶照片的貼文（aria「新增了 N 張相片」）2026-09-20 起也會被納入
 *   node delete-groups.mjs --kinds=all            → 要刪什麼：posts（預設，貼文含相片）／comments（自己的留言、回應）／all
 *   node delete-groups.mjs --sweep                → 刪完再重掃同一頁，直到沒東西（FB 跳月份的畫面一次只給一頁，
 *                                                  刪掉幾篇才會浮出下一批；--sweep-rounds=N 上限，預設 8）
 *   node delete-groups.mjs --max=10              → 這次最多刪幾篇（預設 5）
 *   node delete-groups.mjs --include-undated     → 連「日期看不出來」的也刪（預設跳過）
 *   node delete-groups.mjs --gap-secs=10         → 每篇之間固定隔幾秒（預設隨機 6～8；--pause-every=20 --pause-secs=15 每 20 篇停 15 秒）
 *   node delete-groups.mjs --force              → 解掉「一次最多 50 篇」的保險
 *   node delete-groups.mjs --headless           → 不開視窗（排程用；先手動跑順幾次再說）
 *
 * 📌 「發一篇到 10 個社團，之後把那 10 篇刪掉」怎麼做：
 *    同一篇文案發到多個社團，內文（尤其第一行鉤子）是一樣的。
 *    `--from-post=<發文時用的檔名>` 會拿那篇的第一行去比對活動紀錄，
 *    只刪內文對得上的 —— 不管中間你又發了什麼別的，都不會被掃到。
 *    配 `--max=10`（或更大）一次清完。不需要事先記每篇的網址。
 *
 * 📌 為什麼預設「只看不刪」（跟 post.mjs 一樣）：
 *    刪 FB 貼文救不回來。第一次接上去、或 FB 改版之後，壞掉的後果應該是
 *    「什麼都沒發生」，不是「刪錯一批」。先看清單沒問題，再加 --confirm 重跑。
 *
 * 📌 每刪一篇之前，先把它的社團、日期、內文、連結寫進 deleted-log/。
 *    就算真的刪錯了，至少留一份清單知道刪掉的是哪些。
 *
 * 📌 節奏：每篇之間 6～8 秒，每 20 篇停 15 秒（2026-09-20 本人拍板，原本 8～15 秒／每 10 篇 45 秒太慢）。
 *    短時間連續刪自己的貼文，跟短時間連續發文一樣是異常訊號，所以還是留間隔。
 *
 * 📌 活動紀錄裡社團貼文有四種樣子（2026-09-20 一天內全抓齊），⋯ 的 aria-label 分別是：
 *    ① 「更多關於{我}在{社團}社團發佈了貼文。的選項」　② 「…在{社團}新增了 N 張相片／段影片。的選項」
 *    ③ 「更多關於{我}的選項」（只有名字）　④ 「更多選項」（帶縮圖的貼文，列裡直接是內文＋公開社團＋時間＋查看）
 *    ④ 數量最多（2025/8 那個月 141 顆裡 8/14～8/15 就 59 顆）——只認①②③會以為「那幾天沒東西」。
 *    ④ 只能靠「在 div[role=main] 裡＋列裡有 permalink 的 查看 連結」認，列的容器用「公開社團／私密社團」那行認。
 *
 * ✅ 2026-09-02 已對真實 FB 跑通（禾盛晶綻那篇發到的 2 個社團貼文實刪成功，
 *    紀錄在 deleted-log/）。selector 是照本人帳號的活動紀錄校正過的。
 *    FB 之後改版壞掉時，一樣是跑 `npm run inspect:activity` 抄回來換 selector，程式碼不用動。
 */
import { chromium } from "playwright";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ACTIVITY_LOG_URL,
  AUTH_FILE,
  DELETED_LOG_DIR,
  SHOTS_DIR,
  authSessionStatus,
  ensureDir,
  firstVisible,
  humanDelay,
  listPosts,
  loadSelectors,
  localTimestamp,
  parseFbActivityDate,
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
const INCLUDE_UNDATED = flag("include-undated");
const OLDER_THAN_DAYS = num("older-than", null); // null = 不限日期
const MAX = num("max", 5);

/**
 * 日期區間（2026-09-20，本人要求「刪 2025/5/31～7/22 的社團貼文」）。
 *   --from=2025-05-31 --to=2025-07-22   兩端都含；只給一端也行
 *   --months=2025-05,2025-06,2025-07    直接用網址 &year=&month= 跳到那幾個月（活動紀錄從最新一路往下捲，
 *                                       捲到 2025 年常常卡在「載入中」載不出來；跳月份就沒這問題）
 * 日期的認法：每一則本身只有時間，日期是整組的標頭——讀清單前先依 DOM 順序把「前面最近的標頭」
 * 標到每顆 ⋯ 上（data-fbdel-date），不再只靠列裡有沒有印年月日。
 */
const 解日期 = (s) => {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    console.error(`\n❌ 日期要寫成 YYYY-MM-DD：「${s}」\n`);
    process.exit(1);
  }
  return new Date(+m[1], +m[2] - 1, +m[3]);
};
const FROM = 解日期(str("from"));
const TO_RAW = 解日期(str("to"));
const TO = TO_RAW ? new Date(TO_RAW.getFullYear(), TO_RAW.getMonth(), TO_RAW.getDate(), 23, 59, 59) : null;
const MONTHS = (str("months") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const m = s.match(/^(\d{4})-(\d{1,2})$/);
    if (!m) {
      console.error(`\n❌ --months 要寫成 YYYY-MM，用逗號隔開：「${s}」\n`);
      process.exit(1);
    }
    return { year: +m[1], month: +m[2] };
  });
const 有日期條件 = FROM || TO || OLDER_THAN_DAYS != null;

/** 要刪什麼（2026-09-20，本人要「貼文及留言」都能指定日期刪）。posts＝貼文含相片；comments＝自己在別人貼文下的留言／回覆；all＝兩種。 */
const KINDS = (() => {
  const v = (str("kinds") || "posts").toLowerCase();
  if (!["posts", "comments", "all"].includes(v)) {
    console.error(`\n❌ --kinds 只能是 posts／comments／all：「${v}」\n`);
    process.exit(1);
  }
  return v;
})();
const 要貼文 = KINDS === "posts" || KINDS === "all";
const 要留言 = KINDS === "comments" || KINDS === "all";
/** 刪完再重掃同一頁，直到沒東西。 */
const SWEEP = flag("sweep");
const SWEEP_ROUNDS = num("sweep-rounds", 8);

/**
 * 只刪「內文對得上」的貼文。
 * --match 直接給字串；--from-post 讀 posts/<檔名> 拿第一行（鉤子）當比對字串。
 * 同一篇文案發到 N 個社團時，內文一樣，所以這招能精準命中「那一篇的所有分身」。
 */

// 比對用的正規化搬到 _shared.mjs（跟 delete-group-content.mjs 共用同一份），這裡只是引用。

let MATCH = str("match");
const FROM_POST = str("from-post");
if (FROM_POST) {
  const 檔名 = FROM_POST.endsWith(".md") ? FROM_POST : `${FROM_POST}.md`;
  const 那篇 = listPosts().find((p) => p.file === 檔名);
  if (!那篇) {
    console.error(`\n❌ posts/ 裡找不到「${檔名}」。用 \`npm run list\` 看有哪些。\n`);
    process.exit(1);
  }
  // 第一行（鉤子）—— 一定在活動紀錄摘要的最前面，最適合當指紋
  const 第一行 = (那篇.body.split(/\r?\n/).find((l) => l.trim()) || "").trim();
  const 乾淨 = 指紋正規化(第一行);
  if (乾淨.length < 8) {
    console.error(`\n❌ 「${檔名}」第一行去掉 emoji／符號後只剩「${乾淨}」，太短，拿去比對會誤傷別的貼文。`);
    console.error("   改用 --match= 手動給一段夠獨特的內文（例：--match=禾盛晶綻電梯華廈）。\n");
    process.exit(1);
  }
  MATCH = 第一行; // 存原文給訊息用；比對時會再過 指紋正規化
  console.log(`\n📎 只刪「${檔名}」發出去的`);
  console.log(`   比對指紋（去 emoji／符號後）：「${乾淨.slice(0, 30)}${乾淨.length > 30 ? "…" : ""}」`);
}

/** 比對用的指紋（正規化後）。null ＝ 不做內文比對。 */
const MATCH_KEY = MATCH ? 指紋正規化(MATCH) : null;
/** 訊息裡顯示用的短版。 */
const MATCH_顯示 = MATCH_KEY ? `${MATCH_KEY.slice(0, 24)}${MATCH_KEY.length > 24 ? "…" : ""}` : null;

/**
 * 只處理這一個社團的（2026-09-19，「按社團清空」用）。跟 MATCH_KEY 是 AND 關係——
 * 這是刻意的：單獨給 --group 沒有 --match/--from-post，代表「這個社團裡活動紀錄能看到的
 * 全部社團貼文」都會刪，不管是不是這套系統發的（本人自己手動貼的也會中）。
 * 後台的「按社團清空」／「按工作流清空」兩個入口一定會兩個一起給，不會只給 --group。
 * 比對社團名稱用 讀清單() 從 aria-label 抄出來的原始 社團 欄位，直接字串相等（同一顆帳號，
 * FB 顯示的社團全名是固定的，不用像內文那樣正規化）。
 */
const GROUP_FILTER = str("group");

/** 一次最多刪幾篇的硬上限。--force 才解得開。 */
const HARD_CAP = 50;
/** 每篇之間隔幾秒。預設隨機 6～8 秒（連續動作太規律也是特徵）。2026-09-20 本人拍板從 8～15 改成 6～8。 */
const GAP_SECS = num("gap-secs", null);
/** 每刪幾篇停久一點（讓動作看起來不像機器連刪）。2026-09-20 本人拍板：每 20 篇停 15 秒（原本每 10 篇 45 秒）。 */
const PAUSE_EVERY = num("pause-every", 20);
const PAUSE_SECS = num("pause-secs", 15);
/** 要抓回來看的清單長度。比 MAX 多抓一些，才有得篩日期。
 *  日期區間模式要從最新一路往下讀到那個區間（2026-09-20 實測讀到 2025/7/3 要 100 顆以上），上限放到 300。 */
const SCAN_ROWS = FROM || TO ? Math.max(300, Math.min(1000, MAX * 2)) : Math.min(HARD_CAP * 2, Math.max(MAX * 4, 30));
/** 這次跑的代號，deleted-log 的檔名用。 */
const RUN_STAMP = stamp();

if (MAX > HARD_CAP && !FORCE) {
  console.error(`\n❌ --max=${MAX} 超過一次 ${HARD_CAP} 篇的上限。`);
  console.error("   一次刪太多是最容易被 FB 盯上的行為。真的要：加 --force。\n");
  process.exit(1);
}

if (!process.env.FB_SKIP_AUTH_CHECK && !authSessionStatus().有登入) {
  console.error("\n❌ 現在跑不了。");
  console.error(`   ${登入問題說明()}\n`);
  process.exit(1);
}

if (!existsSync(AUTH_FILE)) {
  console.error(`\n❌ 找不到登入狀態：${AUTH_FILE}`);
  console.error("   先跑 `npm run login`（或點桌面的「FB登入.bat」）。\n");
  process.exit(1);
}

const cfg = loadSelectors();
const sel = cfg.activity_delete?.steps;
if (!sel) {
  console.error("\n❌ config/selectors.json 裡沒有 activity_delete 那一段。");
  console.error("   先跑 `npm run inspect:activity` 抄回活動紀錄的結構。\n");
  process.exit(1);
}
/** 某一步的 selector 候選。key 打錯會在這裡就爆，不會默默跳過。 */
const 候選 = (key) => {
  const s = sel[key];
  if (!s || !Array.isArray(s.候選)) throw new Error(`selectors.json 的 activity_delete 少了「${key}」`);
  return s;
};
const 登入過期候選 = cfg.steps?.["登入過期偵測"]?.候選 || ['input[name="pass"]', 'input[type="password"]'];

/**
 * 帳號顯示名稱。第三種貼文（2026-09-20 抓到，2025/8/16 那批）在活動紀錄裡 ⋯ 的 aria 只有「更多關於{名字}的選項」，
 * 沒有「在XX社團發佈了貼文」，只能靠名字認。右上角 Messenger 的聯絡人 ⋯ 也長「更多關於某某的選項」，
 * 但在 div[role=main] 外面，所以錨點限定 main 裡面。
 */
const OWNER = process.env.FB_OWNER_NAME || cfg.activity_delete?.帳號名稱 || "蕭茗馥";
const 光溜溜aria = `更多關於${OWNER}的選項`;
/**
 * 第四種（2026-09-20 抓到，8/14～8/15 那 59 篇全是這種）：帶縮圖的社團貼文，⋯ 的 aria 只有「更多選項」，
 * 列裡直接是內文＋「公開社團 下午12:47」＋查看。selector 在 selectors.json 的 貼文更多動作 候選（限定 main 裡）。
 * 🔴 這種 aria 太通用，讀清單時還要再驗「列裡有 permalink 的連結、而且列裡只有這一顆 ⋯」才算一則貼文。
 */
const 通用aria = "更多選項";

/** 每則社團貼文右邊那顆 ⋯ 鈕（整個流程的錨點）。候選用逗號串起來 = 「試每一個」。
 *  --kinds 決定錨點包不包留言那種（selectors.json 的 留言更多動作）。 */
const 貼文更多動作 = [
  ...(要貼文 ? 候選("貼文更多動作").候選 : []),
  ...(要貼文 ? [`div[role="main"] div[role="button"][aria-label=${JSON.stringify(光溜溜aria)}]`] : []),
  ...(要留言 ? (sel["留言更多動作"]?.候選 || []) : []),
].join(", ");
if (!貼文更多動作) {
  console.error("\n❌ selectors.json 少了 留言更多動作，--kinds=comments 跑不了。\n");
  process.exit(1);
}

const 全都沒驗證 = Object.values(sel).every((s) => s.已驗證 === false);
if (全都沒驗證) {
  console.log("\n⚠️  activity_delete 的 selector 目前全部『還沒對過真實畫面』。");
  console.log("   這次很可能會在某一步停住 —— 那是正常的，不會亂刪東西。");
  console.log("   要修：跑 `npm run inspect:activity`，把 config/activity-dump.json 貼回對話。\n");
}

const 日期條件文字 = (() => {
  const parts = [];
  if (OLDER_THAN_DAYS != null) parts.push(`${OLDER_THAN_DAYS} 天前`);
  // 用本機日期組字串，不要 toISOString()（會轉成 UTC，5/31 變 5/30）
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (FROM || TO) parts.push(`${FROM ? ymd(FROM) : "…"} ～ ${TO ? ymd(TO) : "…"}`);
  return parts.length ? parts.join("、") : "不限日期";
})();
console.log(`\n模式：${DO_DELETE ? "🔴 會真的刪" : "只看不刪（要真的刪加 --confirm）"}`);
console.log(
  `條件：${日期條件文字}` +
    `${MONTHS.length ? `｜跳月份 ${MONTHS.map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`).join(",")}` : ""}` +
    `${GROUP_FILTER ? `｜社團＝「${GROUP_FILTER}」` : ""}` +
    `${MATCH_顯示 ? `｜內文含「${MATCH_顯示}」` : ""}｜刪 ${KINDS === "all" ? "貼文＋留言" : KINDS === "comments" ? "留言／回應" : "貼文（含相片）"}｜這次最多 ${MAX} 篇${SWEEP ? "｜刪完重掃到乾淨" : ""}`,
);
console.log(`日期看不出來的：${INCLUDE_UNDATED ? "也刪" : "跳過"}`);
if (!MATCH_KEY && !有日期條件 && DO_DELETE) {
  console.log(
    GROUP_FILTER
      ? `\n⚠️  只給了 --group 沒給 --match/--from-post —— 「${GROUP_FILTER}」這個社團裡活動紀錄能看到的` +
          "全部社團貼文都會刪，不管是不是這套系統發的（手動貼的也會中）。"
      : "\n⚠️  沒給 --from-post 也沒給 --older-than —— 會刪『活動紀錄最上面的幾篇』，" +
          "不管是哪一篇文案發的。要精準刪某一篇，用 --from-post=<檔名>。",
  );
}

/* ────────────────── 準備 ────────────────── */

ensureDir(SHOTS_DIR);
ensureDir(DELETED_LOG_DIR);

/** 這一步的結構找不到。停下來，不要硬著頭皮往下刪。 */
class 刪除中止 extends Error {}
const 中止 = (msg) => {
  throw new 刪除中止(msg);
};

const 刪除紀錄 = [];

/** 把目前為止刪掉的寫進檔案。每刪一篇就重寫一次，中途斷掉也留得住。 */
function 寫刪除紀錄() {
  if (!刪除紀錄.length) return;
  writeFileSync(
    path.join(DELETED_LOG_DIR, `${RUN_STAMP}.md`),
    [
      `# 批次刪社團貼文 —— 這次刪掉的`,
      `時間：${localTimestamp()}`,
      `條件：${日期條件文字}${MATCH_顯示 ? `，內文含「${MATCH_顯示}」` : ""}${GROUP_FILTER ? `，社團＝「${GROUP_FILTER}」` : ""}，最多 ${MAX} 篇`,
      ``,
      ...刪除紀錄.flatMap((d) => [
        `## ${d.序}. ${d.日期}${d.社團 ? `　[${d.社團}]` : ""}`,
        d.連結,
        ``,
        d.內文,
        ``,
        `（刪除時間 ${d.刪除時間}）`,
        ``,
      ]),
    ].join("\n"),
    "utf8",
  );
}

/* ────────────────── 開瀏覽器 ────────────────── */

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

const shot = (name) =>
  page.screenshot({ path: path.join(SHOTS_DIR, `${stamp()}-del-${name}.png`) }).catch(() => {});

/* ────────────────── 進到「社團貼文和留言」清單 ────────────────── */

/** 活動紀錄網址，可加 &year=&month= 直接跳到某個月（2026-09-20 對真 FB 驗證過，篩選面板會顯示「日期 2025年7月」）。 */
function 清單網址(month) {
  if (!month) return ACTIVITY_LOG_URL;
  const sep = ACTIVITY_LOG_URL.includes("?") ? "&" : "?";
  return `${ACTIVITY_LOG_URL}${sep}year=${month.year}&month=${month.month}`;
}

async function 開啟清單(url = ACTIVITY_LOG_URL) {
  console.log(`\n開啟活動紀錄：${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await humanDelay(3000, 4200);

  if (await firstVisible(page, 登入過期候選, FAST ? 400 : 2500)) {
    中止("FB 給的是登出畫面（出現密碼欄位）。重跑 `npm run login` 再來。");
  }

  // 直達網址（category_key=GROUPPOSTS）進去就已經是「社團貼文和留言」，
  // 通常不用點篩選。真的沒到位再試點一次。
  const 篩選項 = 候選("社團貼文篩選");
  const 已在清單 = await page
    .locator(貼文更多動作)
    .first()
    .isVisible({ timeout: FAST ? 800 : 4000 })
    .catch(() => false);
  if (!已在清單) {
    const 篩選 = await firstVisible(page, 篩選項.候選, FAST ? 500 : 5000);
    if (篩選) {
      console.log("點「社團貼文和留言」…");
      await 篩選.click().catch(() => {});
      await humanDelay(2500, 3800);
    }
  }

  // 等「載入中」骨架消失（社團相關頁面載得慢，等太短會讀到空的）
  await page
    .locator('[role="status"][aria-label*="載入"], [aria-label*="Loading"]')
    .first()
    .waitFor({ state: "hidden", timeout: FAST ? 1000 : 8000 })
    .catch(() => {});
  await humanDelay(800, 1400);
}

/* ────────────────── 把清單往下捲、讀回來 ──────────────────
 *
 * 🔴 FB 活動紀錄沒有乾淨的「列」容器。改成**以那顆 ⋯ 鈕為錨**：
 *    每則社團貼文都有一顆 aria-label＝「更多關於{我}在{社團}社團發佈了貼文。的選項」的 ⋯ 鈕，
 *    從它往上找「裝著一個連結」的 div 就是那一則的整塊。
 */

/** 從 ⋯ 鈕往上找那一則的整塊容器。
 * 🔴 不能用「最近的、裡面有連結的 div」—— 那會抓到只包著「查看」連結的小 wrapper，
 *    讀出來只有「查看」兩個字。改用「最近的、文字含『發佈了貼文』的 div」，
 *    那一定是列層級（標題那行「蕭茗馥在{社團}社團發佈了貼文。」在裡面）。（2026-09-02 實測）
 */
function 那一列(更多鈕) {
  // 2026-09-20 多收「新增了」：相片貼文那一列是「蕭茗馥在{社團}新增了 N 張相片。」，沒有「發佈了貼文」
  return 更多鈕.locator(
    'xpath=ancestor::div[contains(., "發佈了貼文") or contains(., "新增了") or contains(., "回覆了") or contains(., "回應了") or contains(., "公開社團") or contains(., "私密社團")][1]',
  );
}

/** 這顆 ⋯ 是哪一種：貼文（發佈了貼文、新增了 N 張相片／段影片）、留言（回覆了…的留言、回應了…的貼文）、null＝都不是。
 *  selector 第三個候選抓得比較寬，這裡再擋一次；--kinds 沒要的那種也在這裡擋掉。 */
const 種類 = (aria) => {
  if (/發佈了貼文|新增了\s*\d+\s*(?:張相片|段影片)/.test(aria)) return "貼文";
  if (aria === 光溜溜aria) return "貼文"; // 第三種：只有名字，沒有動詞
  if (aria === 通用aria) return "貼文"; // 第四種：只有「更多選項」（讀清單時再驗列裡有 permalink）
  if (/回覆了.+的留言|回應了.+的貼文/.test(aria)) return "留言";
  return null;
};
const 要這種 = (k) => (k === "貼文" && 要貼文) || (k === "留言" && 要留言);

/**
 * 🔴 每一則本身只有時間（下午10:34），日期是整組的標頭（2026年9月14日），不在那一列的容器裡。
 * 依 DOM 順序走一遍：遇到日期標頭就記住，遇到 ⋯ 鈕就把「前面最近的標頭」寫到 data-fbdel-date。
 * 讀清單前跑一次、每刪一則前再跑一次（刪掉之後 FB 會重繪）。
 */
async function 標日期() {
  await page
    .evaluate((sel) => {
      const isHeader = (el) => el.children.length <= 2 && /^\d{4}年\d{1,2}月\d{1,2}日$/.test((el.innerText || "").trim());
      let cur = "";
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let el;
      while ((el = walker.nextNode())) {
        if (isHeader(el)) {
          cur = el.innerText.trim();
          continue;
        }
        if (cur && el.matches && el.matches(sel)) el.setAttribute("data-fbdel-date", cur);
      }
    }, 貼文更多動作)
    .catch(() => {});
}

async function 讀清單({ 容許空頁 = false } = {}) {
  const 只看得到的 = () => page.locator(貼文更多動作).filter({ visible: true });

  // 往下捲，把 ⋯ 鈕載到夠多。FB 活動紀錄會邊捲邊 lazy-load 更舊的動態，停太早會漏——
  // 2026-09-20 實測 FB 常常轉「載入中」轉好幾秒才吐，所以看到載入中就多等，連 4 次沒新東西才停。
  let 上次 = -1;
  let 連續沒變 = 0;
  // 不篩月份、有 --from 時要從最新一路捲到那個區間，40 次不夠（2026-09-20：從 2026/9 捲到 2025/8 要一百多次）；
  // 但一捲過 --from 那天就可以停了，後面的都不在區間內。
  const 最多捲幾次 = FROM ? 160 : 40;
  // 🔴 只認「獨立一個元素、整行就是日期」的標頭（跟 標日期 同一套認法）——不能拿 innerText 用正規式撈最後一個日期，
  //    貼文內文常寫「2025年8月1日開放看屋」之類，會讓早停提早觸發、整段區間漏掉。
  const 最舊標頭 = () =>
    page
      .evaluate(() => {
        const root = document.querySelector('[role="main"]') || document.body;
        let last = "";
        const 像日期 = /^\d{4}年\d{1,2}月\d{1,2}日$/;
        for (const el of root.querySelectorAll("*")) {
          if (el.children.length > 2) continue;
          const t = (el.textContent || "").trim(); // 先用不觸發排版的 textContent 粗篩，innerText 對上萬個節點跑會卡
          if (t.length > 14 || !像日期.test(t)) continue;
          if (像日期.test((el.innerText || "").trim())) last = el.innerText.trim();
        }
        return last;
      })
      .catch(() => "");
  for (let i = 0; i < 最多捲幾次; i++) {
    const n = await 只看得到的().count().catch(() => 0);
    if (n >= SCAN_ROWS) break;
    連續沒變 = n === 上次 ? 連續沒變 + 1 : 0;
    if (連續沒變 >= 4 && i > 2) break;
    上次 = n;
    if (FROM && i > 0 && i % 3 === 0) {
      const 最舊 = await 最舊標頭();
      const d = parseFbActivityDate(最舊, new Date());
      if (d && d < FROM) {
        console.log(`   …捲到 ${最舊}，已經過了要刪的區間，不用再往下`);
        break;
      }
    }
    if (i % 5 === 4) {
      const 最舊 = (await 最舊標頭()) || "?";
      console.log(`   …往下捲第 ${i + 1} 次，目前 ${n} 則，最舊到 ${最舊}`);
    }
    await page.mouse.wheel(0, 2600);
    await humanDelay(FAST ? 20 : 1000, FAST ? 40 : 1600);
    if (!FAST) {
      const 載入中 = page.locator('[aria-label*="載入"], [role="status"]').filter({ visible: true }).first();
      if (await 載入中.isVisible().catch(() => false)) {
        await 載入中.waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
        await humanDelay(600, 1200);
      }
    }
  }

  // 讓 DOM 停下來再讀（捲動剛結束時 FB 可能還在補／收虛擬化的節點）
  await humanDelay(FAST ? 30 : 1500, FAST ? 60 : 2500);
  await 標日期();

  const btns = 只看得到的();
  const total = await btns.count().catch(() => 0);
  if (total === 0 && 容許空頁) return []; // 跳月份時某個月可能只有留言沒有貼文，不算壞掉
  if (total === 0) {
    中止(
      "一則社團貼文都找不到（`貼文更多動作` 這個 selector 沒對上，或這個帳號在活動紀錄裡沒有社團貼文）。\n" +
        "   重跑 `npm run inspect:activity`，把 config/activity-dump.json 貼回對話。",
    );
  }

  const now = new Date();
  const rows = [];
  const 看過的 = new Set(); // 🔴 FB 會留虛擬化的重複節點在 DOM 裡，用 aria+內文開頭去重
  let 區間外沒細讀 = 0;
  console.log(`   捲完了，共 ${total} 則，開始一則一則讀（每則約 1 秒）…`);
  for (let i = 0; i < Math.min(total, SCAN_ROWS); i++) {
    if (i > 0 && i % 20 === 0) console.log(`   …讀到第 ${i}/${Math.min(total, SCAN_ROWS)} 則`);
    const 更多鈕 = btns.nth(i);
    const aria = (await 更多鈕.getAttribute("aria-label").catch(() => "")) || "";
    if (!aria) continue; // nth(i) 剛好落在「數過但現在沒了」的節點
    const kind = 種類(aria);
    if (!kind || !要這種(kind)) continue; // 心情之類的不算；--kinds 沒要的也跳過
    const 社團 =
      aria.match(/在\s*(.+?)\s*社團發佈了貼文/)?.[1]?.trim() ||
      aria.match(/在\s*(.+?)\s*發佈了貼文/)?.[1]?.trim() ||
      aria.match(/在\s*(.+?)\s*新增了\s*\d+\s*(?:張相片|段影片)/)?.[1]?.trim() ||
      "";
    const 標頭日期 = (await 更多鈕.getAttribute("data-fbdel-date").catch(() => "")) || "";

    // --from/--to：標頭日期就不在區間內的，不用花 1 秒去讀內文（2025/8 一個月 177 則、要的只有 67 則）。
    // 還是丟進 rows 讓 挑出要刪的 用「不在日期區間」略過，數字才對得上；這種殼列沒有內文、不去重。
    if (FROM || TO) {
      const d = 標頭日期 ? parseFbActivityDate(標頭日期, now) : null;
      if (d && ((FROM && d < FROM) || (TO && d > TO))) {
        // 第四種 aria 太通用：列裡沒有貼文連結的（工具列那種）不是貼文，連殼都不算（一次 locator 呼叫，比讀內文便宜）
        if (aria === 通用aria) {
          const 有連結 = await 那一列(更多鈕).locator('a[href*="permalink"], a[href*="/posts/"]').count().catch(() => 0);
          if (!有連結) continue;
        }
        區間外沒細讀++;
        rows.push({ aria, kind, 標頭日期, 社團, raw: "", 文字: "", 日期字: 標頭日期, 日期: d, 連結: "", 殼: true });
        continue;
      }
    }

    const raw = (await 那一列(更多鈕).innerText().catch(() => "")).replace(/\s+/g, " ").trim();

    // 🔴 `那一列` 有時（節點正在重繪）會往上抓到「整包清單」——那種 raw 會含頁面標題
    //    「社團貼文和留言」或整串左側選單，或長到離譜。那不是一則貼文，跳過。
    if (
      !raw ||
      raw.length > 1200 ||
      raw.startsWith("社團貼文和留言") ||
      raw.startsWith("活動紀錄") ||
      raw.includes("篩選條件")
    ) {
      continue;
    }

    const href =
      (await 那一列(更多鈕)
        .locator('a[href*="/groups/"], a[href*="permalink"], a[href*="/posts/"], a[href*="story"]')
        .first()
        .getAttribute("href")
        .catch(() => null)) || "";
    let 連結 = "";
    try {
      if (href) 連結 = new URL(href, "https://www.facebook.com").toString().split(/[?#]/)[0];
    } catch {
      連結 = href;
    }
    // 第四種「更多選項」太通用：列裡沒有 permalink 連結、或那個容器裡不只一顆 ⋯（抓到整包清單）→ 不是一則貼文，跳過
    if (aria === 通用aria) {
      const 幾顆 = await 那一列(更多鈕).locator(`[aria-label=${JSON.stringify(通用aria)}]`).count().catch(() => 0);
      if (!/\/(?:posts|permalink)\/\d+/.test(連結) || 幾顆 !== 1) continue;
    }
    // 光溜溜／更多選項那種 aria 沒有社團名，從連結拆一個 groups/<id> 出來當標示
    const 社團標示 = 社團 || (連結.match(/\/groups\/([^/?#]+)/)?.[1] ? `groups/${連結.match(/\/groups\/([^/?#]+)/)[1]}` : "");

    // 去重：連結裡有貼文編號（/posts/<id>、/permalink/<id>）就用連結——同一篇發 8 個社團、內文一模一樣，
    // 只有連結不同（2026-09-20 8/16 那批）。🔴 只有社團網址、沒有貼文編號的連結不能當 key
    // （同一社團的好幾篇貼文 查看 連結都一樣是 /groups/<id>/），那種跟沒連結的一樣退回
    // 「標頭日期＋社團＋列文字」（相片貼文 aria 一樣、只差日期跟時間）
    const 指紋 = /\/(?:posts|permalink)\/\d+/.test(連結) ? 連結 : 標頭日期 + "｜" + 社團 + "｜" + raw.slice(0, 60);
    if (看過的.has(指紋)) continue; // 重複節點，跳過
    看過的.add(指紋);

    const 日期字 =
      raw.match(/\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/)?.[0] ||
      raw.match(/\d{1,2}\s*月\s*\d{1,2}\s*日/)?.[0] ||
      raw.match(/\d{4}-\d{2}-\d{2}/)?.[0] ||
      raw.match(/昨天|今天|剛剛|\d+\s*(?:天|週|個?月|年|小時|分鐘)前|上週|上個月/)?.[0] ||
      標頭日期 ||
      "";
    // 光溜溜那種列文字以名字開頭（「蕭茗馥 ✨內文…」），顯示時把名字砍掉。名字裡若有正規式特殊字元要跳脫。
    const 去名字 = new RegExp("^" + OWNER.replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c) + "\\s*");
    rows.push({
      // 🔴 aria 含社團名，但同一社團的相片貼文 aria 完全一樣——刪的時候要連 標頭日期＋raw 一起對，不能只靠 aria
      aria,
      kind,
      標頭日期,
      社團,
      raw,
      文字:
        (kind === "留言" ? "〔留言〕" : "") +
        (社團標示 ? `[${社團標示}] ` : "") +
        raw
          .replace(/^蕭.*?(?:發佈了貼文|新增了\s*\d+\s*(?:張相片|段影片)|回覆了.+?的留言|回應了.+?的貼文)。?\s*/, "")
          .replace(去名字, "")
          .replace(/^\d{4}年\d{1,2}月\d{1,2}日\s*/, "")
          .slice(0, 64),
      日期字,
      日期: parseFbActivityDate(日期字, now),
      連結,
    });
  }
  if (區間外沒細讀) console.log(`   （其中 ${區間外沒細讀} 則標頭日期不在區間內，沒細讀）`);
  return rows;
}

/* ────────────────── 篩出這次要刪的 ────────────────── */

function 挑出要刪的(rows, 上限 = MAX) {
  const now = Date.now();
  const 挑中 = [];
  const 略過 = [];
  for (const r of rows) {
    if (挑中.length >= 上限) break;

    // --group：不是指定的那個社團就跳過（「按社團清空」的核心；跟下面的內文比對是 AND 關係）
    if (GROUP_FILTER && r.社團 !== GROUP_FILTER) {
      略過.push({ ...r, 原因: "不是指定的社團" });
      continue;
    }

    // --from-post / --match：內文對不上就跳過（這是「只刪那一篇」的核心）
    if (MATCH_KEY && !指紋正規化(r.raw).includes(MATCH_KEY)) {
      略過.push({ ...r, 原因: "內文不含指定字串" });
      continue;
    }

    if (OLDER_THAN_DAYS != null) {
      if (!r.日期) {
        if (!INCLUDE_UNDATED) {
          略過.push({ ...r, 原因: "日期看不出來" });
          continue;
        }
      } else {
        const 幾天前 = (now - r.日期.getTime()) / 86400000;
        if (幾天前 < OLDER_THAN_DAYS) {
          略過.push({ ...r, 原因: `才 ${Math.round(幾天前)} 天，不到 ${OLDER_THAN_DAYS} 天` });
          continue;
        }
      }
    }

    // --from / --to：日期區間（兩端都含）。看不出日期的一律不刪——區間模式沒有 --include-undated 這種放行
    if (FROM || TO) {
      if (!r.日期) {
        略過.push({ ...r, 原因: "日期看不出來" });
        continue;
      }
      if ((FROM && r.日期 < FROM) || (TO && r.日期 > TO)) {
        略過.push({ ...r, 原因: "不在日期區間" });
        continue;
      }
    }
    挑中.push(r);
  }
  return { 挑中, 略過 };
}

/* ────────────────── 刪一則 ────────────────── */

async function 刪一則(row) {
  // 🔴 靠 ⋯ 鈕的 aria-label 重新找它——不用 index，因為前面刪掉幾則之後 index 全部位移。
  //    但 aria 只含社團名：同一社團的相片貼文 aria **完全一樣**，只拿 .first() 會刪到別則
  //    （例如清單最上面是 7/30 那則、要刪的是 7/20 那則）。所以同 aria 的每一顆都要再對
  //    「標頭日期」＋「那一列的文字開頭」，全對上才是它。（2026-09-20 加日期區間模式時補的）
  await 標日期();
  // 限定 div[role=main]：第四種 aria 只有「更多選項」，main 外面（Messenger、通知面板）也可能有同名的鈕
  const 同aria = page.locator(`div[role="main"] div[role="button"][aria-label=${JSON.stringify(row.aria)}]`).filter({ visible: true });
  const n = await 同aria.count().catch(() => 0);
  let 更多鈕 = null;
  for (let i = 0; i < n; i++) {
    const b = 同aria.nth(i);
    const d = (await b.getAttribute("data-fbdel-date").catch(() => "")) || "";
    if (row.標頭日期 && d !== row.標頭日期) continue;
    const t = (await 那一列(b).innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (!t.startsWith(row.raw.slice(0, 40))) continue;
    更多鈕 = b;
    break;
  }
  if (!更多鈕) {
    中止(
      `找不到這一則的「⋯」鈕了（可能已經被刪、或清單重繪；同 aria 的有 ${n} 顆但日期／內文都對不上）。停下來。\n   ${row.標頭日期} ${row.aria}`,
    );
  }
  await 更多鈕.scrollIntoViewIfNeeded().catch(() => {});
  await humanDelay(600, 1200);

  const 刪之前 = await page.locator(貼文更多動作).filter({ visible: true }).count().catch(() => 0);

  await 更多鈕.click();
  await humanDelay(900, 1600);

  // ⋯ 選單 render 在 body 的 portal，用 page 層級找
  const 刪除項 = await firstVisible(page, 候選("刪除選單項").候選, 5000);
  if (!刪除項) {
    await shot(`選單開了-找不到刪除`);
    中止(
      "⋯ 選單開了，但找不到「刪除」那一項。\n" +
        "     👉 把**打開的選單**截圖回來，我看選單裡確切寫什麼字（可能是「移到垃圾桶」之類）。\n" +
        "        截圖已存在 shots/。",
    );
  }
  await 刪除項.click();
  await humanDelay(1000, 1800);

  // FB 可能會再問一次「確定要刪除嗎」，也可能直接刪。有跳才處理，沒跳就往下。
  const 確認框 = await firstVisible(page, 候選("確認對話框").候選, FAST ? 800 : 3500);
  if (確認框) {
    const 確認鈕 = await firstVisible(確認框, 候選("確認刪除按鈕").候選, 4000);
    if (!確認鈕) {
      await shot(`確認框-找不到刪除鈕`);
      中止("跳出確認框但找不到裡面的「刪除」鈕。把確認框截圖回來，我看裡面按鈕怎麼寫。");
    }
    await 確認鈕.click();
    await humanDelay(800, 1400);
  }

  // 確認刪掉了：同 aria 的 ⋯ 鈕少了一顆，或看得到的 ⋯ 鈕總數少了。
  // （更多鈕 是 nth(i)，刪掉後 nth(i) 會指到下一顆同 aria 的，不能拿「那一顆還在不在」當依據）
  let 刪掉了 = false;
  for (let i = 0; i < 30 && !刪掉了; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const 同aria現在 = await 同aria.count().catch(() => n);
    const 現在總數 = await page.locator(貼文更多動作).filter({ visible: true }).count().catch(() => 刪之前);
    if (同aria現在 < n || 現在總數 <= 刪之前 - 1) 刪掉了 = true;
  }
  await humanDelay(1200, 2200);
  if (!刪掉了) {
    await shot(`刪完清單沒變少`);
    中止("按了刪除但那一則還在。可能被擋、或選單／確認框 selector 不對。看截圖確認刪了沒。");
  }
}

/* ────────────────── 主流程 ────────────────── */

let 刪了幾篇 = 0;
const 全部挑中 = [];
const 全部略過 = [];
let 全部讀到 = 0;

/** 刪這一頁挑中的（每則刪之前用 aria＋日期＋內文重新找它，所以 index 位移沒關係，照清單順序做就好）。 */
async function 刪這一批(挑中, 已算幾則) {
  for (const [n, row] of 挑中.entries()) {
    const 序 = 已算幾則 + n + 1;
    if (刪了幾篇 > 0) {
      const 停 = 刪了幾篇 % PAUSE_EVERY === 0;
      const ms = 停 ? PAUSE_SECS * 1000 : GAP_SECS != null ? GAP_SECS * 1000 : 6000 + Math.random() * 2000;
      if (ms > 0) {
        console.log(`\n⏳ 等 ${Math.round(ms / 1000)} 秒${停 ? `（每 ${PAUSE_EVERY} 則停久一點）` : ""}…`);
        await new Promise((r) => setTimeout(r, ms));
      }
    }

    console.log(`\n🗑️  第 ${序} 則：${row.日期字 ? row.日期字 + "  " : ""}${row.文字}`);
    await shot(`2-${序}-刪之前`);

    // 🔴 刪之前先記下來。刪完就查不到了。
    刪除紀錄.push({
      序,
      日期: row.日期字 || "（不明）",
      社團: row.社團 || "",
      連結: row.連結 || "（沒抓到）",
      內文: row.raw.slice(0, 200),
      刪除時間: localTimestamp(),
    });
    寫刪除紀錄();

    await 刪一則(row);
    刪了幾篇++;
    console.log(`   ✅ 刪掉了（累計 ${刪了幾篇} 則）`);
    await shot(`2-${序}-刪之後`);
  }
}

try {
  // 沒給 --months 就是原本的行為：開一次活動紀錄、讀一頁。給了就一個月開一次。
  const 頁面清單 = MONTHS.length ? MONTHS.map((m) => 清單網址(m)) : [ACTIVITY_LOG_URL];
  let 有讀到東西 = false;

  // --sweep：整輪跑完若有刪到東西，再跑一輪（同樣的頁面），直到一輪都沒刪到或到上限。
  // 只有真的刪才需要（預覽再掃也是同一批）。
  const 輪數 = DO_DELETE && SWEEP ? SWEEP_ROUNDS : 1;
  // 跳月份的畫面偶爾會被 FB 節流（轉「載入中」就不吐了），一輪空的不代表真的空：要連續兩輪都空才停
  const 要連續幾輪空 = MONTHS.length ? 2 : 1;
  let 連續空輪 = 0;
  for (let round = 1; round <= 輪數; round++) {
  if (round > 1) {
    console.log(`\n🔁 第 ${round} 輪：刪掉的位置會浮出下一批，重掃一次…`);
    // 這一輪要重新挑，配額不累計（每輪最多 MAX）
    全部挑中.length = 0;
  }
  const 這輪刪了前 = 刪了幾篇;

  for (const [pi, url] of 頁面清單.entries()) {
    const 剩餘 = MAX - 全部挑中.length;
    if (剩餘 <= 0) {
      console.log(`\n（已經挑滿 ${MAX} 篇，剩下的月份這次不看；再跑一次會接著處理）`);
      break;
    }
    await 開啟清單(url);
    await shot(`1-清單${頁面清單.length > 1 ? `-${pi + 1}` : ""}`);

    const rows = await 讀清單({ 容許空頁: MONTHS.length > 0 }); // 跳月份時某個月空的是正常的
    if (rows.length) 有讀到東西 = true;
    全部讀到 += rows.length;
    console.log(`\n活動紀錄裡讀到 ${rows.length} 則社團貼文。`);

    const { 挑中, 略過 } = 挑出要刪的(rows, 剩餘);
    全部略過.push(...略過);

    console.log(`\n${"─".repeat(64)}`);
    console.log(`這次會刪這 ${挑中.length} 則${DO_DELETE ? "" : "（要真的刪，加 --confirm 重跑）"}：`);
    console.log("─".repeat(64));
    挑中.forEach((r, n) => {
      console.log(`${String(全部挑中.length + n + 1).padStart(2)}. ${r.日期字 ? r.日期字 + "  " : ""}${r.文字}`);
      if (r.連結) console.log(`     ${r.連結}`);
    });
    if (略過.length) {
      const 前三 = [...new Set(略過.map((r) => r.原因))].slice(0, 3).join("、");
      console.log(`\n略過 ${略過.length} 則（${前三}）`);
    }

    if (DO_DELETE && 挑中.length) await 刪這一批(挑中, 刪了幾篇); // 序號用累計刪了幾篇接下去，--sweep 多輪不會重號
    全部挑中.push(...挑中);
  }

  if (輪數 > 1) {
    if (刪了幾篇 === 這輪刪了前) {
      連續空輪++;
      if (連續空輪 >= 要連續幾輪空) {
        console.log(`\n✅ 這一輪沒有再找到要刪的，掃乾淨了（共 ${round} 輪）。`);
        break;
      }
      console.log(`\n（這一輪沒找到；跳月份畫面偶爾載入不全，再確認一輪）`);
    } else {
      連續空輪 = 0;
    }
  }
  } // sweep 迴圈

  if (!有讀到東西 && MONTHS.length > 0) {
    // 跳月份時全部空的多半是「那幾個月已經清光了」——不當錯誤（--sweep 之後最後一輪本來就會空）
    console.log("\n這幾個月的活動紀錄裡已經沒有符合種類的項目（清光了；或 selector 沒對上——看 shots/ 的截圖確認）。\n");
    console.log(`RESULT_JSON:${JSON.stringify({ deleted: 刪了幾篇, previewCount: 0, scanned: 0, confirmed: DO_DELETE, items: 刪除紀錄.map((d) => ({ date: d.日期, group: d.社團 || null, link: d.連結, snippet: d.內文.slice(0, 80) })) })}`);
    await browser.close();
    process.exit(0);
  }

  if (!全部挑中.length && 刪了幾篇 > 0) {
    // --sweep 的最後一輪是空的，前面幾輪已經刪了東西 → 正常收尾
    console.log(`\n${"─".repeat(64)}`);
    console.log(`這次總共刪了 ${刪了幾篇} 則。清單在 ${DELETED_LOG_DIR}。`);
    console.log("─".repeat(64) + "\n");
    console.log(`RESULT_JSON:${JSON.stringify({ deleted: 刪了幾篇, previewCount: 0, scanned: 全部讀到, confirmed: true, items: 刪除紀錄.map((d) => ({ date: d.日期, group: d.社團 || null, link: d.連結, snippet: d.內文.slice(0, 80) })) })}`);
    await browser.close();
    process.exit(0);
  }
  if (!全部挑中.length) {
    console.log("\n沒有符合條件的貼文，什麼都不做。");
    if (MATCH_KEY && 全部略過.some((r) => r.原因 === "內文不含指定字串")) {
      console.log(
        `   （沒有一則對得上「${MATCH_顯示}」。活動紀錄的內文摘要可能被截得很短 ——\n` +
          `    改用 --match= 給更短、更靠前的一段字試試，或先不加條件看看清單長怎樣。）`,
      );
    }
    console.log("");
    // 給呼叫端（桌機 runner）讀的機器可讀結果
    console.log(`RESULT_JSON:${JSON.stringify({ deleted: 0, previewCount: 0, scanned: 全部讀到, confirmed: DO_DELETE, items: [] })}`);
    await browser.close();
    process.exit(0);
  }

  // dry-run：把清單寫一份出來就結束
  if (!DO_DELETE) {
    const preview = path.join(DELETED_LOG_DIR, `DRYRUN-${RUN_STAMP}.md`);
    writeFileSync(
      preview,
      [
        `# 批次刪社團貼文 —— 預覽（沒有真的刪）`,
        `時間：${localTimestamp()}`,
        `條件：${日期條件文字}${MATCH_顯示 ? `，內文含「${MATCH_顯示}」` : ""}${GROUP_FILTER ? `，社團＝「${GROUP_FILTER}」` : ""}，最多 ${MAX} 篇`,
        ``,
        `## 加 --confirm 之後會刪這 ${全部挑中.length} 篇`,
        ...全部挑中.map((r, n) => `${n + 1}. ${r.日期字 || "（日期不明）"} — ${r.文字}\n   ${r.連結 || "（沒抓到連結）"}`),
      ].join("\n"),
      "utf8",
    );
    console.log(`\n這是「只看不刪」。清單也寫了一份到：${preview}`);
    console.log("   確認沒問題，同一條指令加 --confirm 重跑一次就會真的刪。\n");
    console.log(
      `RESULT_JSON:${JSON.stringify({
        deleted: 0,
        previewCount: 全部挑中.length,
        scanned: 全部讀到,
        confirmed: false,
        previewFile: preview,
        items: 全部挑中.map((r) => ({ date: r.日期字 || null, group: r.社團 || null, link: r.連結 || null, snippet: r.文字 })),
      })}`,
    );
    await browser.close();
    process.exit(0);
  }

  console.log(`\n${"─".repeat(64)}`);
  console.log(`這次刪了 ${刪了幾篇} 則。清單在 ${DELETED_LOG_DIR}。`);
  console.log("─".repeat(64) + "\n");
  console.log(
    `RESULT_JSON:${JSON.stringify({
      deleted: 刪了幾篇,
      previewCount: 0,
      scanned: 全部讀到,
      confirmed: true,
      items: 刪除紀錄.map((d) => ({ date: d.日期, group: d.社團 || null, link: d.連結, snippet: d.內文.slice(0, 80) })),
    })}`,
  );
} catch (err) {
  if (!(err instanceof 刪除中止)) throw err;
  console.error(`\n❌ ${err.message}`);
  await shot("失敗");
  console.error(`   截圖在 ${SHOTS_DIR}，看一下卡在哪。`);
  if (刪了幾篇 > 0) {
    console.error(`   ⚠ 中止前已經刪了 ${刪了幾篇} 篇，清單在 ${DELETED_LOG_DIR}。`);
  }
  await browser.close().catch(() => {});
  process.exit(1);
} finally {
  await browser.close().catch(() => {});
}

process.exit(0);
