import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import {
  enqueueAppointmentOutbox,
  ensureAppointmentTable,
  markAppointmentOutboxAccepted,
  type AppointmentOutboxRow,
  type AppointmentRow,
} from "@/lib/appointment";
import { sendGa4Event } from "@/lib/ga4-mp";
import { sendCapiEvent } from "@/lib/meta-capi";
import {
  createTrackingEventId,
  trackingConsentStillCoversEvent,
} from "@/lib/tracking-consent-server";

export type AppointmentAnalyticsEvent =
  | "submit_success"
  | "booking_confirmed"
  | "attendance_confirmed"
  | "arrived"
  | "closed_won";

export type AppointmentAnalyticsPayload = {
  event: AppointmentAnalyticsEvent;
  eventId: string;
  occurredAt: number;
};

const GA4_EVENT_NAMES: Record<AppointmentAnalyticsEvent, string> = {
  submit_success: "generate_lead",
  booking_confirmed: "appointment_booking_confirmed",
  attendance_confirmed: "appointment_attendance_confirmed",
  arrived: "appointment_arrived",
  closed_won: "appointment_closed_won",
};

export class AppointmentAnalyticsSettlement extends Error {
  constructor(
    readonly status:
      | "blocked_config"
      | "skipped_no_consent"
      | "skipped_no_identity"
      | "failed_permanent",
    message: string,
  ) {
    super(message);
    this.name = "AppointmentAnalyticsSettlement";
  }
}

export async function enqueueAppointmentAnalyticsEvent(
  appointment: AppointmentRow,
  event: AppointmentAnalyticsEvent,
  occurredAt = new Date(),
): Promise<void> {
  const logicalKey = `appointment:v1:${appointment.id}:${event}`;
  const eventId = createTrackingEventId(logicalKey);
  const payload: AppointmentAnalyticsPayload = {
    event,
    eventId,
    occurredAt: Math.floor(occurredAt.getTime() / 1000),
  };
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
  const occurredAtDate = new Date(payload.occurredAt * 1000);
  const tasks: Promise<void>[] = [];
  if (
    appointment.analytics_consent_granted &&
    appointment.tracking_consent_receipt_id &&
    appointment.tracking_consent_subject_id
  ) {
    tasks.push(
      enqueueAppointmentOutbox({
        appointmentId: appointment.id,
        taskType: "analytics_ga4",
        dedupeKey: `${logicalKey}:ga4`,
        payload,
        delivery: {
          provider: "ga4",
          eventId,
          eventName: GA4_EVENT_NAMES[event],
          occurredAt: occurredAtDate,
          consentReceiptId: appointment.tracking_consent_receipt_id,
          payloadHash,
        },
      }),
    );
  }
  // 表單送出已取得姓名、電話與 Email，屬 Lead；確認預約則是 Schedule，不重複計 Lead。
  if (
    (event === "submit_success" || event === "booking_confirmed") &&
    appointment.marketing_consent_granted &&
    appointment.tracking_consent_receipt_id &&
    appointment.tracking_consent_subject_id
  ) {
    tasks.push(
      enqueueAppointmentOutbox({
        appointmentId: appointment.id,
        taskType: "analytics_meta",
        dedupeKey: `${logicalKey}:meta`,
        payload,
        delivery: {
          provider: "meta",
          eventId,
          eventName: event === "submit_success" ? "Lead" : "Schedule",
          occurredAt: occurredAtDate,
          consentReceiptId: appointment.tracking_consent_receipt_id,
          payloadHash,
        },
      }),
    );
  }
  await Promise.all(tasks);
}

