import type { Metadata } from "next";
import BookingForm from "./BookingForm";

export const metadata: Metadata = {
  title: "線上預約｜茗馥（蕭茗馥）",
  description: "預約房產諮詢、合作洽談或面試。依需求選擇聯繫方式與時間，完成 Email 確認後正式成立。",
  robots: { index: false, follow: false },
};

export default function BookingPage() {
  return <BookingForm />;
}
