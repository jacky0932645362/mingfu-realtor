/**
 * 網站地圖 —— 告訴 Google 這個站有哪些頁面。
 *
 * 網址是從 `APPOINTMENT_BASE_URL` 讀的，所以本機跑是 localhost、
 * 上線後自動變成正式網域，不用手動改。
 */
import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/owner";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL.replace(/\/+$/, "");
  const now = new Date();

  return [
    // 首頁 —— 客戶搜「梧棲房仲」進來的主要落地頁
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    // 數位名片
    { url: `${base}/card`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    // 線上預約
    { url: `${base}/card/booking`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
  ];
}
