/**
 * FB 貼文工廠 × 太平洋官網：成交／下架檢查（2026-10-05，上架／下架看板第二階段）。
 *
 * 本人看同業 EZup好上架的做法：物件綁「太平洋公司給客戶看的網址」，檢查時如果官網已經沒有這戶，
 * 就移到「需處理物件」。這裡照搬樂屋循環刊登外掛 `lib/pacific-check.js` 已驗證過的判斷法
 * （那邊是出租 R 字頭，這裡出售 S 字頭也用正式站驗證過，2026-10-05）：
 *
 *  - 官網詳情頁的 og:title／og:description 是伺服器端直接寫在 HTML 裡的
 *      還在：og:title＝「梧棲美建地 - 臺中市梧棲區南簡段」、og:description＝「總價3900萬，坪數159.12坪」
 *      （出租是「租金23000元，坪數53.19坪」）
 *      不存在的 saleID：HTTP 一樣 200，但兩個都是空字串
 *  - ⚠️ 沒有「剛成交那一刻」官網長怎樣的樣本，假設跟「不存在」一樣。官網 HTML 裡也沒有「已成交」標記
 *    （對照過還在架上的兩戶，只有導覽列的「成交行情」字樣）。
 *  - 🔴 不輕易判下架：①從來沒成功看過這戶（沒有基準）→ 只回報「連結可能貼錯」，不算下架
 *    ②疑似消失要隔幾秒再抓一次，兩次都空才算 ③抓不到（網路／HTTP 錯）永遠只算檢查失敗
 *  - 價格變動不算下架（屋主調價很常見），只記成備註；坪數差超過 0.5 坪才當「同編號變成別戶」。
 *
 * 這支只讀官網＋寫 fb_draft 的 pacific_* 欄位，不碰排程、不碰 FB。
 * 桌機 runner 用裸 node 直接 import 這個檔，所以內部 import 一律走 @/ 別名。
 */
import { db } from "@/lib/db";
import { ensureFbCoreTables } from "@/lib/fb-factory";

export type PacificStatus = "ok" | "never_seen" | "gone" | "changed";

export type PacificBaseline = { title: string; priceWan: number | null; rent: number | null; ping: number | null };

export type PacificPage = PacificBaseline & { exists: boolean };

const PING_TOLERANCE = 0.5;

/**
 * 本人可以貼完整網址，也可以只貼編號（S2906738 出售／R3487344 出租）。
 * 回傳正規化後的網址；看不懂就回 null（呼叫端顯示錯誤，不要硬存）。
 */
export function normalizePacificInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const idOnly = s.match(/^([SR]\d{5,9})$/i);
  const fromUrl = s.match(/pacific\.com\.tw\/[^\s]*?saleID=([SR]\d{5,9})/i);
  const id = (idOnly?.[1] || fromUrl?.[1] || "").toUpperCase();
  if (!id) return null;
  const path = id.startsWith("R") ? "ObjectRentDetail" : "ObjectDetail";
  return `https://www.pacific.com.tw/Object/${path}/?saleID=${id}`;
}

export function pacificIdFromUrl(url: string | null | undefined): string {
  return String(url || "").match(/saleID=([SR]\d+)/i)?.[1]?.toUpperCase() || "";
}

function metaContent(html: string, prop: string): string {
  const m = html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i"));
  return m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim() : "";
}

export function parsePacificPage(html: string): PacificPage {
  const title = metaContent(html, "og:title");
  const desc = metaContent(html, "og:description");
  const priceM = desc.match(/總價\s*([\d,.]+)\s*萬/);
  const rentM = desc.match(/租金\s*([\d,]+)\s*元/);
  const pingM = desc.match(/坪數\s*([\d.]+)\s*坪/);
  return {
    exists: title !== "" && title !== "太平洋房屋",
    title,
    priceWan: priceM ? Number(priceM[1].replace(/,/g, "")) : null,
    rent: rentM ? Number(rentM[1].replace(/,/g, "")) : null,
    ping: pingM ? Number(pingM[1]) : null,
  };
}

