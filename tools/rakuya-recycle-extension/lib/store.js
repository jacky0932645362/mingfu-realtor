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

export function dueForRecycle(list, now = new Date()) {
  return list.filter((s) => s.status === "active" && s.nextRecycleAt && new Date(s.nextRecycleAt) <= now);
}

/** 設定（後台網址／LINE 通知）跟快照分開存，options.html 那頁在改的就是這個 */
const SETTINGS_KEY = "rr:settings";
const DEFAULT_SETTINGS = { manageUrl: "", postUrl: "", lineToken: "", lineTarget: "", cycleDays: 5 };

export async function loadSettings() {
  const o = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(o[SETTINGS_KEY] || {}) };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, ...settings } });
}
