/**
 * 存在檢查：重新抓 catalogUrl（貼在樂屋描述最後一行的太平洋房屋連結），
 * 跟快照裡的 listing 比對欄位，判斷這戶是不是已經出租出去了。
 *
 * 🔴 直接 import 591-extension 的 parser.js，不複製一份。理由見
 * [[project_樂屋出租循環刊登]]：這支解析器完全不碰 chrome.*（parser.js 檔頭
 * 自己寫明「node 直接 import 得起來」），兩邊是同一層 tools/ 底下的兄弟資料夾，
 * 愛屋版面一直在變（points/points_m/points_s 那種坑），直接 import 才能自動
 * 吃到 591-extension 那邊之後修的欄位對照——跟 catalog-import.ts 刻意複製一份
 * 是不同情況（那邊跨到完全不同的網站專案，這邊是兄弟資料夾互叫）。
 *
 * 愛屋型錄頁不需要 Playwright：房屋物件資料庫的 catalog-import.ts 已經證明
 * 伺服器端直接 fetch() 就抓得到，不用真的開瀏覽器（跟 591 不一樣，591 有
 * Cloudflare）。這裡先照這個假設走最簡單的路，真的被擋再回頭加 Playwright。
 */
import { catalogTextFromHtml, parseCatalog, withShowAddr } from "../591-extension/lib/parser.js";
import { compareListing } from "./snapshot.mjs";

/**
 * 抓一次愛屋型錄頁，回傳解析出來的 listing。
 * 抓不到（網路錯誤、非 200、或內容完全不像型錄頁）回 { ok:false }，不丟例外——
 * 呼叫端要能區分「抓失敗」跟「抓到了但欄位對不起來」，兩者處理方式不一樣。
 */
export async function fetchCatalogListing(catalogUrl, { timeoutMs = 15000 } = {}) {
  if (!catalogUrl) return { ok: false, error: "沒有 catalogUrl" };
  let res;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // 門牌預設是隱藏的（本人 2026-09-16 實測過的坑，見 parser.js 對 withShowAddr 的說明），
    // 補上 showaddr=1 才抓得到完整地址；不影響坪數/樓層這些既有比對欄位，純粹讓資料更完整。
    res = await fetch(withShowAddr(catalogUrl), {
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
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

/**
 * 快照的完整存在檢查：抓 catalogUrl → 跟快照裡的 listing 比對。
 * 回傳的形狀跟 store.mjs 的 markChecked() 要的 result 一樣（可以直接傳進去）。
 */
export async function checkExistence(snapshot) {
  const fetched = await fetchCatalogListing(snapshot.catalogUrl);
  if (!fetched.ok) return { verdict: "fetch_failed", error: fetched.error };
  return compareListing(snapshot.listing, fetched.listing);
}
