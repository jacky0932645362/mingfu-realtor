"use server";
/**
 * 「產生文案」貼愛屋連結／591／樂屋連結／愛屋案號 → 自動產生廣告文案草稿（2026-10-07，本人貼同業
 * 「FB 社團廣告助手 → 從愛屋帶入」的截圖，要求抓的東西跟截圖一樣）。
 *
 * 只產出「草稿」（標題、內文、照片網址），不存檔、不發任何東西——畫面上帶進「手動填一筆」那幾格，
 * 本人改完再按「存進貼文庫」。每一支 Server Action 開頭先 isCurrentUserAdmin()。
 */
import { isCurrentUserAdmin } from "@/lib/admin-check";
import { resolveListingInput } from "@/lib/catalog-fetch";
import { buildCatalogAdCopy } from "@/lib/catalog-copy";
import { listingNoFromUrl } from "@/lib/catalog-import";

export type ListingCopyResult =
  | {
      ok: true;
      title: string;
      body: string;
      /** 型錄上這一戶的全部照片網址（畫面上按鈕再決定帶幾張進去） */
      photos: string[];
      /** 這份資料是怎麼找到的（愛屋連結／案號／從 591 頁面裡反查到的編號…），畫面印一句 */
      via: string;
      /** 物件編號（有就印給本人核對是不是那一戶） */
      no: string | null;
      warnings: string[];
    }
  | { ok: false; error: string };

export async function importListingCopyAction(rawInput: string): Promise<ListingCopyResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };

  const r = await resolveListingInput(rawInput);
  if (!r.ok) return { ok: false, error: r.error };

  const copy = buildCatalogAdCopy(r.data);
  return {
    ok: true,
    title: copy.title,
    body: copy.body,
    photos: r.data.photos,
    via: r.via,
    no: listingNoFromUrl(r.catalogUrl) || r.data.no || null,
    warnings: copy.warnings,
  };
}
