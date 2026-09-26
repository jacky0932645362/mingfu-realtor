/**
 * 快照的資料格式與比對邏輯。純函式，不碰 chrome.*、不碰 DOM（讀寫交給 store.js）。
 *
 * 跟 tools/rakuya-recycle/snapshot.mjs 是同一套邏輯的外掛版——差別只有 randomUUID
 * 改用瀏覽器原生的 crypto.randomUUID()，不用 import node:crypto。背景與這份邏輯的
 * 完整背景見 [[project_樂屋出租循環刊登]]。
 */

/** 存在檢查真正拿來比對的欄位——全部是數字，同一個實體物件不該隨時間改變 */
export const COMPARE_FIELDS = ["regPing", "floor", "total", "room", "hall", "bath"];

const PING_TOLERANCE = 0.5;

function fieldsEqual(key, a, b) {
  if (a == null || b == null) return null;
  if (key === "regPing") return Math.abs(Number(a) - Number(b)) <= PING_TOLERANCE;
  return Number(a) === Number(b);
}

export function newSnapshot({ listing, catalogUrl, no, rakuyaUrl = null, rakuyaId = null, cycleDays = 5 }) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID().slice(0, 8),
    no: no || listing?.no || "",
    catalogUrl: catalogUrl || listing?.catalogUrl || "",
    rakuyaUrl,
    rakuyaId,
    listing,

    status: "active", // active | rented_out | error
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