export async function reconcileAppointmentAnalyticsOutbox(limit = 200): Promise<number> {
  await ensureAppointmentTable();
  if (process.env.NEXT_PUBLIC_GA_ID && process.env.GA4_API_SECRET) {
    await db.$executeRaw`
      UPDATE appointment_outbox
         SET status = 'retry', next_attempt_at = NOW(), locked_at = NULL,
             final_reason = NULL, updated_at = NOW()
       WHERE task_type = 'analytics_ga4' AND status = 'blocked_config'
    `;
  }
  if (
    process.env.NEXT_PUBLIC_META_PIXEL_ID &&
    process.env.META_CAPI_ACCESS_TOKEN
  ) {
    await db.$executeRaw`
      UPDATE appointment_outbox
         SET status = 'retry', next_attempt_at = NOW(), locked_at = NULL,
             final_reason = NULL, updated_at = NOW()
       WHERE task_type = 'analytics_meta' AND status = 'blocked_config'
    `;
  }
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit) || 200));
  const appointments = await db.$queryRawUnsafe<AppointmentRow[]>(
    `SELECT *
       FROM appointment
      WHERE tracking_consent_receipt_id IS NOT NULL
        AND (analytics_consent_granted = 1 OR marketing_consent_granted = 1)
      ORDER BY created_at DESC
      LIMIT ?`,
    safeLimit,
  );
  let reconciled = 0;
  for (const appointment of appointments) {
    const events: Array<[AppointmentAnalyticsEvent, Date]> = [
      ["submit_success", new Date(appointment.created_at)],
    ];
    if (["confirmed", "completed"].includes(appointment.status)) {
      events.push([
        "booking_confirmed",
        new Date(appointment.updated_at || appointment.created_at),
      ]);
    }
    if (appointment.attendance_status === "confirmed") {
      events.push([
        "attendance_confirmed",
        new Date(appointment.updated_at || appointment.created_at),
      ]);
    }
    if (appointment.attendance_status === "arrived") {
      events.push([
        "arrived",
        new Date(appointment.updated_at || appointment.slot_at),
      ]);
    }
    if (appointment.outcome_status === "closed_won") {
      events.push([
        "closed_won",
        new Date(appointment.updated_at || appointment.slot_at),
      ]);
    }
    for (const [event, eventAt] of events) {
      await enqueueAppointmentAnalyticsEvent(appointment, event, eventAt);
      reconciled += 1;
    }
  }
  return reconciled;
}

function isPayload(value: unknown): value is AppointmentAnalyticsPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    ["submit_success", "booking_confirmed", "attendance_confirmed", "arrived", "closed_won"].includes(
      String(payload.event || ""),
    ) &&
    typeof payload.eventId === "string" &&
    Number.isFinite(Number(payload.occurredAt))
  );
}

function eventSourceUrl(appointment: AppointmentRow): string {
  const path =
    appointment.from_page && appointment.from_page.startsWith("/")
      ? appointment.from_page
      : "/card/booking";
  return `https://example.com${path}`;
}

