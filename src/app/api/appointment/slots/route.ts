/**
 * GET /api/appointment/slots?meetType=office
 * 依見面方式套用提前時間、公開時長與交通緩衝，並合併 DB lock 與 Google Calendar busy。
 */
import { NextRequest, NextResponse } from "next/server";
import {
  BOOKING_RULES,
  MEET_TYPE_KEYS,
  appointmentMeetingPolicy,
  consumeAppointmentRateLimit,
  generateOpenSlots,
  getBookedSlots,
} from "@/lib/appointment";
import { GoogleCalendarUnavailableError, getBusyRangesStrict } from "@/lib/google-calendar";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const rate = await consumeAppointmentRateLimit({
      key: `slots:ip:${getClientIp(req)}`,
      bucketKind: "slots",
      limit: 120,
      windowMs: 10 * 60_000,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { days: [], error: "查詢太頻繁，請稍後再試。" },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }

    const meetType = String(req.nextUrl.searchParams.get("meetType") || "office").trim();
    if (!MEET_TYPE_KEYS.includes(meetType)) {
      return NextResponse.json({ days: [], error: "見面方式不正確。" }, { status: 400 });
    }
    const policy = appointmentMeetingPolicy(meetType);
    const now = new Date();
    const to = new Date(now.getTime() + (BOOKING_RULES.daysAhead + 2) * 86400_000);
    const step = BOOKING_RULES.slotMinutes * 60_000;
    const booked = await getBookedSlots(now, to);
    const blockedIso = new Set<string>(booked.map((date) => date.toISOString()));

    const busy = await getBusyRangesStrict(now.toISOString(), to.toISOString());
    for (const range of busy) {
      // 候選預約自身會帶前後緩衝，因此 Google busy 也要反向展開後再切成 15 分格。
      const expandedStart = range.start - policy.bufferAfterMin * 60_000;
      const expandedEnd = range.end + policy.bufferBeforeMin * 60_000;
      const first = Math.floor(expandedStart / step) * step;
      for (let time = first; time < expandedEnd; time += step) {
        if (time + step > expandedStart) blockedIso.add(new Date(time).toISOString());
      }
    }

    const days = generateOpenSlots(now, blockedIso, {
      leadHours: policy.leadHours,
      minDurationMin: Math.min(...policy.publicDurations),
      durations: policy.publicDurations,
    });
    return NextResponse.json({
      days,
      policy: {
        meetType,
        leadHours: policy.leadHours,
        durations: policy.publicDurations,
        bufferBeforeMinutes: policy.bufferBeforeMin,
        bufferAfterMinutes: policy.bufferAfterMin,
        daysAhead: BOOKING_RULES.daysAhead,
      },
    });
  } catch (error) {
    if (error instanceof GoogleCalendarUnavailableError) {
      return NextResponse.json(
        {
          days: [],
          error: "目前無法確認茗馥的行事曆，為避免重複預約，暫時不開放選時段。請稍後再試。",
          code: "calendar_unavailable",
        },
        { status: 503, headers: { "Retry-After": "60" } },
      );
    }
    console.error("[appointment/slots]", error);
    return NextResponse.json(
      { days: [], error: "目前無法讀取可預約時段，請稍後再試。" },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }
}
