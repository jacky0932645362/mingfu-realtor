/**
 * 端對端測試：自己蓋一張假的 FB 發文頁，讓**真正的 post.mjs** 去跑
 *
 * 跑法：node test-post-e2e.mjs
 *
 * ⭐ 為什麼要這樣測（照 591 那支的做法）：
 *    離線邏輯測試（test-fb-post.mjs）驗的是「文案組得對不對」，
 *    但「點開發文框 → 打字 → 對答案 → 上傳照片 → 按發布」這條主迴圈
 *    完全沒被驗過。沒有 FB 帳號就驗不了的話，等於要等接上去那天才知道會不會動。
 *
 *    所以改成蓋一張結構跟 FB 一樣的假頁面（test-fake-fb.html），
 *    用環境變數把 post.mjs 指過去，再把它填進去的東西讀回來對答案。
 *
 * ⚠️ 這裡驗的是**程式邏輯**，不是真的 FB 的 selector。
 *    真的 FB 長什麼樣還是要靠 `npm run inspect`。
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { serializePostFile, HARVEST } from "./_shared.mjs";

const HERE = import.meta.dirname;
const SANDBOX = path.join(HERE, "test-tmp");
const POSTS = path.join(SANDBOX, "posts");
const AUTH = path.join(SANDBOX, "fake-auth.json");
const DUMP = path.join(SANDBOX, "dump.json");
const SHOTS = path.join(SANDBOX, "shots");
const FAKE_PAGE = pathToFileURL(path.join(HERE, "test-fake-fb.html")).href;

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${name}${extra ? `　→ ${extra}` : ""}`);
};

/* 每次從乾淨的狀態開始，不然上一輪標成 posted 的檔會影響這一輪 */
if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(POSTS, { recursive: true });

// post.mjs 會檢查登入狀態存不存在。假頁面不需要 cookie，給一個空的合法 storageState 就好。
writeFileSync(AUTH, JSON.stringify({ cookies: [], origins: [] }), "utf8");

/** 1x1 的透明 PNG。用 data: URL 是為了讓測試不依賴網路。 */
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const TINY_PNG_BUF = Buffer.from(TINY_PNG.split(",")[1], "base64");

// 本機照片測試用：一個資料夾裡放兩張真的檔案，外加一個單檔
const PHOTO_DIR = path.join(SANDBOX, "物件照");
mkdirSync(PHOTO_DIR, { recursive: true });
writeFileSync(path.join(PHOTO_DIR, "02.png"), TINY_PNG_BUF);
writeFileSync(path.join(PHOTO_DIR, "01.png"), TINY_PNG_BUF);
writeFileSync(path.join(PHOTO_DIR, "readme.txt"), "不是圖片，不該被撿"); // 干擾項
const SINGLE_PHOTO = path.join(SANDBOX, "封面.jpg");
writeFileSync(SINGLE_PHOTO, TINY_PNG_BUF);

const BODY = [
  "梧棲 698 萬，買得到 2房2廳1衛＋平面車位？",
  "",
  "📍 台中市梧棲區｜總價 698 萬",
  "🚗 平面車位一個",
  "",
  "【這間的重點】",
  "・高樓層看得到海",
  "・平面車位免倒車",
  "",
  "📱 0932-645-362（電話／LINE 同號）",
].join("\n");

function writePost(name, meta, body) {
  writeFileSync(path.join(POSTS, name), serializePostFile(meta, body), "utf8");
}

// 測試用的社團清單。指到假頁面，社團跟個人主頁走的是同一套流程，
// 所以拿同一張假頁面當「社團」就驗得到多目標的邏輯。
const GROUPS = path.join(SANDBOX, "groups.json");
const 假社團A = `${FAKE_PAGE}?g=A`;
const 假社團B = `${FAKE_PAGE}?g=B`;
writeFileSync(
  GROUPS,
  JSON.stringify({
    社團: [
      { 名稱: "測試社團A", 網址: 假社團A, 啟用: false },
      { 名稱: "測試社團B", 網址: 假社團B, 啟用: false },
    ],
  }),
  "utf8",
);

