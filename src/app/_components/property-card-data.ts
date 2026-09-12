/**
 * 物件卡片的資料整形（2026-09-01）
 *
 * 為什麼要獨立一個檔：卡片本身有照片輪播，必須是 "use client" 元件，
 * 但 PropertyRow 是資料層的型別、而且 DECIMAL 欄位帶著 Prisma.Decimal 實例，
 * 直接丟進 client component 會被 RSC 序列化擋下來
 * （"Only plain objects can be passed to Client Components"，跟 property.ts 檔頭
 * 記的是同一個坑）。所以在 server 端先壓成純字串／純陣列再往下傳。
 *
 * 首頁「物件精選」與 /property 列表共用同一份轉換，卡片上顯示什麼由這裡決定，
 * 兩個頁面不要各自再算一次。
 */
import { propertyTypeLabel, type PropertyRow } from "@/lib/property";
import { directImageUrl, parseImageList, parseVideoList } from "@/lib/media-url";

export type PropertyCardData = {
  slug: string;
  /** 卡片標題。優先用行銷標題 headline，沒有才退回 title */
  title: string;
  /** 標題上方的小標，例：「梧棲・和築好好窩」 */
  eyebrow: string;
  /** 「1,280 萬」或「價格請洽詢」 */
  priceText: string;
  /** 「梧棲．電梯大樓．3房2廳．12F／15F」 */
  meta: string;
  /** 照片直連網址，已去重。可能是空陣列 */
  photos: string[];
  /** 賣點條列，最多三條（卡片放不下更多，完整清單在物件詳情頁） */
  highlights: string[];
  /** 有沒有影片 —— 沒有就不長「影片賞析」那顆按鈕 */
  hasVideo: boolean;
  /** 「已有斡旋」角標；null 代表不顯示 */
  badge: string | null;
};

/** 卡片最多列幾條賣點。列滿三條之後每張卡高度差太多，版面會參差不齊。 */
const MAX_HIGHLIGHTS = 3;

function splitLines(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function toPropertyCardData(p: PropertyRow): PropertyCardData {
  const photos = [
    ...(p.cover_url ? [directImageUrl(p.cover_url)] : []),
    ...parseImageList(p.photo_urls),
  ].filter((url, i, arr) => Boolean(url) && arr.indexOf(url) === i);

  // 小標優先「區域・社區」，這是客戶最快認出「這在哪」的組合；
  // 沒填社區名就只留區域，兩個都沒有才整條不顯示。
  const eyebrow = [p.district, p.community?.trim()].filter(Boolean).join("・");

  const meta = [p.district, propertyTypeLabel(p), p.layout, p.floor_info, p.parking]
    .filter(Boolean)
    .join("．");

  return {
    slug: p.slug,
    title: p.headline?.trim() || p.title,
    eyebrow,
    priceText: p.price ? `${p.price.toLocaleString("zh-TW")} 萬` : "價格請洽詢",
    meta,
    photos,
    highlights: splitLines(p.highlights).slice(0, MAX_HIGHLIGHTS),
    hasVideo: parseVideoList(p.video_urls).length > 0,
    badge: p.status === "reserved" ? "已有斡旋" : null,
  };
}
