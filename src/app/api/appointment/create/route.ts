import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  AppointmentIdempotencyConflictError,
  AppointmentLocationApprovalError,
  AppointmentSlotConflictError,
  INTENT_KEYS,
  MEET_TYPE_KEYS,
  URGENCY_KEYS,
  assignAppointmentCaseNo,
  consumeAppointmentRateLimit,
  getAppointmentRateLimitSettings,
  createAppointment,
  enqueueAppointmentOutbox,
  getAppointment,
  getAppointmentByIdempotencyKey,
  hasRecentAppointmentContact,
  recordAppointmentFunnelEvent,
  type AppointmentRow,
  type MeetLocation,
} from "@/lib/appointment";
import {
  appointmentIcsUrl,
  appointmentMapsUrl,
  buildAppointmentCalendarUrl,
  formatSlotRangeTw,
} from "@/lib/appointment-notify";
import {
  PublicAppointmentValidationError,
  appointmentIdempotencyKey,
  isAppointmentHoneypotFilled,
  legacyAppointmentIdempotencyKey,
  parseAppointmentQualification,
  parseBookingMode,
  validateBookingModeAndQualification,
  validatePublicAppointmentSlot,
  verifyAppointmentTurnstile,
} from "@/lib/appointment-public-validation";
import { createAppointmentManageToken } from "@/lib/appointment-token";
import {
  GoogleCalendarUnavailableError,
  getBusyRangesStrict,
  isGoogleConfigured,
} from "@/lib/google-calendar";
import { getClientIp } from "@/lib/rate-limit";
import { enqueueAppointmentAnalyticsEvent } from "@/lib/appointment-analytics";
import { getCurrentTrackingConsent } from "@/lib/tracking-consent-server";
import {
  normalizeGaClientId,
  normalizeMetaBrowserId,
} from "@/lib/tracking-consent";

export const dynamic = "force-dynamic";

// 2026-08-06 移除：重複防呆的視窗改由後台設定（getAppointmentRateLimitSettings().duplicateWindowMin）
const BASE_URL = (process.env.APPOINTMENT_BASE_URL || "https://example.com").replace(/\/+$/, "");

function clean(value: unknown, max: number): string | null {
  const normalized = String(value || "").trim().slice(0, max);
  return normalized || null;
}

function parseMeetLocation(raw: string | null): MeetLocation | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<MeetLocation>;
    if (!value.name) return null;
    return {
      name: String(value.name).slice(0, 120),
      address: String(value.address || "").slice(0, 200),
      lat: typeof value.lat === "number" ? value.lat : null,
      lng: typeof value.lng === "number" ? value.lng : null,
      placeId: typeof value.placeId === "string" ? value.placeId.slice(0, 200) : null,
      source: value.source === "google" ? "google" : "manual",
    };
  } catch {
    return null;
  }
}

function publicResponse(appt: AppointmentRow) {
  const slotAt = new Date(appt.slot_at);
  const slotEndAt = appt.slot_end_at || new Date(slotAt.getTime() + 60 * 60_000);
  const meetLocation = parseMeetLocation(appt.meet_location);
  const confirmed = appt.status === "confirmed";
  const manageToken = createAppointmentManageToken(appt.id, appt.email);
  const manageUrl = `${BASE_URL}/card/booking/manage?token=${encodeURIComponent(manageToken)}`;
  return {
    ok: true,
    id: appt.id,
    status: appt.status,
    pendingConfirmation: appt.status === "pending_confirmation",
    confirmationDeadline: appt.confirmation_deadline?.toISOString() || null,
    // 待確認時不可把管理金鑰直接回傳到原瀏覽器，否則無法證明 Email 屬於填表者。
    manageToken: confirmed ? manageToken : null,
    manageUrl: confirmed ? manageUrl : null,
    meetUrl: confirmed ? appt.meet_url : null,
    icsUrl: confirmed ? appointmentIcsUrl(appt.id) : null,
    calendarUrl: confirmed
      ? buildAppointmentCalendarUrl({
          id: appt.id,
          name: appt.name,
          phone: appt.phone,
          email: appt.email,
          meetType: appt.meet_type,
          meetLocation,
          note: appt.note,
          slotAt,
          slotEndAt,
          meetUrl: appt.meet_url,
        })
      : null,
    mapsUrl: appointmentMapsUrl(appt.meet_type, meetLocation),
    slotLabel: formatSlotRangeTw(slotAt, slotEndAt),
  };
}