function runPost(args, extraEnv = {}) {
  return spawnSync(process.execPath, ["post.mjs", ...args], {
    cwd: HERE,
    encoding: "utf8",
    env: {
      ...process.env,
      FB_HOME: FAKE_PAGE,
      FB_AUTH_FILE: AUTH,
      FB_POSTS_DIR: POSTS,
      FB_SHOTS_DIR: SHOTS,
      FB_DUMP_VALUES: DUMP,
      FB_GROUPS_FILE: GROUPS,
      FB_GROUP_GAP_MINUTES: "0",
      ...extraEnv,
    },
  });
}

/* ────────────────── 1. 完整跑一遍：打字 + 照片 + 送出 ────────────────── */

console.log("① 完整發一篇（含照片、真的按發布）…");
writePost("a-完整.md", { status: "pending", publishAt: "2020-01-01 09:00", photos: [TINY_PNG, TINY_PNG] }, BODY);

let r = runPost(["a-完整.md", "--publish", "--headless"]);
ok("① 正常結束", r.status === 0, `離開碼 ${r.status}\n${r.stdout}\n${r.stderr}`.slice(0, 600));

if (existsSync(DUMP)) {
  const dumped = JSON.parse(readFileSync(DUMP, "utf8"));
  const flat = (s) => String(s).replace(/\s+/g, "");

  ok("① 內文完整打進去", flat(dumped.text) === flat(BODY), `實際：${dumped.text?.slice(0, 60)}`);
  ok("① 鉤子在第一行", dumped.text.split("\n")[0].includes("698"), dumped.text.split("\n")[0]);
  ok("① 換行沒被吃掉", dumped.text.split("\n").length >= 8, `只有 ${dumped.text.split("\n").length} 行`);
  ok("① emoji 沒壞", dumped.text.includes("📍") && dumped.text.includes("🚗"));
  ok("① 兩張照片都上傳了", dumped.photoCount === 2, String(dumped.photoCount));
  ok(
    "① 照片有補上圖片副檔名（data:image/png → .png）",
    dumped.photoNames?.every((n) => /\.(jpe?g|png|webp|gif)$/i.test(n)),
    dumped.photoNames?.join(","),
  );
} else {
  ok("① 有倒出填進去的值", false, "dump.json 沒產生，post.mjs 大概在填之前就掛了");
}

{
  const after = readFileSync(path.join(POSTS, "a-完整.md"), "utf8");
  ok("① 發完標記成 posted", after.includes("status: posted"), after.slice(0, 120));
  ok("① 有記下發出去的時間", /postedAt: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(after));
  ok("① 有記下是誰按的", after.includes("--publish"));
}

/* ────────────────── 1b. 本機照片：單檔 ＋ 資料夾展開 ────────────────── */

console.log("①b 本機照片（單檔＋整個資料夾）…");
writePost(
  "a2-本機照片.md",
  { status: "pending", publishAt: "2020-01-01 09:00", photos: [SINGLE_PHOTO, PHOTO_DIR] },
  BODY,
);
r = runPost(["a2-本機照片.md", "--publish", "--headless"], { FB_MIN_GAP_MINUTES: "0" });
ok("①b 正常結束", r.status === 0, `離開碼 ${r.status}\n${r.stdout}\n${r.stderr}`.slice(0, 600));
if (existsSync(DUMP)) {
  const dumped = JSON.parse(readFileSync(DUMP, "utf8"));
  // 單檔 1 張 ＋ 資料夾 2 張（.txt 不算）＝ 3
  ok("①b 單檔＋資料夾＝3 張", dumped.photoCount === 3, String(dumped.photoCount));
  ok("①b 資料夾內依檔名排序（01 在 02 前）", dumped.photoNames?.join(",").indexOf("01") < dumped.photoNames?.join(",").indexOf("02"), dumped.photoNames?.join(","));
  ok("①b 沒撿到 readme.txt", !dumped.photoNames?.some((n) => n.endsWith(".txt")), dumped.photoNames?.join(","));
}

