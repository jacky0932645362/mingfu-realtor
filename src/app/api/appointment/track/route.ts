import { NextRequest, NextResponse } from "next/server";
import {
  BOOKING_MODE_KEYS,
  consumeAppointmentRateLimit,
  recordAppointmentFunnelEvent,
  type AppointmentFunnelEvent,
  type BookingMode,
} from "@/lib/appointment";
import { getClientIp } from "@/lib/rate-limit";
import { getCurrentTrackingConsent } from "@/lib/tracking-consent-server";

export const dynamic = "force-dynamic";

const CLIENT_EVENTS: readonly AppointmentFunnelEvent[] = [
  "view",
  "mode_select",
  "meet_type_select",
  "slot_select",
  "contact_complete",
  "qualification_complete",
  "submit_start",
  "submit_error",
];
const SERVER_EVENTS: readonly AppointmentFunnelEvent[] = [
  "submit_success",
  "booking_confirmed",
  "attendance_confirmed",
  "arrived",
  "closed_won",
];

function clean(value: unknown, max: number): string | null {
  const normalized = String(value || "").trim().slice(0, max);
  return normalized || null;
}

export async function POST(req: NextRequest) {
  const consent = await getCurrentTrackingConsent(req.cookies).catch((error) => {
    console.error("[appointment/track] consent receipt unavailable:", error);
    return null;
  });
  if (!consent?.analyticsGranted) {
    return new NextResponse(null, { status: 204 });
  }
  const ip = getClientIp(req);
  try {
    const rate = await consumeAppointmentRateLimit({
      key: `track:ip:${ip}`,
      bucketKind: "track",
      limit: 120,
      windowMs: 60_000,
    });
    if (!rate.allowed) return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[appointment/track] rate limit unavailable:", error);
    return new NextResponse(null, { status: 204 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const sessionId = clean(body.sessionId, 80);
  const event = String(body.event || "") as AppointmentFunnelEvent;
  if (SERVER_EVENTS.includes(event)) {
    return NextResponse.json(
      { ok: false, error: "這個轉換事件只能由伺服器記錄。" },
      { status: 403 },
    );
  }
  if (!sessionId || !CLIENT_EVENTS.includes(event)) {
    return NextResponse.json({ ok: false, error: "追蹤事件格式錯誤。" }, { status: 400 });
  }

  const requestedMode = clean(body.bookingMode, 32);
  if (requestedMode && !BOOKING_MODE_KEYS.includes(requestedMode)) {
    return NextResponse.json({ ok: false, error: "預約模式不正確。" }, { status: 400 });
  }
  const ua = req.headers.get("user-agent") || "";
  const device =
    /line|liff|fbav|fban|instagram|messenger|micromessenger/i.test(ua)
      ? "in_app"
      : /android|iphone|ipad|ipod|mobile/i.test(ua)
        ? "mobile"
        : "desktop";

  await recordAppointmentFunnelEvent({
    sessionId,
    event,
    detail: clean(body.detail, 200),
    utmSource: clean(body.utmSource, 80),
    utmMedium: clean(body.utmMedium, 80),
    utmCampaign: clean(body.utmCampaign, 160),
    utmContent: clean(body.utmContent, 160),
    utmTerm: clean(body.utmTerm, 160),
    bookingMode: requestedMode as BookingMode | null,
    fromPage: clean(body.fromPage, 240),
    device,
  }).catch((error) => console.error("[appointment/track] write failed:", error));

  return NextResponse.json({ ok: true });
}
