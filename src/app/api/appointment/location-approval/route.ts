import { NextRequest, NextResponse } from "next/server";
import {
  consumeAppointmentRateLimit,
  getCustomLocationApproval,
  isCustomLocationApprovalValid,
  type MeetLocation,
} from "@/lib/appointment";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function approvedLocation(raw: string | null): MeetLocation | null {
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

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const token = req.nextUrl.searchParams.get("token") || "";
  try {
    const limit = await consumeAppointmentRateLimit({
      key: `location-approval:ip:${ip}`,
      bucketKind: "location_approval",
      limit: 30,
      windowMs: 10 * 60_000,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        { approved: false, error: "驗證太頻繁，請稍後再試。" },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "600" } },
      );
    }
    const approved = await isCustomLocationApprovalValid(token);
    const approval = approved ? await getCustomLocationApproval(token) : null;
    const location = approvedLocation(approval?.location_json || null);
    if (approved && (!approval || !location)) {
      return NextResponse.json(
        { approved: false, error: "這個核准連結缺少已同意的地點，請重新向茗馥確認。" },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      {
        approved,
        location,
        constraints: approval
          ? {
              expiresAt: approval.expires_at.toISOString(),
              allowedStartAt: approval.allowed_start_at?.toISOString() || null,
              allowedEndAt: approval.allowed_end_at?.toISOString() || null,
              approvedDurationMinutes: approval.approved_duration_min,
              customerBound: {
                phone: Boolean(approval.customer_phone_hash),
                email: Boolean(approval.customer_email_hash),
              },
            }
          : null,
      },
      { status: approved ? 200 : 404, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[appointment/location-approval] validation failed:", error);
    return NextResponse.json(
      { approved: false, error: "核准服務暫時無法驗證,請稍後重整" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