console.log("①c 照片路徑打錯 → 停下來不默默發沒圖的…");
writePost(
  "a3-爛路徑.md",
  { status: "pending", publishAt: "2020-01-01 09:00", photos: ["D:\\不存在的資料夾\\x.jpg"] },
  BODY,
);
r = runPost(["a3-爛路徑.md", "--publish", "--headless"], { FB_MIN_GAP_MINUTES: "0" });
ok("①c 一張都備不出來就中止", r.status !== 0, "居然還發了");
ok("①c 訊息講得出是照片問題", (r.stdout + r.stderr).includes("準備不出來"), (r.stdout + r.stderr).slice(-300));
ok("①c 沒有真的開瀏覽器發文", !r.stdout.includes("📍 個人主頁") && !r.stdout.includes("已經幫你貼好"), r.stdout.slice(-200));
// a3 因為照片錯而卡在 pending＋過去時間，會被後面「挑該發哪一篇」的測試撈到 —— 收起來
writePost("a3-爛路徑.md", { status: "skipped", publishAt: "2020-01-01 09:00", photos: [] }, "（照片路徑測試用，已收）");

/* ────────────────── 1d. 影片：跟照片同一顆上傳欄位一起送出（2026-09-22） ────────────────── */

console.log("①d 影片（本機路徑，跟照片一起送出）…");
const VIDEO_FILE = path.join(SANDBOX, "覓蜜開箱.mp4");
writeFileSync(VIDEO_FILE, "fake video bytes —— prepareVideo 對本機路徑只看副檔名，不驗內容");
writePost(
  "a4-含影片.md",
  { status: "pending", publishAt: "2020-01-01 09:00", photos: [SINGLE_PHOTO], video: VIDEO_FILE },
  BODY,
);
r = runPost(["a4-含影片.md", "--publish", "--headless"], { FB_MIN_GAP_MINUTES: "0" });
ok("①d 正常結束", r.status === 0, `離開碼 ${r.status}\n${r.stdout}\n${r.stderr}`.slice(0, 600));
if (existsSync(DUMP)) {
  const dumped = JSON.parse(readFileSync(DUMP, "utf8"));
  ok("①d 照片沒被影片擠掉，還是 1 張", dumped.photoCount === 1, String(dumped.photoCount));
  ok("①d 影片有被撿進去、跟照片一起塞進同一顆欄位", dumped.videoName === "覓蜜開箱.mp4", String(dumped.videoName));
}

console.log("①e 影片路徑打錯 → 停下來不默默發沒影片的…");
writePost(
  "a5-影片爛路徑.md",
  { status: "pending", publishAt: "2020-01-01 09:00", photos: [], video: "D:\\不存在的資料夾\\x.mp4" },
  BODY,
);
r = runPost(["a5-影片爛路徑.md", "--publish", "--headless"], { FB_MIN_GAP_MINUTES: "0" });
ok("①e 影片備不出來就中止", r.status !== 0, "居然還發了");
ok("①e 訊息講得出是影片問題", (r.stdout + r.stderr).includes("影片準備不出來"), (r.stdout + r.stderr).slice(-300));
ok(
  "①e 沒有真的開瀏覽器發文",
  !r.stdout.includes("📍 個人主頁") && !r.stdout.includes("已經幫你貼好"),
  r.stdout.slice(-200),
);
// 跟 a3 同樣的道理：這篇因為影片錯而卡在 pending＋過去時間，收起來免得被後面「挑該發哪一篇」的測試撈到
writePost("a5-影片爛路徑.md", { status: "skipped", publishAt: "2020-01-01 09:00" }, "（影片路徑測試用，已收）");

