/**
 * 買方客戶資料庫 — 資料層（2026-08-16）
 * raw SQL 讀寫 customer 表，對齊 appointment.ts 的做法（不依賴 prisma client 重生）。
 *
 * 全 additive：新表，不改任何既有表／邏輯。跟 appointment（單次預約）分開，
 * 一個客戶可能對到多次預約／帶看，V1 先不強制關聯，保持簡單。
 */
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";

export type CustomerRow = {
  id: string;
  name: string;
  phone: string;
  line_id: string | null;
  email: string | null;
  source: string | null;
  customer_type: string | null;
  grade: string;
  stage: string;
  budget_min: number | null;
  budget_max: number | null;
  area: string | null;
  house_type: string | null;
  min_ping: number | null;
  parking_needed: number;
  must_have: string | null;
  nice_to_have: string | null;
  purchase_timing: string | null;
  purchase_purpose: string | null;
  note: string | null;
  next_step: string | null;
  last_contact_at: Date | null;
  next_follow_up_at: Date | null;
  created_at: Date;
  updated_at: Date | null;
};

export type CustomerQueue = "all" | "overdue_followup" | "followup_today" | "high_grade";

export const CUSTOMER_GRADES = ["A", "B", "C"] as const;

export const CUSTOMER_STAGES = [
  { key: "new", label: "新客戶" },
  { key: "contacted", label: "已聯絡" },
  { key: "viewing_booked", label: "已約看" },
  { key: "viewed", label: "已帶看" },
  { key: "nurturing", label: "持續追蹤" },
  { key: "negotiating", label: "議價" },
  { key: "closed", label: "成交" },
  { key: "paused", label: "暫停" },
] as const;

export const CUSTOMER_TYPES = [
  { key: "first_time", label: "首購" },
  { key: "upgrade", label: "換屋" },
  { key: "invest", label: "投資" },
  { key: "asset", label: "置產" },
] as const;

