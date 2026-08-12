/**
 * 客戶預約系統 — 資料層（2026-06-19）
 * raw SQL 讀寫 appointment 表（對齊 deal_record / ai_usage,不依賴 prisma client 重生）。
 * 純常數 / 規則 / 時區 helper 在 appointment-constants.ts（client + server 共用,此處 re-export）。
 *
 * 🚨 全 additive:新表,不改任何既有表 / 邏輯。
 */
import { db } from "@/lib/db";
import { listCalendarEventIds } from "@/lib/google-calendar";
import {
  allocateAppointmentCaseNo,
  appointmentCasePrefix,
  formatAppointmentCaseNo,
  type AppointmentCaseNumberStore,
} from "@/lib/appointment-case-number";
import {
  DEFAULT_RATE_LIMIT_SETTINGS,
  RATE_LIMIT_CONFIG_KEYS,
  normalizeRateLimitSettings,
  type AppointmentRateLimitSettings,
} from "@/lib/appointment-rate-limit-settings";
import {
  appointmentRateLimitBucketKind,
  type AppointmentRateLimitBucketKind,
} from "@/lib/appointment-rate-limit-policy";
import {
  BOOKING_CONFIRMATION_HOLD_MINUTES,
  BOOKING_RULES,
  appointmentMeetingPolicy,
  type AppointmentQualification,
  type AppointmentRow,
  type BookingMode,
  type MeetLocation,
} from "@/lib/appointment-constants";
import { createHash, randomBytes, randomUUID } from "node:crypto";

export * from "@/lib/appointment-constants";
export { formatAppointmentCaseNo } from "@/lib/appointment-case-number";
export type { AppointmentRateLimitBucketKind } from "@/lib/appointment-rate-limit-policy";

/** createAppointment 撞到 slot lock(該時段已被佔)時丟出,route 捕捉回 409。2026-07-03 */
export class AppointmentSlotConflictError extends Error {
  constructor(message = "slot_conflict") {
    super(message);
    this.name = "AppointmentSlotConflictError";
  }
}

/** 客戶選自訂地點時，核准連結不存在、失效或已使用。 */
export class AppointmentLocationApprovalError extends Error {
  constructor(message = "custom_location_approval_required") {
    super(message);
    this.name = "AppointmentLocationApprovalError";
  }
}

const CUSTOM_LOCATION_APPROVAL_HOURS = 72;

function normalizeCustomLocationApprovalToken(token: string): string | null {
  const normalized = token.trim();
  return /^[A-Za-z0-9_-]{32,100}$/.test(normalized) ? normalized : null;
}

function hashCustomLocationApprovalToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export class AppointmentIdempotencyConflictError extends Error {
  constructor(message = "idempotency_conflict") {
    super(message);
    this.name = "AppointmentIdempotencyConflictError";
  }
}

function hashAppointmentContact(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, "");
  return normalized ? createHash("sha256").update(normalized, "utf8").digest("hex") : null;
}

/** 把一筆預約(可連選多格)展開成它實際佔用的每一個整點小時。撞號防線以「每格一列 lock」為單位。 */
function occupiedSlotHours(
  slotAt: Date,
  slotEndAt: Date | null,
  buffer?: { beforeMin?: number; afterMin?: number },
): Date[] {
  const slotMs = BOOKING_RULES.slotMinutes * 60_000;
  const beforeMs = Math.ceil(Math.max(0, buffer?.beforeMin || 0) / BOOKING_RULES.slotMinutes) * slotMs;
  const afterMs = Math.ceil(Math.max(0, buffer?.afterMin || 0) / BOOKING_RULES.slotMinutes) * slotMs;
  const start = slotAt.getTime() - beforeMs;
  const end =
    slotEndAt && slotEndAt.getTime() > slotAt.getTime()
      ? slotEndAt.getTime() + afterMs
      : slotAt.getTime() + slotMs + afterMs;
  const hours: Date[] = [];
  for (let t = start; t < end; t += slotMs) hours.push(new Date(t));
  return hours.length ? hours : [new Date(slotAt.getTime())];
}

/** 錯誤是否為「該時段搶不到」的暫時性衝突:1062 duplicate(格被搶)或 1213/1205 deadlock / lock wait timeout(併發鎖爭用)。
 *  兩者都當成 slot conflict → 回 409 讓客戶重選 / 重試,而非 500。 */
function isTransientSlotConflict(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? e ?? "");
  return /duplicate entry|err_dup_entry|\b1062\b|deadlock|err_lock_deadlock|\b1213\b|lock wait timeout|\b1205\b/i.test(msg);
}

export type AppointmentTrackingInput = {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  referrer?: string | null;
  userAgent?: string | null;
  device?: string | null;
  fromPage?: string | null;
  funnelSessionId?: string | null;
};

export type AppointmentConsentInput = {
  receiptId: string;
  subjectId: string;
  version: string;
  analyticsGranted: boolean;
  marketingGranted: boolean;
  decidedAt: Date;
  gaClientId?: string | null;
  fbp?: string | null;
  fbc?: string | null;
};

export type AppointmentNotificationPurpose =
  | "admin_new"
  | "admin_line_pending"
  | "admin_line_new"
  | "customer_confirmation_request"
  | "customer_confirmation"
  | "customer_reminder"
  | "customer_reschedule"
  | "customer_cancel"
  | "admin_customer_cancel"
  | "admin_customer_reschedule";

export type AppointmentNotificationChannel = "email" | "line";

export type AppointmentNotificationRow = {
  id: string;
  appointment_id: string;
  purpose: string;
  channel: string;
  recipient: string | null;
  status: string;
  provider: string | null;
  message_id: string | null;
  error: string | null;
  created_at: Date;
};

export type AppointmentFunnelEvent =
  | "view"
  | "mode_select"
  | "meet_type_select"
  | "slot_select"
  | "contact_complete"
  | "qualification_complete"
  | "submit_start"
  | "submit_success"
  | "submit_error"
  | "booking_confirmed"
  | "attendance_confirmed"
  | "arrived"
  | "closed_won";

export type AppointmentFunnelSummaryRow = {
  event: string;
  count: bigint;
};

export type AppointmentFunnelBreakdownRow = AppointmentFunnelSummaryRow & {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  booking_mode: string | null;
  device: string | null;
};

export type AppointmentFollowupRow = {
  id: string;
  appointment_id: string;
  status: string;
  title: string;
  customer_name: string;
  phone: string | null;
  email: string | null;
  line_id: string | null;
  intent: string | null;
  note: string | null;
  next_action: string | null;
  owner: string | null;
  due_at: Date | null;
  completed_at: Date | null;
  result: string | null;
  source: string | null;
  created_at: Date;
  updated_at: Date | null;
};

export type AppointmentLocationApprovalRow = {
  id: string;
  customer_hint: string | null;
  location_json: string | null;
  customer_phone_hash: string | null;
  customer_email_hash: string | null;
  allowed_start_at: Date | null;
  allowed_end_at: Date | null;
  approved_duration_min: number | null;
  expires_at: Date;
  used_at: Date | null;
  used_appointment_id: string | null;
  revoked_at: Date | null;
  revoke_reason: string | null;
  created_by: string | null;
  created_at: Date;
};

export type AppointmentOutboxTaskType =
  | "ai_grade"
  | "calendar_create"
  | "calendar_reschedule"
  | "calendar_cancel"
  | "notify_new"
  | "notify_reschedule"
  | "notify_cancel"
  | "analytics_ga4"
  | "analytics_meta";

export type AppointmentOutboxRow = {
  id: string;
  appointment_id: string;
  task_type: AppointmentOutboxTaskType;
  payload_json: string | null;
  status: string;
  attempts: number;
  next_attempt_at: Date;
  locked_at: Date | null;
  last_error: string | null;
  dedupe_key: string;
  provider: string | null;
  event_id: string | null;
  event_name: string | null;
  occurred_at: Date | null;
  consent_receipt_id: string | null;
  payload_hash: string | null;
  last_http_status: number | null;
  provider_request_id: string | null;
  events_received: number | null;
  accepted_at: Date | null;
  final_reason: string | null;
  created_at: Date;
  updated_at: Date | null;
};