/* ────────────────── 2. 已經發過的不會再發一次 ────────────────── */

console.log("② 已發過的不該再發…");
r = runPost(["a-完整.md", "--publish", "--headless"]);
ok("② 擋下重發", r.status !== 0, "居然又發了一次");
ok("② 訊息講得出原因", (r.stdout + r.stderr).includes("已經發過"), (r.stdout + r.stderr).slice(0, 200));

/* ────────────────── 3. 90 分鐘間隔的擋 ────────────────── */

console.log("③ 兩篇之間的間隔…");
writePost("b-太快.md", { status: "pending", publishAt: "2020-01-01 09:00", photos: [] }, BODY);

r = runPost(["b-太快.md", "--publish", "--headless"]);
ok("③ 剛發完馬上再發會被擋", r.status !== 0, "沒擋住");
ok("③ 訊息講得出是間隔問題", (r.stdout + r.stderr).includes("分鐘"), (r.stdout + r.stderr).slice(0, 200));

r = runPost(["b-太快.md", "--publish", "--headless", "--force"], { FB_MIN_GAP_MINUTES: "0" });
ok("③ --force 蓋得過", r.status === 0, `離開碼 ${r.status}\n${r.stderr}`.slice(0, 400));
ok(
  "③ 沒照片也發得出去",
  existsSync(DUMP) && JSON.parse(readFileSync(DUMP, "utf8")).photoCount === 0,
);

/* ────────────────── 4. 空內文不發 ────────────────── */

console.log("④ 空內文…");
writePost("c-空的.md", { status: "pending", publishAt: "2020-01-01 09:00" }, "   ");
r = runPost(["c-空的.md", "--publish", "--headless"], { FB_MIN_GAP_MINUTES: "0" });
ok("④ 不發空白貼文", r.status !== 0, "居然發了空白的");
ok("④ 訊息講得出原因", (r.stdout + r.stderr).includes("沒有內文"), (r.stdout + r.stderr).slice(0, 200));
// 空內文那篇會維持 pending（程式在開瀏覽器之前就退出了），
// 不處理掉的話後面第 6 項會一直撈到它。收起來，那一項才驗得到真正想驗的事。
writePost("c-空的.md", { status: "skipped", publishAt: "2020-01-01 09:00" }, "（空的，測試用）");

/* ────────────────── 5. selector 全錯時要「停住」不是「發出殘缺的」 ────────────────── */

console.log("⑤ FB 改版（selector 全部失效）…");
const BROKEN = path.join(SANDBOX, "broken-selectors.json");
writeFileSync(
  BROKEN,
  JSON.stringify({
    steps: {
      開啟發文框: { 候選: ["div.this-does-not-exist"] },
      發文視窗: { 候選: ['div[role="dialog"]'] },
      內文輸入框: { 候選: ['div[role="textbox"]'] },
      照片按鈕: { 候選: ["div.nope"] },
      照片上傳欄位: { 候選: ['input[type="file"]'] },
      發布按鈕: { 候選: ['div[aria-label="發佈"]'] },
      登入過期偵測: { 候選: ['input[name="pass"]'] },
    },
  }),
  "utf8",
);

writePost("d-改版.md", { status: "pending", publishAt: "2020-01-01 09:00" }, BODY);
r = runPost(["d-改版.md", "--publish", "--headless"], {
  FB_SELECTORS_FILE: BROKEN,
  FB_MIN_GAP_MINUTES: "0",
});
ok("⑤ 找不到發文框就停住", r.status !== 0, "居然繼續往下做了");
ok("⑤ 有講「重跑 inspect」", (r.stdout + r.stderr).includes("inspect"), (r.stdout + r.stderr).slice(0, 300));
{
  const after = readFileSync(path.join(POSTS, "d-改版.md"), "utf8");
  ok("⑤ 失敗會標記成 failed", after.includes("status: failed"), after.slice(0, 120));
  ok("⑤ 失敗原因寫進檔案", after.includes("lastError"), after.slice(0, 200));
}

