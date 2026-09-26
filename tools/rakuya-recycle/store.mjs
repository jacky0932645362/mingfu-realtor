/**
 * 快照清單與歷史的讀寫。全部是本機檔案，放 data/（gitignore，裡面有物件細節）。
 * 檔案配置照抄 property-watch/store.mjs 的做法：
 *
 *   data/snapshots.json     目前追蹤的每一筆物件快照
 *   data/snapshots.json.bak 上一版備份（每次寫入前先複製一份，出事能還原）
 *   data/history.jsonl      只增不改的事件記錄，一行一筆 JSON（建立/重刊/判定已出租/失敗）
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, ensureDir } from "./_shared.mjs";

const LIST_FILE = path.join(DATA_DIR, "snapshots.json");
const HIST_FILE = path.join(DATA_DIR, "history.jsonl");

export function loadSnapshots() {
  if (!existsSync(LIST_FILE)) return [];
  try {
    const data = JSON.parse(readFileSync(LIST_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    throw new Error(
      `data/snapshots.json 讀不動（${e.message}）。\n` +
      `先把它複製出來備份，再看是不是手動編輯時打壞了 JSON。`,
    );
  }
}

export function saveSnapshots(list) {
  ensureDir(DATA_DIR);
  if (existsSync(LIST_FILE)) {
    try { copyFileSync(LIST_FILE, LIST_FILE + ".bak"); } catch { /* 備份失敗不擋主流程 */ }
  }
  writeFileSync(LIST_FILE, JSON.stringify(list, null, 2) + "\n", "utf8");
}

export function appendHistory(entry) {
  ensureDir(DATA_DIR);
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  appendFileSync(HIST_FILE, line + "\n", "utf8");
}

export function loadHistory(limit = 800) {
  if (!existsSync(HIST_FILE)) return [];
  const lines = readFileSync(HIST_FILE, "utf8").trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

export function findById(list, id) {
  return list.find((s) => s.id === id) || null;
}

/**
 * 表單真的送出成功、樂屋分配了刊登網址之後才呼叫——快照建立當下通常還不知道這個。
 * 找不到對應 id 就丟錯，不要靜默略過（代表呼叫端邏輯本身有問題，比對不到才更該早點爆炸）。
 */
export function attachRakuyaUrl(list, id, { rakuyaUrl, rakuyaId }) {
  const item = findById(list, id);
  if (!item) throw new Error(`attachRakuyaUrl 找不到快照 id=${id}`);
  item.rakuyaUrl = rakuyaUrl;
  item.rakuyaId = rakuyaId;
  item.updatedAt = new Date().toISOString();
  appendHistory({ id, kind: "rakuya_url_attached", rakuyaUrl, rakuyaId });
  return item;
}

/**
 * 存在檢查跑完一輪之後更新一筆快照的狀態。
 * result 是 snapshot.mjs 的 compareListing() 或抓取失敗時自己組的 { verdict, ... }。
 *
 * fetch_failed 連續達到門檻才計入失敗記錄，不單次就報——跟 property-watch 對 591
 * 「連續 3 次才推播」是同一個「不推假通知」的設計，愛屋那頁偶爾抓不到不代表已出租。
 */
export function markChecked(list, id, result) {
  const item = findById(list, id);
  if (!item) throw new Error(`markChecked 找不到快照 id=${id}`);
  const now = new Date().toISOString();
  item.lastCheckedAt = now;
  item.updatedAt = now;

  if (result.verdict === "fetch_failed") {
    item.failStreak = (item.failStreak || 0) + 1;
    item.lastCheckResult = "fetch_failed";
    appendHistory({ id, kind: "check_fetch_failed", failStreak: item.failStreak });
    return item;
  }

  item.failStreak = 0;
  if (result.verdict === "different") {
    item.lastCheckResult = "mismatch";
    item.status = "rented_out";
    appendHistory({ id, kind: "rented_out", mismatchedFields: result.mismatchedFields });
  } else if (result.verdict === "same") {
    item.lastCheckResult = "ok";
  } else {
    item.lastCheckResult = "inconclusive";
  }
  return item;
}

/**
 * 舊物件關閉、新物件建立成功之後呼叫——同一筆快照原地更新（不是開新的一筆），
 * cycleCount 累加，nextRecycleAt 重新算，狀態維持 active。
 */
export function recordRecycled(list, id, { rakuyaUrl, rakuyaId, cycleDays = 5 }) {
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
  appendHistory({ id, kind: "recycled", rakuyaUrl, cycleCount: item.cycleCount });
  return item;
}

/** 排到要刪除重刊、而且還沒被判定已出租的物件 */
export function dueForRecycle(list, now = new Date()) {
  return list.filter((s) => s.status === "active" && s.nextRecycleAt && new Date(s.nextRecycleAt) <= now);
}
