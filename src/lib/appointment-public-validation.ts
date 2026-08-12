import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  BOOKING_MODE_KEYS,
  BOOKING_RULES,
  INTENT_KEYS,
  appointmentMeetingPolicy,
  resolveCollaborationIntent,
  type AppointmentQualification,
  type BookingMode,
} from "@/lib/appointment-constants";

const TW_OFFSET_MS = 8 * 3600_000;
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type PublicAppointmentQualification = AppointmentQualification & {
  organization?: string;
  experience?: string;
  portfolio?: string;
  interviewTrack?: string;
};

export class PublicAppointmentValidationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "invalid_request",
  ) {
    super(message);
    this.name = "PublicAppointmentValidationError";
  }
}

function clean(value: unknown, max: number): string | null {
  const normalized = String(value || "").trim().slice(0, max);
  return normalized || null;
}

function qualificationField(value: unknown, max = 240): string | undefined {
  return clean(value, max) || undefined;
}

export function parseBookingMode(value: unknown, intent: readonly string[]): BookingMode {
  const requested = String(value || "").trim();
  if (BOOKING_MODE_KEYS.includes(requested)) return requested as BookingMode;
  return intent.includes("interview") ? "interview" : "realtor";
}

export function parseAppointmentQualification(value: unknown): PublicAppointmentQualification {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const purpose = qualificationField(raw.purpose, 500);
  const collaborationIntent = resolveCollaborationIntent({
    key: raw.collaborationIntentKey,
    label: raw.collaborationIntentLabel,
    purpose,
  });
  return {
    area: qualificationField(raw.area),
    budget: qualificationField(raw.budget),
    purpose,
    collaborationIntentKey: collaborationIntent?.key,
    collaborationIntentLabel: collaborationIntent?.label,
    propertyAddress: qualificationField(raw.propertyAddress, 300),
    propertyType: qualificationField(raw.propertyType),
    legalTopic: qualificationField(raw.legalTopic, 500),
    role: qualificationField(raw.role),
    targetDate: qualificationField(raw.targetDate),
    organization: qualificationField(raw.organization),
    experience: qualificationField(raw.experience, 1000),
    portfolio: qualificationField(raw.portfolio, 500),
    interviewTrack: qualificationField(raw.interviewTrack),
  };
}

function requireQualification(
  qualification: PublicAppointmentQualification,
  field: keyof PublicAppointmentQualification,
  message: string,
): void {
  if (!qualification[field]) throw new PublicAppointmentValidationError(message, 400, "qualification_required");
}

export function validateBookingModeAndQualification(input: {
  bookingMode: BookingMode;
  intent: string[];
  qualification: PublicAppointmentQualification;
}): void {
  const { bookingMode, intent, qualification } = input;
  if (!intent.length || intent.some((item) => !INTENT_KEYS.includes(item))) {
    throw new PublicAppointmentValidationError("請至少選擇一項正確的預約需求。");
  }

  if (bookingMode === "interview") {
    if (intent.some((item) => item !== "interview" && item !== "other")) {
      throw new PublicAppointmentValidationError("面試預約不能混用房產需求。");
    }
    requireQualification(qualification, "role", "請填寫應徵職務。");
    requireQualification(qualification, "purpose", "請簡述這次面談希望了解的內容。");
    requireQualification(qualification, "experience", "請填寫相關經歷。");
    requireQualification(qualification, "targetDate", "請填寫最快可到職日期。");
    return;
  }

  if (intent.includes("interview")) {
    throw new PublicAppointmentValidationError("面試需求請使用「面試預約」模式。");
  }

  if (bookingMode === "collaboration") {
    requireQualification(qualification, "collaborationIntentKey", "請選擇正確的合作方向。");
    requireQualification(qualification, "collaborationIntentLabel", "合作方向格式不正確。");
    requireQualification(qualification, "organization", "請填寫公司或單位名稱。");
    requireQualification(qualification, "role", "請填寫你的職稱或角色。");
    requireQualification(qualification, "purpose", "請簡述合作主題與希望達成的結果。");
    requireQualification(qualification, "targetDate", "請填寫希望合作或會面的時間。");
    return;
  }

  if (intent.some((item) => item === "buy" || item === "rent")) {
    requireQualification(qualification, "area", "請填寫希望的區域。");
    requireQualification(qualification, "budget", "請填寫預算範圍。");
    requireQualification(qualification, "purpose", "請填寫購屋或租賃用途。");
  }
  if (intent.includes("sell")) {
    requireQualification(qualification, "propertyAddress", "請填寫待售物件地址或所在區域。");
    requireQualification(qualification, "purpose", "請填寫出售原因或希望達成的目標。");
  }
  if (intent.includes("legal")) {
    requireQualification(qualification, "legalTopic", "請簡述要諮詢的法律或產權問題。");
  }
  if (intent.includes("other")) {
    requireQualification(qualification, "purpose", "請簡述這次預約的目的。");
  }
}

