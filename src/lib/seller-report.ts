/**
 * 屋主回報／議價紀錄 — 資料層（2026-08-18）
 * raw SQL 讀寫 seller_report 表，對齊 tenant-showing.ts 的做法。
 *
 * 全 additive：新表，不改任何既有表／邏輯。一個屋主可以有多筆回報／議價紀錄。
 * 「回報」跟「議價」合併成一張表、用 type 分流——本質都是「某天發生一件跟這個屋主
 * 有關的事」，議價只是多幾個結構化欄位（出價／回應價／結果）。
 */
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";

export type SellerReportRow = {
  id: string;
  seller_id: string;
  report_date: Date;
  type: string;
  content: string | null;
  offer_price: number | null;
  counter_price: number | null;
  result: string | null;
  note: string | null;
  created_at: Date;
  updated_at: Date | null;
};

export const SELLER_REPORT_TYPES = [
  { key: "report", label: "一般回報" },
  { key: "negotiation", label: "議價" },
] as const;

export const SELLER_REPORT_RESULTS = [
  { key: "in_progress", label: "進行中" },
  { key: "owner_rejected", label: "屋主拒絕" },
  { key: "buyer_dropped", label: "買方放棄" },
  { key: "considering", label: "雙方考慮中" },
  { key: "agreed", label: "達成共識" },
  { key: "broken", label: "破局" },
] as const;

let tableEnsured = false;
export async function ensureSellerReportTable(): Promise<void> {
  if (tableEnsured) return;
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS seller_report (
      id             VARCHAR(64)   NOT NULL,
      seller_id      VARCHAR(64)   NOT NULL,
      report_date    DATETIME      NOT NULL,
      type           VARCHAR(16)   NOT NULL DEFAULT 'report',
      content        LONGTEXT      NULL,
      offer_price    INT           NULL,
      counter_price  INT           NULL,
      result         VARCHAR(20)   NULL,
      note           LONGTEXT      NULL,
      created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMP     NULL,
      PRIMARY KEY (id),
      KEY seller_report_seller_idx (seller_id),
      KEY seller_report_date_idx (report_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tableEnsured = true;
}

export async function listReportsForSeller(sellerId: string): Promise<SellerReportRow[]> {
  await ensureSellerReportTable();
  return db.$queryRaw<SellerReportRow[]>`
    SELECT * FROM seller_report WHERE seller_id = ${sellerId} ORDER BY report_date DESC
  `;
}

export async function getSellerReport(id: string): Promise<SellerReportRow | null> {
  await ensureSellerReportTable();
  const rows = await db.$queryRaw<SellerReportRow[]>`
    SELECT * FROM seller_report WHERE id = ${id} LIMIT 1
  `;
  return rows[0] || null;
}

export type SellerReportInput = {
  sellerId: string;
  reportDate: Date;
  type: string;
  content: string | null;
  offerPrice: number | null;
  counterPrice: number | null;
  result: string | null;
  note: string | null;
};

export async function createSellerReport(data: SellerReportInput): Promise<string> {
  await ensureSellerReportTable();
  const id = randomUUID();
  await db.$executeRaw`
    INSERT INTO seller_report (
      id, seller_id, report_date, type, content, offer_price, counter_price, result, note
    ) VALUES (
      ${id}, ${data.sellerId}, ${data.reportDate}, ${data.type}, ${data.content},
      ${data.offerPrice}, ${data.counterPrice}, ${data.result}, ${data.note}
    )
  `;
  return id;
}

export async function updateSellerReport(id: string, data: SellerReportInput): Promise<void> {
  await ensureSellerReportTable();
  await db.$executeRaw`
    UPDATE seller_report SET
      report_date = ${data.reportDate}, type = ${data.type}, content = ${data.content},
      offer_price = ${data.offerPrice}, counter_price = ${data.counterPrice},
      result = ${data.result}, note = ${data.note}, updated_at = NOW()
    WHERE id = ${id}
  `;
}