export async function runAppointmentAnalyticsTask(
  task: AppointmentOutboxRow,
  appointment: AppointmentRow,
  rawPayload: unknown,
): Promise<"completed" | "skipped"> {
  if (!isPayload(rawPayload)) {
    throw new AppointmentAnalyticsSettlement(
      "failed_permanent",
      "appointment_analytics_payload_invalid",
    );
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - rawPayload.occurredAt;
  if (task.task_type === "analytics_ga4") {
    if (ageSeconds > 72 * 60 * 60) {
      throw new AppointmentAnalyticsSettlement("failed_permanent", "ga4_event_too_old");
    }
    const covered = await trackingConsentStillCoversEvent({
      subjectId: appointment.tracking_consent_subject_id,
      originalReceiptId: appointment.tracking_consent_receipt_id,
      channel: "analytics",
    });
    if (!covered || !appointment.analytics_consent_granted) {
      throw new AppointmentAnalyticsSettlement(
        "skipped_no_consent",
        "analytics_consent_not_current",
      );
    }
    if (!appointment.ga_client_id) {
      throw new AppointmentAnalyticsSettlement(
        "skipped_no_identity",
        "ga_client_id_missing",
      );
    }
    const result = await sendGa4Event(
      GA4_EVENT_NAMES[rawPayload.event],
      {
        appointment_id: appointment.id,
        booking_mode: appointment.booking_mode || "realtor",
        meet_type: appointment.meet_type,
        source: appointment.utm_source || appointment.source || "appointment",
        campaign: appointment.utm_campaign || undefined,
        event_id: rawPayload.eventId,
        engagement_time_msec: 1,
      },
      {
        clientId: appointment.ga_client_id,
        timestampMicros: rawPayload.occurredAt * 1_000_000,
        consentGranted: true,
      },
    );
    if (result.skipped) {
      throw new AppointmentAnalyticsSettlement(
        "blocked_config",
        result.error || "ga4_credentials_missing",
      );
    }
    if (!result.ok) {
      if (/^HTTP 4(?!29)/.test(result.error || "")) {
        throw new AppointmentAnalyticsSettlement(
          "failed_permanent",
          result.error || "appointment_ga4_invalid",
        );
      }
      throw new Error(result.error || "appointment_ga4_failed");
    }
    await markAppointmentOutboxAccepted({
      id: task.id,
      httpStatus: 204,
    });
    return "completed";
  }

  if (ageSeconds > 7 * 24 * 60 * 60) {
    throw new AppointmentAnalyticsSettlement("failed_permanent", "meta_event_too_old");
  }
  if (
    task.task_type !== "analytics_meta" ||
    !["submit_success", "booking_confirmed"].includes(rawPayload.event) ||
    !(await trackingConsentStillCoversEvent({
      subjectId: appointment.tracking_consent_subject_id,
      originalReceiptId: appointment.tracking_consent_receipt_id,
      channel: "marketing",
    })) ||
    !appointment.marketing_consent_granted
  ) {
    throw new AppointmentAnalyticsSettlement(
      "skipped_no_consent",
      "marketing_consent_not_current",
    );
  }
  const result = await sendCapiEvent({
    eventName: rawPayload.event === "submit_success" ? "Lead" : "Schedule",
    eventId: rawPayload.eventId,
    eventTime: rawPayload.occurredAt,
    eventSourceUrl: eventSourceUrl(appointment),
    actionSource: "website",
    userData: {
      email: appointment.email,
      phone: appointment.phone,
      externalId: appointment.id,
      clientUserAgent: appointment.user_agent,
      fbp: appointment.meta_fbp,
      fbc: appointment.meta_fbc,
    },
    customData: {
      contentName:
        rawPayload.event === "submit_success"
          ? "茗馥預約：完成留資表單"
          : "茗馥預約：客戶已確認時段",
      contentCategory: appointment.booking_mode || "appointment",
      contentIds: [appointment.id],
      contentType: "product",
    },
  });
  if (result.skipped) {
    throw new AppointmentAnalyticsSettlement(
      "blocked_config",
      result.error || "meta_credentials_missing",
    );
  }
  if (!result.ok) {
    if (/^HTTP 4(?!29)/.test(result.error || "")) {
      throw new AppointmentAnalyticsSettlement(
        "failed_permanent",
        result.error || "appointment_meta_invalid",
      );
    }
    throw new Error(result.error || "appointment_meta_capi_failed");
  }
  let metaResponse: { events_received?: number; fbtrace_id?: string } = {};
  try {
    metaResponse = JSON.parse(result.responseText || "{}") as typeof metaResponse;
  } catch {
    throw new AppointmentAnalyticsSettlement(
      "failed_permanent",
      "meta_response_invalid_json",
    );
  }
  if (metaResponse.events_received !== 1) {
    throw new AppointmentAnalyticsSettlement(
      "failed_permanent",
      `meta_events_received_${String(metaResponse.events_received ?? "missing")}`,
    );
  }
  await markAppointmentOutboxAccepted({
    id: task.id,
    httpStatus: 200,
    providerRequestId: metaResponse.fbtrace_id || null,
    eventsReceived: metaResponse.events_received,
  });
  return "completed";
}
