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

/**
 * 🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-27 本人真帳號實測發現重刊出來的「特色描述」不是他
 * 原本貼的內容——`listing` 一直是重新抓愛屋型錄頁解析出來的原始資料，不是本人
 * 當初實際貼在樂屋描述欄裡（可能手動調整過）的那段文字。新增 `capturedDescHtml`／
 * `capturedDescText`：在本人按下送出的那一刻，由 captureListing.js 把描述編輯器
 * 當下的內容存起來，這才是本人真正想記住的「一模一樣」——重刊時優先用這份，
 * 不是每次都重新用型錄資料組一份新的。見 [[project_樂屋出租循環刊登]]。
 */
/**
 * 🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-27 本人講得更完整：「你就是要複製
 * 我之前所有的資訊照片，如果一模一樣的話，一定是沒有問題，因為用物件上架
 * 助手刊登新物件之後，我也是有手動修改、補充一些東西」——本人平常貼文本來
 * 就會在自動填表跑完之後手動調整補充，不是只有描述、封面貼圖兩處可能被
 * 手動調整過，整張表單都有可能。`capturedFormFields`：送出的當下把整張
 * 表單目前所有欄位的值都存起來（名稱→值/勾選狀態），重刊時整批套用在
 * 結構性填表結果之上，不用再逐一欄位等本人截圖抓到才回頭補程式碼。
 */
export function newSnapshot({
  listing,
  catalogUrl,
  no,
  rakuyaUrl = null,
  rakuyaId = null,
  cycleDays = 5,
  capturedDescHtml = "",
  capturedDescText = "",
  capturedCoverPhotoDataUrl = "",
  capturedFormFields = null,
}) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID().slice(0, 8),
    no: no || listing?.no || "",
    catalogUrl: catalogUrl || listing?.catalogUrl || "",
    rakuyaUrl,
    rakuyaId,
    listing,
    capturedDescHtml,
    capturedDescText,
    capturedCoverPhotoDataUrl,
    capturedFormFields,

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
