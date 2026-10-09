/**
 * FB 自動發文 —— 各支腳本共用的東西
 *
 * 跟 591-autofill 一樣刻意跟主專案分開（自己的 package.json、自己的 node_modules）：
 * Playwright 跟網站本體無關，塞進主專案只會讓 Vercel 每次 build 多裝一份用不到的東西。
 *
 * ⚠️ FB 個人主頁沒有官方發文 API（Graph API 只開放粉絲專頁），所以只能走瀏覽器自動化。
 *    這代表 FB 一改版就會壞 —— 設計目標因此是「壞掉時好修」，不是「越自動越好」。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import path from "node:path";

/** card-booking/ 的絕對路徑（這個檔在 card-booking/tools/fb-autopost/ 底下） */
export const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * 🔴 這一行要在下面那堆 `process.env.XXX` 常數**之前**跑（2026-09-07 加的）。
 *
 * 為什麼：下面的節奏參數（MIN_GAP_MINUTES／MAX_PER_DAY／GROUP_GAP_MINUTES）跟路徑設定
 * 都是**模組載入當下就算好的常數**。以前只有 runner.mjs／post-marketplace.mjs 這些
 * 「自己記得呼叫 loadEnv()」的腳本吃得到 .env.local，而 ESM 的 import 是先跑完被匯入的
 * 模組本體才回到呼叫端 —— 所以那時候常數早就用預設值定案了。
 * 結果就是：在 .env.local 寫 `FB_MAX_PER_DAY=100`，**直接 `node post.mjs` 完全沒效果**
 * （只有 runner 把它塞進子行程環境時才生效），同一個設定兩條路走出兩種行為。
 *
 * loadEnv() 內部是 `if (!process.env[key])` —— 已經存在的環境變數不會被蓋掉，
 * 所以端對端測試那種「spawn 時明確指定 FB_MAX_PER_DAY」的做法照樣贏過 .env.local。
 * 讀不到 .env.local 就安靜跳過用預設值，不要讓沒有設定檔的情境掛掉。
 */
try {
  loadEnv();
} catch {
  // 沒有 .env.local（例如乾淨環境跑測試）就用預設值
}

/**
 * 登入狀態（cookie）存這裡。⚠️ 等同 FB 帳號鑰匙，已進 .gitignore。
 * 路徑可用環境變數蓋掉，測試時才不用動到正式的登入狀態。
 */
export const AUTH_FILE = process.env.FB_AUTH_FILE || path.join(import.meta.dirname, "auth", "fb-state.json");

/** 每一步的截圖。出事時看得出來卡在哪 —— FB 的錯誤訊息常常只是畫面上一行小字。 */
export const SHOTS_DIR = process.env.FB_SHOTS_DIR || path.join(import.meta.dirname, "shots");

/** 唯一要維護的檔。FB 改版只改這個，程式碼一行不動。 */
export const SELECTORS_FILE =
  process.env.FB_SELECTORS_FILE || path.join(import.meta.dirname, "config", "selectors.json");

/** 排好的貼文放這裡，一篇一個 .md 檔。 */
export const POSTS_DIR = process.env.FB_POSTS_DIR || path.join(import.meta.dirname, "posts");

/** 照片要上傳給 FB 必須是本機檔案，網址得先抓下來放這。 */
export const TMP_DIR = process.env.FB_TMP_DIR || path.join(import.meta.dirname, "tmp");

/**
 * 批次刪社團貼文時，每次跑把「刪掉了哪些」寫一份到這裡。
 * 刪 FB 貼文救不回來 —— 就算刪錯了，至少留一份清單知道刪的是什麼。
 */
export const DELETED_LOG_DIR = process.env.FB_DELETED_LOG_DIR || path.join(import.meta.dirname, "deleted-log");

/**
 * 「活動紀錄 → 社團貼文和留言」的直達網址（2026-09-02 從本人的 activity-dump 抄回）。
 * `category_key=GROUPPOSTS` 進去就已經是篩好的畫面，不用再點左側篩選。
 * 可用環境變數蓋掉 —— 端對端測試要指到本機那張假的活動紀錄頁。
 */
export const ACTIVITY_LOG_URL =
  process.env.FB_ACTIVITY_URL ||
  "https://www.facebook.com/me/allactivity?category_key=GROUPPOSTS";

/**
 * 首頁網址。可以用環境變數蓋掉 —— 端對端測試要指到本機那張假的發文頁，
 * 才驗得到「沒有 FB 帳號時主迴圈到底會不會動」。
 */
export const FB_HOME = process.env.FB_HOME || "https://www.facebook.com/";

/**
 * 兩篇貼文之間至少要隔多久（分鐘）。
 *
 * 這不是技術限制，是本人自己定的原則：連續發文最容易被判定成異常帳號。
 * `--force` 可以蓋過，但預設擋住比較安全 —— 排程器設錯時間的機率遠高於真的需要連發。
 */
export const MIN_GAP_MINUTES = Number(process.env.FB_MIN_GAP_MINUTES || 90);

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** 把 card-booking/.env.local 讀進 process.env（要從資料庫撈物件時需要 DATABASE_URL）。 */
export function loadEnv() {
  const envFile = path.join(PROJECT_ROOT, ".env.local");
  if (!existsSync(envFile)) {
    throw new Error(`找不到 ${envFile} —— 從資料庫產貼文草稿需要 DATABASE_URL`);
  }
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

/** tsconfig 的 "@/*" 別名只有 Next 的 bundler 認得，裸 node 要自己接。 */
export function registerAliasHooks() {
  const base = pathToFileURL(PROJECT_ROOT).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) {
        return nextResolve(`${base}/src/${specifier.slice(2)}.ts`, context);
      }
      return nextResolve(specifier, context);
    },
  });
}

