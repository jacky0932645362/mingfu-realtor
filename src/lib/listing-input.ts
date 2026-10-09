/**
 * 「貼一個東西就帶入物件」的輸入判斷（2026-10-07，本人：廣告文案要能貼愛屋連結、591／樂屋連結，
 * 或愛屋案號，自動產生文案）。
 *
 * 純函式、**不 import 任何東西**——node 測試（test-catalog-copy.mjs）直接讀得到，
 * 真的去抓網頁那一段放在 catalog-fetch.ts。
 */

/**
 * 本人的愛屋帳號代碼。出自他自己的型錄網址：
 *   https://es.houseol.com.tw/Ecatalog.aspx?UID=SP254&UAID=H229&No=AA5959255&AID=H229
 * 只給「只貼案號」時組型錄網址用（跟愛屋「LINE 型錄」是同一組參數，見愛屋配案傳LINE外掛）。
 * 不是密碼、也不是金鑰——那串網址本來就是發給客戶看的。
 */
export const HOUSEOL_AGENT = { uid: "SP254", uaid: "H229", aid: "H229" } as const;

/** 愛屋物件編號：1～3 個英文字母＋5 碼以上數字（AA6345420、AD5358801）。 */
export const HOUSEOL_NO_RE = /^[A-Za-z]{1,3}\d{5,}$/;

export type ListingInput =
  | { kind: "houseol"; url: string }
  | { kind: "no"; no: string }
  | { kind: "591"; url: string }
  | { kind: "rakuya"; url: string };

export type ClassifyResult = { ok: true; input: ListingInput } | { ok: false; error: string };

/** 用網址解析出來的主機名判斷，不是用字串前綴比（evilhouseol.com.tw 不算愛屋）。 */
export function hostIs(hostname: string, domain: string): boolean {
  const h = hostname.toLowerCase();
  return h === domain || h.endsWith(`.${domain}`);
}

/** 案號 → 他自己的型錄網址。 */
export function catalogUrlForNo(no: string): string {
  const n = no.trim().toUpperCase();
  return (
    `https://es.houseol.com.tw/Ecatalog.aspx?UID=${HOUSEOL_AGENT.uid}&UAID=${HOUSEOL_AGENT.uaid}` +
    `&No=${encodeURIComponent(n)}&AID=${HOUSEOL_AGENT.aid}`
  );
}

/** 是不是愛屋型錄頁本身（Ecatalog.aspx 之類的 .aspx，而且不是「更多照片」那種帶 picstr 的連結）。 */
export function isHouseolCatalogUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return hostIs(u.hostname, "houseol.com.tw") && /\.aspx$/i.test(u.pathname) && !/picstr=/i.test(u.search);
  } catch {
    return false;
  }
}

/** 一串文字（可能夾在整句話裡）取第一條網址，去掉尾巴的標點。 */
function firstUrl(s: string): string | null {
  const m = s.match(/https?:\/\/[^\s"'<>]+/i);
  if (!m) return null;
  return m[0].replace(/[)\]）】。，、；;,.]+$/, "");
}

/**
 * 判斷本人貼進來的是什麼：愛屋連結／愛屋案號／591 連結／樂屋連結。
 * 認不得的回人話錯誤，不猜。整句複製（連結夾在文字裡、「編號：AA1234567」）也吃。
 */
export function classifyListingInput(raw: string | null | undefined): ClassifyResult {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: false, error: "貼上愛屋連結、591／樂屋連結，或愛屋案號（像 AA6345420）" };

  if (HOUSEOL_NO_RE.test(s)) return { ok: true, input: { kind: "no", no: s.toUpperCase() } };

  const url = firstUrl(s);
  if (!url) {
    const noM = s.match(/(?:物件)?(?:編號|案號|No)\s*[:：=]?\s*([A-Za-z]{1,3}\d{5,})/i);
    if (noM) return { ok: true, input: { kind: "no", no: noM[1].toUpperCase() } };
    return { ok: false, error: "認不得這是什麼——要貼愛屋連結、591／樂屋連結，或愛屋案號（像 AA6345420）" };
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { ok: false, error: "這個網址格式不對，檢查一下有沒有貼完整" };
  }

  if (hostIs(host, "houseol.com.tw")) {
    if (!isHouseolCatalogUrl(url)) {
      return { ok: false, error: "這是愛屋的連結，但不是物件型錄頁（要像 Ecatalog.aspx?…&No=AA1234567…，「更多照片」那種連結不行）" };
    }
    return { ok: true, input: { kind: "houseol", url } };
  }
  if (hostIs(host, "591.com.tw")) return { ok: true, input: { kind: "591", url } };
  if (hostIs(host, "rakuya.com.tw")) return { ok: true, input: { kind: "rakuya", url } };

  return { ok: false, error: `不支援這個網站（${host}）——要貼愛屋連結、591／樂屋連結，或愛屋案號` };
}

/**
 * 在 591／樂屋頁面的 HTML 或文字裡找這戶的愛屋連結／案號。
 * 本人用「物件上架助手」刊登時，描述尾段會帶愛屋型錄連結與物件編號（樂屋出租一定有），
 * 所以從這兩個站的頁面可以反查回愛屋。先找完整型錄網址（最準），再找「編號：AAxxxxxxx」。
 * 🔴 只認有「編號／案號」字樣開頭的，不撈任意「字母＋數字」——頁面上到處是亂碼般的 id，撈了會抓錯戶。
 */
export function findHouseolRef(textOrHtml: string | null | undefined): { kind: "url"; url: string; no: string | null } | { kind: "no"; no: string } | null {
  const text = String(textOrHtml ?? "").replace(/&amp;/gi, "&");

  const urlM = text.match(/https?:\/\/[^\s"'<>)\\]*houseol\.com\.tw\/[^\s"'<>)\\]*Ecatalog\.aspx\?[^\s"'<>)\\]*/i);
  if (urlM) {
    const url = urlM[0].replace(/[)\]）】。，、；;,.]+$/, "");
    if (isHouseolCatalogUrl(url)) {
      const no = url.match(/[?&]No=([A-Za-z]{1,3}\d{5,})/i);
      return { kind: "url", url, no: no ? no[1].toUpperCase() : null };
    }
  }

  const noM = text.match(/(?:物件)?(?:編號|案號)\s*[:：=]?\s*(?:<[^>]*>\s*)*([A-Za-z]{1,3}\d{6,9})\b/);
  if (noM) return { kind: "no", no: noM[1].toUpperCase() };

  return null;
}