function taiwanDateKey(date: Date): number {
  const tw = new Date(date.getTime() + TW_OFFSET_MS);
  return Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate());
}

export function validatePublicAppointmentSlot(input: {
  slotAt: Date;
  durationMinutes: number;
  meetType: string;
  now?: Date;
}): { slotEndAt: Date; policy: ReturnType<typeof appointmentMeetingPolicy> } {
  const { slotAt, durationMinutes, meetType } = input;
  const now = input.now || new Date();
  const policy = appointmentMeetingPolicy(meetType);
  if (!Number.isFinite(slotAt.getTime())) {
    throw new PublicAppointmentValidationError("預約時段格式錯誤。");
  }
  if (
    slotAt.getUTCMinutes() % BOOKING_RULES.slotMinutes !== 0 ||
    slotAt.getUTCSeconds() !== 0 ||
    slotAt.getUTCMilliseconds() !== 0
  ) {
    throw new PublicAppointmentValidationError("預約時間必須以 15 分鐘為單位。");
  }
  if (!policy.publicDurations.includes(durationMinutes)) {
    throw new PublicAppointmentValidationError(
      `這種見面方式只開放 ${policy.publicDurations.join("、")} 分鐘。`,
      400,
      "duration_not_allowed",
    );
  }
  if (slotAt.getTime() < now.getTime() + policy.leadHours * 3600_000) {
    throw new PublicAppointmentValidationError(
      `這種見面方式至少要提前 ${policy.leadHours} 小時預約。`,
      409,
      "lead_time_required",
    );
  }
  const dayDiff = Math.round((taiwanDateKey(slotAt) - taiwanDateKey(now)) / 86400_000);
  if (dayDiff < 0 || dayDiff > BOOKING_RULES.daysAhead) {
    throw new PublicAppointmentValidationError(
      `目前只開放未來 ${BOOKING_RULES.daysAhead} 天內的預約。`,
      400,
      "outside_booking_window",
    );
  }

  const slotEndAt = new Date(slotAt.getTime() + durationMinutes * 60_000);
  const twStart = new Date(slotAt.getTime() + TW_OFFSET_MS);
  const weekday = twStart.getUTCDay();
  const startMinute = twStart.getUTCHours() * 60 + twStart.getUTCMinutes();
  const endMinute = startMinute + durationMinutes;
  if (
    !(BOOKING_RULES.workDays as readonly number[]).includes(weekday) ||
    startMinute < BOOKING_RULES.startHour * 60 ||
    endMinute > BOOKING_RULES.endHour * 60
  ) {
    throw new PublicAppointmentValidationError("請選擇 10:00 到 18:00 之間的開放時段。");
  }
  return { slotEndAt, policy };
}

export function appointmentIdempotencyKey(req: NextRequest, body: Record<string, unknown>): string | null {
  const raw = String(req.headers.get("idempotency-key") || body.idempotencyKey || "").trim();
  if (!raw) return null;
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(raw)) {
    throw new PublicAppointmentValidationError(
      "防重複識別碼格式錯誤，請重新整理後再送出。",
      400,
      "invalid_idempotency_key",
    );
  }
  return raw;
}

export function legacyAppointmentIdempotencyKey(input: {
  email: string;
  phone: string;
  slotIso: string;
  durationMinutes: number;
  meetType: string;
}): string {
  const fingerprint = [
    input.email.trim().toLowerCase(),
    input.phone.replace(/\s+/g, ""),
    input.slotIso,
    input.durationMinutes,
    input.meetType,
  ].join("|");
  return `legacy:${createHash("sha256").update(fingerprint, "utf8").digest("hex")}`;
}

export function isAppointmentHoneypotFilled(body: Record<string, unknown>): boolean {
  return Boolean(clean(body.website ?? body.companyWebsite ?? body._honey, 200));
}

export type TurnstileVerification =
  | { configured: false; ok: true }
  | { configured: true; ok: true }
  | { configured: true; ok: false; unavailable: boolean };

export async function verifyAppointmentTurnstile(input: {
  token: unknown;
  ip: string;
}): Promise<TurnstileVerification> {
  const secret =
    process.env.APPOINTMENT_TURNSTILE_SECRET_KEY ||
    process.env.TURNSTILE_SECRET_KEY ||
    "";
  if (!secret) return { configured: false, ok: true };

  const token = clean(input.token, 2048);
  if (!token) return { configured: true, ok: false, unavailable: false };
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: input.ip,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { configured: true, ok: false, unavailable: true };
    const result = (await response.json()) as { success?: boolean };
    return { configured: true, ok: result.success === true, unavailable: false };
  } catch (error) {
    console.error("[appointment/turnstile] verification unavailable:", error);
    return { configured: true, ok: false, unavailable: true };
  }
}