/** 時間戳，給截圖與檔名用。 */
export function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * 內文比對用的正規化：全形轉半形、拿掉 emoji、拿掉分隔符與空白、轉小寫。
 * delete-groups.mjs（活動紀錄）跟 delete-group-content.mjs（社團「你的內容」）共用同一份，
 * 兩邊比對的結果才會一致。
 *
 * 🔴 為什麼要這麼兇：FB 各種畫面的內文摘要，emoji（🔥）跟全形符號（｜【】）
 *    的呈現方式跟原文不一定一致，直接比對常常對不上。
 *    比對的兩邊都跑這個，剩下的就是「純文字」，最耐得住 FB 各種渲染差異。
 */
export const 指紋正規化 = (s) =>
  String(s || "")
    .normalize("NFKC")
    // emoji、變異選擇符、keycap 組字、ZWJ —— 摘要裡這些的呈現最不可靠
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}️⃣‍]/gu, "")
    // 分隔／標點／空白（全形半形都收，NFKC 之後多半已是半形）
    .replace(/[\s｜|·・･、。，,.．/／\\【】〔〕\[\](){}（）「」『』<>：:~～^*_+\-—–！!？?]+/g, "")
    .toLowerCase();

/**
 * 人工節奏。
 *
 * 跟 591 那支同樣的理由：FB 的發文框是逐步長出來的（點開才生 dialog、
 * 選了照片才出現預覽），機器全速操作會在下一個元素還沒生出來時就去點它。
 */
export function humanDelay(min = 300, max = 900) {
  // FB_FAST：端對端測試用，跑的是本機假頁面，不需要真的等 FB 的元素長出來。
  // 正式跑一律不設，節奏該慢就慢。
  if (process.env.FB_FAST) return new Promise((resolve) => setTimeout(resolve, 10));
  const ms = min + Math.floor(Math.random() * (max - min));
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 終端機等一下本人按 Enter（登入、按發布這種事不能由程式代做）。
 *
 * ⚠️ 一定要同時處理 `end`（EOF）。只等 `data` 的話，沒有終端機可讀時
 *    （排程器、測試、`< /dev/null`）會**永遠卡住不回**，而且畫面上什麼都看不出來 ——
 *    2026-08-25 拿假頁面測抄欄位時就是這樣掛住的。
 */
export function waitForEnter(message) {
  process.stdout.write(`\n${message}\n> `);
  return new Promise((resolve) => {
    const done = () => {
      process.stdin.off("data", done);
      process.stdin.off("end", done);
      process.stdin.pause();
      resolve();
    };
    process.stdin.resume();
    process.stdin.once("data", done);
    process.stdin.once("end", done);
  });
}

/** 在終端機問一行，回傳他打的字。EOF 時回空字串（理由同上）。 */
export function askLine(question) {
  process.stdout.write(`${question} `);
  return new Promise((resolve) => {
    const finish = (value) => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.pause();
      resolve(value);
    };
    const onData = (data) => finish(String(data).trim());
    const onEnd = () => finish("");
    process.stdin.resume();
    process.stdin.once("data", onData);
    process.stdin.once("end", onEnd);
  });
}

/**
 * 看一下存下來的登入檔到底有沒有「登入」這件事。
 *
 * FB 沒登入時也會發 cookie（`datr`／`fr`／`sb`／`wd`／`dpr`），那些只是瀏覽器指紋，
 * 檔案看起來正常但完全沒用。真正代表身分的是 **`c_user`**，代表 session 的是 **`xs`**。
 *
 * ⚠️ 只看 cookie 的「名字」，不讀值 —— 值等同帳號密碼，沒有任何理由印出來。
 */
export function authSessionStatus(file = AUTH_FILE) {
  if (!existsSync(file)) return { 檔案存在: false, 有登入: false, cookie數: 0, 缺少: ["c_user", "xs"] };
  try {
    const state = JSON.parse(readFileSync(file, "utf8"));
    const names = new Set((state.cookies || []).map((c) => c.name));
    const 缺少 = ["c_user", "xs"].filter((n) => !names.has(n));
    return {
      檔案存在: true,
      有登入: 缺少.length === 0,
      cookie數: names.size,
      缺少,
    };
  } catch {
    return { 檔案存在: true, 有登入: false, cookie數: 0, 缺少: ["讀不出來，檔案壞了"] };
  }
}

/**
 * 發文身分（2026-10-07）：登入代號 → 這個身分的登入檔路徑。
 *
 * 主帳號（沒有代號）＝原本的 AUTH_FILE，**一個字都沒變**——沒新增其他身分時行為跟以前一模一樣。
 * 其他身分放在跟 AUTH_FILE 同一個資料夾：fb-state-<代號>.json（測試把 FB_AUTH_FILE 指到沙盒時，
 * 其他身分的登入檔也自動跟著進沙盒，不會碰到真的 auth/）。
 *
 * 🔴 代號會被拼進檔名，一律先驗再拼；不合法直接丟錯，**絕不退回主帳號的檔**
 *    （退回去＝拿錯帳號的鑰匙去發文，是多帳號功能最不能發生的事）。
 * 規則要跟 src/lib/fb-identity-core.ts 的 isValidAuthKey／authFileNameFor 一致（test-identity.mjs 會對照）。
 */
export function authFileForIdentity(authKey) {
  if (authKey == null || authKey === "") return AUTH_FILE;
  if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(String(authKey))) {
    throw new Error(`登入代號不合法：「${authKey}」`);
  }
  return path.join(path.dirname(AUTH_FILE), `fb-state-${authKey}.json`);
}

