import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import {
  TRACKING_CONSENT_DECISION_COOKIE,
  TRACKING_CONSENT_VERSION,
} from "@/lib/tracking-consent";

export const TRACKING_CONSENT_SUBJECT_COOKIE = "consent_subject";
export { TRACKING_CONSENT_DECISION_COOKIE };
export const TRACKING_POLICY_VERSION = "privacy-2026-07-28";
export const TRACKING_CONSENT_UI_VERSION = "tracking-banner-v1";
const TRACKING_CONSENT_COPY =
  "必要項目用於登入預約付款安全與合作方佣金歸屬；同意後啟用GA4 Google Ads Meta Pixel PostHog與Vercel Analytics";
const TRACKING_CONSENT_COPY_HASH = createHash("sha256")
  .update(TRACKING_CONSENT_COPY, "utf8")
  .digest("hex");

export type TrackingConsentReceipt = {
  id: string;
  subjectId: string;
  version: string;
  analyticsGranted: boolean;
  marketingGranted: boolean;
  source: "banner" | "settings" | "migration";
  decidedAt: Date;
};

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

let tableEnsured = false;

function consentSecret(): string | null {
  return (
    process.env.TRACKING_CONSENT_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.APPOINTMENT_TOKEN_SECRET ||
    null
  );
}

