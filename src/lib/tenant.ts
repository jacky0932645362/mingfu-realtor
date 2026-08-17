/**
 * 租客客戶資料庫 — 資料層（2026-08-17）
 * raw SQL 讀寫 tenant 表，對齊 customer.ts 的做法（不依賴 prisma client 重生）。
 *
 * 全 additive：新表，不改任何既有表／邏輯。跟買方 customer 是平行的兩張表，
 * 不共用，因為租金／物件類型等需求欄位跟購屋條件不同，混在一張表反而互相干擾。
 */
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";

export type TenantRow = {
  id: string;
  name: string;
  phone: string;
  line_id: string | null;
  email: string | null;
  source: string | null;
  grade: string;
  stage: string;
  rent_min: number | null;
  rent_max: number | null;
  area: string | null;
  property_types: string | null;
  property_type_other: string | null;
  note: string | null;
  next_step: string | null;
  last_contact_at: Date | null;
  next_follow_up_at: Date | null;
  created_at: Date;
  updated_at: Date | null;
};

export type TenantQueue = "all" | "overdue_followup" | "followup_today" | "high_grade";

export const TENANT_GRADES = ["A", "B", "C"] as const;

export const TENANT_STAGES = [
  { key: "new", label: "新客戶" },
  { key: "contacted", label: "已聯絡" },
  { key: "viewing_booked", label: "已約看" },
  { key: "viewed", label: "已帶看" },
  { key: "nurturing", label: "持續追蹤" },
  { key: "negotiating", label: "議價中" },
  { key: "closed", label: "已成交" },
  { key: "paused", label: "暫停" },
] as const;

export const TENANT_PROPERTY_TYPES = [
  { key: "house", label: "透天厝" },
  { key: "villa", label: "別墅" },
  { key: "building", label: "大樓" },
  { key: "studio", label: "套房" },
  { key: "factory", label: "廠房" },
  { key: "land", label: "土地" },
] as const;