/**
 * 🔴 版本錯位保險（2026-10-07）：後台 API 回的 identity，要跟資料庫裡那份工作實際指定的身分一致。
 * 後台還沒更新（舊版）時 claim 不會回 identity，runner 會把「沒有身分」當成主帳號——但資料庫裡這份工作
 * 可能是別的身分排的，拿主帳號去發＝用錯帳號。對不上就整份標失敗，不發。
 *   dbIdentityId：資料庫 fb_task.identity_id（null／空／"main"＝主帳號）
 *   jobIdentity ：後台回的 identity 物件（可能沒有）
 */
export function identityMatchesJob(dbIdentityId, jobIdentity) {
  const dbSide = dbIdentityId == null || dbIdentityId === "" || dbIdentityId === "main" ? null : String(dbIdentityId);
  const jobSide = !jobIdentity || !jobIdentity.id || jobIdentity.id === "main" ? null : String(jobIdentity.id);
  return dbSide === jobSide;
}

/**
 * 這個登入檔是哪個 FB 帳號（cookie `c_user` 的值＝帳號的數字編號，不是密碼；`xs` 那種 session 值一律不碰）。
 * 讀不到回 null。只給「新增身分時別把同一個帳號登入兩次」的比對用，不印出來。
 */
export function authAccountId(file) {
  try {
    if (!existsSync(file)) return null;
    const state = JSON.parse(readFileSync(file, "utf8"));
    const c = (state.cookies || []).find((x) => x.name === "c_user");
    return c?.value ? String(c.value) : null;
  } catch {
    return null;
  }
}

/** auth 資料夾裡所有登入檔（主帳號 fb-state.json ＋各身分 fb-state-<代號>.json），排除指定那一個。 */
export function otherAuthFiles(exceptFile) {
  const dir = path.dirname(AUTH_FILE);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^fb-state(-[a-z0-9-]+)?\.json$/.test(f))
    .map((f) => path.join(dir, f))
    .filter((f) => path.resolve(f) !== path.resolve(exceptFile));
}

/** 登入過期／沒登入時，統一講同一套人話，不要每支腳本各講各的。 */
export function 登入問題說明(file = AUTH_FILE) {
  const s = authSessionStatus(file);
  if (!s.檔案存在) return "還沒存過登入狀態。先跑 `npm run login`（或點桌面的「FB登入.bat」）。";
  if (!s.有登入) {
    return [
      `登入檔裡沒有真正的登入資訊（缺 ${s.缺少.join("、")}，目前只有 ${s.cookie數} 個瀏覽器指紋 cookie）。`,
      "   👉 代表上次跑「FB登入.bat」時，**按 Enter 的當下瀏覽器裡還沒登入完成**。",
      "   重跑一次，這次等到看見自己的首頁動態（中間有「在想些什麼」發文框）再按 Enter。",
    ].join("\n");
  }
  return [
    "登入檔看起來是完整的，但 FB 還是給了登出畫面 —— 那就是 cookie 過期了。",
    "   重跑 `npm run login`（或點桌面的「FB登入.bat」）。",
  ].join("\n");
}

/* ────────────────── selectors ────────────────── */

/**
 * FB 的 class name 是打亂過的（`x1i10hfl x1qjc9v5 …`），照抄一定會壞。
 * 所以 selectors.json 每一項存的是**一組候選**，依序試，第一個找得到的就用。
 * 前面放語意選擇器（role／aria-label），後面才放結構選擇器。
 */
export function loadSelectors() {
  if (!existsSync(SELECTORS_FILE)) {
    throw new Error(`找不到 ${SELECTORS_FILE}`);
  }
  const raw = JSON.parse(readFileSync(SELECTORS_FILE, "utf8"));
  if (!raw.steps || Object.keys(raw.steps).length === 0) {
    throw new Error("config/selectors.json 沒有 steps，檔案壞了或被改壞了。");
  }
  return raw;
}

/**
 * 依序試一組候選 selector，回傳第一個真的出現在畫面上的 locator。
 * 全部落空回 null —— 交給呼叫端決定要報錯還是跳過，這裡不猜。
 */
