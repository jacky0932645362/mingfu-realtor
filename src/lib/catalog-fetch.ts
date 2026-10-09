/**
 * 去把愛屋型錄頁（或 591／樂屋頁面）抓回來解析——伺服器端用的。純判斷在 listing-input.ts／catalog-import.ts。
 *
 * 兩個入口共用這支：「新增物件」貼連結自動帶入、「產生文案」貼連結／案號自動產生文案。
 *
 * 範圍刻意縮小：只抓 houseol.com.tw、591.com.tw、rakuya.com.tw 這三個網站（網址用解析出來的主機名驗，
 * 不是比字串前綴），而且只有登入後台的管理者能呼叫（action 開頭檢查）。不是通用爬蟲。
 */
import {
  isCatalogHtml,
  catalogTextFromHtml,
  parseCatalog,
  photosFromCatalogHtml,
  listingNoFromUrl,
  withShowAddr,
  type CatalogListing,
} from "@/lib/catalog-import";
import { classifyListingInput, catalogUrlForNo, findHouseolRef, hostIs, isHouseolCatalogUrl } from "@/lib/listing-input";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

type Fetched = { ok: true; html: string; finalUrl: string } | { ok: false; error: string };

async function fetchHtml(url: string, domain: string): Promise<Fetched> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9" },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
      redirect: "follow",
    });
    // 被轉到別的網站（網址縮短、導去驗證頁）就不收了
    let finalHost = "";
    try {
      finalHost = new URL(res.url || url).hostname;
    } catch {
      /* 拿不到就當沒轉 */
    }
    if (finalHost && !hostIs(finalHost, domain)) {
      return { ok: false, error: `被轉到別的網站了（${finalHost}），沒有收` };
    }
    if (!res.ok) return { ok: false, error: `伺服器回應 ${res.status}` };
    return { ok: true, html: await res.text(), finalUrl: res.url || url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "連線失敗" };
  }
}

export type CatalogFetchResult =
  | { ok: true; data: CatalogListing; catalogUrl: string }
  | { ok: false; error: string };

/** 抓一頁愛屋型錄、解析、補上這戶的照片。 */
export async function fetchCatalogListingData(rawUrl: string): Promise<CatalogFetchResult> {
  const url = rawUrl.trim();
  if (!isHouseolCatalogUrl(url)) {
    return { ok: false, error: "這不像愛屋型錄頁的網址（要是 …houseol.com.tw/….aspx，且不是照片連結）" };
  }

  const page = await fetchHtml(withShowAddr(url), "houseol.com.tw");
  if (!page.ok) return { ok: false, error: `抓不到這個型錄頁（${page.error}）` };
  if (!isCatalogHtml(page.html)) {
    return { ok: false, error: "抓到頁面了，但看起來不是型錄頁（可能連結有誤，或型錄改版了）" };
  }

  const data = parseCatalog(catalogTextFromHtml(page.html));
  const listingNo = listingNoFromUrl(url) || data.no || null;
  data.photos = photosFromCatalogHtml(page.html, listingNo);
  if (data.photos.length === 0) data.warnings.push("沒抓到照片，要自己貼");
  return { ok: true, data, catalogUrl: url };
}

export type ResolveResult =
  | { ok: true; data: CatalogListing; catalogUrl: string; /** 這份資料是怎麼找到的，給畫面印一句 */ via: string }
  | { ok: false; error: string };

/**
 * 本人貼進來的任何一種東西（愛屋連結／案號／591 連結／樂屋連結）→ 愛屋型錄資料。
 *
 * 591／樂屋：先把那個頁面抓回來，從裡面找這戶的愛屋連結或物件編號（物件上架助手刊登時，描述尾段會帶），
 * 找到了就照愛屋型錄走。🚫 找不到就老實說找不到，**不去猜頁面上的價格、坪數**——
 * 591 的價格是混淆過的、兩個站的欄位結構我都還沒對真實頁面核對過，抓錯的數字會直接貼到 FB 上。
 */
export async function resolveListingInput(raw: string): Promise<ResolveResult> {
  const c = classifyListingInput(raw);
  if (!c.ok) return c;
  const input = c.input;

  let catalogUrl: string;
  let via: string;

  if (input.kind === "houseol") {
    catalogUrl = input.url;
    via = "愛屋型錄連結";
  } else if (input.kind === "no") {
    catalogUrl = catalogUrlForNo(input.no);
    via = `愛屋案號 ${input.no}`;
  } else {
    const site = input.kind === "591" ? "591" : "樂屋";
    const page = await fetchHtml(input.url, input.kind === "591" ? "591.com.tw" : "rakuya.com.tw");
    if (!page.ok) {
      // 樂屋對程式讀取一律回 403（2026-10-07 實測：連首頁都是），這不是這個連結的問題
      const blocked = input.kind === "rakuya" && /403/.test(page.error);
      return {
        ok: false,
        error: blocked
          ? "樂屋擋住了程式讀取（HTTP 403），這個連結讀不進來。可以把樂屋頁面描述最後面那行「編號：AD…」或愛屋連結複製貼過來（刊登時有自動帶在尾巴），或直接貼愛屋連結／案號。"
          : `${site}頁面抓不到（${page.error}）。改貼愛屋連結或案號最穩。`,
      };
    }
    const ref = findHouseolRef(page.html);
    if (!ref) {
      return {
        ok: false,
        error:
          `這個${site}頁面的描述裡找不到這戶的愛屋連結或物件編號，沒辦法帶入` +
          `（物件上架助手只有「出租」物件才會自動把愛屋編號跟連結加在描述尾巴；出售的要自己寫進固定尾段才有）。` +
          `${site}頁面本身的價格、坪數我沒有直接讀——抓錯了會原樣貼上 FB。請改貼愛屋連結或案號。`,
      };
    }
    if (ref.kind === "url") {
      catalogUrl = ref.url;
      via = `${site}頁面裡的愛屋連結${ref.no ? `（${ref.no}）` : ""}`;
    } else {
      catalogUrl = catalogUrlForNo(ref.no);
      via = `${site}頁面裡的物件編號 ${ref.no}`;
    }
  }

  const r = await fetchCatalogListingData(catalogUrl);
  if (!r.ok) return r;
  return { ok: true, data: r.data, catalogUrl: r.catalogUrl, via };
}
