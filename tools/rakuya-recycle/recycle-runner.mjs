/**
 * 排程真正呼叫的入口：把到期的快照一筆一筆處理——存在檢查 → 沒出租的話關閉舊的
 * →建立新的 →更新快照。之後接 Windows工作排程器就是排這支（跟 property-watch
 * 的 check.mjs 是同一種角色）。
 *
 * ⚠️ 第一版，還沒對真帳號跑過。`manageUrl`／`postUrl` 兩個樂屋後台網址還沒本人
 * 帶著確認過實際路徑，先當參數留著，不要硬編一個猜的網址進去。
 *
 * 每處理完一筆就存一次快照（同 property-watch 的原則），中途中斷不會整批丟。
 */
import { launchContext, closeListing, createListing } from "./rakuya-actions.mjs";
import { checkExistence } from "./catalog-check.mjs";
import { loadSnapshots, saveSnapshots, markChecked, recordRecycled, dueForRecycle, findById } from "./store.mjs";
import { pushLine, renderRecycleFailed, renderRecycled, renderRentedOut, renderCheckFailing } from "./notify.mjs";

const FAIL_STREAK_NOTIFY = 3; // 跟 property-watch 對 591「連續3次才推播」同一個「不推假通知」原則

function rakuyaIdFromUrl(url) {
  return (String(url || "").match(/\/rent\/([0-9a-f]{6,})/i) || [])[1] || null;
}

/**
 * 處理一筆到期的快照。回傳 { outcome: "recycled"|"rented_out"|"fetch_failed"|"error" }。
 * 不丟例外給呼叫端——每一種結果都要能繼續處理清單裡的下一筆，一筆出事不能拖垮整批。
 *
 * `actions.closeListing`／`actions.createListing` 可以注入假的實作來測分支邏輯，
 * 不用真的開瀏覽器——預設就是 rakuya-actions.mjs 那兩支真的會點畫面的函式。
 */
export async function recycleOne(context, list, snap, { manageUrl, postUrl, actions = { closeListing, createListing } }) {
  const check = await checkExistence(snap);
  markChecked(list, snap.id, check);

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
  const page = await context.newPage();
  let closed = false;
  try {
    await actions.closeListing(page, { manageUrl, matchText: snap.no || snap.listing?.title });
    closed = true;
    await page.goto(postUrl, { waitUntil: "domcontentloaded" });
    await actions.createListing(page, snap.listing);
    await page.waitForURL(/\/rent\//, { timeout: 15000 }).catch(() => {});
    const newUrl = page.url();
    const updated = recordRecycled(list, snap.id, { rakuyaUrl: newUrl, rakuyaId: rakuyaIdFromUrl(newUrl) });
    await pushLine(renderRecycled(updated));
    return { outcome: "recycled" };
  } catch (e) {
    const item = findById(list, snap.id);
    item.status = "error";
    item.updatedAt = new Date().toISOString();
    if (closed) {
      // 🔴 最壞情況：舊的關了、新的沒建成——這戶現在完全沒曝光，一定要通知，不能悄悄跳過
      await pushLine(renderRecycleFailed(item, e.message));
    }
    return { outcome: "error", error: e.message, closedButNotRecreated: closed };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function runOnce({ manageUrl, postUrl, headless = true } = {}) {
  const list = loadSnapshots();
  const due = dueForRecycle(list);
  if (!due.length) {
    console.log("沒有排到要刷新的物件");
    return { processed: 0 };
  }
  if (!manageUrl || !postUrl) {
    throw new Error("manageUrl／postUrl 還沒設定——這兩個樂屋後台網址要本人帶著確認過實際路徑才能填，不能用猜的");
  }

  const context = await launchContext({ headless });
  const results = [];
  try {
    for (const snap of due) {
      const r = await recycleOne(context, list, snap, { manageUrl, postUrl });
      saveSnapshots(list);
      results.push({ id: snap.id, no: snap.no, ...r });
      console.log(`${snap.no || snap.id}：${r.outcome}`);
    }
  } finally {
    await context.close();
  }
  return { processed: results.length, results };
}