// ---- 建表（首次呼叫自動建，對齊 customer.ts pattern）----
let tableEnsured = false;
export async function ensureTenantTable(): Promise<void> {
  if (tableEnsured) return;
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tenant (
      id                   VARCHAR(64)   NOT NULL,
      name                 VARCHAR(80)   NOT NULL,
      phone                VARCHAR(40)   NOT NULL DEFAULT '',
      line_id              VARCHAR(120)  NULL,
      email                VARCHAR(160)  NULL,
      source               VARCHAR(40)   NULL,
      grade                VARCHAR(4)    NOT NULL DEFAULT 'B',
      stage                VARCHAR(20)   NOT NULL DEFAULT 'new',
      rent_min             INT           NULL,
      rent_max             INT           NULL,
      area                 VARCHAR(200)  NULL,
      property_types       VARCHAR(160)  NULL,
      property_type_other  VARCHAR(80)   NULL,
      note                 LONGTEXT      NULL,
      next_step            LONGTEXT      NULL,
      last_contact_at      DATETIME      NULL,
      next_follow_up_at    DATETIME      NULL,
      created_at           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at           TIMESTAMP     NULL,
      PRIMARY KEY (id),
      KEY tenant_grade_idx (grade),
      KEY tenant_stage_idx (stage),
      KEY tenant_next_follow_up_idx (next_follow_up_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tableEnsured = true;
}

export async function listTenants(opts?: {
  grade?: string;
  stage?: string;
  queue?: TenantQueue;
  search?: string;
  limit?: number;
}): Promise<TenantRow[]> {
  await ensureTenantTable();
  const limit = Math.min(opts?.limit || 300, 500);
  const filters: string[] = ["1=1"];
  const params: unknown[] = [];

  if (opts?.grade && opts.grade !== "all") {
    filters.push("grade = ?");
    params.push(opts.grade);
  }
  if (opts?.stage && opts.stage !== "all") {
    filters.push("stage = ?");
    params.push(opts.stage);
  }

  const queue = opts?.queue || "all";
  if (queue === "overdue_followup") {
    filters.push("next_follow_up_at IS NOT NULL AND next_follow_up_at < NOW()");
  } else if (queue === "followup_today") {
    filters.push(
      "next_follow_up_at IS NOT NULL AND next_follow_up_at >= CURDATE() AND next_follow_up_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)",
    );
  } else if (queue === "high_grade") {
    filters.push("grade = 'A'");
  }

  const search = opts?.search?.trim().slice(0, 120);
  if (search) {
    const pattern = `%${search.replace(/[%_]/g, "\\$&")}%`;
    filters.push("(name LIKE ? OR phone LIKE ? OR line_id LIKE ? OR area LIKE ?)");
    params.push(pattern, pattern, pattern, pattern);
  }

  return db.$queryRawUnsafe<TenantRow[]>(
    `SELECT * FROM tenant
      WHERE ${filters.join(" AND ")}
      ORDER BY
        CASE WHEN next_follow_up_at IS NOT NULL AND next_follow_up_at < NOW() THEN 0 ELSE 1 END,
        CASE WHEN next_follow_up_at IS NOT NULL THEN next_follow_up_at END ASC,
        created_at DESC
      LIMIT ?`,
    ...params,
    limit,
  );
}

/** 未來 N 天內要追蹤的租客（含已逾期），供行事曆頁用。 */
export async function listUpcomingTenantFollowUps(days: number = 14): Promise<TenantRow[]> {
  await ensureTenantTable();
  return db.$queryRawUnsafe<TenantRow[]>(
    `SELECT * FROM tenant
      WHERE next_follow_up_at IS NOT NULL AND next_follow_up_at < DATE_ADD(NOW(), INTERVAL ? DAY)
      ORDER BY next_follow_up_at ASC`,
    days,
  );
}

export async function getTenant(id: string): Promise<TenantRow | null> {
  await ensureTenantTable();
  const rows = await db.$queryRaw<TenantRow[]>`
    SELECT * FROM tenant WHERE id = ${id} LIMIT 1
  `;
  return rows[0] || null;
}

export async function tenantStats(): Promise<{
  total: number;
  gradeA: number;
  gradeB: number;
  gradeC: number;
  overdueFollowup: number;
}> {
  await ensureTenantTable();
  const rows = await db.$queryRaw<
    Array<{ total: bigint; gradeA: bigint; gradeB: bigint; gradeC: bigint; overdueFollowup: bigint }>
  >`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN grade = 'A' THEN 1 ELSE 0 END) AS gradeA,
      SUM(CASE WHEN grade = 'B' THEN 1 ELSE 0 END) AS gradeB,
      SUM(CASE WHEN grade = 'C' THEN 1 ELSE 0 END) AS gradeC,
      SUM(CASE WHEN next_follow_up_at IS NOT NULL AND next_follow_up_at < NOW() THEN 1 ELSE 0 END) AS overdueFollowup
    FROM tenant
  `;
  const row = rows[0];
  return {
    total: Number(row?.total || 0),
    gradeA: Number(row?.gradeA || 0),
    gradeB: Number(row?.gradeB || 0),
    gradeC: Number(row?.gradeC || 0),
    overdueFollowup: Number(row?.overdueFollowup || 0),
  };
}

export type TenantInput = {
  name: string;
  phone: string;
  lineId: string | null;
  email: string | null;
  source: string | null;
  grade: string;
  stage: string;
  rentMin: number | null;
  rentMax: number | null;
  area: string | null;
  propertyTypes: string[];
  propertyTypeOther: string | null;
  note: string | null;
  nextStep: string | null;
  lastContactAt: Date | null;
  nextFollowUpAt: Date | null;
};

export async function createTenant(data: TenantInput): Promise<string> {
  await ensureTenantTable();
  const id = randomUUID();
  const propertyTypes = data.propertyTypes.join(",");
  await db.$executeRaw`
    INSERT INTO tenant (
      id, name, phone, line_id, email, source, grade, stage,
      rent_min, rent_max, area, property_types, property_type_other,
      note, next_step, last_contact_at, next_follow_up_at
    ) VALUES (
      ${id}, ${data.name}, ${data.phone}, ${data.lineId}, ${data.email},
      ${data.source}, ${data.grade}, ${data.stage},
      ${data.rentMin}, ${data.rentMax}, ${data.area}, ${propertyTypes}, ${data.propertyTypeOther},
      ${data.note}, ${data.nextStep}, ${data.lastContactAt}, ${data.nextFollowUpAt}
    )
  `;
  return id;
}

export async function updateTenant(id: string, data: TenantInput): Promise<void> {
  await ensureTenantTable();
  const propertyTypes = data.propertyTypes.join(",");
  await db.$executeRaw`
    UPDATE tenant SET
      name = ${data.name}, phone = ${data.phone}, line_id = ${data.lineId}, email = ${data.email},
      source = ${data.source}, grade = ${data.grade}, stage = ${data.stage},
      rent_min = ${data.rentMin}, rent_max = ${data.rentMax}, area = ${data.area},
      property_types = ${propertyTypes}, property_type_other = ${data.propertyTypeOther},
      note = ${data.note}, next_step = ${data.nextStep},
      last_contact_at = ${data.lastContactAt}, next_follow_up_at = ${data.nextFollowUpAt},
      updated_at = NOW()
    WHERE id = ${id}
  `;
}

/**
 * 只更新聯絡／追蹤時間，不用整包 TenantInput —— 帶看紀錄存檔時
 * 「順便」更新租客的最後聯絡／下次追蹤時間會用到這個。
 */
export async function touchTenantFollowUp(
  id: string,
  data: { lastContactAt?: Date | null; nextFollowUpAt?: Date | null },
): Promise<void> {
  await ensureTenantTable();
  if (data.lastContactAt !== undefined) {
    await db.$executeRaw`UPDATE tenant SET last_contact_at = ${data.lastContactAt}, updated_at = NOW() WHERE id = ${id}`;
  }
  if (data.nextFollowUpAt !== undefined) {
    await db.$executeRaw`UPDATE tenant SET next_follow_up_at = ${data.nextFollowUpAt}, updated_at = NOW() WHERE id = ${id}`;
  }
}
