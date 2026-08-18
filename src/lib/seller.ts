/**
 * 屋主（賣方）客戶資料庫 — 資料層（2026-08-18）
 * raw SQL 讀寫 seller 表，對齊 tenant.ts 的做法（不依賴 prisma client 重生）。
 *
 * 全 additive：新表，不改任何既有表／邏輯。跟買方 customer、租客 tenant 是平行的三張表，
 * 不共用——委託底價／開價／委託期限等欄位跟購屋/租屋需求是不同的需求邏輯，混在一起會互相干擾。
 * 方向也相反：customer/tenant 記錄「誰想跟你買/租」，seller 記錄「誰委託你賣」。
 */
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";

export type SellerRow = {
  id: string;
  name: string;
  phone: string;
  line_id: string | null;
  birthday: Date | null;
  residential_address: string | null;
  property_address: string | null;
  source: string | null;
  grade: string;
  stage: string;
  property_type: string | null;
  property_type_other: string | null;
  size_ping: string | null;
  floor_info: string | null;
  age_years: number | null;
  layout: string | null;
  parking: string | null;
  has_mortgage: number | null;
  mortgage_note: string | null;
  listing_price: number | null;
  floor_price: number | null;
  listing_type: string | null;
  listing_start_date: Date | null;
  listing_end_date: Date | null;
  sell_reason: string | null;
  key_access: string | null;
  note: string | null;
  next_step: string | null;
  last_report_at: Date | null;
  next_report_at: Date | null;
  created_at: Date;
  updated_at: Date | null;
};

export type SellerQueue = "all" | "overdue_report" | "report_today" | "high_grade";

/**
 * TiDB 的 DECIMAL 欄位（size_ping）Prisma raw query 讀回來是 Prisma.Decimal 物件實例，
 * 不是純字串——直接把 SellerRow 從 Server Component 傳進 "use client" 元件（SellerForm）
 * 會被 RSC 序列化擋下（"Only plain objects can be passed to Client Components"）。
 * 統一在資料層轉成字串，之後拿到手的 SellerRow.size_ping 保證是 string | null。
 */
function normalizeSellerRow(row: SellerRow): SellerRow {
  return { ...row, size_ping: row.size_ping == null ? null : String(row.size_ping) };
}

export const SELLER_GRADES = ["A", "B", "C"] as const;

export const SELLER_STAGES = [
  { key: "pending", label: "待簽委託" },
  { key: "listed", label: "已委託待售" },
  { key: "marketing", label: "刊登曝光中" },
  { key: "showing", label: "帶看中" },
  { key: "negotiating", label: "議價中" },
  { key: "closed", label: "已成交" },
  { key: "expired", label: "委託到期" },
  { key: "paused", label: "暫停" },
] as const;

export const SELLER_PROPERTY_TYPES = [
  { key: "house", label: "透天厝" },
  { key: "villa", label: "別墅" },
  { key: "building", label: "大樓" },
  { key: "studio", label: "套房" },
  { key: "factory", label: "廠房" },
  { key: "land", label: "土地" },
] as const;

export const SELLER_LISTING_TYPES = [
  { key: "exclusive", label: "專任委託" },
  { key: "open", label: "一般委託" },
  { key: "verbal", label: "口頭配合" },
] as const;