/* ────────────────── 6. 挑「該發的那一篇」 ────────────────── */

console.log("⑥ 不指定檔名時挑哪一篇…");
writePost("e-未來.md", { status: "pending", publishAt: "2099-01-01 09:00" }, BODY);
r = runPost(["--list"]);
ok("⑥ --list 不需要瀏覽器就跑得完", r.status === 0);
ok("⑥ --list 看得到全部四篇", (r.stdout.match(/\.md/g) || []).length >= 4, r.stdout.slice(0, 300));

r = runPost(["--headless", "--publish"], { FB_MIN_GAP_MINUTES: "0" });
ok("⑥ 沒有到期的就什麼都不做", r.status === 0 && r.stdout.includes("什麼都不做"), r.stdout.slice(0, 200));

/* ────────────────── 7. 抄欄位：三個真實的坑 ────────────────── */

console.log("⑦ 抄欄位（兄弟標籤／流水號 id／portal 下拉）…");
{
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(HERE, "test-fake-marketplace.html")).href, {
    waitUntil: "load",
  });

  const rows = await page.evaluate(HARVEST, null);
  const byLabel = (t) => rows.find((r) => r.旁邊的標籤 === t);

  // ① 標籤是兄弟節點 —— 一般抄法會全部抄回「(無標籤)」
  ok("⑦ 撿得到兄弟節點的標籤「售價」", !!byLabel("售價"), rows.map((r) => r.旁邊的標籤).join(","));
  ok("⑦ 撿得到「地址」", !!byLabel("地址"));
  ok("⑦ 撿得到「房間數」", !!byLabel("房間數"));

  // ② 流水號 id 要被標成不能用
  ok("⑦ `:r1:` 判定成不能用", byLabel("售價")?.id能不能用 === false, String(byLabel("售價")?.id能不能用));
  ok("⑦ `jsc_c_3` 判定成不能用", byLabel("地址")?.id能不能用 === false, String(byLabel("地址")?.id能不能用));
  ok(
    "⑦ 人取的 `bedrooms-field` 判定成可以用",
    byLabel("房間數")?.id能不能用 === true,
    String(byLabel("房間數")?.id能不能用),
  );

  // 有 aria-label 就不要再去旁邊撿（撿到的會是隔壁那格的字）
  const described = rows.find((r) => r.ariaLabel === "物件描述");
  ok("⑦ 有 aria-label 就不去旁邊撿", described && !described.旁邊的標籤, described?.旁邊的標籤);

  // ③ portal 下拉
  const portals = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[role="listbox"],[role="menu"],[role="tooltip"]')) {
      let depth = 0;
      let n = el;
      while (n.parentElement && n.parentElement !== document.body) {
        n = n.parentElement;
        depth++;
      }
      out.push({
        role: el.getAttribute("role"),
        掛在body底下第幾層: depth,
        選項數: el.querySelectorAll('[role="option"],[role="menuitem"]').length,
      });
    }
    return out;
  });
  ok("⑦ 抓得到 portal 下拉", portals.length === 1, JSON.stringify(portals));
  ok("⑦ portal 直接掛在 body 底下", portals[0]?.掛在body底下第幾層 === 0, String(portals[0]?.掛在body底下第幾層));
  ok("⑦ 讀得到五個選項", portals[0]?.選項數 === 5, String(portals[0]?.選項數));

  // 檔案欄位（隱藏的也要抓得到，不然照片永遠上不去）
  const files = await page.evaluate(() => document.querySelectorAll('input[type="file"]').length);
  ok("⑦ 抓得到檔案上傳欄位", files === 1, String(files));

  await browser.close();
}

/* ────────────────── 8. 一篇文發到多個地方 ────────────────── */

console.log("⑧ 一篇文發到多個地方…");
writePost(
  "f-多目標.md",
  { status: "pending", publishAt: "2020-01-01 09:00", targets: ["個人主頁", 假社團A, 假社團B] },
  BODY,
);

