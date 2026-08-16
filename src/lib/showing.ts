/**
 * 帶看紀錄 — 資料層（2026-08-16）
 * raw SQL 讀寫 showing 表，對齊 appointment.ts / customer.ts 的做法。
 *
 * 全 additive：新表，不改任何既有表／邏輯。一個客戶可以有多筆帶看紀錄。
 */
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";

export type ShowingRow = {
  id: string;
  customer_id: string;
  property_name: string;
  property_address: string | null;
  visited_at: Date;
  status: string;
  rating: number | null;
  liked: string | null;
  disliked: string | null;
  intent_level: string | null;
  next_step: string | null;
  note: string | null;
  created_at: Date;
  updated_at: Date | null;
};

export type UpcomingShowingRow = ShowingRow & {
  customer_name: string;
  customer_phone: string;
};

export const SHOWING_STATUSES = [
  { key: "scheduled", label: "已預約" },
  { key: "completed", label: "已完成" },
  { key: "cancelled", label: "已取消" },
  { key: "no_show", label: "未到" },
] as const;

export const SHOWING_INTENT_LEVELS = [
  { key: "high", label: "高" },
  { key: "medium", label: "中" },
  { key: "low", label: "低" },
] as const;

let tableEnsured = false;
export async function ensureShowingTable(): Promise<void> {
  if (tableEnsured) return;
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS showing (
      id                VARCHAR(64)   NOT NULL,
      customer_id       VARCHAR(64)   NOT NULL,
      property_name     VARCHAR(160)  NOT NULL DEFAULT '',
      property_address  VARCHAR(240)  NULL,
      visited_at        DATETIME      NOT NULL,
      status            VARCHAR(16)   NOT NULL DEFAULT 'completed',
      rating            TINYINT       NULL,
      liked             LONGTEXT      NULL,
      disliked          LONGTEXT      NULL,
      intent_level      VARCHAR(8)    NULL,
      next_step         VARCHAR(300)  NULL,
      note              LONGTEXT      NULL,
      created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at        TIMESTAMP     NULL,
      PRIMARY KEY (id),
      KEY showing_customer_idx (customer_id),
      KEY showing_visited_idx (visited_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tableEnsured = true;
}

export async function listShowingsForCustomer(customerId: string): Promise<ShowingRow[]> {
  await ensureShowingTable();
  return db.$queryRaw<ShowingRow[]>`
    SELECT * FROM showing WHERE customer_id = ${customerId} ORDER BY visited_at DESC
  `;
}

export async function getShowing(id: string): Promise<ShowingRow | null> {
  await ensureShowingTable();
  const rows = await db.$queryRaw<ShowingRow[]>`
    SELECT * FROM showing WHERE id = ${id} LIMIT 1
  `;
  return rows[0] || null;
}

/** 未來 N 天內「已預約」的帶看，含客戶姓名電話，供行事曆頁用。 */
export async function listUpcomingShowings(days: number = 14): Promise<UpcomingShowingRow[]> {
  await ensureShowingTable();
  return db.$queryRawUnsafe<UpcomingShowingRow[]>(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone
       FROM showing s
       JOIN customer c ON c.id = s.customer_id
      WHERE s.status = 'scheduled'
        AND s.visited_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
        AND s.visited_at < DATE_ADD(NOW(), INTERVAL ? DAY)
      ORDER BY s.visited_at ASC`,
    days,
  );
}

export type ShowingInput = {
  customerId: string;
  propertyName: string;
  propertyAddress: string | null;
  visitedAt: Date;
  status: string;
  rating: number | null;
  liked: string | null;
  disliked: string | null;
  intentLevel: string | null;
  nextStep: string | null;
  note: string | null;
};

export async function createShowing(data: ShowingInput): Promise<string> {
  await ensureShowingTable();
  const id = randomUUID();
  await db.$executeRaw`
    INSERT INTO showing (
      id, customer_id, property_name, property_address, visited_at, status,
      rating, liked, disliked, intent_level, next_step, note
    ) VALUES (
      ${id}, ${data.customerId}, ${data.propertyName}, ${data.propertyAddress}, ${data.visitedAt}, ${data.status},
      ${data.rating}, ${data.liked}, ${data.disliked}, ${data.intentLevel}, ${data.nextStep}, ${data.note}
    )
  `;
  return id;
}

export async function updateShowing(id: string, data: ShowingInput): Promise<void> {
  await ensureShowingTable();
  await db.$executeRaw`
    UPDATE showing SET
      property_name = ${data.propertyName}, property_address = ${data.propertyAddress},
      visited_at = ${data.visitedAt}, status = ${data.status}, rating = ${data.rating},
      liked = ${data.liked}, disliked = ${data.disliked}, intent_level = ${data.intentLevel},
      next_step = ${data.nextStep}, note = ${data.note}, updated_at = NOW()
    WHERE id = ${id}
  `;
}