// ---- 建表（首次呼叫自動建，對齊 tenant.ts pattern）----
let tableEnsured = false;
export async function ensureSellerTable(): Promise<void> {
  if (tableEnsured) return;
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS seller (
      id                   VARCHAR(64)   NOT NULL,
      name                 VARCHAR(80)   NOT NULL,
      phone                VARCHAR(40)   NOT NULL DEFAULT '',
      line_id              VARCHAR(120)  NULL,
      birthday             DATE          NULL,
      residential_address  VARCHAR(240)  NULL,
      property_address     VARCHAR(240)  NULL,
      source               VARCHAR(40)   NULL,
      grade                VARCHAR(4)    NOT NULL DEFAULT 'B',
      stage                VARCHAR(20)   NOT NULL DEFAULT 'pending',
      property_type        VARCHAR(20)   NULL,
      property_type_other  VARCHAR(80)   NULL,
      size_ping            DECIMAL(6,2)  NULL,
      floor_info           VARCHAR(40)   NULL,
      age_years            INT           NULL,
      layout               VARCHAR(40)   NULL,
      parking              VARCHAR(20)   NULL,
      has_mortgage         TINYINT(1)    NULL,
      mortgage_note        VARCHAR(200)  NULL,
      listing_price        INT           NULL,
      floor_price          INT           NULL,
      listing_type         VARCHAR(20)   NULL,
      listing_start_date   DATE          NULL,
      listing_end_date     DATE          NULL,
      sell_reason          VARCHAR(100)  NULL,
      key_access           VARCHAR(100)  NULL,
      note                 LONGTEXT      NULL,
      next_step            LONGTEXT      NULL,
      last_report_at       DATETIME      NULL,
      next_report_at       DATETIME      NULL,
      created_at           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at           TIMESTAMP     NULL,
      PRIMARY KEY (id),
      KEY seller_grade_idx (grade),
      KEY seller_stage_idx (stage),
      KEY seller_next_report_idx (next_report_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tableEnsured = true;
}

export async function listSellers(opts?: {
  grade?: string;
  stage?: string;
  queue?: SellerQueue;
  search?: string;
  limit?: number;
}): Promise<SellerRow[]> {
  await ensureSellerTable();
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
  if (queue === "overdue_report") {
    filters.push("next_report_at IS NOT NULL AND next_report_at < NOW()");
  } else if (queue === "report_today") {
    filters.push(
      "next_report_at IS NOT NULL AND next_report_at >= CURDATE() AND next_report_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)",
    );
  } else if (queue === "high_grade") {
    filters.push("grade = 'A'");
  }

  const search = opts?.search?.trim().slice(0, 120);
  if (search) {
    const pattern = `%${search.replace(/[%_]/g, "\\$&")}%`;
    filters.push("(name LIKE ? OR phone LIKE ? OR line_id LIKE ? OR property_address LIKE ?)");
    params.push(pattern, pattern, pattern, pattern);
  }

  const rows = await db.$queryRawUnsafe<SellerRow[]>(
    `SELECT * FROM seller
      WHERE ${filters.join(" AND ")}
      ORDER BY
        CASE WHEN next_report_at IS NOT NULL AND next_report_at < NOW() THEN 0 ELSE 1 END,
        CASE WHEN next_report_at IS NOT NULL THEN next_report_at END ASC,
        created_at DESC
      LIMIT ?`,
    ...params,
    limit,
  );
  return rows.map(normalizeSellerRow);
}

/** 未來 N 天內要回報的屋主（含已逾期），供行事曆頁用。 */
export async function listUpcomingSellerReportDue(days: number = 14): Promise<SellerRow[]> {
  await ensureSellerTable();
  const rows = await db.$queryRawUnsafe<SellerRow[]>(
    `SELECT * FROM seller
      WHERE next_report_at IS NOT NULL AND next_report_at < DATE_ADD(NOW(), INTERVAL ? DAY)
      ORDER BY next_report_at ASC`,
    days,
  );
  return rows.map(normalizeSellerRow);
}

export async function getSeller(id: string): Promise<SellerRow | null> {
  await ensureSellerTable();
  const rows = await db.$queryRaw<SellerRow[]>`
    SELECT * FROM seller WHERE id = ${id} LIMIT 1
  `;
  return rows[0] ? normalizeSellerRow(rows[0]) : null;
}

export async function sellerStats(): Promise<{
  total: number;
  gradeA: number;
  gradeB: number;
  gradeC: number;
  overdueReport: number;
}> {
  await ensureSellerTable();
  const rows = await db.$queryRaw<
    Array<{ total: bigint; gradeA: bigint; gradeB: bigint; gradeC: bigint; overdueReport: bigint }>
  >`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN grade = 'A' THEN 1 ELSE 0 END) AS gradeA,
      SUM(CASE WHEN grade = 'B' THEN 1 ELSE 0 END) AS gradeB,
      SUM(CASE WHEN grade = 'C' THEN 1 ELSE 0 END) AS gradeC,
      SUM(CASE WHEN next_report_at IS NOT NULL AND next_report_at < NOW() THEN 1 ELSE 0 END) AS overdueReport
    FROM seller
  `;
  const row = rows[0];
  return {
    total: Number(row?.total || 0),
    gradeA: Number(row?.gradeA || 0),
    gradeB: Number(row?.gradeB || 0),
    gradeC: Number(row?.gradeC || 0),
    overdueReport: Number(row?.overdueReport || 0),
  };
}

export type SellerInput = {
  name: string;
  phone: string;
  lineId: string | null;
  birthday: Date | null;
  residentialAddress: string | null;
  propertyAddress: string | null;
  source: string | null;
  grade: string;
  stage: string;
  propertyType: string | null;
  propertyTypeOther: string | null;
  sizePing: number | null;
  floorInfo: string | null;
  ageYears: number | null;
  layout: string | null;
  parking: string | null;
  hasMortgage: boolean | null;
  mortgageNote: string | null;
  listingPrice: number | null;
  floorPrice: number | null;
  listingType: string | null;
  listingStartDate: Date | null;
  listingEndDate: Date | null;
  sellReason: string | null;
  keyAccess: string | null;
  note: string | null;
  nextStep: string | null;
  lastReportAt: Date | null;
  nextReportAt: Date | null;
};

export async function createSeller(data: SellerInput): Promise<string> {
  await ensureSellerTable();
  const id = randomUUID();
  await db.$executeRaw`
    INSERT INTO seller (
      id, name, phone, line_id, birthday, residential_address, property_address, source,
      grade, stage, property_type, property_type_other, size_ping, floor_info, age_years,
      layout, parking, has_mortgage, mortgage_note, listing_price, floor_price,
      listing_type, listing_start_date, listing_end_date, sell_reason, key_access,
      note, next_step, last_report_at, next_report_at
    ) VALUES (
      ${id}, ${data.name}, ${data.phone}, ${data.lineId}, ${data.birthday},
      ${data.residentialAddress}, ${data.propertyAddress}, ${data.source},
      ${data.grade}, ${data.stage}, ${data.propertyType}, ${data.propertyTypeOther},
      ${data.sizePing}, ${data.floorInfo}, ${data.ageYears}, ${data.layout}, ${data.parking},
      ${data.hasMortgage === null ? null : data.hasMortgage ? 1 : 0}, ${data.mortgageNote},
      ${data.listingPrice}, ${data.floorPrice}, ${data.listingType},
      ${data.listingStartDate}, ${data.listingEndDate}, ${data.sellReason}, ${data.keyAccess},
      ${data.note}, ${data.nextStep}, ${data.lastReportAt}, ${data.nextReportAt}
    )
  `;
  return id;
}

export async function updateSeller(id: string, data: SellerInput): Promise<void> {
  await ensureSellerTable();
  await db.$executeRaw`
    UPDATE seller SET
      name = ${data.name}, phone = ${data.phone}, line_id = ${data.lineId},
      birthday = ${data.birthday}, residential_address = ${data.residentialAddress},
      property_address = ${data.propertyAddress}, source = ${data.source},
      grade = ${data.grade}, stage = ${data.stage},
      property_type = ${data.propertyType}, property_type_other = ${data.propertyTypeOther},
      size_ping = ${data.sizePing}, floor_info = ${data.floorInfo}, age_years = ${data.ageYears},
      layout = ${data.layout}, parking = ${data.parking},
      has_mortgage = ${data.hasMortgage === null ? null : data.hasMortgage ? 1 : 0},
      mortgage_note = ${data.mortgageNote},
      listing_price = ${data.listingPrice}, floor_price = ${data.floorPrice},
      listing_type = ${data.listingType},
      listing_start_date = ${data.listingStartDate}, listing_end_date = ${data.listingEndDate},
      sell_reason = ${data.sellReason}, key_access = ${data.keyAccess},
      note = ${data.note}, next_step = ${data.nextStep},
      last_report_at = ${data.lastReportAt}, next_report_at = ${data.nextReportAt},
      updated_at = NOW()
    WHERE id = ${id}
  `;
}

/**
 * 只更新最後回報／下次回報時間，不用整包 SellerInput —— 回報/議價紀錄存檔時
 * 「順便」更新屋主的最後回報／下次回報時間會用到這個。
 */
export async function touchSellerReport(
  id: string,
  data: { lastReportAt?: Date | null; nextReportAt?: Date | null },
): Promise<void> {
  await ensureSellerTable();
  if (data.lastReportAt !== undefined) {
    await db.$executeRaw`UPDATE seller SET last_report_at = ${data.lastReportAt}, updated_at = NOW() WHERE id = ${id}`;
  }
  if (data.nextReportAt !== undefined) {
    await db.$executeRaw`UPDATE seller SET next_report_at = ${data.nextReportAt}, updated_at = NOW() WHERE id = ${id}`;
  }
}
