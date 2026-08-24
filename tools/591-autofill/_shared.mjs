/**
 * 591 自動填表 —— 三支腳本共用的東西
 *
 * 這個工具刻意跟主專案分開（自己的 package.json、自己的 node_modules）：
 * Playwright 跟網站本體完全無關，塞進主專案的 devDependencies 只會讓 Vercel
 * 每次 build 都多裝一份用不到的東西。
 */
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

/** card-booking/ 的絕對路徑（這個檔在 card-booking/tools/591-autofill/ 底下） */
export const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * 登入狀態（cookie）存這裡。⚠️ 等同帳號鑰匙，已經進 .gitignore，不要外流。
 *
 * 這三個路徑都可以用環境變數蓋掉。用意是拿假表單測整條填表流程時
 * 不必去動正式設定檔 —— 沒有 591 帳號也要能驗證主迴圈會動，
 * 否則「接上去那天才發現不會動」就太晚了。
 */
export const AUTH_FILE = process.env.FILL_AUTH_FILE || path.join(import.meta.dirname, "auth", "591-state.json");

/** 每一步的截圖存這裡，出事時看得出來卡在哪一格。 */
export const SHOTS_DIR = process.env.FILL_SHOTS_DIR || path.join(import.meta.dirname, "shots");

export const SELECTORS_FILE =
  process.env.FILL_SELECTORS_FILE || path.join(import.meta.dirname, "config", "selectors.json");

/** 591 首頁。刊登表單的實際網址由本人自己貼給 inspect-form.mjs，不寫死在這裡猜。 */
export const SITE_591 = "https://www.591.com.tw/";

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** 把 card-booking/.env.local 讀進 process.env（資料庫連線字串在裡面）。 */
export function loadEnv() {
  const envFile = path.join(PROJECT_ROOT, ".env.local");
  if (!existsSync(envFile)) {
    throw new Error(`找不到 ${envFile} —— 這支腳本要連資料庫，需要 DATABASE_URL`);
  }
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

/**
 * tsconfig 的 "@/*" 別名只有 Next 的 bundler 認得，裸 node 要自己接
 * （跟 card-booking/test-*.mjs 同一招）。
 */
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

/**
 * 列出資料庫裡的物件，給終端機挑用。
 *
 * 存在的理由很實際：物件 id 是 uuid，叫人從網址列複製一長串
 * `2002450b-6a82-40fc-9d88-351b17de29a6` 進終端機，第一次就會貼錯。
 * 列出來選編號比較不會出事。
 */
export async function listPickableProperties() {
  loadEnv();
  registerAliasHooks();
  const base = pathToFileURL(PROJECT_ROOT).href;
  const { listProperties, statusLabel } = await import(`${base}/src/lib/property.ts`);
  const rows = await listProperties({ limit: 50 });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    price: r.price,
    status: statusLabel(r.status),
    district: r.district,
  }));
}

/** 讀一筆物件並產生 591 上架包（跟後台那頁用的是同一個函式，不會兩邊講不一樣的話）。 */
export async function loadPackage(propertyId) {
  loadEnv();
  registerAliasHooks();
  const base = pathToFileURL(PROJECT_ROOT).href;
  const { getProperty } = await import(`${base}/src/lib/property.ts`);
  const { build591Package } = await import(`${base}/src/lib/export-591.ts`);

  const property = await getProperty(propertyId);
  if (!property) throw new Error(`資料庫裡找不到 id=${propertyId} 這筆物件`);
  return { property, pkg: build591Package(property) };
}

export function loadSelectors() {
  if (!existsSync(SELECTORS_FILE)) {
    throw new Error(`找不到 ${SELECTORS_FILE}`);
  }
  const raw = JSON.parse(readFileSync(SELECTORS_FILE, "utf8"));
  if (!raw.fields || Object.keys(raw.fields).length === 0) {
    throw new Error(
      "config/selectors.json 還沒填好欄位對映。\n" +
        "先跑 `npm run inspect` 把 591 表單的欄位抄下來，再照 README 第 2 步填。",
    );
  }
  // 出廠的骨架每一格 selector 都是空的。全空代表根本還沒對映過，
  // 這時候跑下去只會看到一整排「跳過」，不如直接講清楚下一步要做什麼。
  const mapped = Object.values(raw.fields).filter((f) => f.selector?.trim()).length;
  if (mapped === 0) {
    throw new Error(
      "config/selectors.json 裡每一格的 selector 都還是空的（這是出廠骨架）。\n" +
        "先跑 `npm run inspect`，把產生的 config/form-dump.json 貼回對話給我，我照它填好。",
    );
  }
  return raw;
}

/**
 * 人工節奏。
 *
 * 不是為了「假裝成人類騙過偵測」，而是因為機器全速填表本來就會出事：
 * 591 的表單有連動欄位（選了縣市才會載入行政區、選了類型才會出現對應欄位），
 * 填太快會在下一格還沒生出來的時候就去點它。順便也避免被判定成異常流量。
 */
export function humanDelay(min = 220, max = 620) {
  const ms = min + Math.floor(Math.random() * (max - min));
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 終端機等一下本人按 Enter（登入之類的事不能由程式代做）。 */
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
      resolve(String(data));
    });
  });
}

/** 時間戳，給截圖檔名用。 */
export function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/* ────────────────── 取值（填表的核心，抽出來才測得到）────────────────── */

/**
 * 把 selectors.json 裡的 "from" 換成真正要填的字。
 *
 * "@" 開頭是特殊來源（標題、描述、拆開的格局與樓層），
 * 其他一律去 591 上架包的欄位對照表裡照「標籤」找 —— 那份表就是後台那頁看到的東西，
 * 兩邊用同一個函式產生，不會出現「後台顯示 A、自動填表填 B」。
 *
 * 找不到就回空字串，讓 fill.mjs 記成「跳過」。**絕不回傳猜出來的值。**
 */
export function resolveValue(from, pkg) {
  if (!from) return "";

  if (from.startsWith("@")) {
    const key = from.slice(1);
    if (key === "title") return pkg.titleFull;
    if (key === "titleShort") return pkg.title;
    if (key === "description") return pkg.description;

    // @layout.rooms / @layout.halls / @layout.baths
    if (key.startsWith("layout.")) {
      const raw = pkg.fields.find((f) => f.label === "格局")?.value || "";
      const m = raw.match(/(\d+)\s*房\s*(\d+)\s*廳\s*(\d+)\s*衛/);
      // 拆不出來（例如原本就寫「開放式套房」）就回空字串，不要猜一個數字去選下拉
      if (!m) return "";
      const part = key.slice("layout.".length);
      if (part === "rooms") return m[1];
      if (part === "halls") return m[2];
      if (part === "baths") return m[3];
      return "";
    }

    // @floor.floor / @floor.total
    if (key === "floor.floor") return pkg.fields.find((f) => f.label === "樓層")?.value || "";
    if (key === "floor.total") return pkg.fields.find((f) => f.label === "總樓層")?.value || "";

    return "";
  }

  return pkg.fields.find((f) => f.label === from)?.value || "";
}

/** 591 的數字欄位多半不吃單位，「32.55 坪」要變成「32.55」。 */
export function applyTransform(value, transform) {
  if (!value) return value;
  if (transform === "number") {
    const m = String(value).match(/-?\d+(\.\d+)?/);
    return m ? m[0] : "";
  }
  if (transform === "int") {
    const m = String(value).match(/-?\d+/);
    return m ? m[0] : "";
  }
  return value;
}
