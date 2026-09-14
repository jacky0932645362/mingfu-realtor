/**
 * 591 競品分析 —— 共用的東西
 *
 * 跟 591-autofill 一樣刻意跟主專案分開（自己的 package.json、自己的 node_modules）。
 * 這支工具不需要登入 591（讀的是公開物件頁），比 591-autofill 少掉整套 auth 機制。
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/** card-booking/ 的絕對路徑（這個檔在 card-booking/tools/591-analysis/ 底下） */
export const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");

/** 產生的報告存這裡。已進 .gitignore —— 報告裡有物件細節與行情數字，不進版控。 */
export const REPORTS_DIR = process.env.ANALYSIS_REPORTS_DIR || path.join(import.meta.dirname, "reports");

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** 時間戳，給報告檔名用。 */
export function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * 591 物件詳情頁網址格式：https://sale.591.com.tw/home/house/detail/2/{id}.html
 * 只接受這個格式，貼錯網址（例如貼到列表頁或社區頁）要先講清楚，不要硬跑下去抓錯東西。
 */
export function normalizeDetailUrl(input) {
  const url = String(input || "").trim();
  if (!url) throw new Error("沒有貼網址。");
  const m = url.match(/sale\.591\.com\.tw\/home\/house\/detail\/(\d+)\/(\d+)\.html/);
  if (!m) {
    throw new Error(
      `這不是 591 物件詳情頁網址：${url}\n` +
        "格式要像 https://sale.591.com.tw/home/house/detail/2/20731244.html\n" +
        "（去物件頁的網址列複製，不要貼列表頁或社區頁的網址）",
    );
  }
  return `https://sale.591.com.tw/home/house/detail/${m[1]}/${m[2]}.html`;
}

/**
 * 591 的縣市代碼（regionid）。2026-09-14 直接從 sale.591.com.tw 縣市選單的連結抄下來的，
 * 不是憑印象填的——每一筆都對應到 `/?regionid=N&shType=list` 那個連結。
 */
export const REGION_IDS = {
  台北市: 1, 基隆市: 2, 新北市: 3, 新竹市: 4, 新竹縣: 5, 桃園市: 6, 苗栗縣: 7, 台中市: 8,
  彰化縣: 10, 南投縣: 11, 嘉義市: 12, 嘉義縣: 13, 雲林縣: 14, 台南市: 15, 高雄市: 17,
  屏東縣: 19, 宜蘭縣: 21, 台東縣: 22, 花蓮縣: 23, 澎湖縣: 24, 金門縣: 25, 連江縣: 26,
};

/** 從「台中市梧棲區臨港路四段」拆出縣市代碼、行政區、路名；拆不出來的欄位回 null。 */
export function parseAddress(address) {
  const s = String(address || "").replace(/臺/g, "台").trim();
  const m = s.match(/^(.{2}[市縣])(.+?[區鄉鎮市])(.*)$/);
  if (!m) return { city: null, regionId: null, district: null, road: null };
  return { city: m[1], regionId: REGION_IDS[m[1]] ?? null, district: m[2], road: m[3].trim() || null };
}

/**
 * 同社區在售清單改讀 591 主站的關鍵字搜尋頁（不是 market.591.com.tw 的社區清單頁）：
 * 這一頁 591 自己就把總價／權狀坪／樓層用純文字排出來，不用碰任何 obfuscate 元件。
 * 不帶 region 的話 591 預設搜台北市，所以縣市代碼一定要帶。
 */
export function buildCommunitySearchUrl(regionId, communityName) {
  return `https://sale.591.com.tw/?region=${regionId}&keywords=${encodeURIComponent(communityName)}`;
}

/** 591 同一個社區名會混用「悅／悦」這類異體字，比對前先統一。 */
export function normalizeCommunityName(s) {
  return String(s || "").replace(/悦/g, "悅").replace(/[\s　()（）]/g, "");
}

/**
 * 找出「同一戶被多家仲介重複刊登」：同樓層＋同權狀坪＋同總價就當同一戶。
 * 三個都要有才比，缺任一個的視為獨立一筆（寧可少標，不要誤標）。
 * 只用「樓層＋坪數」不夠——大樓同一層常有兩戶鏡像格局、坪數一模一樣，會誤判。
 * 坪數比到小數一位：實測同一戶不同仲介會寫 38.71 跟 38.7，四捨五入到一位才對得上；
 * 同層同價又剛好坪數差在 0.05 以內的兩戶，實務上不會發生。
 * 回傳每筆加上 dupGroup（A/B/C…）與 dupCount，以及去重後的戶數。
 */
export function dedupeComps(comps) {
  const groups = new Map();
  for (const c of comps) {
    if (c.floor == null || c.sizePing == null || c.totalPrice == null) continue;
    const key = `${c.floor}|${c.sizePing.toFixed(1)}|${c.totalPrice}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  let letter = 0;
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const label = String.fromCharCode(65 + (letter++ % 26));
    for (const m of members) {
      m.dupGroup = label;
      m.dupCount = members.length;
    }
  }
  const duplicateExtras = [...groups.values()].reduce((n, g) => n + Math.max(0, g.length - 1), 0);
  return { comps, uniqueCount: comps.length - duplicateExtras, dupGroupCount: letter };
}

/** 終端機等一下本人按 Enter。 */
export function waitForEnter(message) {
  process.stdout.write(`\n${message}\n> `);
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}

/** 在終端機問一行，回傳他打的字。 */
export function askLine(question) {
  process.stdout.write(`${question} `);
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", (data) => {
      process.stdin.pause();
      resolve(String(data).trim());
    });
  });
}

/**
 * 讀 src/config/owner.ts 的 OWNER（品牌署名用）。
 * 跟 591-autofill 一樣直接動態 import .ts 檔——Node 24 原生會剝掉型別語法，
 * 不需要額外的建置步驟。
 */
export async function loadOwner() {
  const { pathToFileURL } = await import("node:url");
  const mod = await import(pathToFileURL(path.join(PROJECT_ROOT, "src/config/owner.ts")).href);
  return mod.OWNER;
}
