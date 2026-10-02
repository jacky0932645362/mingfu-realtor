/**
 * 價格變動通知（2026-10-02 本人要求：「在檢查物件時，還要增加價格變動通知的列表，
 * 並附上那筆物件的連結，方便做修改」）。
 *
 * 兩個檢查都會順便看到租金：愛屋型錄的存在檢查（重刊前）、太平洋官網的下架檢查（每天）。
 * 重刊是照樂屋編輯頁上「現在的內容」重貼的，所以型錄／官網調了租金、樂屋這邊沒跟著改，
 * 重刊出去的還是舊價——這份清單就是把「該去樂屋改價的物件」列出來，附上樂屋修改連結。
 *
 * 設計重點：
 *  ① 每個來源（愛屋／官網）只跟「自己上次看到的」比。兩邊偶爾本來就差一點，混在一起比的話
 *    每次檢查都會來回通知。
 *  ② 每筆物件同時間只有一列「待處理」：價格連續變動只看「最早的舊價 → 最新的新價」；
 *    改回原價就自動消掉；兩個來源看到同一個新價只算一次，不重複通知。
 *  ③ 連結不存死——樂屋重刊之後 rakuyaId 會換，顯示的時候從現在的快照重新組。
 */
import { loadPriceChanges, savePriceChanges } from "./store.js";

export const PRICE_SOURCES = { catalog: "愛屋型錄", pacific: "太平洋官網" };

const PRICE_MAX = 200;

const validRent = (n) => Number.isFinite(n) && n > 0;

/** 樂屋「修改這筆」的網址（跟 background.js scrapeCurrentListingState 開編輯頁用的是同一個格式） */
export function rakuyaEditUrl(rakuyaId) {
  return rakuyaId ? `https://member.rakuya.com.tw/rent/post/edit?ehid=${encodeURIComponent(rakuyaId)}` : "";
}

export function priceLinks(snap) {
  return {
    rakuyaEdit: rakuyaEditUrl(snap?.rakuyaId),
    catalog: snap?.catalogUrl || "",
    pacific: snap?.pacificUrl || "",
  };
}

/**
 * 記下某個來源這次看到的租金，直接改 snap.rentSeen。
 * 有變動回傳 { oldRent, newRent }；第一次看到（只記基準）、沒變、租金讀不到都回 null。
 * baselineRent：這個來源還沒有紀錄時拿來當舊價的值（愛屋用建立快照時存的 listing.rent，
 * 官網用第一次看到時存的 pacificBaseline.rent）。
 */
export function noteRentSeen(snap, source, nowRent, baselineRent = null) {
  if (!validRent(nowRent)) return null;
  snap.rentSeen = snap.rentSeen || {};
  const prev = validRent(snap.rentSeen[source]) ? snap.rentSeen[source] : validRent(baselineRent) ? baselineRent : null;
  snap.rentSeen[source] = nowRent;
  if (prev == null || prev === nowRent) return null;
  return { oldRent: prev, newRent: nowRent };
}

/**
 * 把一次變動併進清單（純函式，不碰儲存）。回傳 { list, entry, status }：
 *  added    沒有待處理的 → 新增一列（要通知）
 *  updated  已經有待處理的、這次又變到別的價 → 保留最早的舊價、更新新價（要通知）
 *  merged   另一個來源也看到同樣的新價 → 只補上來源（不重複通知）
 *  resolved 價格回到原本的舊價 → 這列不用改了，自動拿掉（不通知）
 */
export function upsertPriceChange(list, { snap, title, source, oldRent, newRent, now = new Date().toISOString() }) {
  const sourceName = PRICE_SOURCES[source] || source;
  const idx = list.findIndex((e) => e.snapId === snap.id && !e.done);

  if (idx === -1) {
    const entry = {
      id: crypto.randomUUID().slice(0, 8),
      snapId: snap.id,
      no: snap.no || "",
      title: title || snap.no || "",
      oldRent,
      newRent,
      sources: [sourceName],
      detectedAt: now,
      updatedAt: now,
      links: priceLinks(snap),
      done: false,
      doneAt: null,
    };
    return { list: [...list, entry], entry, status: "added" };
  }

  const cur = list[idx];
  if (newRent === cur.oldRent) {
    return { list: list.filter((_, i) => i !== idx), entry: cur, status: "resolved" };
  }
  if (newRent === cur.newRent) {
    const sources = cur.sources.includes(sourceName) ? cur.sources : [...cur.sources, sourceName];
    const entry = { ...cur, sources, updatedAt: now };
    return { list: list.map((e, i) => (i === idx ? entry : e)), entry, status: "merged" };
  }
  const entry = { ...cur, newRent, sources: [sourceName], title: title || cur.title, updatedAt: now, links: priceLinks(snap) };
  return { list: list.map((e, i) => (i === idx ? entry : e)), entry, status: "updated" };
}

/** 清單太長時只留最新的；待處理的永遠不丟，已處理的才會被擠掉 */
export function trimPriceChanges(list, max = PRICE_MAX) {
  if (list.length <= max) return list;
  const pending = list.filter((e) => !e.done);
  const done = list.filter((e) => e.done).slice(-Math.max(0, max - pending.length));
  return [...done, ...pending];
}

export function markPriceChangeDone(list, id, now = new Date().toISOString()) {
  if (!list.some((e) => e.id === id)) throw new Error(`markPriceChangeDone 找不到 id=${id}`);
  return list.map((e) => (e.id === id ? { ...e, done: true, doneAt: now } : e));
}

/**
 * 檢查流程呼叫的入口：記下這次看到的租金，有變動就寫進清單。
 * snap 要是 list（快照清單）裡的同一個物件——rentSeen 是直接改在上面，
 * 呼叫端之後 saveSnapshots(list) 才會連基準一起存起來。
 * 回傳 { status, entry }：status 是 upsertPriceChange 的四種之一，沒有變動時是 "none"。
 */
export async function recordRentObservation(snap, { source, nowRent, baselineRent = null, title = "", now } = {}) {
  const change = noteRentSeen(snap, source, nowRent, baselineRent);
  if (!change) return { status: "none", entry: null };
  const { list, entry, status } = upsertPriceChange(await loadPriceChanges(), { snap, title, source, ...change, now });
  await savePriceChanges(trimPriceChanges(list));
  return { status, entry };
}
