/**
 * 背景程式（MV3 service worker，ES module——跟 591-extension 的 background.js 不同，
 * 那支是 classic script 用 importScripts()；這支獨立外掛沒有互相依賴的理由，直接用
 * import 比較乾淨）。
 *
 * 做四件事：
 *  ① 裝好之後排一個 chrome.alarms 週期鬧鐘，時間到自己醒來跑一輪（本人 2026-09-26
 *     拍板：獨立 Chrome 外掛＋背景鬧鐘自動觸發，全自動不用人在電腦前按，條件只有
 *     「Chrome 要是開著的」——見 [[project_樂屋出租循環刊登]]）。
 *  ② 存在檢查：抓愛屋型錄頁比對，判斷是否已出租。
 *  ③ 還在租的：開分頁把舊物件「成交/關閉」（固定選「不方便帶看」），再開新增物件
 *     頁面填表＋真的送出。
 *  ④ LINE 通知——最重要的一則是「舊的關了但新的沒建成」，物件曝光空窗必須立刻
 *     通知，不能悄悄跳過。
 *
 * ⚠️ 第一版，還沒對真帳號跑過。options.html 有「立即執行一次」按鈕方便本人第一次
 *    校準，不用等鬧鐘時間到。
 */
import { checkExistence, fetchCatalogListing } from "./lib/catalog-check.js";
import { loadSnapshots, saveSnapshots, markChecked, recordRecycled, dueForRecycle, findById, loadSettings } from "./lib/store.js";
import { newSnapshot } from "./lib/snapshot.js";

const ALARM_NAME = "rr:sweep";
const ALARM_PERIOD_MINUTES = 60; // 每小時醒來看一次有沒有到期的，不是「每小時都刪除重刊一次」
const FAIL_STREAK_NOTIFY = 3;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runSweep().catch((e) => console.error("排程執行失敗：", e));
});

/* ───────── LINE 通知：照 tools/rakuya-recycle/notify.mjs 同一套，設定改從 chrome.storage 讀 ───────── */

