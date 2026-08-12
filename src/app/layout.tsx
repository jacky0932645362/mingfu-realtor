import type { Metadata } from "next";
import { OWNER } from "@/config/owner";
import "./globals.css";

const BRAND = OWNER.company || OWNER.name;

// 各頁自己的 metadata 會覆蓋這裡；這組只是沒設定時的後備值。
export const metadata: Metadata = {
  title: `${OWNER.name}｜${BRAND}`,
  description: "台中海線房產顧問，線上預約諮詢。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