async function enqueueCreatedAppointmentTasks(appt: AppointmentRow): Promise<void> {
  if (appt.status === "pending_confirmation") {
    await Promise.all([
      enqueueAppointmentOutbox({
        appointmentId: appt.id,
        taskType: "notify_new",
        dedupeKey: `appointment:${appt.id}:confirmation-request`,
        payload: { phase: "confirmation_request" },
      }),
      enqueueAppointmentOutbox({
        appointmentId: appt.id,
        taskType: "ai_grade",
        dedupeKey: `appointment:${appt.id}:ai-grade`,
      }),
    ]);
    return;
  }
  if (appt.status === "confirmed") {
    await Promise.all([
      enqueueAppointmentOutbox({
        appointmentId: appt.id,
        taskType: "ai_grade",
        dedupeKey: `appointment:${appt.id}:ai-grade`,
      }),
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
}

function sameIdempotentCustomer(appt: AppointmentRow, email: string, phone: string): boolean {
  return appt.email.toLowerCase() === email.toLowerCase() && appt.phone.replace(/\s+/g, "") === phone.replace(/\s+/g, "");
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (isAppointmentHoneypotFilled(body)) return new NextResponse(null, { status: 204 });

  const ip = getClientIp(req);
  // 2026-08-06 系統擁有者：三道限制的數字改成後台可調（原本寫死 8/10 分、3/60 分、重複 10 分）。
  //   系統擁有者自己測試時一直用同一組 email + 電話，3 次就被鎖 1 小時，測不下去。
  //   讀不到設定會回預設，不會因此放行所有人。
  const rateSettings = await getAppointmentRateLimitSettings();
  try {
    // 限制次數設 0 = 這道關掉（系統擁有者要能自己決定卡不卡）
    const ipRate = rateSettings.ipLimit > 0
      ? await consumeAppointmentRateLimit({
          key: `create:ip:${ip}`,
          bucketKind: "create_ip",
          limit: rateSettings.ipLimit,
          windowMs: rateSettings.ipWindowMin * 60_000,
        })
      : { allowed: true, remaining: 0 };
    if (!ipRate.allowed) {
      return NextResponse.json(
        { error: `送出太頻繁，請 ${rateSettings.ipWindowMin} 分鐘後再試。`, code: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rateSettings.ipWindowMin * 60) } },
      );
    }
  } catch (error) {
    console.error("[appointment/create] DB rate limit unavailable:", error);
    return NextResponse.json(
      { error: "預約服務暫時無法確認送出次數，請稍後再試。", code: "rate_limit_unavailable" },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }

  const turnstile = await verifyAppointmentTurnstile({
    token: body.turnstileToken ?? body["cf-turnstile-response"],
    ip,
  });
  if (!turnstile.ok) {
    return NextResponse.json(
      {
        error: turnstile.unavailable
          ? "人機驗證服務暫時無法使用，請稍後再試。"
          : "人機驗證未完成，請重新勾選後再送出。",
        code: turnstile.unavailable ? "turnstile_unavailable" : "turnstile_invalid",
      },
      { status: turnstile.unavailable ? 503 : 400 },
    );
  }

  try {
    const name = String(body.name || "").trim();
    const gender = clean(body.gender, 20) || "unspecified";
    const phone = String(body.phone || "").trim();
    const email = String(body.email || "").trim();
    const lineId = clean(body.lineId, 120);
    const meetType = String(body.meetType || "").trim();
    const customLocationApprovalToken = clean(body.customLocationApprovalToken, 120);
    const urgency = clean(body.urgency, 32);
    const note = clean(body.note, 2000);
    const slotIso = String(body.slotIso || "").trim();
    const slotAt = new Date(slotIso);
    const durationMinutes = Math.round(Number(body.durationMinutes));
    const intent = Array.isArray(body.intent)
      ? Array.from(
          new Set(
            body.intent.filter(
              (item): item is string => typeof item === "string" && INTENT_KEYS.includes(item),
            ),
          ),
        ).slice(0, 5)
      : [];
    const bookingMode = parseBookingMode(body.bookingMode, intent);
    const qualification = parseAppointmentQualification(body.qualification);

    if (!name || name.length > 80) throw new PublicAppointmentValidationError("請填寫姓名。");
    if (gender !== "unspecified" && gender !== "male" && gender !== "female" && gender !== "other") {
      throw new PublicAppointmentValidationError("性別欄位格式不正確。");
    }
    if (!/^[0-9+\-() ]{6,20}$/.test(phone)) {
      throw new PublicAppointmentValidationError("請填寫可聯絡的正確電話。");
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 160) {
      throw new PublicAppointmentValidationError("請填寫正確 Email，確認連結會寄到這裡。");
    }
    if (!MEET_TYPE_KEYS.includes(meetType)) {
      throw new PublicAppointmentValidationError("請選擇正確的見面方式。");
    }
    if (!urgency || !URGENCY_KEYS.includes(urgency)) {
      throw new PublicAppointmentValidationError("請選擇希望處理或面談的時間。");
    }
    validateBookingModeAndQualification({ bookingMode, intent, qualification });
    const { slotEndAt, policy } = validatePublicAppointmentSlot({
      slotAt,
      durationMinutes,
      meetType,
    });

    const explicitIdempotencyKey = appointmentIdempotencyKey(req, body);
    let idempotencyKey =
      explicitIdempotencyKey ||
      legacyAppointmentIdempotencyKey({ email, phone, slotIso, durationMinutes, meetType });
    let existing = await getAppointmentByIdempotencyKey(idempotencyKey);
    if (existing && !sameIdempotentCustomer(existing, email, phone)) {
      throw new PublicAppointmentValidationError(
        "防重複識別碼已被其他預約使用，請重新整理後再送出。",
        409,
        "idempotency_conflict",
      );
    }
    if (existing && (existing.status === "cancelled" || existing.status === "expired")) {
      if (explicitIdempotencyKey) {
        throw new PublicAppointmentValidationError(
          "這次送出已經取消或逾期，請重新整理頁面後再預約。",
          409,
          "idempotency_closed",
        );
      }
      idempotencyKey = `${idempotencyKey.slice(0, 80)}:${Date.now().toString(36)}`;
      existing = null;
    }
    if (existing) {
      await enqueueCreatedAppointmentTasks(existing);
      return NextResponse.json(publicResponse(existing));
    }

    const contactRate = rateSettings.contactLimit > 0
      ? await consumeAppointmentRateLimit({
          key: `create:contact:${email.toLowerCase()}:${phone.replace(/\s+/g, "")}`,
          bucketKind: "create_contact",
          limit: rateSettings.contactLimit,
          windowMs: rateSettings.contactWindowMin * 60_000,
        })
      : { allowed: true, remaining: 0 };
    if (!contactRate.allowed) {
      return NextResponse.json(
        {
          // 把「要等多久」講出來，不然使用者只會一直重按
          error: `相同聯絡資料送出太頻繁，請 ${rateSettings.contactWindowMin} 分鐘後再試。`,
          code: "contact_rate_limited",
        },
        { status: 429, headers: { "Retry-After": String(rateSettings.contactWindowMin * 60) } },
      );
    }
    if (
      rateSettings.duplicateWindowMin > 0 &&
      (await hasRecentAppointmentContact(email, phone, rateSettings.duplicateWindowMin * 60_000))
    ) {
      return NextResponse.json(
        {
          error: `這組聯絡資料剛送出過預約，請先查看 Email，或 ${rateSettings.duplicateWindowMin} 分鐘後再試。`,
          code: "recent_duplicate",
        },
        { status: 409 },
      );
    }

    const bufferedStart = new Date(slotAt.getTime() - policy.bufferBeforeMin * 60_000);
    const bufferedEnd = new Date(slotEndAt.getTime() + policy.bufferAfterMin * 60_000);
    const busy = await getBusyRangesStrict(bufferedStart.toISOString(), bufferedEnd.toISOString());
    if (busy.some((range) => bufferedStart.getTime() < range.end && bufferedEnd.getTime() > range.start)) {
      return NextResponse.json(
        { error: "這個時段剛被行事曆佔用，請重新選擇其他時間。", code: "calendar_conflict" },
        { status: 409 },
      );
    }

    const id = randomUUID().replace(/-/g, "");
    // 在寫入 DB 前先確認 production 簽章密鑰可用，避免建立出無法確認的孤兒預約。
    createAppointmentManageToken(id, email);
    const trackingBody =
      body.tracking && typeof body.tracking === "object"
        ? (body.tracking as Record<string, unknown>)
        : {};
    const trackingIdentifiers =
      body.trackingIdentifiers && typeof body.trackingIdentifiers === "object"
        ? (body.trackingIdentifiers as Record<string, unknown>)
        : {};
    const consentReceipt = await getCurrentTrackingConsent(req.cookies).catch((error) => {
      console.error("[appointment/create] consent receipt unavailable:", error);
      return null;
    });
    const analyticsGranted = consentReceipt?.analyticsGranted === true;
    const marketingGranted = consentReceipt?.marketingGranted === true;
    const ua = req.headers.get("user-agent") || "";
    const referrerHeader = req.headers.get("referer") || "";
    const device =
      /line|liff|fbav|fban|instagram|messenger|micromessenger/i.test(ua)
        ? "in_app"
        : /android|iphone|ipad|ipod|mobile/i.test(ua)
          ? "mobile"
          : "desktop";
    const funnelSessionId =
      analyticsGranted
        ? clean(trackingBody.funnelSessionId, 80) ||
          clean(body.funnelSessionId, 80)
        : null;
    const tracking = {
      utmSource: analyticsGranted ? clean(trackingBody.utmSource, 80) : null,
      utmMedium: analyticsGranted ? clean(trackingBody.utmMedium, 80) : null,
      utmCampaign: analyticsGranted ? clean(trackingBody.utmCampaign, 160) : null,
      utmContent: analyticsGranted ? clean(trackingBody.utmContent, 160) : null,
      utmTerm: analyticsGranted ? clean(trackingBody.utmTerm, 160) : null,
      referrer: analyticsGranted
        ? clean(trackingBody.referrer, 1000) || clean(referrerHeader, 1000)
        : null,
      userAgent: analyticsGranted || marketingGranted ? clean(ua, 1000) : null,
      device: analyticsGranted ? device : null,
      fromPage: analyticsGranted
        ? clean(trackingBody.fromPage, 240) || "unknown"
        : null,
      funnelSessionId,
    };
    const trackingConsent = consentReceipt
      ? {
          receiptId: consentReceipt.id,
          subjectId: consentReceipt.subjectId,
          version: consentReceipt.version,
          analyticsGranted,
          marketingGranted,
          decidedAt: consentReceipt.decidedAt,
          gaClientId: analyticsGranted
            ? normalizeGaClientId(trackingIdentifiers.gaClientId)
            : null,
          fbp: marketingGranted
            ? normalizeMetaBrowserId(trackingIdentifiers.fbp)
            : null,
          fbc: marketingGranted
            ? normalizeMetaBrowserId(trackingIdentifiers.fbc)
            : null,
        }
      : null;

    let createdNew = false;
    try {
      await createAppointment({
        id,
        bookingMode,
        name,
        gender,
        phone,
        email,
        lineId,
        meetType,
        // 自訂地點一律由 createAppointment 讀取核准資料，忽略客戶端送入的地點。
        meetLocation: null,
        customLocationApprovalToken,
        intent,
        qualification,
        urgency,
        note,
        slotAt,
        slotEndAt,
        source: "card",
        idempotencyKey,
        // 2026-08-06 系統擁有者拍板拿掉「15 分鐘內去信箱點確認」這道關卡：預約送出就成立、直接進 Google 日曆。
        //
        // 為什麼拿掉（8/5 上課實測數據）：
        //   6 月 8 筆過期 0、7 月 17 筆過期 0，8 月 15 筆卻過期 11 —— 因為 6/7 月有一半是系統擁有者自己測試，
        //   他當然會去點。8/5 上課示範那 9 筆，確認信全部「已寄出」，但一個人都沒去點，全數過期。
        //   連坐在教室、旁邊有人教的學員都不會去收信，真實客戶更不會。
        //
        // 為什麼拿掉是安全的：這道閘門原本擋三件事，其中兩件已經有別的機制了 ——
        //   ① 防機器人灌爆 → appointment_rate_limit 已經在擋
        //   ② 防假預約佔時段 → 逾時本來就會自動釋出，最多佔 15 分鐘，本來就擋不了什麼
        //   ③ 驗證 email 是本人 → 只剩這件。代價是漏掉真客戶（＝漏掉成交機會），不對等。
        //
        // 要收回這個決定：設環境變數 APPOINTMENT_REQUIRE_CONFIRMATION=1 即可（不必改程式）。
        // pending_confirmation 那整條路徑（確認信、manage 頁確認、逾時清掉）都原封不動留著。
        requireConfirmation: process.env.APPOINTMENT_REQUIRE_CONFIRMATION === "1",
        tracking,
        trackingConsent,
      });
      createdNew = true;
      // 發一個人看得懂的案件編號（AP-260806-01）。失敗不擋預約 —— 後台顯示會自動掉回 id。
      await assignAppointmentCaseNo(id).catch((error) => {
        console.error("[appointment/create] 產案件編號失敗(不影響預約):", error);
        return null;
      });
      existing = await getAppointment(id);
    } catch (error) {
      if (error instanceof AppointmentIdempotencyConflictError) {
        existing = await getAppointmentByIdempotencyKey(idempotencyKey);
        if (!existing || !sameIdempotentCustomer(existing, email, phone)) {
          throw new PublicAppointmentValidationError(
            "這次送出已由另一個請求處理，請重新整理確認。",
            409,
            "idempotency_conflict",
          );
        }
      } else {
        throw error;
      }
    }
    if (!existing) throw new Error("appointment_created_but_not_found");

    try {
      await enqueueCreatedAppointmentTasks(existing);
    } catch (error) {
      console.error("[appointment/create] enqueue failed:", error);
      return NextResponse.json(
        {
          ok: false,
          id: existing.id,
          status: existing.status,
          error: "時段已暫時保留，但確認信尚未排入寄送。請用相同頁面再按一次送出，系統不會重複建立預約。",
          code: "outbox_unavailable",
        },
        { status: 503, headers: { "Retry-After": "30" } },
      );
    }

    if (createdNew) {
      await enqueueAppointmentAnalyticsEvent(existing, "submit_success").catch((error) =>
        console.error("[appointment/create] analytics enqueue failed:", error),
      );
    }
    if (createdNew && funnelSessionId) {
      await recordAppointmentFunnelEvent({
        sessionId: funnelSessionId,
        appointmentId: existing.id,
        event: "submit_success",
        detail: `${durationMinutes}m`,
        utmSource: tracking.utmSource,
        utmMedium: tracking.utmMedium,
        utmCampaign: tracking.utmCampaign,
        utmContent: tracking.utmContent,
        utmTerm: tracking.utmTerm,
        bookingMode,
        fromPage: tracking.fromPage,
        device,
      }).catch((error) => console.error("[appointment/create] funnel write failed:", error));
    }
    return NextResponse.json(publicResponse(existing), { status: createdNew ? 201 : 200 });
  } catch (error) {
    if (error instanceof PublicAppointmentValidationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    if (error instanceof AppointmentLocationApprovalError) {
      const messages: Record<string, string> = {
        approved_location_missing: "指定地點核准資料不完整，請重新向茗馥確認。",
        approved_customer_mismatch: "這個指定地點連結不是核准給目前這組聯絡資料使用。",
        approved_time_mismatch: "你選的時間不在指定地點核准範圍內。",
        approved_duration_mismatch: "你選的時長不符合指定地點核准內容。",
      };
      return NextResponse.json(
        {
          error: messages[error.message] || "指定地點尚未取得茗馥核准，或核准連結已失效。",
          code: error.message,
        },
        { status: 403 },
      );
    }
    if (error instanceof AppointmentSlotConflictError) {
      return NextResponse.json(
        { error: "其中一個時段剛被預約，請重新選擇其他時間。", code: "slot_conflict" },
        { status: 409 },
      );
    }
    if (error instanceof GoogleCalendarUnavailableError) {
      return NextResponse.json(
        {
          error: "目前無法確認茗馥的行事曆，為避免重複預約，這次沒有建立預約。請稍後再試。",
          code: "calendar_unavailable",
        },
        { status: 503, headers: { "Retry-After": "60" } },
      );
    }
    if (String((error as Error)?.message || error) === "appointment_token_secret_missing") {
      console.error("[appointment/create] manage token secret missing");
      return NextResponse.json(
        {
          error: "預約確認服務尚未完成設定，目前沒有建立預約。",
          code: "confirmation_unavailable",
        },
        { status: 503 },
      );
    }
    console.error("[appointment/create] unexpected failure:", error);
    return NextResponse.json(
      { error: "預約服務暫時無法使用，請稍後再試。", code: "create_failed" },
      { status: 503 },
    );
  }
}
