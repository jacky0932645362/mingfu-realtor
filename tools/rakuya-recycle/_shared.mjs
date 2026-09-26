/**
 * 樂屋出租循環刊登 —— 共用工具。跟 property-watch / 591-extension 一樣刻意自己一份，
 * 不共用 import（見 [[project_樂屋出租循環刊登]] 與 [[project_591上架外掛]] 的教訓）。
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export const TOOL_DIR = import.meta.dirname;
/** card-booking/ 的絕對路徑（這個檔在 card-booking/tools/rakuya-recycle/ 底下） */
export const PROJECT_ROOT = path.resolve(TOOL_DIR, "../..");
/** 快照與歷史都放這 —— 進 .gitignore，裡面有物件細節與照片網址不進版控 */
export const DATA_DIR = path.join(TOOL_DIR, "data");
export const FIXTURES_DIR = path.join(TOOL_DIR, "fixtures");

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** 檔名用的時間戳：2026-09-26T09-12-05 */
export function stamp(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * 台灣時間的「2026-09-26 09:12」字串，給快照時間與通知用。
 * 用 formatToParts 自己組，避開 Intl 對 zh-TW 會塞窄空格 U+2009 的老問題
 * （見 [[project_屋主客戶資料庫]] 的 hydration 坑；這裡不是 hydration，但同個雷，
 * property-watch 的 twClock() 也是同一份抄過來的寫法）。
 */
export function twClock(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t) => parts.find((x) => x.type === t)?.value ?? "";
  let hh = g("hour");
  if (hh === "24") hh = "00";
  return `${g("year")}-${g("month")}-${g("day")} ${hh}:${g("minute")}`;
}
