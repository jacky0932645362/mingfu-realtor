/**
 * 租客帶看紀錄 — 資料層（2026-08-17）
 * raw SQL 讀寫 tenant_showing 表，對齊 showing.ts 的做法。
 *
 * 全 additive：新表，不改任何既有表／邏輯。一個租客可以有多筆帶看紀錄。
 * 跟買方的 showing 表分開（tenant 跟 customer 是兩張獨立的表，FK 對應各自的表）。
 */
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";

export type TenantShowingRow = {
  id: string;
  tenant_id: string;
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

export type UpcomingTenantShowingRow = TenantShowingRow & {
  tenant_name: string;
  tenant_phone: string;
};

export const TENANT_SHOWING_STATUSES = [
  { key: "scheduled", label: "已預約" },
  { key: "completed", label: "已完成" },
  { key: "cancelled", label: "已取消" },
  { key: "no_show", label: "未到" },
] as const;

export const TENANT_SHOWING_INTENT_LEVELS = [
  { key: "high", label: "高" },
  { key: "medium", label: "中" },
  { key: "low", label: "低" },
] as const;

let tableEnsured = false;
export async function ensureTenantShowingTable(): Promise<void> {
  if (tableEnsured) return;
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tenant_showing (
      id                VARCHAR(64)   NOT NULL,
      tenant_id         VARCHAR(64)   NOT NULL,
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
      KEY tenant_showing_tenant_idx (tenant_id),
      KEY tenant_showing_visited_idx (visited_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tableEnsured = true;
}

export async function listShowingsForTenant(tenantId: string): Promise<TenantShowingRow[]> {
  await ensureTenantShowingTable();
  return db.$queryRaw<TenantShowingRow[]>`
    SELECT * FROM tenant_showing WHERE tenant_id = ${tenantId} ORDER BY visited_at DESC
  `;
}

export async function getTenantShowing(id: string): Promise<TenantShowingRow | null> {
  await ensureTenantShowingTable();
  const rows = await db.$queryRaw<TenantShowingRow[]>`
    SELECT * FROM tenant_showing WHERE id = ${id} LIMIT 1
  `;
  return rows[0] || null;
}

/** 未來 N 天內「已預約」的帶看，含租客姓名電話，供行事曆頁用。 */
export async function listUpcomingTenantShowings(days: number = 14): Promise<UpcomingTenantShowingRow[]> {
  await ensureTenantShowingTable();
  return db.$queryRawUnsafe<UpcomingTenantShowingRow[]>(
    `SELECT s.*, t.name AS tenant_name, t.phone AS tenant_phone
       FROM tenant_showing s
       JOIN tenant t ON t.id = s.tenant_id
      WHERE s.status = 'scheduled'
        AND s.visited_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
        AND s.visited_at < DATE_ADD(NOW(), INTERVAL ? DAY)
      ORDER BY s.visited_at ASC`,
    days,
  );
}

export type TenantShowingInput = {
  tenantId: string;
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

export async function createTenantShowing(data: TenantShowingInput): Promise<string> {
  await ensureTenantShowingTable();
  const id = randomUUID();
  await db.$executeRaw`
    INSERT INTO tenant_showing (
      id, tenant_id, property_name, property_address, visited_at, status,
      rating, liked, disliked, intent_level, next_step, note
    ) VALUES (
      ${id}, ${data.tenantId}, ${data.propertyName}, ${data.propertyAddress}, ${data.visitedAt}, ${data.status},
      ${data.rating}, ${data.liked}, ${data.disliked}, ${data.intentLevel}, ${data.nextStep}, ${data.note}
    )
  `;
  return id;
}

export async function updateTenantShowing(id: string, data: TenantShowingInput): Promise<void> {
  await ensureTenantShowingTable();
  await db.$executeRaw`
    UPDATE tenant_showing SET
      property_name = ${data.propertyName}, property_address = ${data.propertyAddress},
      visited_at = ${data.visitedAt}, status = ${data.status}, rating = ${data.rating},
      liked = ${data.liked}, disliked = ${data.disliked}, intent_level = ${data.intentLevel},
      next_step = ${data.nextStep}, note = ${data.note}, updated_at = NOW()
    WHERE id = ${id}
  `;
}