/** 跟基準比：消失／坪數不符才算有問題；價格變了只放備註。 */
export function judgePacific(
  baseline: PacificBaseline,
  page: PacificPage,
): { verdict: "same" | "gone" | "changed"; reason: string; notes: string[] } {
  if (!page.exists) return { verdict: "gone", reason: "太平洋官網已經沒有這戶（多半是成交或撤委託）", notes: [] };
  const notes: string[] = [];
  if (baseline.priceWan != null && page.priceWan != null && baseline.priceWan !== page.priceWan) {
    notes.push(`官網總價 ${baseline.priceWan}→${page.priceWan} 萬`);
  }
  if (baseline.rent != null && page.rent != null && baseline.rent !== page.rent) {
    notes.push(`官網租金 ${baseline.rent}→${page.rent} 元`);
  }
  if (baseline.ping != null && page.ping != null && Math.abs(baseline.ping - page.ping) > PING_TOLERANCE) {
    return { verdict: "changed", reason: `官網坪數從 ${baseline.ping} 變成 ${page.ping}，可能同編號換成別戶`, notes };
  }
  return { verdict: "same", reason: "", notes };
}

export async function fetchPacificPage(
  url: string,
  timeoutMs = 15000,
): Promise<{ ok: true; page: PacificPage } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, page: parsePacificPage(await res.text()) };
  } catch (e) {
    return { ok: false, error: `抓取失敗：${e instanceof Error ? e.message : String(e)}` };
  }
}

export type PacificCheckOutcome = {
  draftId: string;
  title: string;
  /** null＝這次沒得出結論（抓不到），資料庫原本的狀態保留 */
  status: PacificStatus | null;
  note: string;
};

type DraftForCheck = {
  id: string;
  title: string;
  pacific_url: string;
  pacific_baseline: string | null;
  pacific_status: string | null;
};

function parseBaseline(raw: string | null): PacificBaseline | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PacificBaseline;
  } catch {
    return null;
  }
}

