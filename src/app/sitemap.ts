/**
 * 網站地圖 —— 告訴 Google 這個站有哪些頁面。
 *
 * 網址是從 `APPOINTMENT_BASE_URL` 讀的，所以本機跑是 localhost、
 * 上線後自動變成正式網域，不用手動改。
 */
import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/owner";
import { listPublicProperties } from "@/lib/property";

// 物件會上下架，sitemap 不能被靜態快取成建置當下那份
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE_URL.replace(/\/+$/, "");
  const now = new Date();

  const fixed: MetadataRoute.Sitemap = [
    // 首頁 —— 客戶搜「梧棲房仲」進來的主要落地頁
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    // 數位名片
    { url: `${base}/card`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    // 線上預約
    { url: `${base}/card/booking`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    // 物件列表
    { url: `${base}/property`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    // 委託賣房 —— 收案源的落地頁，權重跟預約頁同級
    { url: `${base}/sell`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    // 工具（房地合一稅試算）—— 靠搜「房地合一稅怎麼算」進來的自然流量入口
    { url: `${base}/tools`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/tools/land-tax-calculator.html`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
  ];

  // 每一個上架中的物件各自一條。資料庫連不上時不要讓整個 sitemap 掛掉 ——
  // 少幾條物件頁只是少被收錄，sitemap 整份 500 會讓 Google 連首頁都讀不到。
  try {
    const properties = await listPublicProperties({ limit: 200 });
    return [
      ...fixed,
      ...properties.map((p) => ({
        url: `${base}/property/${p.slug}`,
        lastModified: p.updated_at || p.published_at || p.created_at || now,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })),
    ];
  } catch {
    return fixed;
  }
}
