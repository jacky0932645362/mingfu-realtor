import type { Metadata } from "next";
import BookingManageClient from "./BookingManageClient";

export const metadata: Metadata = {
  title: "確認與管理預約｜茗馥（蕭茗馥）",
  description: "確認出席、查看時間，或管理與茗馥的預約。",
  robots: { index: false, follow: false },
};

export default async function BookingManagePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const sp = await searchParams;
  const raw = sp.token;
  const token = Array.isArray(raw) ? raw[0] || "" : raw || "";
  return <BookingManageClient token={token} />;
}