// ---- 建表（首次呼叫自動建,對齊 ai-usage.ts pattern）----
let tableEnsured = false;
export async function ensureAppointmentTable(): Promise<void> {
  if (tableEnsured) return;
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS appointment (
      id              VARCHAR(64)  NOT NULL,
      booking_mode    VARCHAR(24)  NOT NULL DEFAULT 'realtor',
      name            VARCHAR(80)  NOT NULL,
      gender          VARCHAR(16)  NOT NULL DEFAULT '',
      phone           VARCHAR(40)  NOT NULL DEFAULT '',
      email           VARCHAR(160) NOT NULL DEFAULT '',
      line_id         VARCHAR(120) NULL,
      meet_type       VARCHAR(16)  NOT NULL DEFAULT 'office',
      meet_location   TEXT         NULL,
      intent          LONGTEXT     NULL,
      qualification_json LONGTEXT  NULL,
      urgency         VARCHAR(16)  NULL,
      note            LONGTEXT     NULL,
      slot_at         DATETIME     NOT NULL,
      slot_end_at     DATETIME     NULL,
      status          VARCHAR(24)  NOT NULL DEFAULT 'confirmed',
      confirmation_deadline DATETIME NULL,
      attendance_status VARCHAR(24) NOT NULL DEFAULT 'pending',
      outcome_status  VARCHAR(24)  NOT NULL DEFAULT 'none',
      outcome_note    LONGTEXT     NULL,
      contact_status  VARCHAR(24)  NOT NULL DEFAULT 'uncontacted',
      first_contacted_at DATETIME  NULL,
      next_followup_at DATETIME    NULL,
      estimated_commission DECIMAL(14,2) NULL,
      actual_commission DECIMAL(14,2) NULL,
      case_reference  VARCHAR(160) NULL,
      case_no         VARCHAR(32)  NULL,
      ai_heat         VARCHAR(8)   NULL,
      ai_film         TINYINT(1)   NOT NULL DEFAULT 0,
      ai_suggestion   LONGTEXT     NULL,
      ai_summary      LONGTEXT     NULL,
      ai_next_action  LONGTEXT     NULL,
      ai_profile      LONGTEXT     NULL,
      google_event_id VARCHAR(128) NULL,
      meet_url        TEXT         NULL,
      calendar_sync_status VARCHAR(24) NULL,
      calendar_sync_error TEXT NULL,
      calendar_synced_at DATETIME NULL,
      customer_email_status VARCHAR(24) NULL,
      admin_email_status    VARCHAR(24) NULL,
      line_notify_status    VARCHAR(24) NULL,
      last_notify_error     TEXT NULL,
      utm_source      VARCHAR(80)  NULL,
      utm_medium      VARCHAR(80)  NULL,
      utm_campaign    VARCHAR(160) NULL,
      utm_content     VARCHAR(160) NULL,
      utm_term        VARCHAR(160) NULL,
      referrer        TEXT         NULL,
      user_agent      TEXT         NULL,
      device          VARCHAR(32)  NULL,
      from_page       VARCHAR(240) NULL,
      funnel_session_id VARCHAR(80) NULL,
      tracking_consent_receipt_id CHAR(32) NULL,
      tracking_consent_subject_id CHAR(32) NULL,
      tracking_consent_version VARCHAR(64) NULL,
      analytics_consent_granted TINYINT(1) NOT NULL DEFAULT 0,
      marketing_consent_granted TINYINT(1) NOT NULL DEFAULT 0,
      tracking_consent_at DATETIME(3) NULL,
      ga_client_id VARCHAR(200) NULL,
      meta_fbp VARCHAR(200) NULL,
      meta_fbc VARCHAR(200) NULL,
      rate_limit_generation BIGINT NOT NULL DEFAULT 0,
      idempotency_key VARCHAR(100) NULL,
      source          VARCHAR(32)  NULL,
      created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP    NULL,
      cancelled_at    TIMESTAMP    NULL,
      reminder_24h_sent_at TIMESTAMP NULL,
      customer_reminder_24h_sent_at TIMESTAMP NULL,
      admin_reminder_24h_sent_at TIMESTAMP NULL,
      PRIMARY KEY (id),
      UNIQUE KEY appointment_idempotency_uid (idempotency_key),
      UNIQUE KEY appointment_case_no_uid (case_no),
      KEY appointment_slot_idx (slot_at),
      KEY appointment_status_slot_idx (status, slot_at),
      KEY appointment_attendance_slot_idx (attendance_status, slot_at),
      KEY appointment_followup_due_idx (contact_status, next_followup_at),
      KEY appointment_created_idx (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // 既有表冪等補 meet_location 欄(MySQL/TiDB 無通用 ADD COLUMN IF NOT EXISTS → 查 INFORMATION_SCHEMA;
  //  try/catch 吞「欄位已存在」的併發 race，additive 不影響既有資料)。2026-06-25
  try {
    const col = await db.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment' AND COLUMN_NAME = 'meet_location'
        LIMIT 1`,
    );
    if (!Array.isArray(col) || col.length === 0) {
      await db.$executeRawUnsafe(`ALTER TABLE appointment ADD COLUMN meet_location TEXT NULL`);
    }
  } catch (e) {
    console.error("[appointment] ensure meet_location 欄失敗(忽略,可能已存在):", e);
  }
  try {
    const col = await db.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment' AND COLUMN_NAME = 'slot_end_at'
        LIMIT 1`,
    );
    if (!Array.isArray(col) || col.length === 0) {
      await db.$executeRawUnsafe(`ALTER TABLE appointment ADD COLUMN slot_end_at DATETIME NULL AFTER slot_at`);
    }
  } catch (e) {
    console.error("[appointment] ensure slot_end_at 欄失敗(忽略,可能已存在):", e);
  }
  const additiveColumns: Array<[string, string]> = [
    ["booking_mode", "ALTER TABLE appointment ADD COLUMN booking_mode VARCHAR(24) NOT NULL DEFAULT 'realtor' AFTER id"],
    ["qualification_json", "ALTER TABLE appointment ADD COLUMN qualification_json LONGTEXT NULL AFTER intent"],
    ["confirmation_deadline", "ALTER TABLE appointment ADD COLUMN confirmation_deadline DATETIME NULL AFTER status"],
    ["attendance_status", "ALTER TABLE appointment ADD COLUMN attendance_status VARCHAR(24) NOT NULL DEFAULT 'pending' AFTER confirmation_deadline"],
    ["outcome_status", "ALTER TABLE appointment ADD COLUMN outcome_status VARCHAR(24) NOT NULL DEFAULT 'none' AFTER attendance_status"],
    ["outcome_note", "ALTER TABLE appointment ADD COLUMN outcome_note LONGTEXT NULL AFTER outcome_status"],
    ["contact_status", "ALTER TABLE appointment ADD COLUMN contact_status VARCHAR(24) NOT NULL DEFAULT 'uncontacted' AFTER outcome_note"],
    ["first_contacted_at", "ALTER TABLE appointment ADD COLUMN first_contacted_at DATETIME NULL AFTER contact_status"],
    ["next_followup_at", "ALTER TABLE appointment ADD COLUMN next_followup_at DATETIME NULL AFTER first_contacted_at"],
    ["estimated_commission", "ALTER TABLE appointment ADD COLUMN estimated_commission DECIMAL(14,2) NULL AFTER next_followup_at"],
    ["actual_commission", "ALTER TABLE appointment ADD COLUMN actual_commission DECIMAL(14,2) NULL AFTER estimated_commission"],
    ["case_reference", "ALTER TABLE appointment ADD COLUMN case_reference VARCHAR(160) NULL AFTER actual_commission"],
    // 2026-08-06 系統擁有者：「這個案件編號蠻難看的，可以設計一個有規則的嗎？」
    //   顯示用的人話編號（AP-260806-01）。`id` 是 32 碼亂數，被拿去算 Google 事件 ID
    //   與管理金鑰，動不得，所以另開一欄。case_reference 留給他填外部 CRM 編號，不佔用。
    //   ⚠️ 這份清單是用 COLUMN_NAME 判斷跑不跑的，只能放「加欄位」，不能放加索引。
    ["case_no", "ALTER TABLE appointment ADD COLUMN case_no VARCHAR(32) NULL AFTER case_reference"],
    ["ai_summary", "ALTER TABLE appointment ADD COLUMN ai_summary LONGTEXT NULL"],
    ["ai_next_action", "ALTER TABLE appointment ADD COLUMN ai_next_action LONGTEXT NULL"],
    ["ai_profile", "ALTER TABLE appointment ADD COLUMN ai_profile LONGTEXT NULL"],
    ["meet_url", "ALTER TABLE appointment ADD COLUMN meet_url TEXT NULL AFTER google_event_id"],
    ["calendar_sync_status", "ALTER TABLE appointment ADD COLUMN calendar_sync_status VARCHAR(24) NULL AFTER meet_url"],
    ["calendar_sync_error", "ALTER TABLE appointment ADD COLUMN calendar_sync_error TEXT NULL AFTER calendar_sync_status"],
    ["calendar_synced_at", "ALTER TABLE appointment ADD COLUMN calendar_synced_at DATETIME NULL AFTER calendar_sync_error"],
    ["customer_email_status", "ALTER TABLE appointment ADD COLUMN customer_email_status VARCHAR(24) NULL"],
    ["admin_email_status", "ALTER TABLE appointment ADD COLUMN admin_email_status VARCHAR(24) NULL"],
    ["line_notify_status", "ALTER TABLE appointment ADD COLUMN line_notify_status VARCHAR(24) NULL"],
    ["last_notify_error", "ALTER TABLE appointment ADD COLUMN last_notify_error TEXT NULL"],
    ["utm_source", "ALTER TABLE appointment ADD COLUMN utm_source VARCHAR(80) NULL"],
    ["utm_medium", "ALTER TABLE appointment ADD COLUMN utm_medium VARCHAR(80) NULL"],
    ["utm_campaign", "ALTER TABLE appointment ADD COLUMN utm_campaign VARCHAR(160) NULL"],
    ["utm_content", "ALTER TABLE appointment ADD COLUMN utm_content VARCHAR(160) NULL"],
    ["utm_term", "ALTER TABLE appointment ADD COLUMN utm_term VARCHAR(160) NULL"],
    ["referrer", "ALTER TABLE appointment ADD COLUMN referrer TEXT NULL"],
    ["user_agent", "ALTER TABLE appointment ADD COLUMN user_agent TEXT NULL"],
    ["device", "ALTER TABLE appointment ADD COLUMN device VARCHAR(32) NULL"],
    ["from_page", "ALTER TABLE appointment ADD COLUMN from_page VARCHAR(240) NULL"],
    ["funnel_session_id", "ALTER TABLE appointment ADD COLUMN funnel_session_id VARCHAR(80) NULL"],
    ["tracking_consent_receipt_id", "ALTER TABLE appointment ADD COLUMN tracking_consent_receipt_id CHAR(32) NULL"],
    ["tracking_consent_subject_id", "ALTER TABLE appointment ADD COLUMN tracking_consent_subject_id CHAR(32) NULL"],
    ["tracking_consent_version", "ALTER TABLE appointment ADD COLUMN tracking_consent_version VARCHAR(64) NULL"],
    ["analytics_consent_granted", "ALTER TABLE appointment ADD COLUMN analytics_consent_granted TINYINT(1) NOT NULL DEFAULT 0"],
    ["marketing_consent_granted", "ALTER TABLE appointment ADD COLUMN marketing_consent_granted TINYINT(1) NOT NULL DEFAULT 0"],
    ["tracking_consent_at", "ALTER TABLE appointment ADD COLUMN tracking_consent_at DATETIME(3) NULL"],
    ["ga_client_id", "ALTER TABLE appointment ADD COLUMN ga_client_id VARCHAR(200) NULL"],
    ["meta_fbp", "ALTER TABLE appointment ADD COLUMN meta_fbp VARCHAR(200) NULL"],
    ["meta_fbc", "ALTER TABLE appointment ADD COLUMN meta_fbc VARCHAR(200) NULL"],
    ["rate_limit_generation", "ALTER TABLE appointment ADD COLUMN rate_limit_generation BIGINT NOT NULL DEFAULT 0 AFTER meta_fbc"],
    ["idempotency_key", "ALTER TABLE appointment ADD COLUMN idempotency_key VARCHAR(100) NULL"],
    ["reminder_24h_sent_at", "ALTER TABLE appointment ADD COLUMN reminder_24h_sent_at TIMESTAMP NULL"],
    ["customer_reminder_24h_sent_at", "ALTER TABLE appointment ADD COLUMN customer_reminder_24h_sent_at TIMESTAMP NULL"],
    ["admin_reminder_24h_sent_at", "ALTER TABLE appointment ADD COLUMN admin_reminder_24h_sent_at TIMESTAMP NULL"],
  ];
  for (const [columnName, ddl] of additiveColumns) {
    try {
      const col = await db.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment' AND COLUMN_NAME = ?
          LIMIT 1`,
        columnName,
      );
      if (!Array.isArray(col) || col.length === 0) await db.$executeRawUnsafe(ddl);
    } catch (e) {
      console.error(`[appointment] ensure ${columnName} 欄失敗(忽略,可能已存在):`, e);
    }
  }
  try {
    const rows = await db.$queryRawUnsafe<Array<{ CHARACTER_MAXIMUM_LENGTH: bigint | number | null }>>(
      `SELECT CHARACTER_MAXIMUM_LENGTH
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment' AND COLUMN_NAME = 'status'
        LIMIT 1`,
    );
    if (Number(rows[0]?.CHARACTER_MAXIMUM_LENGTH || 0) < 24) {
      await db.$executeRawUnsafe(`ALTER TABLE appointment MODIFY COLUMN status VARCHAR(24) NOT NULL DEFAULT 'confirmed'`);
    }
  } catch (e) {
    console.error("[appointment] widen status 欄失敗:", e);
  }
  try {
    const rows = await db.$queryRawUnsafe<Array<{ CHARACTER_MAXIMUM_LENGTH: bigint | number | null }>>(
      `SELECT CHARACTER_MAXIMUM_LENGTH
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment' AND COLUMN_NAME = 'gender'
        LIMIT 1`,
    );
    if (Number(rows[0]?.CHARACTER_MAXIMUM_LENGTH || 0) < 16) {
      await db.$executeRawUnsafe(`ALTER TABLE appointment MODIFY COLUMN gender VARCHAR(16) NOT NULL DEFAULT ''`);
    }
  } catch (e) {
    console.error("[appointment] widen gender failed:", e);
  }
  const appointmentIndexes: Array<[string, string]> = [
    ["appointment_idempotency_uid", "CREATE UNIQUE INDEX appointment_idempotency_uid ON appointment (idempotency_key)"],
    ["appointment_case_no_uid", "CREATE UNIQUE INDEX appointment_case_no_uid ON appointment (case_no)"],
    ["appointment_attendance_slot_idx", "CREATE INDEX appointment_attendance_slot_idx ON appointment (attendance_status, slot_at)"],
    ["appointment_followup_due_idx", "CREATE INDEX appointment_followup_due_idx ON appointment (contact_status, next_followup_at)"],
  ];
  for (const [indexName, ddl] of appointmentIndexes) {
    try {
      const rows = await db.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment' AND INDEX_NAME = ?
          LIMIT 1`,
        indexName,
      );
      if (!Array.isArray(rows) || rows.length === 0) await db.$executeRawUnsafe(ddl);
    } catch (e) {
      console.error(`[appointment] ensure ${indexName} 索引失敗:`, e);
    }
  }
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS appointment_case_sequence (
      case_day   CHAR(6)   NOT NULL,
      last_seq   INT       NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (case_day)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // ---- 撞號終極防線:slot lock 表(2026-07-03,對抗覆檢後定案)----
  // 為何不用生成欄:TiDB 不支援 ALTER TABLE 加 STORED 生成欄(官方明文 + pingcap/tidb#9288),會靜默失效。
  // 設計:一筆預約實際佔用的「每一個整點小時」各插一列 lock,PK(slot_at)全域唯一 → 任何時段重疊(含多格連約
  //   14:00-17:00 vs 15:00-16:00 這種不同起點)都會在 INSERT 撞 PK。createAppointment 交易內逐格 INSERT,
  //   撞到就整筆 rollback 丟 AppointmentSlotConflictError;取消 / 改期同步刪 / 重建 lock。TiDB 對純表 + PK 完整支援。
  const lockExisted = await db.$queryRawUnsafe<unknown[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment_slot_lock' LIMIT 1`,
  );
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS appointment_slot_lock (
      slot_at        DATETIME     NOT NULL,
      appointment_id VARCHAR(64)  NOT NULL,
      created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (slot_at),
      KEY appointment_slot_lock_appt_idx (appointment_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // 一次性 backfill(僅在本次剛建表時跑一次):既有 confirmed 未來預約逐格補 lock。
  //   INSERT IGNORE 跳過既有撞號,best-effort、不炸(既有雙約留原狀,不新增保護那格,但至少擋掉之後的新撞號)。
  if (!Array.isArray(lockExisted) || lockExisted.length === 0) {
    try {
      // 以「終點」過濾(非起點):跨整點的在途預約(23:00→01:00、NOW=23:30)起點已過但仍佔用未來整點 00:00,
      //   用 slot_at>=NOW() 會漏掉它 → 該格建表後可被雙約。改用 COALESCE(slot_end_at, slot_at+slotMin) > NOW()。
      const future = await db.$queryRawUnsafe<Array<{ id: string; slot_at: Date; slot_end_at: Date | null }>>(
        `SELECT id, slot_at, slot_end_at FROM appointment
          WHERE status = 'confirmed'
            AND COALESCE(slot_end_at, DATE_ADD(slot_at, INTERVAL ${BOOKING_RULES.slotMinutes} MINUTE)) > NOW()`,
      );
      for (const a of future) {
        for (const h of occupiedSlotHours(new Date(a.slot_at), a.slot_end_at ? new Date(a.slot_end_at) : null)) {
          await db.$executeRaw`INSERT IGNORE INTO appointment_slot_lock (slot_at, appointment_id) VALUES (${h}, ${a.id})`;
        }
      }
    } catch (e) {
      console.error("[appointment] slot_lock backfill 失敗(忽略,不影響既有流程):", e);
    }
  }
  // 2026-07-17：15 分鐘格 migration。既有預約當初是用「整點鎖」建的（slotMinutes 曾=60，只鎖 :00），
  //   改 15 分鐘後這些既有未來預約缺 :15/:30/:45 的鎖 → 新 15 分預約可能與舊整點預約雙約。
  //   這裡對「未來 confirmed 預約」逐 15 分格補鎖（INSERT IGNORE 冪等、自癒；未來預約數量有限，每 instance 冷啟跑一次）。
  //   NULL slot_end_at（更早期資料）視為 1 小時（歷史預設）以免補鎖不足。
  //   ⚠️ 一次性：用 slot_lock 表的哨兵列當 guard，跑完就標記，之後冷啟直接跳過（不佔熱路徑）。
  try {
    const MIGRATION_MARKER_ID = "__grid15_migrated__";
    const marker = await db.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM appointment_slot_lock WHERE appointment_id = ? LIMIT 1`,
      MIGRATION_MARKER_ID,
    );
    if (!Array.isArray(marker) || marker.length === 0) {
      const future = await db.$queryRawUnsafe<Array<{ id: string; slot_at: Date; slot_end_at: Date | null }>>(
        `SELECT id, slot_at, slot_end_at FROM appointment
          WHERE status = 'confirmed'
            AND COALESCE(slot_end_at, DATE_ADD(slot_at, INTERVAL 60 MINUTE)) > NOW()`,
      );
      const gridMs = BOOKING_RULES.slotMinutes * 60_000;
      for (const a of future) {
        const start = new Date(a.slot_at).getTime();
        const end = a.slot_end_at ? new Date(a.slot_end_at).getTime() : start + 60 * 60_000;
        for (let t = start; t < end; t += gridMs) {
          await db.$executeRaw`INSERT IGNORE INTO appointment_slot_lock (slot_at, appointment_id) VALUES (${new Date(t)}, ${a.id})`;
        }
      }
      // 哨兵標記（sentinel slot_at=1970-01-01T00:00:15Z，永不與真實時段撞）→ 之後冷啟不再重跑
      await db.$executeRaw`INSERT IGNORE INTO appointment_slot_lock (slot_at, appointment_id) VALUES (${new Date(15_000)}, ${MIGRATION_MARKER_ID})`;
    }
  } catch (e) {
    console.error("[appointment] 15 分鐘格補鎖 migration 失敗(忽略):", e);
  }
  try {
    const BUFFER_MARKER_ID = "__meeting_buffers_v2__";
    const marker = await db.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM appointment_slot_lock WHERE appointment_id = ? LIMIT 1`,
      BUFFER_MARKER_ID,
    );
    if (!Array.isArray(marker) || marker.length === 0) {
      const future = await db.$queryRawUnsafe<Array<{
        id: string;
        slot_at: Date;
        slot_end_at: Date | null;
        meet_type: string;
      }>>(
        `SELECT id, slot_at, slot_end_at, meet_type FROM appointment
          WHERE status IN ('confirmed', 'pending_confirmation')
            AND COALESCE(slot_end_at, DATE_ADD(slot_at, INTERVAL 60 MINUTE)) > NOW()`,
      );
      for (const appointment of future) {
        const policy = appointmentMeetingPolicy(appointment.meet_type);
        const locks = occupiedSlotHours(
          new Date(appointment.slot_at),
          appointment.slot_end_at ? new Date(appointment.slot_end_at) : null,
          { beforeMin: policy.bufferBeforeMin, afterMin: policy.bufferAfterMin },
        );
        for (const lockAt of locks) {
          await db.$executeRaw`INSERT IGNORE INTO appointment_slot_lock (slot_at, appointment_id) VALUES (${lockAt}, ${appointment.id})`;
        }
      }
      await db.$executeRaw`INSERT IGNORE INTO appointment_slot_lock (slot_at, appointment_id) VALUES (${new Date(30_000)}, ${BUFFER_MARKER_ID})`;
    }
  } catch (e) {
    console.error("[appointment] meeting buffer 補鎖 migration 失敗:", e);
  }
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS appointment_notification_log (
      id             VARCHAR(64)  NOT NULL,
      appointment_id VARCHAR(64)  NOT NULL,
      purpose        VARCHAR(40)  NOT NULL,
      channel        VARCHAR(16)  NOT NULL,
      recipient      VARCHAR(200) NULL,
      status         VARCHAR(24)  NOT NULL,
      provider       VARCHAR(24)  NULL,
      message_id     VARCHAR(200) NULL,
      error          TEXT         NULL,
      created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY appointment_notification_appointment_idx (appointment_id, created_at),
      KEY appointment_notification_status_idx (status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS appointment_funnel_event (
      id           VARCHAR(64)  NOT NULL,
      session_id   VARCHAR(80)  NOT NULL,
      appointment_id VARCHAR(64) NULL,
      event        VARCHAR(40)  NOT NULL,
      detail       VARCHAR(200) NULL,
      utm_source   VARCHAR(80)  NULL,
      utm_medium   VARCHAR(80)  NULL,
      utm_campaign VARCHAR(160) NULL,
      utm_content  VARCHAR(160) NULL,
      utm_term     VARCHAR(160) NULL,
      booking_mode VARCHAR(24)  NULL,
      from_page    VARCHAR(240) NULL,
      device       VARCHAR(32)  NULL,
      created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY appointment_funnel_created_idx (created_at),
      KEY appointment_funnel_event_idx (event, created_at),
      KEY appointment_funnel_session_idx (session_id, created_at),
      KEY appointment_funnel_appointment_idx (appointment_id, created_at),
      KEY appointment_funnel_campaign_idx (utm_campaign, event, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const funnelColumns: Array<[string, string]> = [
    ["appointment_id", "ALTER TABLE appointment_funnel_event ADD COLUMN appointment_id VARCHAR(64) NULL AFTER session_id"],
    ["from_page", "ALTER TABLE appointment_funnel_event ADD COLUMN from_page VARCHAR(240) NULL AFTER utm_term"],
    ["utm_medium", "ALTER TABLE appointment_funnel_event ADD COLUMN utm_medium VARCHAR(80) NULL AFTER utm_source"],
    ["utm_campaign", "ALTER TABLE appointment_funnel_event ADD COLUMN utm_campaign VARCHAR(160) NULL AFTER utm_medium"],
    ["utm_content", "ALTER TABLE appointment_funnel_event ADD COLUMN utm_content VARCHAR(160) NULL AFTER utm_campaign"],
    ["utm_term", "ALTER TABLE appointment_funnel_event ADD COLUMN utm_term VARCHAR(160) NULL AFTER utm_content"],
    ["booking_mode", "ALTER TABLE appointment_funnel_event ADD COLUMN booking_mode VARCHAR(24) NULL AFTER utm_term"],
  ];
  for (const [columnName, ddl] of funnelColumns) {
    try {
      const rows = await db.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment_funnel_event' AND COLUMN_NAME = ?
          LIMIT 1`,
        columnName,
      );
      if (!Array.isArray(rows) || rows.length === 0) await db.$executeRawUnsafe(ddl);
    } catch (e) {
      console.error(`[appointment] ensure appointment_funnel_event.${columnName} 欄失敗:`, e);
    }
  }
  const funnelIndexes: Array<[string, string]> = [
    ["appointment_funnel_appointment_idx", "CREATE INDEX appointment_funnel_appointment_idx ON appointment_funnel_event (appointment_id, created_at)"],
    ["appointment_funnel_campaign_idx", "CREATE INDEX appointment_funnel_campaign_idx ON appointment_funnel_event (utm_campaign, event, created_at)"],
  ];
  for (const [indexName, ddl] of funnelIndexes) {
    try {
      const rows = await db.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment_funnel_event' AND INDEX_NAME = ?
          LIMIT 1`,
        indexName,
      );
      if (!Array.isArray(rows) || rows.length === 0) await db.$executeRawUnsafe(ddl);
    } catch (e) {
      console.error(`[appointment] ensure ${indexName} 索引失敗:`, e);
    }
  }
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS appointment_followup (
      id             VARCHAR(64)  NOT NULL,
      appointment_id VARCHAR(64)  NOT NULL,
      status         VARCHAR(24)  NOT NULL DEFAULT 'open',
      title          VARCHAR(160) NOT NULL,
      customer_name  VARCHAR(80)  NOT NULL,
      phone          VARCHAR(40)  NULL,
      email          VARCHAR(160) NULL,
      line_id        VARCHAR(120) NULL,
      intent         LONGTEXT     NULL,
      note           LONGTEXT     NULL,
      next_action    LONGTEXT     NULL,
      owner          VARCHAR(120) NULL,
      due_at         DATETIME     NULL,
      completed_at   DATETIME     NULL,
      result         VARCHAR(40)  NULL,
      source         VARCHAR(240) NULL,
      created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMP    NULL,
      PRIMARY KEY (id),
      UNIQUE KEY appointment_followup_appointment_uid (appointment_id),
      KEY appointment_followup_status_idx (status, created_at),
      KEY appointment_followup_due_idx (status, due_at),
      KEY appointment_followup_created_idx (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const followupColumns: Array<[string, string]> = [
    ["owner", "ALTER TABLE appointment_followup ADD COLUMN owner VARCHAR(120) NULL AFTER next_action"],
    ["due_at", "ALTER TABLE appointment_followup ADD COLUMN due_at DATETIME NULL AFTER owner"],
    ["completed_at", "ALTER TABLE appointment_followup ADD COLUMN completed_at DATETIME NULL AFTER due_at"],
    ["result", "ALTER TABLE appointment_followup ADD COLUMN result VARCHAR(40) NULL AFTER completed_at"],
  ];
  for (const [columnName, ddl] of followupColumns) {
    try {
      const rows = await db.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment_followup' AND COLUMN_NAME = ?
          LIMIT 1`,
        columnName,
      );
      if (!Array.isArray(rows) || rows.length === 0) await db.$executeRawUnsafe(ddl);
    } catch (e) {
      console.error(`[appointment] ensure appointment_followup.${columnName} 欄失敗:`, e);
    }
  }
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS appointment_location_approval (
      id                  VARCHAR(64)  NOT NULL,
      token_hash          CHAR(64)     NOT NULL,
      customer_hint       VARCHAR(120) NULL,
      location_json       TEXT         NULL,
      customer_phone_hash CHAR(64)     NULL,
      customer_email_hash CHAR(64)     NULL,
      allowed_start_at    DATETIME     NULL,
      allowed_end_at      DATETIME     NULL,
      approved_duration_min INT        NULL,
      created_by          VARCHAR(160) NULL,
      expires_at          DATETIME     NOT NULL,
      used_at             DATETIME     NULL,
      used_appointment_id VARCHAR(64)  NULL,
      revoked_at          DATETIME     NULL,
      revoke_reason       VARCHAR(240) NULL,
      created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY appointment_location_approval_token_uid (token_hash),
      KEY appointment_location_approval_active_idx (revoked_at, used_at, expires_at),
      KEY appointment_location_approval_appointment_idx (used_appointment_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const approvalColumns: Array<[string, string]> = [
    ["location_json", "ALTER TABLE appointment_location_approval ADD COLUMN location_json TEXT NULL AFTER customer_hint"],
    ["customer_phone_hash", "ALTER TABLE appointment_location_approval ADD COLUMN customer_phone_hash CHAR(64) NULL AFTER location_json"],
    ["customer_email_hash", "ALTER TABLE appointment_location_approval ADD COLUMN customer_email_hash CHAR(64) NULL AFTER customer_phone_hash"],
    ["allowed_start_at", "ALTER TABLE appointment_location_approval ADD COLUMN allowed_start_at DATETIME NULL AFTER customer_email_hash"],
    ["allowed_end_at", "ALTER TABLE appointment_location_approval ADD COLUMN allowed_end_at DATETIME NULL AFTER allowed_start_at"],
    ["approved_duration_min", "ALTER TABLE appointment_location_approval ADD COLUMN approved_duration_min INT NULL AFTER allowed_end_at"],
    ["revoked_at", "ALTER TABLE appointment_location_approval ADD COLUMN revoked_at DATETIME NULL AFTER used_appointment_id"],
    ["revoke_reason", "ALTER TABLE appointment_location_approval ADD COLUMN revoke_reason VARCHAR(240) NULL AFTER revoked_at"],
  ];
  for (const [columnName, ddl] of approvalColumns) {
    try {
      const rows = await db.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment_location_approval' AND COLUMN_NAME = ?
          LIMIT 1`,
        columnName,
      );
      if (!Array.isArray(rows) || rows.length === 0) await db.$executeRawUnsafe(ddl);
    } catch (e) {
      console.error(`[appointment] ensure appointment_location_approval.${columnName} 欄失敗:`, e);
    }
  }
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS appointment_outbox (
      id              VARCHAR(64)  NOT NULL,
      appointment_id  VARCHAR(64)  NOT NULL,
      task_type       VARCHAR(40)  NOT NULL,
      payload_json    LONGTEXT     NULL,
      status          VARCHAR(24)  NOT NULL DEFAULT 'pending',
      attempts        INT          NOT NULL DEFAULT 0,
      next_attempt_at DATETIME     NOT NULL,
      locked_at       DATETIME     NULL,
      last_error      TEXT         NULL,
      dedupe_key      VARCHAR(160) NOT NULL,
      provider        VARCHAR(24)  NULL,
      event_id        VARCHAR(80)  NULL,
      event_name      VARCHAR(80)  NULL,
      occurred_at     DATETIME(3)  NULL,
      consent_receipt_id CHAR(32)  NULL,
      payload_hash    CHAR(64)     NULL,
      last_http_status INT         NULL,
      provider_request_id VARCHAR(160) NULL,
      events_received INT          NULL,
      accepted_at     DATETIME(3)  NULL,
      final_reason    VARCHAR(240) NULL,
      created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP    NULL,
      PRIMARY KEY (id),
      UNIQUE KEY appointment_outbox_dedupe_uid (dedupe_key),
      KEY appointment_outbox_due_idx (status, next_attempt_at),
      KEY appointment_outbox_appointment_idx (appointment_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const outboxColumns: Array<[string, string]> = [
    ["provider", "ALTER TABLE appointment_outbox ADD COLUMN provider VARCHAR(24) NULL"],
    ["event_id", "ALTER TABLE appointment_outbox ADD COLUMN event_id VARCHAR(80) NULL"],
    ["event_name", "ALTER TABLE appointment_outbox ADD COLUMN event_name VARCHAR(80) NULL"],
    ["occurred_at", "ALTER TABLE appointment_outbox ADD COLUMN occurred_at DATETIME(3) NULL"],
    ["consent_receipt_id", "ALTER TABLE appointment_outbox ADD COLUMN consent_receipt_id CHAR(32) NULL"],
    ["payload_hash", "ALTER TABLE appointment_outbox ADD COLUMN payload_hash CHAR(64) NULL"],
    ["last_http_status", "ALTER TABLE appointment_outbox ADD COLUMN last_http_status INT NULL"],
    ["provider_request_id", "ALTER TABLE appointment_outbox ADD COLUMN provider_request_id VARCHAR(160) NULL"],
    ["events_received", "ALTER TABLE appointment_outbox ADD COLUMN events_received INT NULL"],
    ["accepted_at", "ALTER TABLE appointment_outbox ADD COLUMN accepted_at DATETIME(3) NULL"],
    ["final_reason", "ALTER TABLE appointment_outbox ADD COLUMN final_reason VARCHAR(240) NULL"],
  ];
  for (const [columnName, ddl] of outboxColumns) {
    try {
      const rows = await db.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment_outbox' AND COLUMN_NAME = ?
          LIMIT 1`,
        columnName,
      );
      if (!Array.isArray(rows) || rows.length === 0) await db.$executeRawUnsafe(ddl);
    } catch (error) {
      console.error(`[appointment] ensure appointment_outbox.${columnName} failed:`, error);
    }
  }
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS appointment_rate_limit (
      bucket_key   CHAR(64)    NOT NULL,
      window_start DATETIME    NOT NULL,
      bucket_kind  VARCHAR(32) NOT NULL DEFAULT 'legacy',
      hit_count    INT         NOT NULL DEFAULT 1,
      limit_snapshot INT       NULL,
      blocked_at   DATETIME(3) NULL,
      blocked_until DATETIME(3) NULL,
      expires_at   DATETIME    NOT NULL,
      updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (bucket_key, window_start),
      KEY appointment_rate_limit_expiry_idx (expires_at),
      KEY appointment_rate_limit_blocked_idx (bucket_kind, blocked_until)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const rateLimitColumns: Array<[string, string]> = [
    ["bucket_kind", "ALTER TABLE appointment_rate_limit ADD COLUMN bucket_kind VARCHAR(32) NOT NULL DEFAULT 'legacy' AFTER window_start"],
    ["limit_snapshot", "ALTER TABLE appointment_rate_limit ADD COLUMN limit_snapshot INT NULL AFTER hit_count"],
    ["blocked_at", "ALTER TABLE appointment_rate_limit ADD COLUMN blocked_at DATETIME(3) NULL AFTER limit_snapshot"],
    ["blocked_until", "ALTER TABLE appointment_rate_limit ADD COLUMN blocked_until DATETIME(3) NULL AFTER blocked_at"],
  ];
  for (const [columnName, ddl] of rateLimitColumns) {
    try {
      const rows = await db.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment_rate_limit' AND COLUMN_NAME = ?
          LIMIT 1`,
        columnName,
      );
      if (!Array.isArray(rows) || rows.length === 0) await db.$executeRawUnsafe(ddl);
    } catch (error) {
      console.error(`[appointment] ensure appointment_rate_limit.${columnName} failed:`, error);
    }
  }
  try {
    const rows = await db.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointment_rate_limit'
          AND INDEX_NAME = 'appointment_rate_limit_blocked_idx'
        LIMIT 1`,
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      await db.$executeRawUnsafe(
        `CREATE INDEX appointment_rate_limit_blocked_idx ON appointment_rate_limit (bucket_kind, blocked_until)`,
      );
    }
  } catch (error) {
    console.error("[appointment] ensure appointment_rate_limit_blocked_idx failed:", error);
  }
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS appointment_rate_limit_state (
      scope_key   VARCHAR(32) NOT NULL,
      generation  BIGINT      NOT NULL DEFAULT 0,
      cleared_at  DATETIME(3) NULL,
      updated_by  VARCHAR(160) NULL,
      updated_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (scope_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO appointment_rate_limit_state (scope_key, generation)
    VALUES ('all', 0)
    ON DUPLICATE KEY UPDATE scope_key = VALUES(scope_key)
  `);
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS appointment_rate_limit_clear_audit (
      id                   CHAR(32)     NOT NULL,
      scope_key            VARCHAR(32)  NOT NULL DEFAULT 'all',
      generation           BIGINT       NOT NULL,
      cleared_at           DATETIME(3)  NOT NULL,
      cleared_bucket_count INT          NOT NULL DEFAULT 0,
      created_by           VARCHAR(160) NULL,
      reason               VARCHAR(240) NULL,
      PRIMARY KEY (id),
      KEY appointment_rate_limit_clear_scope_idx (scope_key, generation),
      KEY appointment_rate_limit_clear_time_idx (cleared_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tableEnsured = true;
}

export async function createCustomLocationApproval(input: {
  customerHint?: string | null;
  createdBy?: string | null;
  location?: MeetLocation | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  allowedStartAt?: Date | null;
  allowedEndAt?: Date | null;
  approvedDurationMin?: number | null;
}): Promise<{ token: string; expiresAt: Date; id: string }> {
  await ensureAppointmentTable();
  const token = randomBytes(24).toString("base64url");
  const id = randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + CUSTOM_LOCATION_APPROVAL_HOURS * 60 * 60_000);
  const locationJson = input.location ? JSON.stringify(input.location) : null;
  await db.$executeRaw`
    INSERT INTO appointment_location_approval
      (id, token_hash, customer_hint, location_json, customer_phone_hash, customer_email_hash,
       allowed_start_at, allowed_end_at, approved_duration_min, created_by, expires_at)
    VALUES
      (${id}, ${hashCustomLocationApprovalToken(token)}, ${input.customerHint?.trim().slice(0, 120) || null},
       ${locationJson}, ${hashAppointmentContact(input.customerPhone)}, ${hashAppointmentContact(input.customerEmail)},
       ${input.allowedStartAt || null}, ${input.allowedEndAt || null}, ${input.approvedDurationMin || null},
       ${input.createdBy?.trim().slice(0, 160) || null}, ${expiresAt})
  `;
  return { token, expiresAt, id };
}

export async function getCustomLocationApproval(token: string): Promise<AppointmentLocationApprovalRow | null> {
  const normalized = normalizeCustomLocationApprovalToken(token);
  if (!normalized) return null;
  await ensureAppointmentTable();
  const rows = await db.$queryRaw<AppointmentLocationApprovalRow[]>`
    SELECT id, customer_hint, location_json, customer_phone_hash, customer_email_hash,
           allowed_start_at, allowed_end_at, approved_duration_min, expires_at, used_at,
           used_appointment_id, revoked_at, revoke_reason, created_by, created_at
      FROM appointment_location_approval
     WHERE token_hash = ${hashCustomLocationApprovalToken(normalized)}
       AND used_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > NOW()
     LIMIT 1
  `;
  return rows[0] || null;
}

export async function isCustomLocationApprovalValid(token: string): Promise<boolean> {
  return Boolean(await getCustomLocationApproval(token));
}

export async function listCustomLocationApprovals(limit = 100): Promise<AppointmentLocationApprovalRow[]> {
  await ensureAppointmentTable();
  const safeLimit = Math.max(1, Math.min(limit, 300));
  return db.$queryRaw<AppointmentLocationApprovalRow[]>`
    SELECT id, customer_hint, location_json, customer_phone_hash, customer_email_hash,
           allowed_start_at, allowed_end_at, approved_duration_min, expires_at, used_at,
           used_appointment_id, revoked_at, revoke_reason, created_by, created_at
      FROM appointment_location_approval
     ORDER BY created_at DESC
     LIMIT ${safeLimit}
  `;
}

export async function revokeCustomLocationApproval(id: string, reason?: string | null): Promise<boolean> {
  await ensureAppointmentTable();
  const affected = await db.$executeRaw`
    UPDATE appointment_location_approval
       SET revoked_at = NOW(), revoke_reason = ${reason?.trim().slice(0, 240) || null}
     WHERE id = ${id}
       AND used_at IS NULL
       AND revoked_at IS NULL
  `;
  return Number(affected) === 1;
}

// ---- 建立預約 ----
export async function createAppointment(data: {
  id: string;
  bookingMode?: BookingMode;
  name: string;
  gender: string;
  phone: string;
  email: string;
  lineId?: string | null;
  meetType: string;
  /** 客戶自訂見面地點 JSON(MeetLocation 字串化);非 custom 為 null。2026-06-25 */
  meetLocation?: string | null;
  /** 茗馥核准自訂地點後產生的一次性 token；只有 meetType=custom 才會核銷。 */
  customLocationApprovalToken?: string | null;
  intent?: string[] | null;
  qualification?: AppointmentQualification | null;
  urgency?: string | null;
  note?: string | null;
  slotAt: Date;
  slotEndAt?: Date | null;
  source?: string | null;
  idempotencyKey?: string | null;
  requireConfirmation?: boolean;
  tracking?: AppointmentTrackingInput | null;
  trackingConsent?: AppointmentConsentInput | null;
}): Promise<{ status: "pending_confirmation" | "confirmed"; confirmationDeadline: Date | null }> {
  await ensureAppointmentTable();
  const intentJson = data.intent && data.intent.length ? JSON.stringify(data.intent) : null;
  const qualificationJson = data.qualification ? JSON.stringify(data.qualification) : null;
  const policy = appointmentMeetingPolicy(data.meetType);
  const hours = occupiedSlotHours(data.slotAt, data.slotEndAt ?? null, {
    beforeMin: policy.bufferBeforeMin,
    afterMin: policy.bufferAfterMin,
  });
  const status = data.requireConfirmation === false ? "confirmed" : "pending_confirmation";
  const confirmationDeadline = status === "pending_confirmation"
    ? new Date(Date.now() + BOOKING_CONFIRMATION_HOLD_MINUTES * 60_000)
    : null;
  try {
    await db.$transaction(async (tx) => {
      let approvedMeetLocation = data.meetLocation || null;
      if (data.meetType === "custom") {
        const approvalToken = normalizeCustomLocationApprovalToken(data.customLocationApprovalToken || "");
        if (!approvalToken) throw new AppointmentLocationApprovalError();
        const approvals = await tx.$queryRaw<AppointmentLocationApprovalRow[]>`
          SELECT id, customer_hint, location_json, customer_phone_hash, customer_email_hash,
                 allowed_start_at, allowed_end_at, approved_duration_min, expires_at, used_at,
                 used_appointment_id, revoked_at, revoke_reason, created_by, created_at
            FROM appointment_location_approval
           WHERE token_hash = ${hashCustomLocationApprovalToken(approvalToken)}
             AND used_at IS NULL
             AND revoked_at IS NULL
             AND expires_at > NOW()
           LIMIT 1
        `;
        const approval = approvals[0];
        if (!approval?.location_json) throw new AppointmentLocationApprovalError("approved_location_missing");
        const durationMin = Math.round(((data.slotEndAt?.getTime() || data.slotAt.getTime()) - data.slotAt.getTime()) / 60_000);
        if (approval.customer_phone_hash && approval.customer_phone_hash !== hashAppointmentContact(data.phone)) {
          throw new AppointmentLocationApprovalError("approved_customer_mismatch");
        }
        if (approval.customer_email_hash && approval.customer_email_hash !== hashAppointmentContact(data.email)) {
          throw new AppointmentLocationApprovalError("approved_customer_mismatch");
        }
        if (approval.allowed_start_at && data.slotAt < new Date(approval.allowed_start_at)) {
          throw new AppointmentLocationApprovalError("approved_time_mismatch");
        }
        if (approval.allowed_end_at && (data.slotEndAt || data.slotAt) > new Date(approval.allowed_end_at)) {
          throw new AppointmentLocationApprovalError("approved_time_mismatch");
        }
        if (approval.approved_duration_min && durationMin !== approval.approved_duration_min) {
          throw new AppointmentLocationApprovalError("approved_duration_mismatch");
        }
        approvedMeetLocation = approval.location_json;
        const affected = await tx.$executeRaw`
          UPDATE appointment_location_approval
             SET used_at = NOW(), used_appointment_id = ${data.id}
           WHERE id = ${approval.id}
             AND used_at IS NULL
             AND revoked_at IS NULL
             AND expires_at > NOW()
        `;
        if (Number(affected) !== 1) throw new AppointmentLocationApprovalError();
      }
      // 先逐格搶 slot lock:任一格已被佔 → PK(slot_at)撞 → 整筆 rollback。
      //   這一步在 DB 交易內原子地取代舊的「isSlotTaken 先查、createAppointment 後寫」TOCTOU 併發窗。
      for (const h of hours) {
        await tx.$executeRaw`INSERT INTO appointment_slot_lock (slot_at, appointment_id) VALUES (${h}, ${data.id})`;
      }
      await tx.$executeRaw`
        INSERT INTO appointment
          (id, booking_mode, name, gender, phone, email, line_id, meet_type, meet_location, intent, qualification_json,
           urgency, note, slot_at, slot_end_at, status, confirmation_deadline, attendance_status, contact_status,
           source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer, user_agent, device, from_page,
           funnel_session_id, tracking_consent_receipt_id, tracking_consent_subject_id, tracking_consent_version,
           analytics_consent_granted, marketing_consent_granted, tracking_consent_at, ga_client_id, meta_fbp, meta_fbc,
           rate_limit_generation, idempotency_key)
        VALUES
          (${data.id}, ${data.bookingMode || "realtor"}, ${data.name}, ${data.gender}, ${data.phone}, ${data.email}, ${data.lineId || null},
           ${data.meetType}, ${approvedMeetLocation}, ${intentJson}, ${qualificationJson}, ${data.urgency || null},
           ${data.note || null}, ${data.slotAt}, ${data.slotEndAt || null}, ${status}, ${confirmationDeadline}, 'pending', 'uncontacted',
           ${data.source || "card"}, ${data.tracking?.utmSource || null}, ${data.tracking?.utmMedium || null},
           ${data.tracking?.utmCampaign || null}, ${data.tracking?.utmContent || null}, ${data.tracking?.utmTerm || null},
           ${data.tracking?.referrer || null}, ${data.tracking?.userAgent || null}, ${data.tracking?.device || null},
           ${data.tracking?.fromPage || null}, ${data.tracking?.funnelSessionId || null},
           ${data.trackingConsent?.receiptId || null}, ${data.trackingConsent?.subjectId || null},
           ${data.trackingConsent?.version || null}, ${data.trackingConsent?.analyticsGranted || false},
           ${data.trackingConsent?.marketingGranted || false}, ${data.trackingConsent?.decidedAt || null},
           ${data.trackingConsent?.gaClientId || null}, ${data.trackingConsent?.fbp || null},
           ${data.trackingConsent?.fbc || null},
           COALESCE((SELECT generation FROM appointment_rate_limit_state WHERE scope_key = 'all'), 0),
           ${data.idempotencyKey || null})
      `;
    });
  } catch (e) {
    if (e instanceof AppointmentLocationApprovalError) throw e;
    const message = String((e as { message?: string })?.message || e || "");
    if (/appointment_idempotency_uid|idempotency_key/i.test(message)) {
      throw new AppointmentIdempotencyConflictError();
    }
    // slot lock PK 撞 / 併發鎖爭用 = 該時段剛被別人約走 → 轉成 409(route 捕捉)。其餘錯誤原樣拋出。
    if (isTransientSlotConflict(e)) throw new AppointmentSlotConflictError();
    throw e;
  }
  return { status, confirmationDeadline };
}

export async function hasRecentAppointmentContact(email: string, phone: string, windowMs: number): Promise<boolean> {
  await ensureAppointmentTable();
  const since = new Date(Date.now() - windowMs);
  const rows = await db.$queryRawUnsafe<{ c: bigint }[]>(
    `SELECT COUNT(*) AS c
      FROM appointment
      WHERE created_at >= ?
        AND rate_limit_generation = COALESCE(
          (SELECT generation FROM appointment_rate_limit_state WHERE scope_key = 'all'),
          0
        )
        AND status NOT IN ('cancelled', 'expired')
        AND (email = ? OR phone = ?)
      LIMIT 1`,
    since,
    email,
    phone,
  );
  return Number(rows[0]?.c || 0) > 0;
}

/** 某時段是否已被佔（confirmed）— 防同格重複（並發靠 DB slot lock 硬約束再保證）。
 *  excludeId:改期時排除「自己的舊 row」,否則與自己舊時段重疊的改期(14-16 改 15-17)會誤判自撞、永遠 409。 */
export async function isSlotTaken(slotAt: Date, excludeId?: string): Promise<boolean> {
  await ensureAppointmentTable();
  const rows = await db.$queryRawUnsafe<{ c: bigint }[]>(
    `SELECT COUNT(*) AS c
       FROM appointment_slot_lock
      WHERE slot_at = ?
        AND appointment_id NOT LIKE '__%'
        ${excludeId ? "AND appointment_id <> ?" : ""}`,
    ...(excludeId ? [slotAt, excludeId] : [slotAt]),
  );
  return Number(rows[0]?.c || 0) > 0;
}

/** 未來已佔時段（給前台算可約空檔扣除）*/
export async function getBookedSlots(from: Date, to: Date): Promise<Date[]> {
  await ensureAppointmentTable();
  const rows = await db.$queryRawUnsafe<{ slot_at: Date }[]>(
    `SELECT slot_at
       FROM appointment_slot_lock
      WHERE slot_at >= ?
        AND slot_at < ?
        AND appointment_id NOT LIKE '__%'
      ORDER BY slot_at ASC`,
    from,
    to,
  );
  return rows.map((row) => new Date(row.slot_at));
}

// ---- 後台 ----
export type AppointmentQueue =
  | "all"
  | "today"
  | "pending_confirmation"
  | "overdue_contact"
  | "followup_due"
  | "sync_failed"
  | "outcome_pending";

export async function listAppointments(opts?: {
  status?: string;
  queue?: AppointmentQueue;
  search?: string;
  limit?: number;
}): Promise<AppointmentRow[]> {
  await ensureAppointmentTable();
  const limit = Math.min(opts?.limit || 200, 500);
  const filters: string[] = ["1=1"];
  const params: unknown[] = [];
  if (opts?.status && opts.status !== "all") {
    filters.push("status = ?");
    params.push(opts.status);
  }
  const queue = opts?.queue || "all";
  if (queue === "today") {
    const twNow = new Date(Date.now() + 8 * 60 * 60_000);
    const startUtc = new Date(Date.UTC(
      twNow.getUTCFullYear(),
      twNow.getUTCMonth(),
      twNow.getUTCDate(),
    ) - 8 * 60 * 60_000);
    const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60_000);
    filters.push("slot_at >= ? AND slot_at < ?");
    params.push(startUtc, endUtc);
    filters.push("status IN ('pending_confirmation', 'confirmed', 'completed')");
  } else if (queue === "pending_confirmation") {
    filters.push("status = 'pending_confirmation'");
  } else if (queue === "overdue_contact") {
    filters.push("contact_status = 'uncontacted'");
    filters.push("created_at < DATE_SUB(NOW(), INTERVAL 2 HOUR)");
    filters.push("status NOT IN ('cancelled', 'expired')");
  } else if (queue === "followup_due") {
    filters.push("next_followup_at IS NOT NULL AND next_followup_at <= NOW()");
    filters.push("contact_status <> 'closed'");
  } else if (queue === "sync_failed") {
    filters.push("(calendar_sync_status = 'failed' OR last_notify_error IS NOT NULL)");
  } else if (queue === "outcome_pending") {
    filters.push("slot_at < NOW()");
    filters.push("status IN ('confirmed', 'completed')");
    filters.push("(outcome_status IS NULL OR outcome_status = 'none')");
  }
  const search = opts?.search?.trim().slice(0, 120);
  if (search) {
    // 2026-08-06 加 case_no：後台顯示的是它，搜不到會很怪
    filters.push("(name LIKE ? OR phone LIKE ? OR email LIKE ? OR case_reference LIKE ? OR case_no LIKE ?)");
    const pattern = `%${search.replace(/[%_]/g, "\\$&")}%`;
    params.push(pattern, pattern, pattern, pattern, pattern);
  }
  return db.$queryRawUnsafe<AppointmentRow[]>(
    `SELECT * FROM appointment
      WHERE ${filters.join(" AND ")}
      ORDER BY
        CASE WHEN status IN ('pending_confirmation', 'confirmed') AND slot_at >= NOW() THEN 0 ELSE 1 END,
        CASE WHEN slot_at >= NOW() THEN slot_at END ASC,
        slot_at DESC
      LIMIT ?`,
    ...params,
    limit,
  );
}

export async function getAppointment(id: string): Promise<AppointmentRow | null> {
  await ensureAppointmentTable();
  const rows = await db.$queryRaw<AppointmentRow[]>`
    SELECT * FROM appointment WHERE id = ${id} LIMIT 1
  `;
  return rows[0] || null;
}

export async function setAppointmentStatus(id: string, status: string): Promise<void> {
  await ensureAppointmentTable();
  const cancelledAt = status === "cancelled" ? new Date() : null;
  await db.$executeRaw`
    UPDATE appointment
    SET status = ${status}, updated_at = NOW(), cancelled_at = ${cancelledAt}
    WHERE id = ${id}
  `;
  // 非 confirmed(取消 / 其他狀態)→ 釋放該預約佔用的所有 slot lock,格子可再被約。
  if (!["confirmed", "pending_confirmation"].includes(status)) {
    await db.$executeRaw`DELETE FROM appointment_slot_lock WHERE appointment_id = ${id}`;
  } else {
    // 轉回 confirmed(復原 / un-cancel;目前無此路徑,但防未來新增時「confirmed 卻無 lock 被雙約」的隱性地雷)→ 依該預約時段補回 lock。
    const rows = await db.$queryRaw<{ slot_at: Date; slot_end_at: Date | null; meet_type: string }[]>`
      SELECT slot_at, slot_end_at, meet_type FROM appointment WHERE id = ${id} LIMIT 1`;
    if (rows[0]) {
      const policy = appointmentMeetingPolicy(rows[0].meet_type);
      for (const h of occupiedSlotHours(
        new Date(rows[0].slot_at),
        rows[0].slot_end_at ? new Date(rows[0].slot_end_at) : null,
        { beforeMin: policy.bufferBeforeMin, afterMin: policy.bufferAfterMin },
      )) {
        await db.$executeRaw`INSERT IGNORE INTO appointment_slot_lock (slot_at, appointment_id) VALUES (${h}, ${id})`;
      }
    }
  }
}

/** 改期(admin 後台 + 客戶自助共用):不限營業時段,但一律強制搶 slot lock、不允許雙約(撞號回 409)。 */
export async function setAppointmentSlot(
  id: string,
  slotAt: Date,
  slotEndAt?: Date | null,
): Promise<void> {
  await ensureAppointmentTable();
  const endAt = slotEndAt && slotEndAt.getTime() > slotAt.getTime()
    ? slotEndAt
    : new Date(slotAt.getTime() + BOOKING_RULES.slotMinutes * 60_000);
  const current = await db.$queryRaw<{ status: string; meet_type: string }[]>`
    SELECT status, meet_type FROM appointment WHERE id = ${id} LIMIT 1`;
  const policy = appointmentMeetingPolicy(current[0]?.meet_type || "office");
  const hours = occupiedSlotHours(slotAt, endAt, {
    beforeMin: policy.bufferBeforeMin,
    afterMin: policy.bufferAfterMin,
  });

  // 只有 confirmed 預約才佔 slot lock。非 confirmed(已取消等)→ 清掉殘留 lock、只改時間,不建新 lock、不報錯
  //   (允許後台調整已取消記錄的時間欄,且避免殭屍 lock 卡死格子)。
  if (!["confirmed", "pending_confirmation"].includes(current[0]?.status || "")) {
    try {
      await db.$executeRaw`DELETE FROM appointment_slot_lock WHERE appointment_id = ${id}`;
    } catch (e) {
      console.error("[appointment] setAppointmentSlot(非confirmed) 清 lock 失敗(忽略):", e);
    }
    await db.$executeRaw`
      UPDATE appointment SET slot_at = ${slotAt}, slot_end_at = ${endAt}, updated_at = NOW() WHERE id = ${id}
    `;
    return;
  }

  // confirmed → 一律強制搶鎖(對稱 createAppointment;admin 與客戶同一標準,不做「有意重疊」= 守住不撞號賣點):
  //   交易內先刪本預約舊 lock、逐格「硬 INSERT」新格(撞 PK / 死鎖 → rollback,舊 lock 一併還原);
  //   再用「WHERE status='confirmed'」條件式 UPDATE 把 status 讀取序列化進交易 —— 關掉 outer SELECT→INSERT 的 TOCTOU
  //   (期間被取消 → affected=0 → 丟錯 rollback、不留殭屍 lock)。撞號 / 併發一律回 409(route 捕捉),不 500。
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM appointment_slot_lock WHERE appointment_id = ${id}`;
      for (const h of hours) {
        await tx.$executeRaw`INSERT INTO appointment_slot_lock (slot_at, appointment_id) VALUES (${h}, ${id})`;
      }
      const affected = await tx.$executeRaw`
        UPDATE appointment SET slot_at = ${slotAt}, slot_end_at = ${endAt}, updated_at = NOW()
        WHERE id = ${id} AND status IN ('confirmed', 'pending_confirmation')
      `;
      if (Number(affected) !== 1) throw new AppointmentSlotConflictError();
    });
  } catch (e) {
    if (e instanceof AppointmentSlotConflictError) throw e;
    if (isTransientSlotConflict(e)) throw new AppointmentSlotConflictError();
    throw e;
  }
}

export async function setAppointmentAi(
  id: string,
  ai: { heat: string; film: boolean; suggestion: string; summary?: string | null; nextAction?: string | null; profile?: unknown },
): Promise<void> {
  await ensureAppointmentTable();
  const profileJson = ai.profile ? JSON.stringify(ai.profile) : null;
  await db.$executeRaw`
    UPDATE appointment
    SET ai_heat = ${ai.heat}, ai_film = ${ai.film ? 1 : 0}, ai_suggestion = ${ai.suggestion},
        ai_summary = ${ai.summary || null}, ai_next_action = ${ai.nextAction || null}, ai_profile = ${profileJson}, updated_at = NOW()
    WHERE id = ${id}
  `;
}

export async function setAppointmentGoogleEvent(id: string, eventId: string | null, meetUrl?: string | null): Promise<void> {
  await ensureAppointmentTable();
  await db.$executeRaw`
    UPDATE appointment SET google_event_id = ${eventId}, meet_url = ${meetUrl || null}, updated_at = NOW() WHERE id = ${id}
  `;
}

function notificationStatusColumn(purpose: AppointmentNotificationPurpose, channel: AppointmentNotificationChannel): string | null {
  if (purpose === "customer_confirmation_request" || purpose === "customer_confirmation" || purpose === "customer_reminder" || purpose === "customer_reschedule" || purpose === "customer_cancel") return "customer_email_status";
  if (purpose === "admin_new" && channel === "email") return "admin_email_status";
  if (purpose === "admin_line_new" && channel === "line") return "line_notify_status";
  return null;
}

export async function recordAppointmentNotification(input: {
  appointmentId: string;
  purpose: AppointmentNotificationPurpose;
  channel: AppointmentNotificationChannel;
  recipient?: string | null;
  status: "sent" | "failed" | "skipped";
  provider?: string | null;
  messageId?: string | null;
  error?: string | null;
}): Promise<void> {
  await ensureAppointmentTable();
  const id = `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const error = input.error ? input.error.slice(0, 1000) : null;
  await db.$executeRaw`
    INSERT INTO appointment_notification_log
      (id, appointment_id, purpose, channel, recipient, status, provider, message_id, error)
    VALUES
      (${id}, ${input.appointmentId}, ${input.purpose}, ${input.channel}, ${input.recipient || null},
       ${input.status}, ${input.provider || null}, ${input.messageId || null}, ${error})
  `;
  const col = notificationStatusColumn(input.purpose, input.channel);
  if (col) {
    await db.$executeRawUnsafe(
      `UPDATE appointment SET ${col} = ?, last_notify_error = ?, updated_at = NOW() WHERE id = ?`,
      input.status,
      input.status === "failed" ? error : null,
      input.appointmentId,
    );
  }
}

export async function listAppointmentNotifications(appointmentIds: string[]): Promise<AppointmentNotificationRow[]> {
  await ensureAppointmentTable();
  const ids = Array.from(new Set(appointmentIds.filter(Boolean)));
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db.$queryRawUnsafe<AppointmentNotificationRow[]>(
    `SELECT * FROM appointment_notification_log
      WHERE appointment_id IN (${placeholders})
      ORDER BY created_at DESC`,
    ...ids,
  );
}

export async function recordAppointmentFunnelEvent(input: {
  sessionId: string;
  event: AppointmentFunnelEvent;
  appointmentId?: string | null;
  detail?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  bookingMode?: BookingMode | null;
  fromPage?: string | null;
  device?: string | null;
}): Promise<void> {
  await ensureAppointmentTable();
  const id = `funnel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  await db.$executeRaw`
    INSERT INTO appointment_funnel_event
      (id, session_id, appointment_id, event, detail, utm_source, utm_medium, utm_campaign, utm_content,
       utm_term, booking_mode, from_page, device)
    VALUES (${id}, ${input.sessionId.slice(0, 80)}, ${input.appointmentId?.slice(0, 64) || null},
      ${input.event}, ${input.detail?.slice(0, 200) || null}, ${input.utmSource?.slice(0, 80) || null},
      ${input.utmMedium?.slice(0, 80) || null}, ${input.utmCampaign?.slice(0, 160) || null},
      ${input.utmContent?.slice(0, 160) || null}, ${input.utmTerm?.slice(0, 160) || null},
      ${input.bookingMode || null}, ${input.fromPage?.slice(0, 240) || null}, ${input.device?.slice(0, 32) || null})
  `;
}

export async function setAppointmentCalendarSync(input: {
  id: string;
  status: "pending" | "synced" | "failed" | "cancelled";
  error?: string | null;
}): Promise<void> {
  await ensureAppointmentTable();
  await db.$executeRaw`
    UPDATE appointment
       SET calendar_sync_status = ${input.status},
           calendar_sync_error = ${input.error?.slice(0, 2000) || null},
           calendar_synced_at = CASE WHEN ${input.status} IN ('synced', 'cancelled') THEN NOW() ELSE calendar_synced_at END,
           updated_at = NOW()
     WHERE id = ${input.id}
  `;
}

export async function getAppointmentByIdempotencyKey(key: string): Promise<AppointmentRow | null> {
  await ensureAppointmentTable();
  const normalized = key.trim().slice(0, 100);
  if (!normalized) return null;
  const rows = await db.$queryRaw<AppointmentRow[]>`
    SELECT * FROM appointment WHERE idempotency_key = ${normalized} LIMIT 1
  `;
  return rows[0] || null;
}

export async function appointmentFunnelSummary(days = 7): Promise<AppointmentFunnelSummaryRow[]> {
  await ensureAppointmentTable();
  const since = new Date(Date.now() - Math.max(1, Math.min(days, 90)) * 86400_000);
  return db.$queryRaw<AppointmentFunnelSummaryRow[]>`
    SELECT event, COUNT(DISTINCT session_id) AS count
      FROM appointment_funnel_event
     WHERE created_at >= ${since}
     GROUP BY event
  `;
}

export async function appointmentFunnelBreakdown(days = 30): Promise<AppointmentFunnelBreakdownRow[]> {
  await ensureAppointmentTable();
  const since = new Date(Date.now() - Math.max(1, Math.min(days, 90)) * 86400_000);
  return db.$queryRaw<AppointmentFunnelBreakdownRow[]>`
    SELECT event, utm_source, utm_medium, utm_campaign, booking_mode, device,
           COUNT(DISTINCT session_id) AS count
      FROM appointment_funnel_event
     WHERE created_at >= ${since}
     GROUP BY event, utm_source, utm_medium, utm_campaign, booking_mode, device
     ORDER BY count DESC
  `;
}

export type AppointmentReminderKind = "scheduled" | "catchup";
export type AppointmentReminderCandidate = AppointmentRow & {
  reminder_kind: AppointmentReminderKind;
};

export async function listDueAppointmentReminders(
  now = new Date(),
  opts: { includeCatchup?: boolean } = {},
): Promise<AppointmentReminderCandidate[]> {
  await ensureAppointmentTable();
  const from = new Date(now.getTime() + 23 * 60 * 60_000);
  const to = new Date(now.getTime() + 25 * 60 * 60_000);
  if (!opts.includeCatchup) {
    return db.$queryRaw<AppointmentReminderCandidate[]>`
      SELECT appointment.*, 'scheduled' AS reminder_kind FROM appointment
       WHERE status = 'confirmed'
         AND reminder_24h_sent_at IS NULL
         AND slot_at >= ${from}
         AND slot_at <= ${to}
       ORDER BY slot_at ASC
       LIMIT 50
    `;
  }

  return db.$queryRaw<AppointmentReminderCandidate[]>`
    SELECT appointment.*,
           CASE WHEN slot_at < ${from} THEN 'catchup' ELSE 'scheduled' END AS reminder_kind
      FROM appointment
     WHERE status = 'confirmed'
       AND reminder_24h_sent_at IS NULL
       AND slot_at >= ${now}
       AND slot_at <= ${to}
     ORDER BY slot_at ASC
     LIMIT 50
  `;
}

export async function markAppointmentReminderSent(id: string): Promise<void> {
  await ensureAppointmentTable();
  await db.$executeRaw`
    UPDATE appointment SET reminder_24h_sent_at = NOW(), updated_at = NOW() WHERE id = ${id}
  `;
}

export async function markAppointmentReminderChannelSent(id: string, channel: "customer" | "admin"): Promise<void> {
  await ensureAppointmentTable();
  const column = channel === "customer" ? "customer_reminder_24h_sent_at" : "admin_reminder_24h_sent_at";
  await db.$executeRawUnsafe(
    `UPDATE appointment
        SET ${column} = NOW(),
            reminder_24h_sent_at = CASE
              WHEN ${channel === "customer" ? "admin_reminder_24h_sent_at" : "customer_reminder_24h_sent_at"} IS NOT NULL THEN NOW()
              ELSE reminder_24h_sent_at
            END,
            updated_at = NOW()
      WHERE id = ?`,
    id,
  );
}

export async function expirePendingAppointmentHolds(now = new Date()): Promise<number> {
  await ensureAppointmentTable();
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM appointment
     WHERE status = 'pending_confirmation'
       AND confirmation_deadline IS NOT NULL
       AND confirmation_deadline <= ${now}
     LIMIT 200
  `;
  if (!rows.length) return 0;
  await db.$transaction(async (tx) => {
    for (const row of rows) {
      const affected = await tx.$executeRaw`
        UPDATE appointment SET status = 'expired', updated_at = NOW()
         WHERE id = ${row.id} AND status = 'pending_confirmation' AND confirmation_deadline <= ${now}`;
      if (Number(affected) === 1) {
        await tx.$executeRaw`DELETE FROM appointment_slot_lock WHERE appointment_id = ${row.id}`;
      }
    }
  });
  return rows.length;
}

export async function confirmPendingAppointment(id: string): Promise<boolean> {
  await ensureAppointmentTable();
  const affected = await db.$executeRaw`
    UPDATE appointment
       SET status = 'confirmed', attendance_status = 'confirmed', confirmation_deadline = NULL, updated_at = NOW()
     WHERE id = ${id}
       AND status = 'pending_confirmation'
       AND confirmation_deadline > NOW()
  `;
  return Number(affected) === 1;
}

export async function updateAppointmentOperations(input: {
  id: string;
  attendanceStatus?: string | null;
  outcomeStatus?: string | null;
  outcomeNote?: string | null;
  contactStatus?: string | null;
  nextFollowupAt?: Date | null;
  estimatedCommission?: number | null;
  actualCommission?: number | null;
  caseReference?: string | null;
}): Promise<boolean> {
  await ensureAppointmentTable();
  const affected = await db.$executeRaw`
    UPDATE appointment
       SET attendance_status = COALESCE(${input.attendanceStatus || null}, attendance_status),
           outcome_status = COALESCE(${input.outcomeStatus || null}, outcome_status),
           outcome_note = CASE
             WHEN ${input.outcomeNote !== undefined} THEN ${input.outcomeNote?.trim().slice(0, 4000) || null}
             ELSE outcome_note
           END,
           contact_status = COALESCE(${input.contactStatus || null}, contact_status),
           first_contacted_at = CASE
             WHEN ${input.contactStatus || null} = 'contacted' AND first_contacted_at IS NULL THEN NOW()
             ELSE first_contacted_at
           END,
           next_followup_at = CASE
             WHEN ${input.nextFollowupAt !== undefined} THEN ${input.nextFollowupAt || null}
             ELSE next_followup_at
           END,
           estimated_commission = CASE
             WHEN ${input.estimatedCommission !== undefined} THEN ${input.estimatedCommission ?? null}
             ELSE estimated_commission
           END,
           actual_commission = CASE
             WHEN ${input.actualCommission !== undefined} THEN ${input.actualCommission ?? null}
             ELSE actual_commission
           END,
           case_reference = CASE
             WHEN ${input.caseReference !== undefined} THEN ${input.caseReference?.trim().slice(0, 160) || null}
             ELSE case_reference
           END,
           updated_at = NOW()
     WHERE id = ${input.id}
  `;
  return Number(affected) === 1;
}

export async function enqueueAppointmentOutbox(input: {
  appointmentId: string;
  taskType: AppointmentOutboxTaskType;
  dedupeKey: string;
  payload?: unknown;
  nextAttemptAt?: Date;
  delivery?: {
    provider: "ga4" | "meta";
    eventId: string;
    eventName: string;
    occurredAt: Date;
    consentReceiptId: string;
    payloadHash: string;
  };
}): Promise<void> {
  await ensureAppointmentTable();
  const id = randomUUID().replace(/-/g, "");
  await db.$executeRaw`
    INSERT INTO appointment_outbox
      (id, appointment_id, task_type, payload_json, status, attempts, next_attempt_at, dedupe_key,
       provider, event_id, event_name, occurred_at, consent_receipt_id, payload_hash)
    VALUES
      (${id}, ${input.appointmentId}, ${input.taskType}, ${input.payload ? JSON.stringify(input.payload) : null},
       'pending', 0, ${input.nextAttemptAt || new Date()}, ${input.dedupeKey.slice(0, 160)},
       ${input.delivery?.provider || null}, ${input.delivery?.eventId || null},
       ${input.delivery?.eventName || null}, ${input.delivery?.occurredAt || null},
       ${input.delivery?.consentReceiptId || null}, ${input.delivery?.payloadHash || null})
    ON DUPLICATE KEY UPDATE
      status = CASE
        WHEN status IN ('completed', 'blocked_config', 'skipped_no_consent', 'skipped_no_identity', 'failed_permanent')
          THEN status
        ELSE 'pending'
      END,
      next_attempt_at = CASE
        WHEN status IN ('completed', 'blocked_config', 'skipped_no_consent', 'skipped_no_identity', 'failed_permanent')
          THEN next_attempt_at
        ELSE VALUES(next_attempt_at)
      END,
      updated_at = NOW()
  `;
}

export async function settleAppointmentOutbox(input: {
  id: string;
  status: "blocked_config" | "skipped_no_consent" | "skipped_no_identity" | "failed_permanent";
  reason: string;
}): Promise<void> {
  await ensureAppointmentTable();
  await db.$executeRaw`
    UPDATE appointment_outbox
       SET status = ${input.status}, locked_at = NULL,
           last_error = ${input.reason.slice(0, 2000)},
           final_reason = ${input.reason.slice(0, 240)},
           updated_at = NOW()
     WHERE id = ${input.id}
  `;
}

export async function markAppointmentOutboxAccepted(input: {
  id: string;
  httpStatus: number;
  providerRequestId?: string | null;
  eventsReceived?: number | null;
}): Promise<void> {
  await ensureAppointmentTable();
  await db.$executeRaw`
    UPDATE appointment_outbox
       SET last_http_status = ${input.httpStatus},
           provider_request_id = ${input.providerRequestId || null},
           events_received = ${input.eventsReceived ?? null},
           accepted_at = NOW(),
           final_reason = 'provider_accepted',
           updated_at = NOW()
     WHERE id = ${input.id}
  `;
}

export async function listDueAppointmentOutbox(limit = 20): Promise<AppointmentOutboxRow[]> {
  await ensureAppointmentTable();
  const safeLimit = Math.max(1, Math.min(limit, 100));
  return db.$queryRaw<AppointmentOutboxRow[]>`
    SELECT * FROM appointment_outbox
     WHERE status IN ('pending', 'retry')
       AND next_attempt_at <= NOW()
       AND (locked_at IS NULL OR locked_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE))
     ORDER BY next_attempt_at ASC
     LIMIT ${safeLimit}
  `;
}

export async function listAppointmentOutbox(appointmentIds: string[]): Promise<AppointmentOutboxRow[]> {
  await ensureAppointmentTable();
  const ids = Array.from(new Set(appointmentIds.filter(Boolean)));
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db.$queryRawUnsafe<AppointmentOutboxRow[]>(
    `SELECT * FROM appointment_outbox
      WHERE appointment_id IN (${placeholders})
      ORDER BY created_at DESC`,
    ...ids,
  );
}

export async function claimAppointmentOutbox(id: string): Promise<boolean> {
  await ensureAppointmentTable();
  const affected = await db.$executeRaw`
    UPDATE appointment_outbox
       SET status = 'processing', locked_at = NOW(), attempts = attempts + 1, updated_at = NOW()
     WHERE id = ${id}
       AND status IN ('pending', 'retry')
       AND (locked_at IS NULL OR locked_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE))
  `;
  return Number(affected) === 1;
}

export async function finishAppointmentOutbox(id: string, error?: string | null): Promise<void> {
  await ensureAppointmentTable();
  if (!error) {
    await db.$executeRaw`
      UPDATE appointment_outbox
         SET status = 'completed', locked_at = NULL, last_error = NULL, updated_at = NOW()
       WHERE id = ${id}`;
    return;
  }
  const rows = await db.$queryRaw<{ attempts: number }[]>`
    SELECT attempts FROM appointment_outbox WHERE id = ${id} LIMIT 1`;
  const attempts = Number(rows[0]?.attempts || 1);
  const terminal = attempts >= 8;
  const delayMinutes = Math.min(360, Math.pow(2, attempts));
  const nextAttemptAt = new Date(Date.now() + delayMinutes * 60_000);
  await db.$executeRaw`
    UPDATE appointment_outbox
       SET status = ${terminal ? "failed" : "retry"}, locked_at = NULL,
           last_error = ${error.slice(0, 2000)},
           next_attempt_at = ${nextAttemptAt},
           updated_at = NOW()
     WHERE id = ${id}`;
}

export async function consumeAppointmentRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
  bucketKind?: AppointmentRateLimitBucketKind;
}): Promise<{ allowed: boolean; remaining: number }> {
  await ensureAppointmentTable();
  const windowMs = Math.max(1_000, input.windowMs);
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const windowEnd = new Date(windowStart.getTime() + windowMs);
  const expiresAt = new Date(windowStart.getTime() + windowMs * 2);
  const bucketKey = createHash("sha256").update(input.key, "utf8").digest("hex");
  const bucketKind = appointmentRateLimitBucketKind(input.key, input.bucketKind);
  await db.$executeRaw`
    INSERT INTO appointment_rate_limit
      (bucket_key, window_start, bucket_kind, hit_count, limit_snapshot, blocked_at, blocked_until, expires_at)
    VALUES (${bucketKey}, ${windowStart}, ${bucketKind}, 1, ${input.limit}, NULL, NULL, ${expiresAt})
    ON DUPLICATE KEY UPDATE hit_count = hit_count + 1,
      bucket_kind = VALUES(bucket_kind),
      limit_snapshot = VALUES(limit_snapshot),
      expires_at = VALUES(expires_at)
  `;
  const rows = await db.$queryRaw<{ hit_count: number }[]>`
    SELECT hit_count FROM appointment_rate_limit
     WHERE bucket_key = ${bucketKey} AND window_start = ${windowStart}
     LIMIT 1`;
  const count = Number(rows[0]?.hit_count || 1);
  if (count > input.limit) {
    await db.$executeRaw`
      UPDATE appointment_rate_limit
         SET blocked_at = COALESCE(blocked_at, NOW(3)), blocked_until = ${windowEnd}
       WHERE bucket_key = ${bucketKey} AND window_start = ${windowStart}`;
  } else {
    await db.$executeRaw`
      UPDATE appointment_rate_limit
         SET blocked_at = NULL, blocked_until = NULL
       WHERE bucket_key = ${bucketKey} AND window_start = ${windowStart}`;
  }
  return { allowed: count <= input.limit, remaining: Math.max(0, input.limit - count) };
}

export async function purgeExpiredAppointmentRateLimits(): Promise<number> {
  await ensureAppointmentTable();
  const affected = await db.$executeRaw`DELETE FROM appointment_rate_limit WHERE expires_at < NOW() LIMIT 1000`;
  return Number(affected);
}

/**
 * 讀後台設定的三道限制（2026-08-06 系統擁有者）。沒設定就回預設 = 跟以前一模一樣。
 * 存在 appointment_config 表（跟 Google refresh token、日曆設定同一張）。
 */
export async function getAppointmentRateLimitSettings(): Promise<AppointmentRateLimitSettings> {
  await ensureAppointmentTable();
  try {
    const keys = Object.values(RATE_LIMIT_CONFIG_KEYS);
    const rows = await db.$queryRawUnsafe<Array<{ k: string; v: string | null }>>(
      `SELECT k, v FROM appointment_config WHERE k IN (${keys.map(() => "?").join(",")})`,
      ...keys,
    );
    const byKey = new Map(rows.map((r) => [r.k, r.v]));
    return normalizeRateLimitSettings({
      ipLimit: byKey.get(RATE_LIMIT_CONFIG_KEYS.ipLimit),
      ipWindowMin: byKey.get(RATE_LIMIT_CONFIG_KEYS.ipWindowMin),
      contactLimit: byKey.get(RATE_LIMIT_CONFIG_KEYS.contactLimit),
      contactWindowMin: byKey.get(RATE_LIMIT_CONFIG_KEYS.contactWindowMin),
      duplicateWindowMin: byKey.get(RATE_LIMIT_CONFIG_KEYS.duplicateWindowMin),
    });
  } catch {
    // 讀設定失敗一律回預設，**不能因為讀不到設定就放行所有人**
    return DEFAULT_RATE_LIMIT_SETTINGS;
  }
}

/**
 * 產一個「人看得懂」的案件編號（2026-08-06 系統擁有者：「這個案件編號蠻難看的」）。
 *
 * 格式：`AP-260806-01` = 預約(AP) + 建立日(YYMMDD) + 當日第幾筆
 *
 * 為什麼用**建立日**不是預約日：編號是識別碼，改期時不該跟著變。
 * 為什麼不改 `id`：那 32 碼亂數被拿去算 Google 事件 ID 與管理金鑰，改了既有預約會全斷。
 *
 * ⚠️ nextAppointmentCaseNo 只供預覽，不會保留號碼。真正寫入必須走 assignAppointmentCaseNo，
 *    由每日 sequence row 與 unique index 共同阻擋併發撞號。
 */
/** 預覽某一天依現有資料推算的下一號；真正寫入一律走 assignAppointmentCaseNo 的交易鎖。 */
export async function nextAppointmentCaseNo(createdAt: Date = new Date()): Promise<string> {
  await ensureAppointmentTable();
  const prefix = appointmentCasePrefix(createdAt); // "AP-260806-"
  try {
    const rows = await db.$queryRawUnsafe<Array<{ max_seq: number | null }>>(
      `SELECT MAX(CAST(SUBSTRING(case_no, ?) AS UNSIGNED)) AS max_seq
         FROM appointment WHERE case_no LIKE ?`,
      prefix.length + 1,
      `${prefix}%`,
    );
    return formatAppointmentCaseNo(createdAt, Number(rows[0]?.max_seq || 0) + 1);
  } catch {
    // 查不到就從 1 開始 —— 撞號會被 UNIQUE 擋下，呼叫端重試即可
    return formatAppointmentCaseNo(createdAt, 1);
  }
}

function isRetryableCaseNumberConflict(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error ?? "");
  return /duplicate entry|err_dup_entry|\b1062\b|deadlock|err_lock_deadlock|\b1213\b|lock wait timeout|\b1205\b/i.test(message);
}

function createAppointmentCaseNumberStore(): AppointmentCaseNumberStore {
  return {
    transaction: (work) => db.$transaction(
      async (tx) => work({
        lockAppointment: async (appointmentId) => {
          const rows = await tx.$queryRawUnsafe<Array<{
            case_no: string | null;
            created_at: Date | string | null;
          }>>(
            `SELECT case_no, created_at FROM appointment WHERE id = ? LIMIT 1 FOR UPDATE`,
            appointmentId,
          );
          const row = rows[0];
          return row ? { caseNo: row.case_no, createdAt: row.created_at } : null;
        },
        lockSequence: async (caseDay) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO appointment_case_sequence (case_day, last_seq)
             VALUES (?, 0)
             ON DUPLICATE KEY UPDATE last_seq = last_seq`,
            caseDay,
          );
          const rows = await tx.$queryRawUnsafe<Array<{ last_seq: number | bigint }>>(
            `SELECT last_seq FROM appointment_case_sequence WHERE case_day = ? FOR UPDATE`,
            caseDay,
          );
          return Number(rows[0]?.last_seq || 0);
        },
        listExistingCaseNos: async (prefix) => {
          const rows = await tx.$queryRawUnsafe<Array<{ case_no: string | null }>>(
            `SELECT case_no FROM appointment
              WHERE case_no LIKE ? AND case_no IS NOT NULL
              FOR UPDATE`,
            `${prefix}%`,
          );
          return rows.map((row) => row.case_no).filter((value): value is string => Boolean(value));
        },
        saveSequence: async (caseDay, lastSeq) => {
          await tx.$executeRawUnsafe(
            `UPDATE appointment_case_sequence SET last_seq = ? WHERE case_day = ?`,
            lastSeq,
            caseDay,
          );
        },
        saveAppointmentCaseNo: async (appointmentId, caseNo) => {
          const affected = await tx.$executeRawUnsafe(
            `UPDATE appointment SET case_no = ?
              WHERE id = ? AND (case_no IS NULL OR case_no = '')`,
            caseNo,
            appointmentId,
          );
          return Number(affected) === 1;
        },
        readAppointmentCaseNo: async (appointmentId) => {
          const rows = await tx.$queryRawUnsafe<Array<{ case_no: string | null }>>(
            `SELECT case_no FROM appointment WHERE id = ? LIMIT 1`,
            appointmentId,
          );
          return rows[0]?.case_no || null;
        },
      }),
      { maxWait: 10_000, timeout: 20_000 },
    ),
  };
}

/**
 * 把案件編號寫進某一筆預約（只在還沒有編號時寫，重跑安全）。
 * 編號日期以 DB 內這筆預約的 created_at 為準；每日 sequence row 負責串行化併發產號。
 * 遇到外部 writer 撞號或短暫死鎖時自動重試，最多 5 次。
 */
export async function assignAppointmentCaseNo(
  appointmentId: string,
  fallbackCreatedAt: Date = new Date(),
): Promise<string | null> {
  await ensureAppointmentTable();
  const store = createAppointmentCaseNumberStore();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await allocateAppointmentCaseNo(store, appointmentId, fallbackCreatedAt);
    } catch (error) {
      if (!isRetryableCaseNumberConflict(error)) throw error;
    }
  }
  console.error("[appointment] 產案件編號連續 5 次撞號，放棄:", appointmentId);
  return null;
}

/**
 * 找出「資料庫說預約還在、但 Google 日曆上那個事件已經不見了」的預約（2026-08-06 系統擁有者）。
 *
 * 系統擁有者習慣直接在 Google 上滑掉測試用的事件，後台不知道 → 時段一直被佔著，
 * 他自己再去約就被擋，還以為系統壞了。這支讓後台一開就看得出來。
 *
 * 只花 **一次** Google API 呼叫（拉整段期間的事件 ID 回來比對），不是逐筆問。
 *
 * 🔴 `checked: false` = 這次沒能問到 Google（沒綁定 / API 掛了 / 逾時）。
 *    **不可以當成「所有事件都不見了」** —— 那會把每一筆預約都標紅。
 *    這是「工具查詢失敗＝不知道，不是沒有」。
 */
export async function findOrphanedCalendarAppointments(): Promise<{
  checked: boolean;
  orphanIds: Set<string>;
}> {
  await ensureAppointmentTable();
  const rows = await db.$queryRaw<Array<{ id: string; google_event_id: string; slot_at: Date }>>`
    SELECT id, google_event_id, slot_at FROM appointment
     WHERE status = 'confirmed'
       AND google_event_id IS NOT NULL AND google_event_id <> ''
       AND slot_at > NOW()`;
  if (!rows.length) return { checked: true, orphanIds: new Set() };

  const from = new Date(Date.now() - 60_000); // 往前一分鐘，避開剛好卡在邊界的那筆
  const latest = rows.reduce((m, r) => Math.max(m, new Date(r.slot_at).getTime()), 0);
  const to = new Date(Math.min(latest + 86_400_000, Date.now() + 180 * 86_400_000));

  const live = await listCalendarEventIds(from.toISOString(), to.toISOString());
  if (!live) return { checked: false, orphanIds: new Set() };

  const orphanIds = new Set<string>();
  for (const r of rows) {
    if (!live.has(r.google_event_id)) orphanIds.add(r.id);
  }
  return { checked: true, orphanIds };
}

/** 原始、尚未清理的計數桶數。含查詢/追蹤等正常流量，不能解讀成「有人被擋」。 */
export async function countActiveAppointmentRateLimits(): Promise<number> {
  await ensureAppointmentTable();
  try {
    const rows = await db.$queryRaw<{ n: bigint | number }[]>`
      SELECT COUNT(*) AS n FROM appointment_rate_limit WHERE expires_at > NOW()`;
    return Number(rows[0]?.n || 0);
  } catch {
    return 0;
  }
}

export type AppointmentRateLimitStats = {
  activeBuckets: number;
  blockedCreateBuckets: number;
};

/** 後台警示只看真的已超限、且阻擋視窗尚未結束的 create bucket。 */
export async function getAppointmentRateLimitStats(): Promise<AppointmentRateLimitStats> {
  await ensureAppointmentTable();
  try {
    const rows = await db.$queryRaw<Array<{
      active_buckets: bigint | number;
      blocked_create_buckets: bigint | number;
    }>>`
      SELECT
        COUNT(*) AS active_buckets,
        COALESCE(SUM(
          CASE
            WHEN bucket_kind IN ('create_ip', 'create_contact')
             AND blocked_at IS NOT NULL
             AND blocked_until > NOW(3)
             AND limit_snapshot IS NOT NULL
             AND hit_count > limit_snapshot
            THEN 1 ELSE 0
          END
        ), 0) AS blocked_create_buckets
      FROM appointment_rate_limit
      WHERE expires_at > NOW()`;
    return {
      activeBuckets: Number(rows[0]?.active_buckets || 0),
      blockedCreateBuckets: Number(rows[0]?.blocked_create_buckets || 0),
    };
  } catch {
    return { activeBuckets: 0, blockedCreateBuckets: 0 };
  }
}

/**
 * 立刻清掉所有還在生效的限制紀錄（系統擁有者 2026-08-06：「我不要讓系統自動卡我」）。
 * 清掉計數桶並推進解除世代，不動任何預約資料。新世代只會檢查解除後建立的預約。
 */
export type AppointmentRateLimitClearResult = {
  cleared: number;
  generation: number;
  clearedAt: Date;
  auditId: string;
};

export async function clearAppointmentRateLimitsWithAudit(input?: {
  createdBy?: string | null;
  reason?: string | null;
}): Promise<AppointmentRateLimitClearResult> {
  await ensureAppointmentTable();
  return db.$transaction(async (tx) => {
    const stateRows = await tx.$queryRaw<Array<{ generation: bigint | number }>>`
      SELECT generation
        FROM appointment_rate_limit_state
       WHERE scope_key = 'all'
       FOR UPDATE`;
    const generation = Number(stateRows[0]?.generation || 0) + 1;
    const timeRows = await tx.$queryRaw<Array<{ cleared_at: Date }>>`SELECT NOW(3) AS cleared_at`;
    const clearedAt = new Date(timeRows[0]?.cleared_at || new Date());
    const affected = await tx.$executeRaw`DELETE FROM appointment_rate_limit`;
    const createdBy = String(input?.createdBy || "").trim().slice(0, 160) || null;
    const reason = String(input?.reason || "").trim().slice(0, 240) || null;
    const stateAffected = await tx.$executeRaw`
      UPDATE appointment_rate_limit_state
         SET generation = ${generation}, cleared_at = ${clearedAt}, updated_by = ${createdBy}
       WHERE scope_key = 'all'`;
    if (Number(stateAffected) !== 1) throw new Error("appointment_rate_limit_state_update_failed");
    const auditId = randomUUID().replace(/-/g, "");
    await tx.$executeRaw`
      INSERT INTO appointment_rate_limit_clear_audit
        (id, scope_key, generation, cleared_at, cleared_bucket_count, created_by, reason)
      VALUES
        (${auditId}, 'all', ${generation}, ${clearedAt}, ${Number(affected)}, ${createdBy}, ${reason})`;
    return {
      cleared: Number(affected),
      generation,
      clearedAt,
      auditId,
    };
  });
}

/** 舊呼叫相容：仍回傳清掉的 bucket 數，但同樣會寫入解除世代與稽核歷程。 */
export async function clearAppointmentRateLimits(): Promise<number> {
  const result = await clearAppointmentRateLimitsWithAudit();
  return result.cleared;
}

export async function createAppointmentFollowup(appt: AppointmentRow): Promise<AppointmentFollowupRow> {
  await ensureAppointmentTable();
  const id = `follow_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const title = `${appt.name} 預約跟進`;
  const nextAction = appt.ai_next_action || appt.ai_suggestion || "先確認需求背景、預算 / 區域 / 時程,再決定下一步。";
  const source = appt.utm_source || appt.from_page || appt.source || "appointment";
  await db.$executeRaw`
    INSERT INTO appointment_followup
      (id, appointment_id, status, title, customer_name, phone, email, line_id, intent, note, next_action, source)
    VALUES
      (${id}, ${appt.id}, 'open', ${title}, ${appt.name}, ${appt.phone || null}, ${appt.email || null},
       ${appt.line_id || null}, ${appt.intent || null}, ${appt.note || null}, ${nextAction}, ${source})
    ON DUPLICATE KEY UPDATE
      updated_at = NOW(),
      status = CASE WHEN status = 'done' THEN status ELSE 'open' END,
      next_action = VALUES(next_action),
      source = VALUES(source)
  `;
  const rows = await db.$queryRaw<AppointmentFollowupRow[]>`
    SELECT * FROM appointment_followup WHERE appointment_id = ${appt.id} LIMIT 1
  `;
  return rows[0];
}

export async function listAppointmentFollowups(appointmentIds: string[]): Promise<AppointmentFollowupRow[]> {
  await ensureAppointmentTable();
  const ids = Array.from(new Set(appointmentIds.filter(Boolean)));
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db.$queryRawUnsafe<AppointmentFollowupRow[]>(
    `SELECT * FROM appointment_followup
      WHERE appointment_id IN (${placeholders})
      ORDER BY created_at DESC`,
    ...ids,
  );
}

export async function updateAppointmentFollowup(input: {
  appointmentId: string;
  status?: "open" | "done";
  owner?: string | null;
  dueAt?: Date | null;
  nextAction?: string | null;
  result?: string | null;
}): Promise<boolean> {
  await ensureAppointmentTable();
  const affected = await db.$executeRaw`
    UPDATE appointment_followup
       SET status = COALESCE(${input.status || null}, status),
           owner = COALESCE(${input.owner?.trim().slice(0, 120) || null}, owner),
           due_at = COALESCE(${input.dueAt || null}, due_at),
           next_action = COALESCE(${input.nextAction?.trim().slice(0, 4000) || null}, next_action),
           result = COALESCE(${input.result?.trim().slice(0, 40) || null}, result),
           completed_at = CASE WHEN ${input.status || null} = 'done' THEN NOW() ELSE completed_at END,
           updated_at = NOW()
     WHERE appointment_id = ${input.appointmentId}
  `;
  return Number(affected) === 1;
}