r = runPost(["f-多目標.md", "--publish", "--headless"], { FB_MIN_GAP_MINUTES: "0" });
ok("⑧ 三個地方都跑完", r.status === 0, `離開碼 ${r.status}\n${r.stderr}`.slice(0, 400));
{
  const after = readFileSync(path.join(POSTS, "f-多目標.md"), "utf8");
  const 發過了 = after.split("\n").filter((l) => l.trim().startsWith("- ") && l.includes(" @ "));
  ok("⑧ 三個目標都記下來了", 發過了.length === 3, `只記了 ${發過了.length} 筆\n${after.slice(0, 400)}`);
  ok("⑧ 個人主頁有記到", after.includes("個人主頁 @"), after.slice(0, 300));
  ok("⑧ 兩個社團都有記到", after.includes("g=A @") && after.includes("g=B @"), after.slice(0, 400));
  ok("⑧ 全部發完才收成 posted", after.includes("status: posted"), after.slice(0, 200));
}

/* ────────────────── 9. 中途斷掉不會重發已發過的 ────────────────── */

console.log("⑨ 已經發過的目標不會重發…");
writePost(
  "g-續發.md",
  {
    status: "pending",
    publishAt: "2020-01-01 09:00",
    targets: ["個人主頁", 假社團A, 假社團B],
    發過了: [`個人主頁 @ 2020-01-01 09:00 --publish`],
  },
  BODY,
);

// 額度開大：這一項要驗的是「不重發」，不是一天上限（上限單獨在⑩驗）
r = runPost(["g-續發.md", "--publish", "--headless"], { FB_MIN_GAP_MINUTES: "0", FB_MAX_PER_DAY: "999" });
ok("⑨ 正常跑完", r.status === 0, `離開碼 ${r.status}\n${r.stderr}`.slice(0, 400));
ok("⑨ 只發還沒發的兩個", (r.stdout.match(/📍/g) || []).length === 2, `實際跑了 ${(r.stdout.match(/📍/g) || []).length} 個`);
ok("⑨ 沒有重發個人主頁", !r.stdout.includes("📍 個人主頁"), r.stdout.slice(0, 300));
{
  const after = readFileSync(path.join(POSTS, "g-續發.md"), "utf8");
  const 筆數 = after.split("\n").filter((l) => l.includes(" @ ")).length;
  ok("⑨ 總共還是三筆（沒有重複）", 筆數 === 3, `${筆數} 筆\n${after.slice(0, 400)}`);
}

/* ────────────────── 10. 一天上限 ────────────────── */

console.log("⑩ 一天最多幾次…");
writePost(
  "h-上限.md",
  { status: "pending", publishAt: "2020-01-01 09:00", targets: ["個人主頁", 假社團A, 假社團B] },
  BODY,
);

// 今天已經發了 5 次（前面幾項測試的量），上限設 2 就該只發到剩下的額度
r = runPost(["h-上限.md", "--publish", "--headless"], { FB_MIN_GAP_MINUTES: "0", FB_MAX_PER_DAY: "2" });
{
  const 跑了 = (r.stdout.match(/📍/g) || []).length;
  ok("⑩ 到上限就不再發", 跑了 === 0 || r.status !== 0, `居然還發了 ${跑了} 個`);
  ok("⑩ 訊息講得出是上限", (r.stdout + r.stderr).includes("上限"), (r.stdout + r.stderr).slice(0, 250));
}

// 額度夠但小於待發數 → 只發額度內的，其餘留著
writePost(
  "i-部分.md",
  { status: "pending", publishAt: "2020-01-01 09:00", targets: ["個人主頁", 假社團A, 假社團B] },
  BODY,
);
r = runPost(["i-部分.md", "--publish", "--headless"], {
  FB_MIN_GAP_MINUTES: "0",
  FB_MAX_PER_DAY: "999",
  FB_POSTS_DIR: POSTS,
});
ok("⑩ 額度夠就三個都發", (r.stdout.match(/📍/g) || []).length === 3, r.stdout.slice(0, 300));