// ---- 建表（首次呼叫自動建，對齊 appointment.ts pattern）----
let tableEnsured = false;
export async function ensureCustomerTable(): Promise<void> {
  if (tableEnsured) return;
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS customer (
      id                VARCHAR(64)   NOT NULL,
      name              VARCHAR(80)   NOT NULL,
      phone             VARCHAR(40)   NOT NULL DEFAULT '',
      line_id           VARCHAR(120)  NULL,
      email             VARCHAR(160)  NULL,
      source            VARCHAR(40)   NULL,
      customer_type     VARCHAR(16)   NULL,
      grade             VARCHAR(4)    NOT NULL DEFAULT 'B',
      stage             VARCHAR(20)   NOT NULL DEFAULT 'new',
      budget_min        INT           NULL,
      budget_max        INT           NULL,
      area              VARCHAR(200)  NULL,
      house_type        VARCHAR(80)   NULL,
      min_ping          DOUBLE        NULL,
      parking_needed    TINYINT(1)    NOT NULL DEFAULT 0,
      must_have         LONGTEXT      NULL,
      nice_to_have      LONGTEXT      NULL,
      purchase_timing   VARCHAR(40)   NULL,
      purchase_purpose  VARCHAR(80)   NULL,
      note              LONGTEXT      NULL,
      next_step         LONGTEXT      NULL,
      last_contact_at   DATETIME      NULL,
      next_follow_up_at DATETIME      NULL,
      created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at        TIMESTAMP     NULL,
      PRIMARY KEY (id),
      KEY customer_grade_idx (grade),
      KEY customer_stage_idx (stage),
      KEY customer_next_follow_up_idx (next_follow_up_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tableEnsured = true;
}

export async function listCustomers(opts?: {
  grade?: string;
  stage?: string;
  queue?: CustomerQueue;
  search?: string;
  limit?: number;
}): Promise<CustomerRow[]> {
  await ensureCustomerTable();
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

  return db.$queryRawUnsafe<CustomerRow[]>(
    `SELECT * FROM customer
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

/** 未來 N 天內要追蹤的客戶（含已逾期），供行事曆頁用。 */
export async function listUpcomingFollowUps(days: number = 14): Promise<CustomerRow[]> {
  await ensureCustomerTable();
  return db.$queryRawUnsafe<CustomerRow[]>(
    `SELECT * FROM customer
      WHERE next_follow_up_at IS NOT NULL AND next_follow_up_at < DATE_ADD(NOW(), INTERVAL ? DAY)
      ORDER BY next_follow_up_at ASC`,
    days,
  );
}

export async function getCustomer(id: string): Promise<CustomerRow | null> {
  await ensureCustomerTable();
  const rows = await db.$queryRaw<CustomerRow[]>`
    SELECT * FROM customer WHERE id = ${id} LIMIT 1
  `;
  return rows[0] || null;
}

export async function customerStats(): Promise<{
  total: number;
  gradeA: number;
  gradeB: number;
  gradeC: number;
  overdueFollowup: number;
}> {
  await ensureCustomerTable();
  const rows = await db.$queryRaw<
    Array<{ total: bigint; gradeA: bigint; gradeB: bigint; gradeC: bigint; overdueFollowup: bigint }>
  >`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN grade = 'A' THEN 1 ELSE 0 END) AS gradeA,
      SUM(CASE WHEN grade = 'B' THEN 1 ELSE 0 END) AS gradeB,
      SUM(CASE WHEN grade = 'C' THEN 1 ELSE 0 END) AS gradeC,
      SUM(CASE WHEN next_follow_up_at IS NOT NULL AND next_follow_up_at < NOW() THEN 1 ELSE 0 END) AS overdueFollowup
    FROM customer
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

export type CustomerInput = {
  name: string;
  phone: string;
  lineId: string | null;
  email: string | null;
  source: string | null;
  customerType: string | null;
  grade: string;
  stage: string;
  budgetMin: number | null;
  budgetMax: number | null;
  area: string | null;
  houseType: string | null;
  minPing: number | null;
  parkingNeeded: boolean;
  mustHave: string | null;
  niceToHave: string | null;
  purchaseTiming: string | null;
  purchasePurpose: string | null;
  note: string | null;
  nextStep: string | null;
  lastContactAt: Date | null;
  nextFollowUpAt: Date | null;
};

export async function createCustomer(data: CustomerInput): Promise<string> {
  await ensureCustomerTable();
  const id = randomUUID();
  await db.$executeRaw`
    INSERT INTO customer (
      id, name, phone, line_id, email, source, customer_type, grade, stage,
      budget_min, budget_max, area, house_type, min_ping, parking_needed,
      must_have, nice_to_have, purchase_timing, purchase_purpose, note, next_step,
      last_contact_at, next_follow_up_at
    ) VALUES (
      ${id}, ${data.name}, ${data.phone}, ${data.lineId}, ${data.email},
      ${data.source}, ${data.customerType}, ${data.grade}, ${data.stage},
      ${data.budgetMin}, ${data.budgetMax}, ${data.area}, ${data.houseType},
      ${data.minPing}, ${data.parkingNeeded ? 1 : 0},
      ${data.mustHave}, ${data.niceToHave}, ${data.purchaseTiming}, ${data.purchasePurpose},
      ${data.note}, ${data.nextStep}, ${data.lastContactAt}, ${data.nextFollowUpAt}
    )
  `;
  return id;
}

export async function updateCustomer(id: string, data: CustomerInput): Promise<void> {
  await ensureCustomerTable();
  await db.$executeRaw`
    UPDATE customer SET
      name = ${data.name}, phone = ${data.phone}, line_id = ${data.lineId}, email = ${data.email},
      source = ${data.source}, customer_type = ${data.customerType}, grade = ${data.grade}, stage = ${data.stage},
      budget_min = ${data.budgetMin}, budget_max = ${data.budgetMax}, area = ${data.area}, house_type = ${data.houseType},
      min_ping = ${data.minPing}, parking_needed = ${data.parkingNeeded ? 1 : 0},
      must_have = ${data.mustHave}, nice_to_have = ${data.niceToHave},
      purchase_timing = ${data.purchaseTiming}, purchase_purpose = ${data.purchasePurpose},
      note = ${data.note}, next_step = ${data.nextStep},
      last_contact_at = ${data.lastContactAt}, next_follow_up_at = ${data.nextFollowUpAt},
      updated_at = NOW()
    WHERE id = ${id}
  `;
}

/**
 * 只更新聯絡／追蹤時間，不用整包 CustomerInput —— 帶看紀錄存檔時
 * 「順便」更新客戶的最後聯絡／下次追蹤時間會用到這個。
 */
export async function touchCustomerFollowUp(
  id: string,
  data: { lastContactAt?: Date | null; nextFollowUpAt?: Date | null },
): Promise<void> {
  await ensureCustomerTable();
  if (data.lastContactAt !== undefined) {
    await db.$executeRaw`UPDATE customer SET last_contact_at = ${data.lastContactAt}, updated_at = NOW() WHERE id = ${id}`;
  }
  if (data.nextFollowUpAt !== undefined) {
    await db.$executeRaw`UPDATE customer SET next_follow_up_at = ${data.nextFollowUpAt}, updated_at = NOW() WHERE id = ${id}`;
  }
}
