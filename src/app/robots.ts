/**
 * 搜尋引擎規則 —— 哪些頁面可以收錄、哪些不行。
 *
 * 後台與 API 一律擋掉：那些頁面對客戶沒意義，被 Google 收錄只會露出
 * 不該露的東西（例如客戶的預約管理連結）。
 */
import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/owner";

export default function robots(): MetadataRoute.Robots {
  const base = SITE_URL.replace(/\/+$/, "");

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",            // 後台
          "/api",              // 所有 API
          "/card/booking/manage", // 客戶的「管理我的預約」連結，帶token不可外流
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