async function pushLine(text) {
  const { lineToken, lineTarget } = await loadSettings();
  if (!lineToken || !lineTarget) return { skipped: true };
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lineToken}` },
      body: JSON.stringify({ to: lineTarget, messages: [{ type: "text", text: String(text).slice(0, 4900) }] }),
    });
    return { skipped: false, ok: res.ok };
  } catch (e) {
    return { skipped: false, ok: false, error: String(e) };
  }
}

const nowTaipei = () =>
  new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date());

const label = (snap) => snap.no || snap.listing?.title || snap.listing?.rawTitle || "（沒有標題）";

function renderRecycleFailed(snap, error) {
  return `🔴 樂屋重刊失敗，物件已關閉但新的沒建立成功，需要你手動處理！\n\n${label(snap)}\n原因：${String(error).slice(0, 200)}\n舊刊登：${snap.rakuyaUrl || "（沒有記錄）"}\n⏱ ${nowTaipei()}`;
}
function renderRecycled(snap) {
  return `🔄 樂屋物件已重新上架\n\n${label(snap)}\n第 ${snap.cycleCount} 次重刊\n🔗 ${snap.rakuyaUrl}\n⏱ ${nowTaipei()}`;
}
function renderRentedOut(snap, mismatchedFields) {
  return `⚫️ 判定已出租，停止重刊\n\n${label(snap)}\n對不起來的欄位：${mismatchedFields.join("、")}\n⏱ ${nowTaipei()}`;
}
function renderCheckFailing(snap, failStreak) {
  return `⚠️ 存在檢查連續 ${failStreak} 次抓不到\n\n${label(snap)}\n愛屋連結：${snap.catalogUrl}\n找時間自己點開看一下是不是連結失效了。\n⏱ ${nowTaipei()}`;
}

/* ───────── 開分頁 → 注入內容腳本 → 呼叫它 → 拿結果 → 關分頁 ───────── */

async function runInTab(tabId, file, func, args) {
  await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return result;
}

async function closeOldListing(manageUrl, matchText) {
  const tab = await chrome.tabs.create({ url: manageUrl, active: false });
  try {
    await waitForTabLoad(tab.id);
    return await runInTab(tab.id, "content/closeListing.js", (matchText) => window.__rrCloseListing__({ matchText }), [matchText]);
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function createNewListing(postUrl, listing) {
  const tab = await chrome.tabs.create({ url: postUrl, active: false });
  try {
    await waitForTabLoad(tab.id);
    return await runInTab(tab.id, "content/createListing.js", (listing) => window.__rrCreateListing__(listing), [listing]);
  } finally {
    // 建立失敗時故意不關分頁，讓本人自己看畫面診斷；成功才關掉
  }
}

function waitForTabLoad(tabId, timeout = 20000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, timeout);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(t);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 500); // 給樂屋前端一點時間把表單元件畫出來
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/* ───────── 排程主邏輯：一筆一筆處理，一筆出事不拖垮整批 ───────── */

async function recycleOne(list, snap, settings) {
  const check = await checkExistence(snap);
  await markChecked(list, snap.id, check);
  await saveSnapshots(list); // 每筆處理完就存一次，中途中斷不會整批丟（同 property-watch 的原則）

  if (check.verdict === "fetch_failed") {
    const item = findById(list, snap.id);
    if (item.failStreak >= FAIL_STREAK_NOTIFY) await pushLine(renderCheckFailing(item, item.failStreak));
    return { outcome: "fetch_failed" };
  }
  if (check.verdict === "different") {
    await pushLine(renderRentedOut(snap, check.mismatchedFields));
    return { outcome: "rented_out" };
  }

  // verdict "same"：還在租，照排程繼續刪除重刊
  const closeResult = await closeOldListing(settings.manageUrl, snap.no || label(snap));
  if (!closeResult || !closeResult.ok) {
    const item = findById(list, snap.id);
    item.status = "error";
    item.updatedAt = new Date().toISOString();
    await saveSnapshots(list);
    return { outcome: "error", error: closeResult?.error, closedButNotRecreated: false };
  }

  const createResult = await createNewListing(settings.postUrl, snap.listing);
  if (!createResult || !createResult.ok) {
    const item = findById(list, snap.id);
    item.status = "error";
    item.updatedAt = new Date().toISOString();
    await saveSnapshots(list);
    // 🔴 最壞情況：舊的關了、新的沒建成——這戶現在完全沒曝光，一定要通知，不能悄悄跳過
    await pushLine(renderRecycleFailed(item, createResult?.error || "未知錯誤"));
    return { outcome: "error", error: createResult?.error, closedButNotRecreated: true };
  }

  const rakuyaId = (String(createResult.finalUrl || "").match(/\/rent\/([0-9a-f]{6,})/i) || [])[1] || null;
  const updated = await recordRecycled(list, snap.id, { rakuyaUrl: createResult.finalUrl, rakuyaId, cycleDays: settings.cycleDays });
  await saveSnapshots(list);
  await pushLine(renderRecycled(updated));
  return { outcome: "recycled" };
}

export async function runSweep() {
  const settings = await loadSettings();
  const list = await loadSnapshots();
  const due = dueForRecycle(list);
  if (!due.length) return { processed: 0 };
  if (!settings.manageUrl || !settings.postUrl) {
    console.warn("manageUrl／postUrl 還沒在設定頁填，這輪先跳過");
    return { processed: 0, skipped: "no_urls" };
  }

  const results = [];
  for (const snap of due) {
    const r = await recycleOne(list, snap, settings);
    results.push({ id: snap.id, no: snap.no, ...r });
  }
  return { processed: results.length, results };
}

/* ───────── 一筆新物件被本人貼出去（不管手動還是樂屋助手）→ 開始追蹤 ───────── */

async function registerListing(catalogUrl) {
  const list = await loadSnapshots();
  // 同一條愛屋連結、還在追蹤中的，不要重複建立快照（本人可能同一筆物件按了兩次上架）
  if (list.some((s) => s.catalogUrl === catalogUrl && s.status === "active")) {
    return { ok: false, error: "這條連結已經在追蹤清單裡了" };
  }
  const settings = await loadSettings();
  const fetched = await fetchCatalogListing(catalogUrl);
  if (!fetched.ok) return { ok: false, error: fetched.error };
  const snap = newSnapshot({ listing: fetched.listing, catalogUrl, cycleDays: settings.cycleDays });
  list.push(snap);
  await saveSnapshots(list);
  return { ok: true, id: snap.id };
}

/* ───────── 訊息：createListing.js 上傳照片時跨網域抓圖用；captureListing.js 通報新物件 ───────── */

function allowedImageHost(hostname) {
  return hostname === "houseol.com.tw" || hostname.endsWith(".houseol.com.tw");
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;

  if (msg.type === "rr:fetch-image") {
    (async () => {
      try {
        const u = new URL(String(msg.url || ""));
        if (!allowedImageHost(u.hostname)) throw new Error("不抓這個網域的圖：" + u.hostname);
        const res = await fetch(u.href, { credentials: "omit" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const bytes = new Uint8Array(await res.arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        sendResponse({ ok: true, b64: btoa(bin), type: res.headers.get("content-type") || "image/jpeg" });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();
    return true; // 非同步回覆
  }

  if (msg.type === "rr:register-listing") {
    registerListing(msg.catalogUrl).then((r) => sendResponse(r)).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "rr:run-now") {
    runSweep().then((r) => sendResponse({ ok: true, ...r })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  return false;
});
