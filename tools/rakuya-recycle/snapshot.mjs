/**
 * 樂屋出租循環刊登 —— 快照的資料格式與比對邏輯。純函式，不碰檔案、不碰瀏覽器
 * （讀寫交給 store.mjs，抓真實頁面之後另外寫）。
 *
 * 背景見 [[project_樂屋出租循環刊登]]：
 *   - 循環＝把樂屋上的出租刊登整個刪除、再貼一筆全新的（不是編輯、不是續刊）。
 *   - 重刊當下需要「跟第一次貼文一樣多」的資料（地址/坪數/文案/照片），所以快照
 *     要在本人貼愛屋連結給樂屋助手產文的當下就存起來，不要等到要刪除那天才臨時
 *     去愛屋抓——愛屋的連結／編號日後會被別戶物件回收沿用，屆時抓到的可能已經
 *     是別戶的資料。
 *   - 存在檢查＝定期重新抓 catalogUrl（貼在描述最後一行下一行的太平洋房屋連結），
 *     拿現在的坪數/樓層等欄位跟快照比對；本人原話「只要圖文不符，就必須要下架」，
 *     不是看頁面打不打得開。
 *
 * `listing` 欄位的形狀刻意對齊 591-extension/lib/parser.js 的 parseCatalog() 輸出
 * （regPing／floor／total／room／hall／bath／community／photos／catalogUrl…），
 * 但這裡不 import 那支——跟 catalog-import.ts 那次同樣的教訓：各自一份，以後
 * 391/樂屋助手改了解析規則，這裡不會悄悄跟著壞掉，但也不會自動跟著修好，要記得
 * 兩邊對照著看。這支只要求「有這些欄位名稱就讀」，欄位缺了也不會炸。
 */
import { randomUUID } from "node:crypto";

/** 存在檢查真正拿來比對的欄位——全部是數字，同一個實體物件不該隨時間改變 */
export const COMPARE_FIELDS = ["regPing", "floor", "total", "room", "hall", "bath"];

/** 坪數用小容差（登記坪數偶爾會有小數點四捨五入的落差，不是同一戶物件的坪數落差通常是好幾坪起跳） */
const PING_TOLERANCE = 0.5;

function fieldsEqual(key, a, b) {
  if (a == null || b == null) return null; // 任一邊沒資料 → 這個欄位不算數，不是「相符」也不是「不符」
  if (key === "regPing") return Math.abs(Number(a) - Number(b)) <= PING_TOLERANCE;
  return Number(a) === Number(b);
}

/**
 * 建一筆新快照。`listing` 直接放貼愛屋連結當下解析出來的完整物件（parseCatalog() 的輸出，
 * 或至少要有 COMPARE_FIELDS 這幾個欄位＋catalogUrl＋photos）。
 * `rakuyaUrl`／`rakuyaId` 這兩個欄位在快照剛建立、表單還沒真的送出成功前是 null——
 * 送出成功、拿到樂屋分配的刊登網址後再用 attachRakuyaUrl() 補上去（見 store.mjs）。
 */
export function newSnapshot({ listing, catalogUrl, no, rakuyaUrl = null, rakuyaId = null, cycleDays = 5 }) {
  const now = new Date().toISOString();
  return {
    id: randomUUID().slice(0, 8),
    no: no || listing?.no || "",
    catalogUrl: catalogUrl || listing?.catalogUrl || "",
    rakuyaUrl,
    rakuyaId,
    listing,

    status: "active", // active | pending_recycle | rented_out | error
    postedAt: now,
    nextRecycleAt: addDays(now, cycleDays),
    cycleCount: 0,

    lastCheckedAt: null,
    lastCheckResult: null, // ok | mismatch | fetch_failed
    failStreak: 0,

    createdAt: now,
    updatedAt: now,
  };
}

function addDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/**
 * 拿快照裡存的 listing 跟「現在重新抓 catalogUrl 得到的 listing」比對。
 * 兩邊都要是 parseCatalog() 那種形狀的物件（或至少有 COMPARE_FIELDS 裡的欄位）。
 *
 * 回傳 verdict：
 *   "same"        —— 有比到欄位，而且全部相符 → 還在租，照排程繼續跑
 *   "different"   —— 有任一欄位對不起來 → 本人原話「只要圖文不符，就必須要下架」，
 *                     判定已出租，不重刊
 *   "inconclusive"—— 兩邊資料都不夠、一個能比對的欄位都沒有 → 不能當作已出租
 *                     （避免因為愛屋那頁改版、欄位一時抓不全就誤判成下架）
 */
export function compareListing(snapshotListing, freshListing) {
  const comparedFields = [];
  const mismatchedFields = [];
  for (const key of COMPARE_FIELDS) {
    const eq = fieldsEqual(key, snapshotListing?.[key], freshListing?.[key]);
    if (eq == null) continue;
    comparedFields.push(key);
    if (!eq) mismatchedFields.push(key);
  }
  const verdict = comparedFields.length === 0 ? "inconclusive" : mismatchedFields.length > 0 ? "different" : "same";
  return { comparedFields, mismatchedFields, verdict };
}