export function createTrackingEventId(logicalKey: string): string {
  const secret = consentSecret();
  if (!secret) throw new Error("tracking_consent_secret_missing");
  const digest = createHmac("sha256", secret)
    .update(logicalKey, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `apv1_${digest}`;
}

function signSubject(subjectId: string): string | null {
  const secret = consentSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(subjectId, "utf8").digest("base64url");
}

function privacyHash(value: string | null | undefined): string | null {
  const secret = consentSecret();
  const normalized = String(value || "").trim();
  if (!secret || !normalized) return null;
  return createHmac("sha256", secret).update(normalized, "utf8").digest("hex");
}

export function signedTrackingConsentSubject(subjectId: string): string {
  const signature = signSubject(subjectId);
  if (!signature) throw new Error("tracking_consent_secret_missing");
  return `${subjectId}.${signature}`;
}

export function verifyTrackingConsentSubject(raw: string | null | undefined): string | null {
  const [subjectId, provided] = String(raw || "").split(".");
  if (!/^[a-f0-9]{32}$/.test(subjectId || "") || !provided) return null;
  const expected = signSubject(subjectId);
  if (!expected) return null;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return null;
  return timingSafeEqual(expectedBuffer, providedBuffer) ? subjectId : null;
}

async function ensureTrackingConsentTable(): Promise<void> {
  if (tableEnsured) return;
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tracking_consent_receipt (
      id                CHAR(32)    NOT NULL,
      subject_id        CHAR(32)    NOT NULL,
      version           VARCHAR(64) NOT NULL,
      analytics_granted TINYINT(1)  NOT NULL DEFAULT 0,
      marketing_granted TINYINT(1)  NOT NULL DEFAULT 0,
      source            VARCHAR(24) NOT NULL,
      policy_version    VARCHAR(64) NOT NULL,
      consent_copy_hash CHAR(64)    NOT NULL,
      locale            VARCHAR(16) NOT NULL DEFAULT 'zh-TW',
      source_page       VARCHAR(240) NULL,
      ui_version        VARCHAR(64) NOT NULL,
      actor_hash        CHAR(64)    NULL,
      previous_receipt_id CHAR(32)  NULL,
      revoke_reason     VARCHAR(80) NULL,
      decided_at        DATETIME(3) NOT NULL,
      created_at        TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY tracking_consent_subject_idx (subject_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tableEnsured = true;
}

function mapReceipt(row: {
  id: string;
  subject_id: string;
  version: string;
  analytics_granted: number | boolean;
  marketing_granted: number | boolean;
  source: string;
  policy_version: string;
  decided_at: Date;
}): TrackingConsentReceipt | null {
  if (
    row.version !== TRACKING_CONSENT_VERSION ||
    row.policy_version !== TRACKING_POLICY_VERSION
  ) {
    return null;
  }
  return {
    id: row.id,
    subjectId: row.subject_id,
    version: row.version,
    analyticsGranted: Boolean(row.analytics_granted),
    marketingGranted: Boolean(row.marketing_granted),
    source:
      row.source === "settings" || row.source === "migration"
        ? row.source
        : "banner",
    decidedAt: new Date(row.decided_at),
  };
}

export async function getCurrentTrackingConsent(
  cookies: CookieReader,
): Promise<TrackingConsentReceipt | null> {
  const subjectId = verifyTrackingConsentSubject(
    cookies.get(TRACKING_CONSENT_SUBJECT_COOKIE)?.value,
  );
  if (!subjectId) return null;
  await ensureTrackingConsentTable();
  const rows = await db.$queryRawUnsafe<
    Array<{
      id: string;
      subject_id: string;
      version: string;
      analytics_granted: number | boolean;
      marketing_granted: number | boolean;
      source: string;
      policy_version: string;
      decided_at: Date;
    }>
  >(
    `SELECT id, subject_id, version, analytics_granted, marketing_granted, source, policy_version, decided_at
       FROM tracking_consent_receipt
      WHERE subject_id = ?
      ORDER BY created_at DESC, decided_at DESC
      LIMIT 1`,
    subjectId,
  );
  return rows[0] ? mapReceipt(rows[0]) : null;
}

export async function getLatestTrackingConsentForSubject(
  subjectId: string | null | undefined,
): Promise<TrackingConsentReceipt | null> {
  if (!subjectId || !/^[a-f0-9]{32}$/.test(subjectId)) return null;
  await ensureTrackingConsentTable();
  const rows = await db.$queryRawUnsafe<
    Array<{
      id: string;
      subject_id: string;
      version: string;
      analytics_granted: number | boolean;
      marketing_granted: number | boolean;
      source: string;
      policy_version: string;
      decided_at: Date;
    }>
  >(
    `SELECT id, subject_id, version, analytics_granted, marketing_granted, source, policy_version, decided_at
       FROM tracking_consent_receipt
      WHERE subject_id = ?
      ORDER BY created_at DESC, decided_at DESC
      LIMIT 1`,
    subjectId,
  );
  return rows[0] ? mapReceipt(rows[0]) : null;
}

export async function trackingConsentStillCoversEvent(input: {
  subjectId: string | null | undefined;
  originalReceiptId: string | null | undefined;
  channel: "analytics" | "marketing";
}): Promise<boolean> {
  if (
    !input.subjectId ||
    !input.originalReceiptId ||
    !/^[a-f0-9]{32}$/.test(input.subjectId) ||
    !/^[a-f0-9]{32}$/.test(input.originalReceiptId)
  ) {
    return false;
  }
  // 🛡️ 這支被 4 個金流回調（實體課 / 線上訂單 / 續扣）與預約分析呼叫，
  //    而且多半跑在 after() 裡、沒有被 try/catch 包住 —— 只要它一 throw，
  //    整段 after 就中斷，開發票、寄通知這些排在後面的事全部不會發生（8/1 實際發生過）。
  //    所以自己吞掉例外，並且**失敗一律回 false**（查不出有沒有同意就不追蹤，
  //    寧可少送事件也不要在沒把握的情況下把資料送給 Meta）。
  try {
    return await evaluateConsentCoverage({
      subjectId: input.subjectId,
      originalReceiptId: input.originalReceiptId,
      channel: input.channel,
    });
  } catch (error) {
    console.error("[tracking-consent] 同意涵蓋判定失敗，保守回 false：", error);
    return false;
  }
}

async function evaluateConsentCoverage(input: {
  subjectId: string;
  originalReceiptId: string;
  channel: "analytics" | "marketing";
}): Promise<boolean> {
  await ensureTrackingConsentTable();
  const grantedColumn =
    input.channel === "analytics" ? "analytics_granted" : "marketing_granted";

  // 🔴 2026-08-04：這裡原本是一句 SQL，把「找出這個人最新那張同意書」寫成
  //    `JOIN ... ON latest.id = (SELECT ... LIMIT 1)`。
  //    **TiDB 不支援 JOIN 的 ON 條件裡放子查詢**（MySQL 支援），每次呼叫都會丟出
  //    `Error 1105: ON condition doesn't support subqueries yet`。
  //    這個函式在綠界付款回調的 after() 裡、而且沒有被 try/catch 包住 → 一 throw
  //    整段就中斷，實測後果兩個：
  //      ① Meta 的 Purchase 事件從 8/1 起一筆都沒送出去（廣告看不到成交）
  //      ② 電子發票從「付款當下開」退化成「隔天 10:30 由補開排程救」
  //    改寫成三段分開查、在 JS 裡比對 —— 語意完全一樣，而且不依賴任何 SQL 方言。
  //    ⚠️ 動這段前先確認 TiDB 版本真的支援你要用的語法，不要照抄 MySQL 文件。

  const originalRows = await db.$queryRawUnsafe<Array<{
    granted: number | bigint;
    subject_id: string;
    decided_at: Date;
  }>>(
    `SELECT ${grantedColumn} AS granted, subject_id, decided_at
       FROM tracking_consent_receipt
      WHERE id = ? AND subject_id = ? AND version = ? AND policy_version = ?
      LIMIT 1`,
    input.originalReceiptId,
    input.subjectId,
    TRACKING_CONSENT_VERSION,
    TRACKING_POLICY_VERSION,
  );
  const original = originalRows[0];
  // 當初那張同意書本身就沒同意 → 不涵蓋
  if (!original || Number(original.granted) !== 1) return false;

  // 這個人現在最新一張同意書（版本要對得上，舊版政策的不算）
  const latestRows = await db.$queryRawUnsafe<Array<{ granted: number | bigint }>>(
    `SELECT ${grantedColumn} AS granted
       FROM tracking_consent_receipt
      WHERE subject_id = ? AND version = ? AND policy_version = ?
      ORDER BY created_at DESC, decided_at DESC
      LIMIT 1`,
    original.subject_id,
    TRACKING_CONSENT_VERSION,
    TRACKING_POLICY_VERSION,
  );
  if (!latestRows[0] || Number(latestRows[0].granted) !== 1) return false;

  // 當初同意之後有沒有撤回過（中間任何一張拒絕都算撤回）
  const deniedRows = await db.$queryRawUnsafe<Array<{ cnt: number | bigint }>>(
    `SELECT COUNT(*) AS cnt
       FROM tracking_consent_receipt
      WHERE subject_id = ? AND decided_at > ? AND ${grantedColumn} = 0`,
    original.subject_id,
    original.decided_at,
  );
  if (Number(deniedRows[0]?.cnt || 0) > 0) return false;

  return true;
}

export async function recordTrackingConsent(input: {
  cookies: CookieReader;
  analyticsGranted: boolean;
  marketingGranted: boolean;
  source: "banner" | "settings" | "migration";
  sourcePage?: string | null;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<{ receipt: TrackingConsentReceipt; signedSubject: string }> {
  if (!consentSecret()) throw new Error("tracking_consent_secret_missing");
  await ensureTrackingConsentTable();
  const subjectId =
    verifyTrackingConsentSubject(
      input.cookies.get(TRACKING_CONSENT_SUBJECT_COOKIE)?.value,
    ) || randomUUID().replace(/-/g, "");
  const previous = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
       FROM tracking_consent_receipt
      WHERE subject_id = ?
      ORDER BY created_at DESC, decided_at DESC
      LIMIT 1`,
    subjectId,
  );
  const receipt: TrackingConsentReceipt = {
    id: randomUUID().replace(/-/g, ""),
    subjectId,
    version: TRACKING_CONSENT_VERSION,
    analyticsGranted: input.analyticsGranted,
    marketingGranted: input.marketingGranted,
    source: input.source,
    decidedAt: new Date(),
  };
  await db.$executeRaw`
    INSERT INTO tracking_consent_receipt
      (id, subject_id, version, analytics_granted, marketing_granted, source,
       policy_version, consent_copy_hash, locale, source_page, ui_version, actor_hash,
       previous_receipt_id, revoke_reason, decided_at)
    VALUES
      (${receipt.id}, ${receipt.subjectId}, ${receipt.version},
       ${receipt.analyticsGranted}, ${receipt.marketingGranted}, ${receipt.source},
       ${TRACKING_POLICY_VERSION}, ${TRACKING_CONSENT_COPY_HASH}, 'zh-TW',
       ${String(input.sourcePage || "").trim().slice(0, 240) || null},
       ${TRACKING_CONSENT_UI_VERSION},
       ${privacyHash(`${input.ip || ""}|${input.userAgent || ""}`)},
       ${previous[0]?.id || null},
       ${receipt.analyticsGranted || receipt.marketingGranted ? null : "user_choice"},
       ${receipt.decidedAt})
  `;
  return {
    receipt,
    signedSubject: signedTrackingConsentSubject(subjectId),
  };
}