/* ────────────────── 11. 間隔要把「發過了」算進去 ────────────────── */

console.log("⑪ 間隔要算到社團那幾筆…");
{
  const { minutesSinceLastPost } = await import("./_shared.mjs");
  const 現在 = new Date();
  const 五分鐘前 = new Date(現在.getTime() - 5 * 60000);
  const 時間字 = `${五分鐘前.getFullYear()}-${String(五分鐘前.getMonth() + 1).padStart(2, "0")}-${String(五分鐘前.getDate()).padStart(2, "0")} ${String(五分鐘前.getHours()).padStart(2, "0")}:${String(五分鐘前.getMinutes()).padStart(2, "0")}`;

  const 發到一半 = { file: "x.md", status: "pending", meta: { 發過了: [`https://g @ ${時間字}`] } };
  const 分鐘 = minutesSinceLastPost([發到一半]);
  ok("⑪ pending 但發過社團的也要算", 分鐘 < 10, `算出來 ${分鐘} 分鐘（應該約 5）`);

  const 排除自己 = minutesSinceLastPost([發到一半], "x.md");
  ok("⑪ 排除自己時不算", 排除自己 === Infinity, String(排除自己));
}

/* ────────────────── 12. FB 不支援的 Markdown 要擋下來 ────────────────── */

console.log("⑫ Markdown 語法要擋…");
writePost(
  "j-粗體.md",
  { status: "pending", publishAt: "2020-01-01 09:00", targets: ["個人主頁"] },
  "漏水不是不能買，是要在**簽約前**就知道。",
);

r = runPost(["j-粗體.md", "--publish", "--headless"], { FB_MIN_GAP_MINUTES: "0", FB_MAX_PER_DAY: "999" });
ok("⑫ 有粗體語法就不發", r.status !== 0, "居然發出去了");
ok("⑫ 訊息指出是哪一行", (r.stdout + r.stderr).includes("第 1 行"), (r.stdout + r.stderr).slice(0, 250));
ok("⑫ 沒有真的開瀏覽器", !r.stdout.includes("📍"), "不該開瀏覽器就該擋掉");

// --force 要蓋得過（真的想留符號的時候）
r = runPost(["j-粗體.md", "--publish", "--headless", "--force"], { FB_MIN_GAP_MINUTES: "0", FB_MAX_PER_DAY: "999" });
ok("⑫ --force 蓋得過", r.status === 0, `離開碼 ${r.status}\n${r.stderr}`.slice(0, 300));

// 正常文案（破折號／括號／emoji）不能被誤擋
writePost(
  "k-正常.md",
  { status: "pending", publishAt: "2020-01-01 09:00", targets: ["個人主頁"] },
  "🔍 摸窗框下緣跟牆角\n漏水不是不能買 —— 價格才有得談（簽約前就要知道）。\n📱 0932-645-362",
);
r = runPost(["k-正常.md", "--publish", "--headless"], { FB_MIN_GAP_MINUTES: "0", FB_MAX_PER_DAY: "999" });
ok("⑫ 破折號／括號／emoji 不會被誤擋", r.status === 0, `離開碼 ${r.status}\n${(r.stdout + r.stderr).slice(0, 300)}`);

/* ────────────────── 結果 ────────────────── */

console.log(`\n${"─".repeat(60)}`);
if (fails.length === 0) {
  console.log(`✅ ${pass} 項全過`);
  rmSync(SANDBOX, { recursive: true, force: true });
  process.exit(0);
}
console.log(`❌ ${pass} 過、${fails.length} 失敗：`);
for (const f of fails) console.log(`   ・${f}`);
console.log(`\n（沙盒留在 ${SANDBOX} 方便你看，下次跑會自己清掉）`);
process.exit(1);
