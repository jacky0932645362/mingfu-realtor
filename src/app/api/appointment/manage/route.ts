import { NextRequest, NextResponse } from "next/server";
import {
  AppointmentSlotConflictError,
  LEGACY_DEFAULT_DURATION_MIN,
  appointmentMeetingPolicy,
  confirmPendingAppointment,
  consumeAppointmentRateLimit,
  enqueueAppointmentOutbox,
  expirePendingAppointmentHolds,
  getAppointment,
  meetTypeLabel,
  recordAppointmentFunnelEvent,
  setAppointmentSlot,
  setAppointmentStatus,
  updateAppointmentOperations,
  type MeetLocation,
} from "@/lib/appointment";
import { verifyAppointmentManageToken } from "@/lib/appointment-token";
import {
  appointmentIcsUrl,
  appointmentMapsUrl,
  buildAppointmentCalendarUrl,
  formatSlotRangeTw,
  type NotifyInput,
} from "@/lib/appointment-notify";
import {
  PublicAppointmentValidationError,
  validatePublicAppointmentSlot,
} from "@/lib/appointment-public-validation";
import { enqueueAppointmentAnalyticsEvent } from "@/lib/appointment-analytics";
import {
  GoogleCalendarUnavailableError,
  getBusyRangesStrict,
  isGoogleConfigured,
} from "@/lib/google-calendar";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function parseIntent(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseMeetLocation(raw: string | null): MeetLocation | null {
  if (!raw) return null;
  try {
    const location = JSON.parse(raw) as Partial<MeetLocation>;
    if (!location.name) return null;
    return {
      name: String(location.name).slice(0, 120),
      address: String(location.address || "").slice(0, 200),
      lat: typeof location.lat === "number" ? location.lat : null,
      lng: typeof location.lng === "number" ? location.lng : null,
      placeId: typeof location.placeId === "string" ? location.placeId.slice(0, 200) : null,
      source: location.source === "google" ? "google" : "manual",
    };
  } catch {
    return null;
  }
}

type Appointment = NonNullable<Awaited<ReturnType<typeof getAppointment>>>;

function slotEnd(appt: Appointment): Date {
  const start = new Date(appt.slot_at);
  return appt.slot_end_at
    ? new Date(appt.slot_end_at)
    : new Date(start.getTime() + LEGACY_DEFAULT_DURATION_MIN * 60_000);
}

function toNotifyInput(appt: Appointment, overrides?: { slotAt?: Date; slotEndAt?: Date }): NotifyInput {
  return {
    id: appt.id,
    name: appt.name,
    gender: appt.gender,
    phone: appt.phone,
    email: appt.email,
    lineId: appt.line_id,
    meetType: appt.meet_type,
    meetLocation: parseMeetLocation(appt.meet_location),
    intent: parseIntent(appt.intent),
    urgency: appt.urgency,
    note: appt.note,
    slotAt: overrides?.slotAt || new Date(appt.slot_at),
    slotEndAt: overrides?.slotEndAt || slotEnd(appt),
    aiHeat: appt.ai_heat,
    aiSuggestion: appt.ai_suggestion,
    meetUrl: appt.meet_url,
  };
}

async function loadAppointment(
  token: string,
): Promise<{ appt: Appointment } | { error: string; status: number }> {
  const verified = verifyAppointmentManageToken(token);
  if (!verified) {
    return { error: "連結已失效，請回到最新確認信，或加茗馥 LINE 協助處理。", status: 401 };
  }
  let appt = await getAppointment(verified.id);
  if (!appt || appt.email.toLowerCase() !== verified.email.toLowerCase()) {
    return { error: "找不到這筆預約，請加茗馥 LINE 協助處理。", status: 404 };
  }
  if (
    appt.status === "pending_confirmation" &&
    appt.confirmation_deadline &&
    new Date(appt.confirmation_deadline).getTime() <= Date.now()
  ) {
    await expirePendingAppointmentHolds(new Date());
    appt = (await getAppointment(verified.id)) || appt;
  }
  return { appt };
}

function publicAppointment(appt: Appointment) {
  const start = new Date(appt.slot_at);
  const end = slotEnd(appt);
  const location = parseMeetLocation(appt.meet_location);
  const confirmed = appt.status === "confirmed";
  const pending =
    appt.status === "pending_confirmation" &&
    Boolean(appt.confirmation_deadline) &&
    new Date(appt.confirmation_deadline as Date).getTime() > Date.now();
  let locationLabel: string | null = null;
  if (location) locationLabel = location.address || location.name;
  const policy = appointmentMeetingPolicy(appt.meet_type);
  const canChangeTime =
    confirmed && start.getTime() > Date.now() + policy.leadHours * 3600_000;
  return {
    id: appt.id,
    name: appt.name,
    email: appt.email,
    status: appt.status,
    attendanceStatus: appt.attendance_status || "pending",
    confirmationDeadline: appt.confirmation_deadline?.toISOString() || null,
    slotAt: start.toISOString(),
    slotEndAt: end.toISOString(),
    slotLabel: formatSlotRangeTw(start, end),
    meetType: appt.meet_type,
    meetTypeLabel: meetTypeLabel(appt.meet_type),
    meetLocationLabel: locationLabel,
    meetUrl: confirmed ? appt.meet_url : null,
    mapsUrl: appointmentMapsUrl(appt.meet_type, location),
    calendarUrl: confirmed ? buildAppointmentCalendarUrl(toNotifyInput(appt)) : null,
    icsUrl: confirmed ? appointmentIcsUrl(appt.id) : null,
    canConfirm: pending,
    canConfirmAttendance: confirmed && appt.attendance_status !== "confirmed",
    canCancel: pending || canChangeTime,
    canReschedule: canChangeTime,
  };
}

async function enforceRateLimit(req: NextRequest, operation: "get" | "post"): Promise<NextResponse | null> {
  try {
    const result = await consumeAppointmentRateLimit({
      key: `manage:${operation}:ip:${getClientIp(req)}`,
      bucketKind: "manage",
      limit: operation === "get" ? 30 : 10,
      windowMs: 10 * 60_000,
    });
    if (result.allowed) return null;
    return NextResponse.json(
      { error: operation === "get" ? "查詢太頻繁，請稍後再試。" : "操作太頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": "600" } },
    );
  } catch (error) {
    console.error("[appointment/manage] rate limit unavailable:", error);
    return NextResponse.json(
      { error: "預約管理服務暫時無法使用，請稍後再試。" },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }
}

async function enqueueConfirmationTasks(appt: Appointment): Promise<void> {
  await Promise.all([
    ...(isGoogleConfigured()
      ? [
          enqueueAppointmentOutbox({
            appointmentId: appt.id,
            taskType: "calendar_create" as const,
            dedupeKey: `appointment:${appt.id}:calendar-create`,
          }),
        ]
      : []),
    enqueueAppointmentOutbox({
      appointmentId: appt.id,
      taskType: "notify_new",
      dedupeKey: `appointment:${appt.id}:confirmed-notify`,
      payload: { phase: "confirmed" },
    }),
  ]);
}

export async function GET(req: NextRequest) {
  const limited = await enforceRateLimit(req, "get");
  if (limited) return limited;
  const loaded = await loadAppointment(String(req.nextUrl.searchParams.get("token") || ""));
  if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  return NextResponse.json({ ok: true, appointment: publicAppointment(loaded.appt) });
}

export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(req, "post");
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const token = String(body.token || "");
  const action = String(body.action || "");
  const loaded = await loadAppointment(token);
  if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  let { appt } = loaded;

  if (action === "confirm" || action === "confirm_attendance") {
    const bookingTransition = appt.status === "pending_confirmation";
    const attendanceTransition =
      ["pending_confirmation", "confirmed"].includes(appt.status) &&
      appt.attendance_status !== "confirmed";
    if (appt.status === "expired") {
      return NextResponse.json(
        { error: "確認期限已過，原時段已釋出，請重新預約。", code: "confirmation_expired" },
        { status: 410 },
      );
    }
    if (appt.status === "cancelled" || appt.status === "completed") {
      return NextResponse.json({ error: "這筆預約目前不能確認出席。" }, { status: 409 });
    }
    if (appt.status === "pending_confirmation") {
      const confirmed = await confirmPendingAppointment(appt.id);
      if (!confirmed) {
        await expirePendingAppointmentHolds(new Date());
        return NextResponse.json(
          { error: "確認期限已過，原時段已釋出，請重新預約。", code: "confirmation_expired" },
          { status: 410 },
        );
      }
      appt = (await getAppointment(appt.id)) || appt;
    } else if (appt.status === "confirmed" && appt.attendance_status !== "confirmed") {
      await updateAppointmentOperations({ id: appt.id, attendanceStatus: "confirmed" });
      appt = (await getAppointment(appt.id)) || appt;
    }
    try {
      await enqueueConfirmationTasks(appt);
    } catch (error) {
      console.error("[appointment/manage] confirmation enqueue failed:", error);
      return NextResponse.json(
        {
          error: "預約已確認，但行事曆與通知尚未排入處理。請稍後重新整理；若持續出現，請加茗馥 LINE。",
          code: "confirmation_outbox_unavailable",
          appointment: publicAppointment(appt),
        },
        { status: 503 },
      );
    }
    const analyticsEvents = [
      ...(bookingTransition ? (["booking_confirmed"] as const) : []),
      ...(attendanceTransition ? (["attendance_confirmed"] as const) : []),
    ];
    for (const analyticsEvent of analyticsEvents) {
      await enqueueAppointmentAnalyticsEvent(appt, analyticsEvent).catch((error) =>
        console.error(
          `[appointment/manage] ${analyticsEvent} analytics enqueue failed:`,
          error,
        ),
      );
    }
    if (appt.funnel_session_id) {
      for (const funnelEvent of analyticsEvents) {
        await recordAppointmentFunnelEvent({
          sessionId: appt.funnel_session_id,
          appointmentId: appt.id,
          event: funnelEvent,
          bookingMode: appt.booking_mode,
          utmSource: appt.utm_source,
          utmMedium: appt.utm_medium,
          utmCampaign: appt.utm_campaign,
          fromPage: appt.from_page,
          device: appt.device,
        }).catch((error) =>
          console.error(
            `[appointment/manage] ${funnelEvent} funnel write failed:`,
            error,
          ),
        );
      }
    }
    return NextResponse.json({
      ok: true,
      status: "confirmed",
      attendanceStatus: "confirmed",
      processingQueued: true,
      appointment: publicAppointment(appt),
    });
  }

  if (action === "cancel") {
    if (appt.status !== "confirmed" && appt.status !== "pending_confirmation") {
      return NextResponse.json({ error: "這筆預約目前不能取消。" }, { status: 409 });
    }
    if (
      appt.status === "confirmed" &&
      new Date(appt.slot_at).getTime() <=
        Date.now() + appointmentMeetingPolicy(appt.meet_type).leadHours * 3600_000
    ) {
      return NextResponse.json(
        { error: "距離預約時間太近，請直接加茗馥 LINE 協助取消。" },
        { status: 409 },
      );
    }
    await setAppointmentStatus(appt.id, "cancelled");
    appt = (await getAppointment(appt.id)) || { ...appt, status: "cancelled" };
    try {
      await Promise.all([
        ...(isGoogleConfigured() || appt.google_event_id
          ? [
              enqueueAppointmentOutbox({
                appointmentId: appt.id,
                taskType: "calendar_cancel" as const,
                dedupeKey: `appointment:${appt.id}:calendar-cancel`,
              }),
            ]
          : []),
        enqueueAppointmentOutbox({
          appointmentId: appt.id,
          taskType: "notify_cancel",
          dedupeKey: `appointment:${appt.id}:cancel-notify`,
          payload: { notifyCustomer: true, notifyAdmin: true },
        }),
      ]);
    } catch (error) {
      console.error("[appointment/manage] cancel enqueue failed:", error);
      return NextResponse.json(
        {
          error: "預約已取消、時段已釋出，但取消通知尚未排入處理。",
          code: "cancel_outbox_unavailable",
          appointment: publicAppointment(appt),
        },
        { status: 503 },
      );
    }
    return NextResponse.json({
      ok: true,
      status: "cancelled",
      processingQueued: true,
      appointment: publicAppointment(appt),
    });
  }

  if (action === "reschedule") {
    if (appt.status !== "confirmed") {
      return NextResponse.json({ error: "請先確認預約，再進行改期。" }, { status: 409 });
    }
    const oldStart = new Date(appt.slot_at);
    const oldEnd = slotEnd(appt);
    if (
      oldStart.getTime() <=
      Date.now() + appointmentMeetingPolicy(appt.meet_type).leadHours * 3600_000
    ) {
      return NextResponse.json(
        { error: "距離預約時間太近，請直接加茗馥 LINE 協助改期。" },
        { status: 409 },
      );
    }
    const durationMinutes = Math.round((oldEnd.getTime() - oldStart.getTime()) / 60_000);
    const slotAt = new Date(String(body.slotIso || ""));
    try {
      const { slotEndAt, policy } = validatePublicAppointmentSlot({
        slotAt,
        durationMinutes,
        meetType: appt.meet_type,
      });
      if (Math.abs(slotAt.getTime() - oldStart.getTime()) < 1000) {
        throw new PublicAppointmentValidationError("請選擇不同時段。");
      }
      const bufferedStart = new Date(slotAt.getTime() - policy.bufferBeforeMin * 60_000);
      const bufferedEnd = new Date(slotEndAt.getTime() + policy.bufferAfterMin * 60_000);
      const busy = await getBusyRangesStrict(bufferedStart.toISOString(), bufferedEnd.toISOString(), {
        excludeEventId: appt.google_event_id,
      });
      if (busy.some((range) => bufferedStart.getTime() < range.end && bufferedEnd.getTime() > range.start)) {
        return NextResponse.json(
          { error: "這個時段已被行事曆佔用，請重新選擇其他時間。" },
          { status: 409 },
        );
      }

      await setAppointmentSlot(appt.id, slotAt, slotEndAt);
      appt = (await getAppointment(appt.id)) || {
        ...appt,
        slot_at: slotAt,
        slot_end_at: slotEndAt,
      };
      try {
        await Promise.all([
          ...(isGoogleConfigured() || appt.google_event_id
            ? [
                enqueueAppointmentOutbox({
                  appointmentId: appt.id,
                  taskType: appt.google_event_id
                    ? ("calendar_reschedule" as const)
                    : ("calendar_create" as const),
                  dedupeKey: `appointment:${appt.id}:calendar:${slotAt.toISOString()}`,
                  payload: {
                    previousSlotTw: formatSlotRangeTw(oldStart, oldEnd),
                    previousSlotAt: oldStart.toISOString(),
                    previousSlotEndAt: oldEnd.toISOString(),
                  },
                }),
              ]
            : []),
          enqueueAppointmentOutbox({
            appointmentId: appt.id,
            taskType: "notify_reschedule",
            dedupeKey: `appointment:${appt.id}:reschedule-notify:${slotAt.toISOString()}`,
            payload: {
              notifyCustomer: true,
              notifyAdmin: true,
              previousSlotTw: formatSlotRangeTw(oldStart, oldEnd),
              previousSlotAt: oldStart.toISOString(),
              previousSlotEndAt: oldEnd.toISOString(),
            },
          }),
        ]);
      } catch (error) {
        console.error("[appointment/manage] reschedule enqueue failed:", error);
        return NextResponse.json(
          {
            error: "預約已改期，但行事曆與通知尚未排入處理。請稍後重新整理確認目前時段。",
            code: "reschedule_outbox_unavailable",
            appointment: publicAppointment(appt),
          },
          { status: 503 },
        );
      }
      return NextResponse.json({
        ok: true,
        slotAt: slotAt.toISOString(),
        slotEndAt: slotEndAt.toISOString(),
        slotLabel: formatSlotRangeTw(slotAt, slotEndAt),
        processingQueued: true,
        appointment: publicAppointment(appt),
      });
    } catch (error) {
      if (error instanceof PublicAppointmentValidationError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }
      if (error instanceof AppointmentSlotConflictError) {
        return NextResponse.json(
          { error: "其中一個時段剛被預約，請重新選擇其他時間。" },
          { status: 409 },
        );
      }
      if (error instanceof GoogleCalendarUnavailableError) {
        return NextResponse.json(
          {
            error: "目前無法確認茗馥的行事曆，為避免重複預約，這次沒有改期。請稍後再試。",
            code: "calendar_unavailable",
          },
          { status: 503, headers: { "Retry-After": "60" } },
        );
      }
      throw error;
    }
  }

  return NextResponse.json({ error: "不支援的操作。" }, { status: 400 });
}
