/**
 * 存在檢查：重新抓 catalogUrl（貼在樂屋描述最後一行的太平洋房屋連結），跟快照
 * 比對欄位，判斷是不是已經出租出去了。背景見 [[project_樂屋出租循環刊登]]。
 *
 * 這支在 background.js（service worker）裡跑，用瀏覽器原生 fetch()——manifest.json
 * 已經把 *.houseol.com.tw 加進 host_permissions，service worker 的 fetch 不受
 * 一般網頁 fetch 的同源限制，也不用像 fillRakuya.js 那樣繞道跨網域抓圖那一套。
 */
import { catalogTextFromHtml, parseCatalog, withShowAddr } from "./parser.js";
import { compareListing } from "./snapshot.js";

export async function fetchCatalogListing(catalogUrl, { timeoutMs = 15000 } = {}) {
  if (!catalogUrl) return { ok: false, error: "沒有 catalogUrl" };
  let res;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    res = await fetch(withShowAddr(catalogUrl), { signal: ctrl.signal });
    clearTimeout(timer);
  } catch (e) {
    return { ok: false, error: `抓取失敗：${e.message}` };
  }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const html = await res.text();
  const text = catalogTextFromHtml(html);
  const listing = parseCatalog(text);
  if (!listing.addr && !listing.regPing && !listing.room) {
    return { ok: false, error: "頁面抓到了，但一個欄位都解析不出來（型錄可能改版或這條連結已經失效）" };
  }
  return { ok: true, listing };
}

export async function checkExistence(snapshot) {
  const fetched = await fetchCatalogListing(snapshot.catalogUrl);
  if (!fetched.ok) return { verdict: "fetch_failed", error: fetched.error };
  return compareListing(snapshot.listing, fetched.listing);
}
