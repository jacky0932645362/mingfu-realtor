/**
 * GET /api/appointment/ics?id=... — 客戶手機加入行事曆用 .ics 檔。
 * 目的：避免手機被導到 Google Calendar 桌機版 web 編輯頁。
 */
import { NextRequest, NextResponse } from "next/server";
import { getAppointment, type MeetLocation } from "@/lib/appointment";
import { buildAppointmentIcs, formatSlotRangeTw } from "@/lib/appointment-notify";

export const dynamic = "force-dynamic";

function parseMeetLocation(raw: string | null): MeetLocation | null {
  if (!raw) return null;
  try {
    const loc = JSON.parse(raw) as Partial<MeetLocation>;
    if (!loc.name) return null;
    return {
      name: String(loc.name || "").slice(0, 120),
      address: String(loc.address || "").slice(0, 200),
      lat: typeof loc.lat === "number" ? loc.lat : null,
      lng: typeof loc.lng === "number" ? loc.lng : null,
      placeId: typeof loc.placeId === "string" ? loc.placeId : null,
      source: loc.source === "google" ? "google" : "manual",
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!/^[a-z0-9]{16,80}$/i.test(id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const appt = await getAppointment(id);
  if (!appt || appt.status !== "confirmed") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const slotAt = new Date(appt.slot_at);
  const slotEndAt = appt.slot_end_at ? new Date(appt.slot_end_at) : null;
  const ics = buildAppointmentIcs({
    id: appt.id,
    name: appt.name,
    phone: appt.phone,
    email: appt.email,
    meetType: appt.meet_type,
    meetLocation: parseMeetLocation(appt.meet_location),
    slotAt,
    slotEndAt,
    meetUrl: appt.meet_url,
    note: appt.note,
  });
  const label = formatSlotRangeTw(slotAt, slotEndAt).replace(/[^\d]/g, "").slice(0, 12);
  const fileName = `abin-appointment-${label || appt.id.slice(0, 8)}.ics`;

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