/** 檢查一則（已綁網址的）文案，並把結果寫回 fb_draft。 */
export async function checkDraftOnPacific(
  d: DraftForCheck,
  opts: { gapMs?: number } = {},
): Promise<PacificCheckOutcome> {
  const gapMs = opts.gapMs ?? 5000;
  const baseline = parseBaseline(d.pacific_baseline);

  const save = async (status: PacificStatus | null, note: string, newBaseline?: PacificBaseline) => {
    await db.$executeRawUnsafe(
      `UPDATE fb_draft
          SET pacific_status = COALESCE(?, pacific_status),
              pacific_note = ?,
              pacific_baseline = COALESCE(?, pacific_baseline),
              pacific_checked_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      status,
      note.slice(0, 500),
      newBaseline ? JSON.stringify(newBaseline) : null,
      d.id,
    );
    return { draftId: d.id, title: d.title, status, note };
  };

  const first = await fetchPacificPage(d.pacific_url);
  if (!first.ok) return save(null, `檢查失敗（${first.error}），下次再試，狀態先不動`);

  const snap = (p: PacificPage): PacificBaseline => ({ title: p.title, priceWan: p.priceWan, rent: p.rent, ping: p.ping });

  if (!baseline) {
    // 第一次看到就把它記成基準；從來沒看到過的（連結貼錯／官網還沒同步）絕不算下架
    if (first.page.exists) return save("ok", "", snap(first.page));
    return save("never_seen", "官網打開是空的：連結可能貼錯，或官網還沒同步這戶");
  }

  const j1 = judgePacific(baseline, first.page);
  if (j1.verdict === "same") return save("ok", j1.notes.join("；"));

  // 疑似消失／換戶：隔幾秒再確認一次
  if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
  const second = await fetchPacificPage(d.pacific_url);
  if (!second.ok) return save(null, `第一次疑似下架，第二次確認抓取失敗（${second.error}），下次再試`);
  const j2 = judgePacific(baseline, second.page);
  if (j2.verdict === "same") return save("ok", ["第一次疑似異常、第二次恢復正常，當作偶發", ...j2.notes].join("；"));
  return save(j2.verdict, [j2.reason, ...j2.notes].join("；"));
}

/** 所有綁了網址、還沒封存的文案。並行 4 筆，避免一次打官網太多。 */
export async function checkAllDraftsOnPacific(opts: { gapMs?: number } = {}): Promise<PacificCheckOutcome[]> {
  await ensureFbCoreTables();
  const drafts = await db.$queryRawUnsafe<DraftForCheck[]>(
    `SELECT id, title, pacific_url, pacific_baseline, pacific_status FROM fb_draft
      WHERE pacific_url IS NOT NULL AND pacific_url <> '' AND board_archived_at IS NULL
      ORDER BY created_at DESC`,
  );
  const out: PacificCheckOutcome[] = [];
  for (let i = 0; i < drafts.length; i += 4) {
    out.push(...(await Promise.all(drafts.slice(i, i + 4).map((d) => checkDraftOnPacific(d, opts)))));
  }
  return out;
}

/** 單筆（看板上「重新檢查」按鈕用）。 */
export async function checkOneDraftOnPacific(draftId: string): Promise<PacificCheckOutcome | null> {
  await ensureFbCoreTables();
  const rows = await db.$queryRawUnsafe<DraftForCheck[]>(
    "SELECT id, title, pacific_url, pacific_baseline, pacific_status FROM fb_draft WHERE id = ? LIMIT 1",
    draftId,
  );
  const d = rows[0];
  if (!d?.pacific_url) return null;
  return checkDraftOnPacific(d);
}

/** 綁定／改網址：換網址就清掉舊基準重新認識這戶；傳 null＝解除綁定。 */
export async function setDraftPacificUrl(draftId: string, url: string | null): Promise<void> {
  await ensureFbCoreTables();
  await db.$executeRawUnsafe(
    `UPDATE fb_draft
        SET pacific_url = ?, pacific_baseline = NULL, pacific_status = NULL, pacific_note = NULL, pacific_checked_at = NULL
      WHERE id = ?`,
    url,
    draftId,
  );
}

/**
 * 「誤判／恢復上架」：把狀態拉回 ok，並用官網現在的內容重設基準
 * （例如同一戶重新委託上架，坪數改了）。官網現在還是空的就不准恢復——那代表真的不在。
 */
export async function resetDraftPacific(draftId: string): Promise<{ ok: boolean; error?: string }> {
  await ensureFbCoreTables();
  const rows = await db.$queryRawUnsafe<Array<{ pacific_url: string | null }>>(
    "SELECT pacific_url FROM fb_draft WHERE id = ? LIMIT 1",
    draftId,
  );
  const url = rows[0]?.pacific_url;
  if (!url) return { ok: false, error: "這則沒有綁官網網址" };
  const r = await fetchPacificPage(url);
  if (!r.ok) return { ok: false, error: `官網抓不到（${r.error}），稍後再試` };
  if (!r.page.exists) return { ok: false, error: "官網現在還是沒有這戶，不能恢復；如果換了新編號，請重新綁網址" };
  await db.$executeRawUnsafe(
    `UPDATE fb_draft SET pacific_status = 'ok', pacific_note = '本人手動恢復', pacific_checked_at = CURRENT_TIMESTAMP,
            pacific_baseline = ? WHERE id = ?`,
    JSON.stringify({ title: r.page.title, priceWan: r.page.priceWan, rent: r.page.rent, ping: r.page.ping }),
    draftId,
  );
  return { ok: true };
}

/** 封存＝從看板收起來（已成交、不再發）。不刪文案、不動排程。 */
export async function setDraftArchived(draftId: string, archived: boolean): Promise<void> {
  await ensureFbCoreTables();
  await db.$executeRawUnsafe(
    `UPDATE fb_draft SET board_archived_at = ${archived ? "CURRENT_TIMESTAMP" : "NULL"} WHERE id = ?`,
    draftId,
  );
}

/**
 * runner 用來判斷「該跑每日檢查了沒」：只要有一筆綁定的文案從沒檢查過、或上次檢查超過 hours 小時，就該跑。
 * 🔴 不用 MAX(checked_at)：看板上單筆「重新檢查」會把 MAX 刷新，害其他筆整天都沒被檢查。
 */
export async function pacificCheckDue(hours = 20): Promise<boolean> {
  await ensureFbCoreTables();
  const rows = await db.$queryRawUnsafe<Array<{ n: unknown }>>(
    `SELECT COUNT(*) AS n FROM fb_draft
      WHERE pacific_url IS NOT NULL AND pacific_url <> '' AND board_archived_at IS NULL
        AND (pacific_checked_at IS NULL OR pacific_checked_at < ?)`,
    new Date(Date.now() - hours * 3_600_000),
  );
  return Number(String(rows[0]?.n ?? 0)) > 0;
}
