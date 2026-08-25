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
