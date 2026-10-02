/**
 * 快照清單與歷史的讀寫。跟 tools/rakuya-recycle/store.mjs 是同一套邏輯，只是本機
 * JSON 檔換成 chrome.storage.local（外掛沒有檔案系統可以寫）——這是本人 2026-09-26
 * 拍板「要做成像物件上架助手一樣的獨立 Chrome 外掛」之後的版本，詳見
 * [[project_樂屋出租循環刊登]]。所有函式都是 async（chrome.storage 本身就是非同步 API）。
 */
const SNAPSHOTS_KEY = "rr:snapshots";
const HISTORY_KEY = "rr:history";
const HISTORY_MAX = 500; // 跟本機版的 loadHistory(limit) 概念一樣，這裡直接限制存檔大小，避免無限長大

export async function loadSnapshots() {
  const o = await chrome.storage.local.get(SNAPSHOTS_KEY);
  return Array.isArray(o[SNAPSHOTS_KEY]) ? o[SNAPSHOTS_KEY] : [];
}

export async function saveSnapshots(list) {
  await chrome.storage.local.set({ [SNAPSHOTS_KEY]: list });
}

export async function appendHistory(entry) {
  const list = await loadHistory();
  list.push({ at: new Date().toISOString(), ...entry });
  await chrome.storage.local.set({ [HISTORY_KEY]: list.slice(-HISTORY_MAX) });
}

export async function loadHistory() {
  const o = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(o[HISTORY_KEY]) ? o[HISTORY_KEY] : [];
}

export function findById(list, id) {
  return list.find((s) => s.id === id) || null;
}

export async function attachRakuyaUrl(list, id, { rakuyaUrl, rakuyaId }) {
  const item = findById(list, id);
  if (!item) throw new Error(`attachRakuyaUrl 找不到快照 id=${id}`);
  item.rakuyaUrl = rakuyaUrl;
  item.rakuyaId = rakuyaId;
  item.updatedAt = new Date().toISOString();
  await appendHistory({ id, kind: "rakuya_url_attached", rakuyaUrl, rakuyaId });
  return item;
}

export async function markChecked(list, id, result) {
  const item = findById(list, id);
  if (!item) throw new Error(`markChecked 找不到快照 id=${id}`);
  const now = new Date().toISOString();
  item.lastCheckedAt = now;
  item.updatedAt = now;

  if (result.verdict === "fetch_failed") {
    item.failStreak = (item.failStreak || 0) + 1;
    item.lastCheckResult = "fetch_failed";
    await appendHistory({ id, kind: "check_fetch_failed", failStreak: item.failStreak });
    return item;
  }

  item.failStreak = 0;
  if (result.verdict === "different") {
    item.lastCheckResult = "mismatch";
    item.status = "rented_out";
    await appendHistory({ id, kind: "rented_out", mismatchedFields: result.mismatchedFields });
  } else if (result.verdict === "same") {
    item.lastCheckResult = "ok";
  } else {
    item.lastCheckResult = "inconclusive";
  }
  return item;
}

export async function recordRecycled(list, id, { rakuyaUrl, rakuyaId, cycleDays = 5 }) {
  const item = findById(list, id);
  if (!item) throw new Error(`recordRecycled 找不到快照 id=${id}`);
  const now = new Date().toISOString();
  item.rakuyaUrl = rakuyaUrl;
  item.rakuyaId = rakuyaId;
  item.postedAt = now;
  item.nextRecycleAt = new Date(Date.now() + cycleDays * 86400000).toISOString();
  item.cycleCount = (item.cycleCount || 0) + 1;
  item.status = "active";
  item.updatedAt = now;
  await appendHistory({ id, kind: "recycled", rakuyaUrl, cycleCount: item.cycleCount });
  return item;
}

/**
 * 🔴 2026-09-27 本人真實遇到：手動處理過的物件，追蹤清單裡留下一筆對應已經
 * 永久失效的舊刊登（status=error），而新的一筆重新開始追蹤。舊的那筆不清掉
 * 會有實際風險——`closeOldListing` 是靠標題文字去比對「上架中物件」列表裡的
 * 那一列，不是靠唯一編號，同一戶物件新舊兩筆標題會一樣，誤按舊的那筆「重試」
 * 可能真的操作到新的那筆刊登。需要一個明確的刪除動作讓本人清掉報廢的追蹤資料。
 */
export function removeSnapshot(list, id) {
  if (!list.some((s) => s.id === id)) throw new Error(`removeSnapshot 找不到快照 id=${id}`);
  return list.filter((s) => s.id !== id);
}

export function dueForRecycle(list, now = new Date()) {
  return list.filter((s) => s.status === "active" && s.nextRecycleAt && new Date(s.nextRecycleAt) <= now);
}

/** 價格變動通知清單（邏輯在 lib/price-watch.js，這裡只管存讀），options.html 那頁直接顯示 */
const PRICE_CHANGES_KEY = "rr:priceChanges";

export async function loadPriceChanges() {
  const o = await chrome.storage.local.get(PRICE_CHANGES_KEY);
  return Array.isArray(o[PRICE_CHANGES_KEY]) ? o[PRICE_CHANGES_KEY] : [];
}

export async function savePriceChanges(list) {
  await chrome.storage.local.set({ [PRICE_CHANGES_KEY]: list });
}

/** 設定（後台網址／LINE 通知）跟快照分開存，options.html 那頁在改的就是這個 */
const SETTINGS_KEY = "rr:settings";
const DEFAULT_SETTINGS = { manageUrl: "", postUrl: "", lineToken: "", lineTarget: "", cycleDays: 5, coverSticker: null,
  // 太平洋官網下架檢查（2026-10-02）：每天固定時間檢查，發現官網已無此物件就自動在樂屋關閉
  delistEnabled: false, delistTime: "09:00", delistEveryDays: 1, delistAutoClose: true };

export async function loadSettings() {
  const o = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(o[SETTINGS_KEY] || {}) };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, ...settings } });
}

/**
 * 除錯紀錄：抓不到、猜不對的時候，本人不方便一直開不同分頁的 DevTools 主控台，
 * 這裡集中記一份，options.html 直接顯示，本人截圖這一頁就好。內容腳本可以直接
 * 呼叫（chrome.storage 不用經過 background 轉一手，也不怕訊息被跨網域跳轉切斷）。
 */
const DEBUG_KEY = "rr:debug";
const DEBUG_MAX = 80;

export async function pushDebug(from, message) {
  const o = await chrome.storage.local.get(DEBUG_KEY);
  const list = Array.isArray(o[DEBUG_KEY]) ? o[DEBUG_KEY] : [];
  // 🔴 2026-09-27 原本 300 字太短——recycleOne() 把 closeListing.js／createListing.js
  // 整包錯誤物件 JSON.stringify 塞進來，遇到需要附一段畫面文字內容當診斷用的情況
  // （例如 dialogTextDump）300 字一下就被切光，最有用的部分反而看不到。
  list.push({ at: new Date().toISOString(), from, message: String(message).slice(0, 1000) });
  await chrome.storage.local.set({ [DEBUG_KEY]: list.slice(-DEBUG_MAX) });
}

export async function loadDebug() {
  const o = await chrome.storage.local.get(DEBUG_KEY);
  return Array.isArray(o[DEBUG_KEY]) ? o[DEBUG_KEY] : [];
}

export async function clearDebug() {
  await chrome.storage.local.set({ [DEBUG_KEY]: [] });
}
