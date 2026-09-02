/**
 * /travel-map —— 台中海線旅遊地圖
 *
 * 底圖用 MapLibre + CARTO 免費圖磚，不需要任何 API 金鑰。
 * 景點資料與座標查證方式見 coastalSpots.ts 開頭註解。
 *
 * ⚠️ 目前刻意「不對外露出」：
 *    1. 主選單（SiteNav）沒有放連結，只有知道網址的人進得來。
 *    2. 下面的 robots 設成 noindex，Google 不會把它收進搜尋結果。
 *    要正式公開時：把 robots 那段刪掉，並在 SiteNav 加一個連結，兩步就好。
 */
import type { Metadata } from "next";
import { OWNER, SITE_URL } from "@/config/owner";
import CoastalTravelMap from "./CoastalTravelMap";

const BRAND = OWNER.company || OWNER.name;
const DESCRIPTION =
  "台中海線旅遊地圖：清水、梧棲、沙鹿、龍井、大肚、大甲、大安、外埔共 32 個景點，附三條現成路線與 Google 地圖導航，座標逐一查證。";

export const metadata: Metadata = {
  title: `台中海線旅遊地圖｜${BRAND}`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/travel-map` },
  // 尚未對外公開，先不讓搜尋引擎收錄。要公開時整段刪掉即可。
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    title: "台中海線旅遊地圖",
    description: DESCRIPTION,
    url: `${SITE_URL}/travel-map`,
    siteName: BRAND,
    locale: "zh_TW",
  },
};

export default function TravelMapPage() {
  return <CoastalTravelMap />;
}