export async function firstVisible(scope, candidates, timeoutMs = 8000) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of list) {
      if (!sel || !String(sel).trim()) continue;
      const loc = scope.locator(sel).first();
      try {
        if (await loc.isVisible({ timeout: 250 })) return loc;
      } catch {
        // 這個候選不合法或不存在，換下一個
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

/**
 * 從 FB 那種「會捲動的下拉清單」裡選一項。
 *
 * ⚠️ FB Marketplace 的類別／狀況**不是標準下拉**：
 *    ・不是 `<select>`，也沒有 `role="option"`，是一堆純 div
 *    ・清單會捲動，一次只看得到六項左右（類別總共 34 項）
 *    所以不能用 selectOption，也不能只看畫面上現在有什麼。
 *    做法：點開 → 在清單裡捲著找目標文字 → 找到才點。
 *
 * 找不到就回 false，**絕不隨便點一個** —— 類別選錯就是刊到錯的地方。
 */
export async function 從捲動清單選(page, combo, 目標, { 最多捲幾次 = 25 } = {}) {
  await combo.click();
  await humanDelay(900, 1500);

  // 用「精確等於目標文字、而且是最底層節點」來認，避免點到包住它的整塊區域
  const 目標節點 = () => page.locator(`div:text-is("${目標}"), span:text-is("${目標}")`).last();

  for (let i = 0; i < 最多捲幾次; i++) {
    const loc = 目標節點();
    if (await loc.count().then((n) => n > 0).catch(() => false)) {
      try {
        await loc.scrollIntoViewIfNeeded({ timeout: 2000 });
        await humanDelay(250, 500);
        await loc.click({ timeout: 3000 });
        await humanDelay(600, 1100);
        return true;
      } catch {
        // 捲到了但點不到（被蓋住之類），繼續往下捲再試
      }
    }

    // 往下捲一頁。找那個 scrollHeight 比 clientHeight 大的容器。
    const 到底了 = await page.evaluate(() => {
      const cands = Array.from(document.querySelectorAll("div")).filter(
        (d) => d.scrollHeight > d.clientHeight + 20 && d.clientHeight > 100,
      );
      const el = cands[cands.length - 1];
      if (!el) return true;
      const before = el.scrollTop;
      el.scrollTop += el.clientHeight * 0.75;
      return el.scrollTop === before;
    });
    await humanDelay(300, 600);
    if (到底了) break;
  }
  return false;
}

/**
 * 找出「FB 不會渲染、只會原樣顯示」的 Markdown 語法。
 *
 * 🔴 為什麼要擋：2026-09-01 第一次真的發文時，草稿裡寫了 `**簽約前**`，
 *    FB 原樣印出四個星號，看起來就是一篇沒校稿的貼文。
 *    這種錯**發出去才會發現**，而且刪文重發比一開始擋住麻煩太多。
 *
 * 只抓「幾乎不可能是故意的」那幾種，不做全套 Markdown 偵測 ——
 * 誤擋比漏擋煩人（他的文案本來就會用到破折號、括號、emoji）。
 */
export function 找出FB不支援的語法(body) {
  const 規則 = [
    { 名稱: "粗體 **文字**", re: /\*\*[^*\n]+\*\*/ },
    { 名稱: "粗體 __文字__", re: /__[^_\n]+__/ },
    { 名稱: "標題 # ", re: /^#{1,6}\s+\S/ },
    { 名稱: "連結 [文字](網址)", re: /\[[^\]\n]+\]\([^)\n]+\)/ },
    { 名稱: "行內程式碼 `文字`", re: /`[^`\n]+`/ },
  ];
  const 問題 = [];
  body.split(/\r?\n/).forEach((line, i) => {
    for (const r of 規則) {
      if (r.re.test(line)) 問題.push({ 行號: i + 1, 語法: r.名稱, 內容: line.trim().slice(0, 50) });
    }
  });
  return 問題;
}

/* ────────────────── 發文目標（個人主頁 ＋ 社團） ────────────────── */

/** 個人主頁在 targets 裡就寫這四個字，其餘一律是社團網址。 */
export const 個人主頁 = "個人主頁";

/**
 * 一天最多發幾次（一次 ＝ 發到一個地方）。
 *
 * 不是技術限制，是「不要被判定成濫發」的自我約束 —— 同一篇灌到 20 個社團，
 * 跟一天發 20 次在 FB 眼裡沒什麼差別。`--force` 蓋得過。
 */
// 🔴 2026-09-19 本人拍板「發布社團不要設限發文次數」→ 預設 0 ＝ 不設限（0 要能寫，所以不能用 `|| 6`）。
//    真的要限再設 FB_MAX_PER_DAY=6 之類。這個值後台（fb-rhythm.ts）也讀同一個環境變數。
export const MAX_PER_DAY = (() => {
  const raw = process.env.FB_MAX_PER_DAY;
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
})();

/**
 * 同一篇文發到不同社團之間隔幾分鐘（基準值；擬真模式再乘 FB_GAP_JITTER 的隨機倍數）。
 * 2026-09-19 本人拍板「一般社團發文改為間隔 3 到 5 分鐘發一則」→ 基準 4 × 0.75～1.25 ＝ 3～5 分。
 */
export const GROUP_GAP_MINUTES = Number(process.env.FB_GROUP_GAP_MINUTES || 4);

export const GROUPS_FILE =
  process.env.FB_GROUPS_FILE || path.join(import.meta.dirname, "config", "groups.json");

export function loadGroups() {
  if (!existsSync(GROUPS_FILE)) return { 社團: [] };
  try {
    const raw = JSON.parse(readFileSync(GROUPS_FILE, "utf8"));
    return { ...raw, 社團: Array.isArray(raw.社團) ? raw.社團 : [] };
  } catch {
    throw new Error(`${GROUPS_FILE} 壞了，讀不出來。`);
  }
}

/** 目前勾選要發的社團。預設全部沒勾 —— 發到哪裡不由程式決定。 */
export function 啟用的社團() {
  return loadGroups().社團.filter((g) => g.啟用 && g.網址);
}

/** 社團網址 → 看得懂的名字。訊息裡不要只印一串數字，人看不出是哪個社團。 */
export function 社團名稱(網址) {
  if (網址 === 個人主頁) return 個人主頁;
  const hit = loadGroups().社團.find((g) => g.網址 === 網址);
  return hit ? hit.名稱 : 網址;
}

/**
 * 這篇文要發到哪些地方。
 * 檔案裡沒寫 targets 就用預設：個人主頁 ＋ 所有啟用的社團。
 */
export function 目標清單(post) {
  const 指定 = post.meta.targets;
  if (Array.isArray(指定) && 指定.length) return 指定;
  return [個人主頁, ...啟用的社團().map((g) => g.網址)];
}

/** 已經發過的目標（`發過了` 每一行是「目標 @ 時間」）。 */
export function 已發目標(post) {
  const list = Array.isArray(post.meta.發過了) ? post.meta.發過了 : [];
  return list.map((line) => String(line).split(" @ ")[0].trim()).filter(Boolean);
}

/**
 * 「發不進去、以後也不用再試」的目標（`跳過了` 每一行是「目標 @ 時間 原因」）。
 *
 * 🔴 2026-09-02 實際踩到：本人挑的 4 個社團裡，`台中海線專攻房地產買賣` **沒有「討論」分頁**，
 *    只有「商品買賣」（社團版 Marketplace，要填表單）。一般發文框根本不存在。
 *    抽查 14 個社團有 6 個是這種 —— 這不是壞掉，是那個社團就長這樣，重試一百次也一樣。
 *    所以跟「發過了」分開記：**不算今天的發文次數、不會再重試、也不擋整批**。
 */
export function 已跳過目標(post) {
  const list = Array.isArray(post.meta.跳過了) ? post.meta.跳過了 : [];
  return list.map((line) => String(line).split(" @ ")[0].trim()).filter(Boolean);
}

/** 還沒處理的目標。發過的、跳過的都不算。全部處理完 ＝ 這篇結束。 */
export function 還沒發的目標(post) {
  const 處理過 = new Set([...已發目標(post), ...已跳過目標(post)]);
  return 目標清單(post).filter((t) => !處理過.has(t));
}

/** 全部目標都處理完了就把 status 收成 posted。回傳還剩幾個。 */
function 收尾(post, patch) {
  const 剩 = 還沒發的目標({ ...post, meta: { ...post.meta, ...patch } });
  if (剩.length === 0) {
    patch.status = "posted";
    patch.postedAt = post.meta.postedAt || localTimestamp();
  }
  updatePostStatus(post, patch);
  return 剩;
}

/** 把「發到某個目標」記進檔案；全部處理完就順手把 status 收成 posted。 */
export function 記下發過了(post, 目標, 備註 = "") {
  const 舊 = Array.isArray(post.meta.發過了) ? post.meta.發過了 : [];
  return 收尾(post, {
    發過了: [...舊, `${目標} @ ${localTimestamp()}${備註 ? ` ${備註}` : ""}`],
    lastError: "",
  });
}

/** 把「這個社團發不進去」記進檔案，之後不再重試，也不算發文次數。 */
export function 記下跳過了(post, 目標, 原因 = "") {
  const 舊 = Array.isArray(post.meta.跳過了) ? post.meta.跳過了 : [];
  return 收尾(post, {
    跳過了: [...舊, `${目標} @ ${localTimestamp()}${原因 ? ` ${原因}` : ""}`],
  });
}

/** 今天總共發出去幾次（跨所有貼文檔一起算）。 */
export function 今天發了幾次(posts) {
  const 今天 = localTimestamp().slice(0, 10);
  let n = 0;
  for (const p of posts) {
    for (const line of Array.isArray(p.meta.發過了) ? p.meta.發過了 : []) {
      const t = String(line).split(" @ ")[1];
      if (t && t.trim().startsWith(今天)) n++;
    }
  }
  return n;
}

/* ────────────────── 貼文佇列 ────────────────── */

/**
 * 貼文檔格式（刻意用最笨的 front matter，不裝 YAML 套件）：
 *
 *   ---
 *   status: pending
 *   publishAt: 2026-08-26 09:00
 *   photos:
 *     - https://res.cloudinary.com/.../a.jpg
 *   source: property:2002450b-…
 *   ---
 *   貼文內文…
 *
 * 只支援 `key: value` 與 key 底下的 `- item` 清單。夠用，而且壞掉時一眼看得出來。
 */
export function parsePostFile(text) {
  const m = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };

  const meta = {};
  let currentListKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && currentListKey) {
      meta[currentListKey].push(item[1].trim());
      continue;
    }
    // 🔴 key 一定要能吃中文。原本只寫 [A-Za-z_]，結果 `發過了:` 根本不被當成 key，
    //    底下的項目就全部被塞進**上一個**清單（targets）裡 —— 檔案靜默壞掉，
    //    而且外表看起來很正常。2026-08-25 多目標測試抓到的。
    const kv = line.match(/^([A-Za-z_一-鿿][A-Za-z0-9_一-鿿]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value.trim() === "") {
      meta[key] = [];
      currentListKey = key;
    } else {
      meta[key] = value.trim();
      currentListKey = null;
    }
  }
  return { meta, body: m[2].trim() };
}

export function serializePostFile(meta, body) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(meta)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const v of value) lines.push(`  - ${v}`);
    } else if (value != null && String(value).trim() !== "") {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---", "", body.trim(), "");
  return lines.join("\n");
}

/**
 * 「2026-08-26 09:00」→ Date。
 *
 * ⚠️ 刻意不走 `new Date("2026-08-26 09:00")`：那個在不同 node 版本與時區下
 *    會被當成 UTC 或本地時間，差 8 小時就是發錯時段。這裡強制當本地時間解析。
 */
export function parseLocalDateTime(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    m[4] ? Number(m[4]) : 0,
    m[5] ? Number(m[5]) : 0,
  );
}

/**
 * FB 活動紀錄那一列顯示的日期字串 → Date。
 *
 * FB 會用好幾種寫法混著出現：
 *   「2026年8月15日」「8月15日」（同一年時會省年份）
 *   「昨天」「3 天前」「上週」  ← 相對時間，只能估
 * 解不出來回 null —— 交給呼叫端決定「日期不明的要不要刪」，這裡不猜。
 *
 * @param {string} raw 那一列的日期文字
 * @param {Date}   now 當作「現在」的時間（測試要能固定）
 */
export function parseFbActivityDate(raw, now = new Date()) {
  if (!raw) return null;
  const s = String(raw).trim();

  // 2026年8月15日 / 8月15日
  const ymd = s.match(/(?:(\d{4})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (ymd) {
    const year = ymd[1] ? Number(ymd[1]) : now.getFullYear();
    const d = new Date(year, Number(ymd[2]) - 1, Number(ymd[3]));
    // 沒寫年份又算出未來 → 是去年的（例：現在 1 月、貼文寫「12月5日」）
    if (!ymd[1] && d.getTime() > now.getTime() + 86400000) d.setFullYear(year - 1);
    return d;
  }

  // 2026-08-15（假頁面 data-date 用這個，好寫測試）
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  // 相對時間：只能估個大概，寧可估得「比較舊」一點（估太新會漏刪，估太舊會誤刪）
  const atMidnight = (offsetDays) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - offsetDays);
    return d;
  };
  if (/剛剛|分鐘前|小時前|今天/.test(s)) return atMidnight(0);
  if (/昨天/.test(s)) return atMidnight(1);
  const 天前 = s.match(/(\d+)\s*天前/);
  if (天前) return atMidnight(Number(天前[1]));
  const 週前 = s.match(/(\d+)\s*週前/);
  if (週前) return atMidnight(Number(週前[1]) * 7);
  if (/上週/.test(s)) return atMidnight(7);
  const 月前 = s.match(/(\d+)\s*(?:個)?月前/);
  if (月前) return atMidnight(Number(月前[1]) * 30);
  if (/上個月/.test(s)) return atMidnight(30);
  const 年前 = s.match(/(\d+)\s*年前/);
  if (年前) return atMidnight(Number(年前[1]) * 365);

  return null;
}

/** 讀 posts/ 底下所有貼文，依 publishAt 排序。 */
export function listPosts() {
  ensureDir(POSTS_DIR);
  return readdirSync(POSTS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".md"))
    .map((file) => {
      const full = path.join(POSTS_DIR, file);
      const { meta, body } = parsePostFile(readFileSync(full, "utf8"));
      return {
        file,
        path: full,
        meta,
        body,
        status: (meta.status || "pending").toLowerCase(),
        publishAt: parseLocalDateTime(meta.publishAt),
        photos: Array.isArray(meta.photos) ? meta.photos.filter(Boolean) : [],
        video: typeof meta.video === "string" ? meta.video.trim() : "",
      };
    })
    .sort((a, b) => (a.publishAt?.getTime() ?? 0) - (b.publishAt?.getTime() ?? 0));
}

/** 挑出「該發了但還沒發」的最早一篇。沒有排時間的視為隨時可發。 */
export function pickDuePost(posts, now = new Date()) {
  return (
    posts.find((p) => p.status === "pending" && (!p.publishAt || p.publishAt <= now)) || null
  );
}

/** 上一篇成功發出去是多久以前（分鐘）。沒發過回 Infinity。 */
export function minutesSinceLastPost(posts, 排除檔名 = null) {
  const times = [];
  for (const p of posts) {
    // 算「距離上一篇」時要把自己排除掉。
    // 同一篇文發到第二個社團，該受的是 GROUP_GAP（8 分）不是 MIN_GAP（90 分），
    // 不排除的話中途斷掉就得等 90 分鐘才能接著發剩下的社團。
    if (排除檔名 && p.file === 排除檔名) continue;

    if (p.meta.postedAt) times.push(parseLocalDateTime(p.meta.postedAt)?.getTime());

    // 🔴 一定要連「發過了」一起算。發到一半的文 status 還是 pending，
    //    只看 status==='posted' 的話，剛發完一個社團馬上又能發下一篇，間隔形同虛設。
    for (const line of Array.isArray(p.meta.發過了) ? p.meta.發過了 : []) {
      const t = String(line).split(" @ ")[1];
      if (t) times.push(parseLocalDateTime(t.trim())?.getTime());
    }
  }
  const 有效 = times.filter(Boolean);
  if (!有效.length) return Infinity;
  return (Date.now() - Math.max(...有效)) / 60000;
}

/** 本地時間格式化成 `YYYY-MM-DD HH:mm`，寫回 postedAt 用。 */
export function localTimestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function updatePostStatus(post, patch) {
  const meta = { ...post.meta, ...patch };
  writeFileSync(post.path, serializePostFile(meta, post.body), "utf8");
  // 🔴 記憶體裡那份也要跟著更新。
  //    一篇文要發到好幾個社團，是同一個 post 物件連續寫好幾次；
  //    不同步的話第二次會拿到「還沒發過任何東西」的舊 meta，直接蓋掉第一次的紀錄。
  //    （2026-08-25 多目標測試抓到：發了三個地方，檔案裡只剩最後一個。）
  post.meta = meta;
}

/* ────────────────── 照片 ────────────────── */

/** FB 上傳吃得下的副檔名。HEIC/HEIF 有時 FB 網頁會收、有時不收，先放進來，收不了會在上傳那步回報。 */
export const 圖片副檔名 = /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i;

/**
 * 把 photos 清單準備成「FB 吃得下的本機檔案路徑」。
 *
 * 每一項可以是：
 *   ・http(s) 網址          → 抓下來存到 tmp/（Cloudinary、官網物件照都走這條）
 *   ・本機圖片檔的路徑       → 直接用，不複製（例：D:\物件照\禾盛晶綻\01.jpg）
 *   ・本機資料夾的路徑       → 展開成裡面所有圖片檔，依檔名排序（整個資料夾丟進來最方便）
 *
 * FB 的照片欄位吃的是本機檔案（`input[type=file]`），不吃網址。
 * 某一張準備不出來就跳過並回報，不要整篇發文失敗 —— 少一張可以接受，
 * 整篇沒發出去而且沒人發現才是問題。
 *
 * 回傳的 files 是「發文時要 setInputFiles 的完整清單」，順序 = photos 裡的順序
 *（資料夾展開的話，資料夾內是檔名排序）。
 */
export async function preparePhotos(items) {
  ensureDir(TMP_DIR);
  const files = [];
  const failed = [];

  for (const [i, 來源] of items.entries()) {
    try {
      // 網址（http/https）或 data: URL —— 都抓成 buffer 存到 tmp/
      if (/^(https?|data):/i.test(來源)) {
        const res = await fetch(來源);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // 🔴 2026-09-06 實測抓到：Google Drive 網址如果沒開「知道連結的人皆可查看」，
        // 轉成直連網址後 fetch 回來的 HTTP 狀態碼還是 200，但內容其實是 Google 登入頁
        // （text/html），不是圖片。之前沒檢查，這種假圖片會原樣存成 .jpg，一路帶到
        // FB 才被退回「無法讀取檔案」，很難查是哪一張、為什麼。現在直接看
        // Content-Type，不是 image/ 開頭就當下載失敗，不要往下存。
        const contentType = res.headers.get("content-type") || "";
        if (!/^image\//i.test(contentType)) {
          throw new Error(
            `下載回來的不是圖片（Content-Type: ${contentType || "(無)"}）——` +
              `如果來源是 Google Drive／Dropbox 這類分享連結，多半是分享權限沒開成` +
              `「知道連結的人皆可查看」，回來的其實是登入頁或錯誤頁，不是真的圖片。`,
          );
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const ext =
          來源.split("?")[0].match(圖片副檔名)?.[1]?.toLowerCase() ||
          來源.match(/^data:image\/(\w+)/i)?.[1]?.toLowerCase() ||
          "jpg";
        const file = path.join(TMP_DIR, `${stamp()}-${String(i + 1).padStart(2, "0")}.${ext}`);
        writeFileSync(file, buf);
        files.push(file);
        continue;
      }

      // 本機路徑：去掉 file:// 前綴、展開開頭的 ~、轉成絕對路徑（Playwright setInputFiles 要絕對路徑才穩）
      const p = path.resolve(來源.replace(/^file:\/\//, "").replace(/^~(?=[/\\]|$)/, homedir()));
      if (!existsSync(p)) throw new Error("這個路徑不存在");

      if (statSync(p).isDirectory()) {
        // 自然排序：1.jpg 排在 10.jpg 前面（房仲照片常常沒補零，封面在第一張很重要）
        const natural = (a, b) => a.localeCompare(b, "zh-Hant", { numeric: true });
        const 裡面 = readdirSync(p)
          .filter((f) => 圖片副檔名.test(f))
          .sort(natural)
          .map((f) => path.join(p, f));
        if (!裡面.length) throw new Error("資料夾裡沒有圖片檔");
        files.push(...裡面);
      } else if (圖片副檔名.test(p)) {
        files.push(p);
      } else {
        throw new Error("不是圖片檔（看副檔名）");
      }
    } catch (err) {
      failed.push({ 來源, reason: err.message });
    }
  }
  return { files, failed };
}

/** 舊名字。post.mjs 以前叫這個，留著不破壞外部呼叫。 */
export const downloadPhotos = preparePhotos;

/* ────────────────── 影片（2026-09-22） ────────────────── */

/** FB 上傳吃得下的影片副檔名。一篇貼文通常只掛一支，跟照片同一顆 input 一起塞給 FB。 */
export const 影片副檔名 = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;

/**
 * 把「一支影片」（網址或桌機路徑／資料夾）準備成本機檔案路徑，來源規則跟 preparePhotos 一樣
 * （http(s)/data 網址就抓下來、本機檔案直接用、本機資料夾就挑裡面第一支影片檔）。
 *
 * 跟 preparePhotos 不共用同一個迴圈是因為語意不同：photos 是「一批、少一張可以接受」，
 * video 是「單一、通常就是這篇貼文的重點」，失敗時呼叫端要用不同的態度處理
 * （post.mjs 選擇整篇擋下來，不要默默發一篇「說好有影片結果沒有」的文）。
 *
 * 沒給來源就回傳 { file: null, failed: null }（這篇本來就沒有影片，不是錯誤）。
 */
export async function prepareVideo(source) {
  if (!source || !String(source).trim()) return { file: null, failed: null };
  ensureDir(TMP_DIR);
  const 來源 = String(source).trim();

  try {
    if (/^(https?|data):/i.test(來源)) {
      const res = await fetch(來源);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // 跟 preparePhotos 同一個坑：分享權限沒開的話，HTTP 狀態碼一樣是 200，
      // 內容其實是登入頁或錯誤頁，不是真的影片檔。
      const contentType = res.headers.get("content-type") || "";
      if (!/^video\//i.test(contentType)) {
        throw new Error(
          `下載回來的不是影片（Content-Type: ${contentType || "(無)"}）——` +
            `如果來源是 Google Drive／Dropbox 這類分享連結，多半是分享權限沒開成「知道連結的人皆可查看」；` +
            `也可能那條網址根本不是檔案本體（例如 YouTube 的觀看頁）。影片欄位要填「直接可以下載到檔案」的網址。`,
        );
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const ext =
        來源.split("?")[0].match(影片副檔名)?.[1]?.toLowerCase() ||
        來源.match(/^data:video\/(\w+)/i)?.[1]?.toLowerCase() ||
        "mp4";
      const file = path.join(TMP_DIR, `${stamp()}-video.${ext}`);
      writeFileSync(file, buf);
      return { file, failed: null };
    }

    // 本機路徑：跟 preparePhotos 同樣的處理（去掉 file://、展開 ~、轉絕對路徑）
    const p = path.resolve(來源.replace(/^file:\/\//, "").replace(/^~(?=[/\\]|$)/, homedir()));
    if (!existsSync(p)) return { file: null, failed: "這個路徑不存在" };

    if (statSync(p).isDirectory()) {
      // 只挑一支——影片跟照片不一樣，一篇貼文不會塞好幾支獨立影片，資料夾只是給你方便放，不是給你放整批
      const natural = (a, b) => a.localeCompare(b, "zh-Hant", { numeric: true });
      const hit = readdirSync(p).filter((f) => 影片副檔名.test(f)).sort(natural)[0];
      if (!hit) return { file: null, failed: "資料夾裡沒有影片檔" };
      return { file: path.join(p, hit), failed: null };
    }
    if (!影片副檔名.test(p)) return { file: null, failed: "不是影片檔（看副檔名）" };
    return { file: p, failed: null };
  } catch (err) {
    return { file: null, failed: err.message };
  }
}

/* ────────────────── 抄畫面結構 ────────────────── */

/**
 * 把一個範圍裡「可能是我們要的東西」的元素抄下來。
 *
 * 只收語意資訊（role／aria-label／附近的標籤文字），不收 class ——
 * class 是亂碼，抄了只會讓人以為可以用。
 *
 * ⚠️ 三個坑是 2026-08-25 另一個視窗實抄 591（Ant Design）踩出來的，
 *    FB／Marketplace 是 React 做的，同樣適用：
 *
 *    ① **標籤常常是輸入框的「兄弟節點」不是父節點。** `label[for]`、包在 `<label>` 裡、
 *       往上找父層文字，這三招會抓回一堆「(無標籤)」。所以這裡改成往上走四層，
 *       每層把「不在輸入框自己裡面」的文字撿起來當候選標籤。
 *    ② **自動產生的 id 不能用。** FB 是 `:r3h:` / `jsc_c_1x` 這種，
 *       Ant Design 是 `rc_select_7`，都是依渲染順序給的，多一格就整排位移。
 *       這裡照抄回來但會標成 `id能不能用: false`，免得有人拿去寫 selector。
 *    ③ **下拉選項 render 在 body 的 portal**，不在表單裡面，所以要另外掃一次。
 */
/*
 * 寫成真正的函式（不是字串）有兩個好處：語法錯誤當場就報，
 * 而且不用跟 `\\d` `\\n` 這種雙重跳脫搏鬥。Playwright 會自己把它送進瀏覽器。
 * ⚠️ 送進去之後就跟這個檔沒關係了 —— 裡面不能用任何外面的變數，全部要自己帶。
 */
export function HARVEST(root) {
  // FB: ":r3h:" / "jsc_c_1x" / "mount_0_0_ab"；Ant Design: "rc_select_7"
  const AUTO_ID = /^(:|jsc_|mount_|rc_|react-|radix-|«)|_\d+$|^[a-z]\d+$/i;

  /**
   * 往上走四層找「看起來像標籤」的文字。
   * 每層都把自己的文字扣掉，剩下的才是旁邊那格標籤。
   */
  function nearbyLabel(el) {
    const own = (el.innerText || el.value || "").trim();
    let node = el.parentElement;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      let t = (node.innerText || "").trim();
      if (own && t.startsWith(own)) t = t.slice(own.length).trim();
      else if (own) t = t.replace(own, "").trim();
      const first = t.split("\n").map((s) => s.trim()).filter(Boolean)[0] || "";
      // 太長的不是標籤，是整段內文
      if (first && first.length <= 20) return { text: first, 往上第幾層: depth + 1 };
    }
    return { text: "", 往上第幾層: 0 };
  }

  const out = [];
  const nodes = (root || document.body).querySelectorAll(
    '[role="button"],[role="textbox"],[role="dialog"],[role="combobox"],[role="option"],' +
      '[role="menuitem"],[role="checkbox"],[role="radio"],[role="switch"],[aria-label],input,textarea,select,' +
      '[contenteditable="true"]',
  );
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
    const label = el.getAttribute("aria-label") || "";
    const isField =
      ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) ||
      el.getAttribute("contenteditable") === "true" ||
      ["textbox", "combobox", "checkbox", "radio", "switch"].includes(el.getAttribute("role"));
    if (!label && !text && !isField) continue;

    const id = el.id || "";
    const row = {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || "",
      ariaLabel: label,
      text,
      placeholder: el.getAttribute("placeholder") || "",
      type: el.getAttribute("type") || "",
      accept: el.getAttribute("accept") || "",
      contenteditable: el.getAttribute("contenteditable") || "",
      visible: r.width > 0 && r.height > 0,
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
    if (id) {
      row.id = id;
      // 自動產生的 id 拿去寫 selector 會在下次改版整排位移，標出來別讓人用
      row.id能不能用 = !AUTO_ID.test(id);
    }
    // 有 aria-label 就夠了，沒有才去旁邊撿 —— 這是 ① 那個坑
    if (!label && isField) {
      const near = nearbyLabel(el);
      if (near.text) {
        row.旁邊的標籤 = near.text;
        row.標籤在往上第幾層 = near.往上第幾層;
      }
    }
    out.push(row);
  }
  return out;
}
