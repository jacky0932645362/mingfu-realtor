/**
 * 客戶預約系統 — 通知層（2026-06-19）
 * 新預約成立 → ① email 通知系統擁有者 ② LINE 通知系統擁有者（茗馥 admin 群）③ email 確認給客戶。
 *
 * 🔴 寄信安全閘（對齊寄信紅線）：
 *   - 系統擁有者通知（email + LINE）一律寄 = 系統通知 / 預先核可（寄系統擁有者自己）。
 *   - 客戶確認信預設寄；若開發 / 測試要關閉，設 APPOINTMENT_NOTIFY_CUSTOMER=0。
 */
import { sendMail } from "@/lib/mail";
import { notifyAbinAdminGroup } from "@/lib/line-notify";
import {
  ensureAppointmentTable,
  intentLabel,
  urgencyLabel,
  meetTypeLabel,
  recordAppointmentNotification,
} from "@/lib/appointment";
import type { AppointmentNotificationPurpose, MeetLocation } from "@/lib/appointment";
import { createAppointmentManageToken } from "@/lib/appointment-token";
import { db } from "@/lib/db";
import { OWNER, SOCIAL as OWNER_SOCIAL } from "@/config/owner";

const BINGE_EMAIL = process.env.APPOINTMENT_ADMIN_EMAIL || "your-email@example.com";
const APPOINTMENT_BASE_URL = process.env.APPOINTMENT_BASE_URL || "https://example.com";
const GENDER_HONOR: Record<string, string> = { male: "先生", female: "小姐" };
const ABIN_PRIVATE_LINE_URL = OWNER_SOCIAL.line;
const ABIN_OFFICE_LOCATION: MeetLocation = {
  name: OWNER.company || OWNER.name,
  address: OWNER.address,
  lat: null,
  lng: null,
  placeId: null,
  source: "manual",
};
// 2026-08-12：範本原本有 studio / hq 兩個假地點（台中西屯）。只有一間梧棲門市，
// 兩個 key 都指回門市，確保就算有舊資料帶 hq / studio，信件也不會寄出錯誤地址。
const SHONKO_STUDIO_LOCATION: MeetLocation = ABIN_OFFICE_LOCATION;
const GOVIEW_HQ_LOCATION: MeetLocation = ABIN_OFFICE_LOCATION;
const TW_OFFSET_MS = 8 * 3600_000;

export type NotifyInput = {
  id: string;
  name: string;
  gender: string;
  phone: string;
  email: string;
  lineId?: string | null;
  meetType: string;
  /** 客戶自訂見面地點(meet_type='custom' 才有)2026-06-25 */
  meetLocation?: MeetLocation | null;
  intent: string[];
  urgency?: string | null;
  note?: string | null;
  slotAt: Date;
  slotEndAt?: Date | null;
  aiHeat?: string | null;
  aiSuggestion?: string | null;
  meetUrl?: string | null;
  status?: string | null;
  confirmationDeadline?: Date | null;
};

export type AppointmentNotificationDispatchResult = {
  ok: boolean;
  customerEmail: "sent" | "skipped" | "failed";
  adminEmail?: "sent" | "skipped" | "failed";
  adminLine?: "sent" | "skipped" | "failed";
};

async function notificationWasDelivered(
  appointmentId: string,
  purpose: AppointmentNotificationPurpose,
  channel: "email" | "line",
): Promise<boolean> {
  await ensureAppointmentTable();
  const rows = await db.$queryRawUnsafe<{ delivered: number }[]>(
    `SELECT 1 AS delivered
       FROM appointment_notification_log
      WHERE appointment_id = ? AND purpose = ? AND channel = ? AND status IN ('sent', 'skipped')
      LIMIT 1`,
    appointmentId,
    purpose,
    channel,
  );
  return rows.length > 0;
}

function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Google Maps 導航連結:有座標用座標、無座標(manual)用地名搜尋。用短 base（maps.google.com/?q=）少幾十字。 */
function mapsUrl(loc: MeetLocation): string {
  const q =
    loc.lat != null && loc.lng != null
      ? `${loc.lat},${loc.lng}`
      : `${loc.name} ${loc.address}`.trim();
  return `https://maps.google.com/?q=${encodeURIComponent(q)}`;
}

function slotEnd(slotAt: Date, slotEndAt?: Date | null): Date {
  return slotEndAt && slotEndAt.getTime() > slotAt.getTime()
    ? slotEndAt
    : new Date(slotAt.getTime() + 60 * 60_000);
}

export function formatSlotRangeTw(slotAt: Date, slotEndAt?: Date | null): string {
  const startTw = new Date(slotAt.getTime() + TW_OFFSET_MS);
  const endTw = new Date(slotEnd(slotAt, slotEndAt).getTime() + TW_OFFSET_MS);
  const wd = ["日", "一", "二", "三", "四", "五", "六"][startTw.getUTCDay()];
  const y = startTw.getUTCFullYear();
  const m = String(startTw.getUTCMonth() + 1).padStart(2, "0");
  const d = String(startTw.getUTCDate()).padStart(2, "0");
  const sh = String(startTw.getUTCHours()).padStart(2, "0");
  const sm = String(startTw.getUTCMinutes()).padStart(2, "0");
  const eh = String(endTw.getUTCHours()).padStart(2, "0");
  const em = String(endTw.getUTCMinutes()).padStart(2, "0");
  return `${y}/${m}/${d}（週${wd}） ${sh}:${sm}–${eh}:${em}`;
}

function formatTwDateTime(value: Date): string {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

function googleCalendarDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function icsEsc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function appointmentLocation(meetType: string, meetLocation?: MeetLocation | null): MeetLocation | null {
  if (meetType === "custom" && meetLocation) return meetLocation;
  if (meetType === "office") return ABIN_OFFICE_LOCATION;
  if (meetType === "hq") return GOVIEW_HQ_LOCATION;
  if (meetType === "studio") return SHONKO_STUDIO_LOCATION;
  return null;
}

export function appointmentMapsUrl(meetType: string, meetLocation?: MeetLocation | null): string | null {
  const loc = appointmentLocation(meetType, meetLocation);
  return loc ? mapsUrl(loc) : null;
}

export function appointmentLocationText(meetType: string, meetLocation?: MeetLocation | null): string | null {
  const loc = appointmentLocation(meetType, meetLocation);
  return loc ? `${loc.name}${loc.address ? ` ${loc.address}` : ""}` : null;
}

export function buildAppointmentCalendarUrl(opts: {
  id?: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  meetType: string;
  meetLocation?: MeetLocation | null;
  slotAt: Date;
  slotEndAt?: Date | null;
  meetUrl?: string | null;
  note?: string | null;
}): string {
  const endAt = slotEnd(opts.slotAt, opts.slotEndAt);
  const meetStr = meetTypeLabel(opts.meetType);
  const loc = appointmentLocation(opts.meetType, opts.meetLocation);
  const location = loc ? `${loc.name}${loc.address ? ` ${loc.address}` : ""}` : opts.meetUrl || "";
  const details = [
    `姓名：${opts.name}`,
    opts.phone ? `電話：${opts.phone}` : "",
    opts.email ? `Email：${opts.email}` : "",
    `見面方式：${meetStr}`,
    opts.meetUrl ? `Google Meet：${opts.meetUrl}` : "",
    opts.note ? `備註：${opts.note}` : "",
  ].filter(Boolean).join("\n");
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: `與茗馥預約：${opts.name}`,
    dates: `${googleCalendarDate(opts.slotAt)}/${googleCalendarDate(endAt)}`,
    details,
  });
  if (location) p.set("location", location);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

export function buildAppointmentIcs(opts: {
  id?: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  meetType: string;
  meetLocation?: MeetLocation | null;
  slotAt: Date;
  slotEndAt?: Date | null;
  meetUrl?: string | null;
  note?: string | null;
}): string {
  const endAt = slotEnd(opts.slotAt, opts.slotEndAt);
  const meetStr = meetTypeLabel(opts.meetType);
  const loc = appointmentLocation(opts.meetType, opts.meetLocation);
  const location = loc ? `${loc.name}${loc.address ? ` ${loc.address}` : ""}` : opts.meetUrl || "";
  const details = [
    `姓名：${opts.name}`,
    opts.phone ? `電話：${opts.phone}` : "",
    opts.email ? `Email：${opts.email}` : "",
    `見面方式：${meetStr}`,
    opts.meetUrl ? `Google Meet：${opts.meetUrl}` : "",
    opts.note ? `備註：${opts.note}` : "",
  ].filter(Boolean).join("\n");
  const now = new Date();
  const uid = `appointment-${opts.id || `${opts.slotAt.getTime()}-${opts.name}`}@example.com`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ShonKo//Appointment//ZH-TW",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${icsEsc(uid)}`,
    `DTSTAMP:${googleCalendarDate(now)}`,
    `DTSTART:${googleCalendarDate(opts.slotAt)}`,
    `DTEND:${googleCalendarDate(endAt)}`,
    `SUMMARY:${icsEsc(`與茗馥預約：${opts.name}`)}`,
    location ? `LOCATION:${icsEsc(location)}` : "",
    `DESCRIPTION:${icsEsc(details)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
}

export function appointmentIcsUrl(id: string): string {
  return `${APPOINTMENT_BASE_URL}/api/appointment/ics?id=${encodeURIComponent(id)}`;
}

/** 太平洋房屋 CIS 亮色 email 外殼（天藍 header + 橘 CTA + 深字,RWD 手機不跑版,內聯 style）*/
function realtorEmailLayout(opts: { title: string; preheader?: string; bodyHtml: string }): string {
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  @media only screen and (max-width:600px){
    .container{width:100%!important}
    .px{padding-left:22px!important;padding-right:22px!important}
    .h1{font-size:21px!important}
  }
</style></head>
<body style="margin:0;padding:0;background:#F7FAFB;font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif;color:#1C2D3A;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader || "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7FAFB;padding:24px 12px">
<tr><td align="center">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(28,45,58,0.08)">
  <tr><td style="background:linear-gradient(135deg,#4EC4DC,#2BA9C4);padding:22px 32px">
    <div style="font-size:13px;color:#E8F7FB;letter-spacing:1px">太平洋房屋 梧棲市鎮加盟店</div>
    <div class="h1" style="font-size:24px;font-weight:800;color:#FFFFFF;margin-top:4px">${esc(opts.title)}</div>
  </td></tr>
  <tr><td class="px" style="padding:28px 32px">${opts.bodyHtml}</td></tr>
  <tr><td style="background:#F7FAFB;padding:20px 32px;border-top:1px solid #E3EAEE">
    <div style="font-size:13px;color:#7A8896;line-height:1.8">
      蕭茗馥 茗馥 ‧ 太平洋房屋<br>
      📞 0932-645-362　📍 台中市梧棲區四維中路338號<br>
      LINE：0932-645-362
    </div>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

/**
 * 交易信精簡外殼（客戶預約確認用）— 降 Gmail「促銷分頁」訊號、進主要收件匣。2026-07-18
 * 跟 realtorEmailLayout（漸層大 banner，admin 用）分開：細品牌色條 + 樸素標題 + 白底，像交易通知不像 DM。
 */
function transactionalEmailLayout(opts: { title: string; preheader?: string; bodyHtml: string }): string {
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>@media only screen and (max-width:600px){.container{width:100%!important}.px{padding-left:20px!important;padding-right:20px!important}}</style></head>
<body style="margin:0;padding:0;background:#F4F6F8;font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif;color:#1C2D3A;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader || "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:24px 12px">
<tr><td align="center">
<table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px;background:#FFFFFF;border:1px solid #E3EAEE;border-radius:12px;overflow:hidden">
  <tr><td style="height:4px;background:#4EC4DC;font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td class="px" style="padding:22px 30px 4px">
    <div style="font-size:13px;color:#7A8896">太平洋房屋 梧棲市鎮加盟店</div>
    <div style="font-size:20px;font-weight:700;color:#1C2D3A;margin-top:4px">${esc(opts.title)}</div>
  </td></tr>
  <tr><td class="px" style="padding:8px 30px 26px">${opts.bodyHtml}</td></tr>
  <tr><td style="padding:16px 30px;border-top:1px solid #EDF2F4">
    <div style="font-size:13px;color:#7A8896;line-height:1.7">蕭茗馥 茗馥 · 太平洋房屋　LINE / 電話 0932-645-362</div>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

async function sendAppointmentEmailAndRecord(args: {
  appointmentId: string;
  purpose: AppointmentNotificationPurpose;
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  const result = await sendMail({
    to: args.to,
    subject: args.subject,
    html: args.html,
  }).catch((e) => ({
    success: false as const,
    provider: "mock" as const,
    error: e instanceof Error ? e.message : String(e),
  }));
  const success = result.success;
  await recordAppointmentNotification({
    appointmentId: args.appointmentId,
    purpose: args.purpose,
    channel: "email",
    recipient: args.to,
    status: success ? "sent" : "failed",
    provider: result.provider,
    messageId: success ? result.messageId : null,
    error: success ? null : result.error || "unknown error",
  }).catch((e) => console.error("[appointment-notify] record email notification 失敗:", e));
  return success;
}

async function recordAppointmentLineResult(
  appointmentId: string,
  sent: boolean,
  purpose: Extract<AppointmentNotificationPurpose, "admin_line_pending" | "admin_line_new"> = "admin_line_new",
): Promise<void> {
  await recordAppointmentNotification({
    appointmentId,
    purpose,
    channel: "line",
    recipient: process.env.ABIN_HITL_GROUP_ID || process.env.LINE_ADMIN_GROUP_ID || null,
    status: sent ? "sent" : "failed",
    provider: "line",
    error: sent ? null : "LINE push failed or group env missing",
  }).catch((e) => console.error("[appointment-notify] record line notification 失敗:", e));
}

export async function sendCustomerAppointmentConfirmation(a: NotifyInput): Promise<boolean> {
  if (process.env.APPOINTMENT_NOTIFY_CUSTOMER === "0") {
    await recordAppointmentNotification({
      appointmentId: a.id,
      purpose: "customer_confirmation",
      channel: "email",
      recipient: a.email,
      status: "skipped",
      provider: "config",
      error: "APPOINTMENT_NOTIFY_CUSTOMER=0",
    }).catch(() => {});
    console.log("[appointment-notify] 客戶確認信已關閉(APPOINTMENT_NOTIFY_CUSTOMER=0),只寄系統擁有者");
    return false;
  }

  const slotTw = formatSlotRangeTw(a.slotAt, a.slotEndAt);
  const meetStr = meetTypeLabel(a.meetType);
  const honor = GENDER_HONOR[a.gender] || "";
  const loc = appointmentLocation(a.meetType, a.meetLocation);
  const mapUrl = appointmentMapsUrl(a.meetType, a.meetLocation);
  const icsUrl = appointmentIcsUrl(a.id);
  const manageUrl = `${APPOINTMENT_BASE_URL}/card/booking/manage?token=${encodeURIComponent(createAppointmentManageToken(a.id, a.email))}`;
  // 交易信精簡版（降 Gmail 促銷分頁訊號）：個人化開頭 + 灰底資訊卡 + 單一主 CTA「加入行事曆」+ 其餘小文字連結。2026-07-18
  const custBody = `
    <p style="font-size:16px;line-height:1.7;margin:0 0 16px">${esc(a.name)} ${honor}你好,茗馥已經收到你的預約,時段幫你安排好了。</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.9;background:#F7FAFB;border-radius:10px">
      <tr><td style="padding:14px 16px">
        <div>📅 時段　<b>${esc(slotTw)}</b></div>
        <div style="margin-top:4px">📍 方式　<b>${esc(meetStr)}</b>${loc ? `<br><span style="color:#7A8896;font-size:14px">　${esc(loc.name)}${loc.address ? ` · ${esc(loc.address)}` : ""}</span>` : ""}</div>
        ${a.meetUrl ? `<div style="margin-top:4px">🎥 視訊　<a href="${esc(a.meetUrl)}" style="color:#1F6F83">點我加入 Google Meet</a></div>` : ""}
      </td></tr>
    </table>
    <div style="text-align:center;margin:22px 0 8px">
      <a href="${esc(icsUrl)}" style="display:inline-block;background:#1C2D3A;color:#ffffff;font-size:15px;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none">加入行事曆</a>
    </div>
    <p style="text-align:center;font-size:13px;color:#7A8896;line-height:2;margin:6px 0 0">
      <a href="${esc(manageUrl)}" style="color:#1F6F83;text-decoration:none">改期 / 取消</a>${mapUrl ? ` · <a href="${esc(mapUrl)}" style="color:#1F6F83;text-decoration:none">地圖導航</a>` : ""} · <a href="${esc(ABIN_PRIVATE_LINE_URL)}" style="color:#1F6F83;text-decoration:none">加茗馥 LINE</a>
    </p>
    <p style="font-size:14px;color:#7A8896;line-height:1.7;margin:18px 0 0">有任何狀況,直接回覆這封信或加茗馥 LINE 都可以。</p>
  `;
  return sendAppointmentEmailAndRecord({
    appointmentId: a.id,
    purpose: "customer_confirmation",
    to: a.email,
    subject: `你的預約已確認 · 茗馥（蕭茗馥）`,
    html: transactionalEmailLayout({
      title: "預約已確認",
      preheader: `${esc(a.name)} ${honor}你好,茗馥已收到你的預約 · ${slotTw}`,
      bodyHtml: custBody,
    }),
  });
}

export async function sendCustomerAppointmentConfirmationRequest(a: NotifyInput): Promise<boolean> {
  if (process.env.APPOINTMENT_NOTIFY_CUSTOMER === "0") {
    await recordAppointmentNotification({
      appointmentId: a.id,
      purpose: "customer_confirmation_request",
      channel: "email",
      recipient: a.email,
      status: "skipped",
      provider: "config",
      error: "APPOINTMENT_NOTIFY_CUSTOMER=0",
    }).catch(() => {});
    return false;
  }

  const slotTw = formatSlotRangeTw(a.slotAt, a.slotEndAt);
  const deadline = a.confirmationDeadline || new Date(Date.now() + 15 * 60_000);
  const deadlineTw = deadline.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const manageUrl = `${APPOINTMENT_BASE_URL}/card/booking/manage?token=${encodeURIComponent(createAppointmentManageToken(a.id, a.email))}`;
  const body = `
    <p style="font-size:16px;line-height:1.7;margin:0 0 16px">${esc(a.name)} 你好，你選的時段已暫時保留。</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.9;background:#FFF7E8;border:1px solid #F5A91D;border-radius:10px">
      <tr><td style="padding:14px 16px">
        <div>📅 時段　<b>${esc(slotTw)}</b></div>
        <div style="margin-top:4px">📍 方式　<b>${esc(meetTypeLabel(a.meetType))}</b></div>
        <div style="margin-top:8px;color:#9A6700">請在台灣時間 ${esc(deadlineTw)} 前完成確認；逾時會自動釋出名額。</div>
      </td></tr>
    </table>
    <div style="text-align:center;margin:22px 0 8px">
      <a href="${esc(manageUrl)}" style="display:inline-block;background:#1C2D3A;color:#ffffff;font-size:15px;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none">確認這筆預約</a>
    </div>
    <p style="font-size:13px;color:#7A8896;line-height:1.7;margin:14px 0 0">按下確認後，系統才會建立行事曆並寄出正式預約資訊。若不是你本人送出，直接忽略即可。</p>
  `;
  return sendAppointmentEmailAndRecord({
    appointmentId: a.id,
    purpose: "customer_confirmation_request",
    to: a.email,
    subject: "請在 15 分鐘內確認預約 · 茗馥（蕭茗馥）",
    html: transactionalEmailLayout({
      title: "時段已暫時保留",
      preheader: `請在 ${deadlineTw} 前確認 · ${slotTw}`,
      bodyHtml: body,
    }),
  });
}

export async function sendCustomerAppointmentChangeEmail(
  a: NotifyInput,
  change: { type: "reschedule" | "cancel"; previousSlotTw?: string | null },
): Promise<boolean> {
  if (process.env.APPOINTMENT_NOTIFY_CUSTOMER === "0") {
    await recordAppointmentNotification({
      appointmentId: a.id,
      purpose: change.type === "cancel" ? "customer_cancel" : "customer_reschedule",
      channel: "email",
      recipient: a.email,
      status: "skipped",
      provider: "config",
      error: "APPOINTMENT_NOTIFY_CUSTOMER=0",
    }).catch(() => {});
    return false;
  }

  const slotTw = formatSlotRangeTw(a.slotAt, a.slotEndAt);
  const isCancel = change.type === "cancel";
  const title = isCancel ? "預約已取消" : "預約已改期";
  const body = `
    <p style="font-size:16px;line-height:1.7;margin:0 0 16px">${esc(a.name)} ${GENDER_HONOR[a.gender] || ""}你好,這封信通知你預約狀態已更新。</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.9;background:${isCancel ? "#FDECEC" : "#F7FAFB"};border-radius:10px">
      <tr><td style="padding:14px 16px">
        ${change.previousSlotTw ? `<div>原時段　<span style="color:#7A8896">${esc(change.previousSlotTw)}</span></div>` : ""}
        <div${change.previousSlotTw ? ` style="margin-top:4px"` : ""}>${isCancel ? "取消時段" : "新時段"}　<b>${esc(slotTw)}</b></div>
        <div style="margin-top:4px">方式　<b>${esc(meetTypeLabel(a.meetType))}</b></div>
        ${!isCancel && a.meetUrl ? `<div style="margin-top:4px">🎥 視訊　<a href="${esc(a.meetUrl)}" style="color:#1F6F83">點我加入 Google Meet</a></div>` : ""}
      </td></tr>
    </table>
    <p style="font-size:14px;color:#7A8896;line-height:1.7;margin:18px 0 0">
      ${isCancel ? "如果還需要重新預約,可以回信或直接加茗馥 LINE。" : "確認信與行事曆請以這封更新後的資訊為準。"}
    </p>
  `;
  return sendAppointmentEmailAndRecord({
    appointmentId: a.id,
    purpose: isCancel ? "customer_cancel" : "customer_reschedule",
    to: a.email,
    subject: isCancel ? `預約已取消 · 茗馥（蕭茗馥）` : `預約已改期 · 茗馥（蕭茗馥）`,
    html: transactionalEmailLayout({
      title,
      preheader: isCancel ? `你的預約已取消 · ${slotTw}` : `你的預約已改期 · ${slotTw}`,
      bodyHtml: body,
    }),
  });
}

export async function sendCustomerAppointmentReminder(a: NotifyInput): Promise<boolean> {
  if (process.env.APPOINTMENT_REMINDER_CUSTOMER !== "1") {
    await recordAppointmentNotification({
      appointmentId: a.id,
      purpose: "customer_reminder",
      channel: "email",
      recipient: a.email,
      status: "skipped",
      provider: "config",
      error: "APPOINTMENT_REMINDER_CUSTOMER!=1",
    }).catch(() => {});
    return false;
  }
  const slotTw = formatSlotRangeTw(a.slotAt, a.slotEndAt);
  const body = `
    <p style="font-size:16px;line-height:1.7;margin:0 0 16px">${esc(a.name)} ${GENDER_HONOR[a.gender] || ""}你好,提醒你明天有和茗馥的預約。</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.9;background:#F7FAFB;border-radius:10px">
      <tr><td style="padding:14px 16px">
        <div>📅 時段　<b>${esc(slotTw)}</b></div>
        <div style="margin-top:4px">📍 方式　<b>${esc(meetTypeLabel(a.meetType))}</b></div>
        ${a.meetUrl ? `<div style="margin-top:4px">🎥 視訊　<a href="${esc(a.meetUrl)}" style="color:#1F6F83">點我加入 Google Meet</a></div>` : ""}
      </td></tr>
    </table>
    <p style="font-size:14px;color:#7A8896;line-height:1.7;margin:18px 0 0">若需要改期或取消,請直接回信或加茗馥 LINE。</p>
  `;
  return sendAppointmentEmailAndRecord({
    appointmentId: a.id,
    purpose: "customer_reminder",
    to: a.email,
    subject: `明天預約提醒 · 茗馥（蕭茗馥）`,
    html: transactionalEmailLayout({
      title: "明天預約提醒",
      preheader: `你的預約時間:${slotTw}`,
      bodyHtml: body,
    }),
  });
}

export async function notifyNewAppointment(
  a: NotifyInput,
  options: {
    onlyPending?: boolean;
    phase?: "confirmation_request" | "confirmed";
    notifyAdmin?: boolean;
    notifyCustomer?: boolean;
  } = {},
): Promise<AppointmentNotificationDispatchResult> {
  if (options.phase === "confirmation_request" || a.status === "pending_confirmation") {
    const alreadyDelivered =
      Boolean(options.onlyPending) &&
      await notificationWasDelivered(a.id, "customer_confirmation_request", "email");
    const disabled = process.env.APPOINTMENT_NOTIFY_CUSTOMER === "0";
    const sent = alreadyDelivered || disabled
      ? true
      : await sendCustomerAppointmentConfirmationRequest(a).catch((error) => {
          console.error("[appointment-notify] 客戶確認請求失敗:", error);
          return false;
        });
    const shouldNotifyAdmin = options.notifyAdmin !== false;
    const adminLineAlreadyDelivered =
      !shouldNotifyAdmin ||
      (Boolean(options.onlyPending) &&
        await notificationWasDelivered(a.id, "admin_line_pending", "line"));
    const pendingLineText = [
      "⏳ 新預約待客戶確認",
      `👤 ${a.name}`,
      `☎️ ${a.phone}`,
      `📧 ${a.email}`,
      `📅 ${formatSlotRangeTw(a.slotAt, a.slotEndAt)}`,
      `📍 ${meetTypeLabel(a.meetType)}`,
      a.confirmationDeadline
        ? `確認期限：${formatTwDateTime(a.confirmationDeadline)}`
        : "確認期限：15 分鐘內",
    ].join("\n");
    const adminLineSent = adminLineAlreadyDelivered
      ? true
      : await notifyAbinAdminGroup(pendingLineText).catch((error) => {
          console.error("[appointment-notify] pending admin LINE failed:", error);
          return false;
        });
    if (!adminLineAlreadyDelivered) {
      await recordAppointmentLineResult(a.id, adminLineSent, "admin_line_pending");
    }
    return {
      ok: sent && adminLineSent,
      adminEmail: "skipped",
      adminLine: adminLineAlreadyDelivered ? "skipped" : adminLineSent ? "sent" : "failed",
      customerEmail: alreadyDelivered || disabled ? "skipped" : sent ? "sent" : "failed",
    };
  }

  const slotTw = formatSlotRangeTw(a.slotAt, a.slotEndAt);
  const intentStr = a.intent.length ? a.intent.map(intentLabel).join("、") : "未填";
  const urgencyStr = a.urgency ? urgencyLabel(a.urgency) : "未填";
  const meetStr = meetTypeLabel(a.meetType);
  const honor = GENDER_HONOR[a.gender] || "";
  const loc = appointmentLocation(a.meetType, a.meetLocation);
  const mapUrl = appointmentMapsUrl(a.meetType, a.meetLocation);
  const locManualNote = a.meetType === "custom" && loc?.source === "manual" ? "（客戶自填、未定位）" : "";
  // 給 admin email「見面」欄用的地點 HTML
  const locEmailHtml = loc
    ? `<br>📍 ${esc(loc.name)}${loc.address ? ` ‧ ${esc(loc.address)}` : ""}` +
      `<br><a href="${esc(mapUrl)}" style="color:#2BA9C4;text-decoration:none">🗺 開地圖導航</a>` +
      (locManualNote ? `<span style="color:#7A8896;font-size:13px"> ${locManualNote}</span>` : "")
    : "";
  // 給 LINE 用的地點文字。固定地點（公司面談/分公司/太平洋房屋 梧棲店）茗馥本來就知道在哪，
  // 不塞又長又醜的編碼地圖網址；只有「客戶自訂地點」才附地圖連結。2026-07-17
  const locLineText = loc
    ? `\n📍 地點：${loc.name}${loc.address ? ` ‧ ${loc.address}` : ""}${locManualNote}` +
      (a.meetType === "custom" && mapUrl ? `\n🗺 ${mapUrl}` : "")
    : "";
  const internalManageUrl = `${APPOINTMENT_BASE_URL}/card/booking/manage?token=${encodeURIComponent(createAppointmentManageToken(a.id, a.email))}`;
  const shouldNotifyAdmin = options.notifyAdmin !== false;
  const shouldNotifyCustomer = options.notifyCustomer !== false;

  // ① email 給系統擁有者
  const adminBody = `
    <p style="font-size:18px;line-height:1.7;margin:0 0 18px">有新客戶線上預約,資料如下 👇</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:16px;line-height:1.9;border-collapse:collapse">
      <tr><td style="padding:7px 0;color:#7A8896;width:84px;vertical-align:top">姓名</td><td style="padding:7px 0;font-weight:700">${esc(a.name)} ${honor}</td></tr>
      <tr><td style="padding:7px 0;color:#7A8896;vertical-align:top">電話</td><td style="padding:7px 0"><a href="tel:${esc(a.phone)}" style="color:#2BA9C4;text-decoration:none">${esc(a.phone)}</a></td></tr>
      <tr><td style="padding:7px 0;color:#7A8896;vertical-align:top">Email</td><td style="padding:7px 0">${esc(a.email)}</td></tr>
      ${a.lineId ? `<tr><td style="padding:7px 0;color:#7A8896;vertical-align:top">LINE</td><td style="padding:7px 0">${esc(a.lineId)}</td></tr>` : ""}
      <tr><td style="padding:7px 0;color:#7A8896;vertical-align:top">需求</td><td style="padding:7px 0;font-weight:700;color:#E0950A">${esc(intentStr)}</td></tr>
      <tr><td style="padding:7px 0;color:#7A8896;vertical-align:top">急迫度</td><td style="padding:7px 0">${esc(urgencyStr)}</td></tr>
      <tr><td style="padding:7px 0;color:#7A8896;vertical-align:top">時段</td><td style="padding:7px 0;font-weight:700">${esc(slotTw)}</td></tr>
      <tr><td style="padding:7px 0;color:#7A8896;vertical-align:top">見面</td><td style="padding:7px 0">${esc(meetStr)}${locEmailHtml}${a.meetUrl ? `<br><a href="${esc(a.meetUrl)}" style="color:#2BA9C4;text-decoration:none">🎥 Google Meet 連結</a>` : ""}</td></tr>
    </table>
    ${a.note ? `<div style="margin-top:16px;padding:14px 16px;background:#FEF3DF;border-radius:10px;font-size:16px;line-height:1.7"><b>客戶備註</b><br>${esc(a.note).replace(/\n/g, "<br>")}</div>` : ""}
    ${a.aiSuggestion ? `<div style="margin-top:16px;padding:14px 16px;background:#E8F7FB;border-radius:10px;font-size:15px;line-height:1.7"><b>🤖 AI 研判</b>　${esc(a.aiSuggestion)}</div>` : ""}
    <div style="margin-top:16px;padding:14px 16px;background:#FFF7E8;border:1px solid #F5A91D;border-radius:12px;font-size:14px;color:#1C2D3A;line-height:1.7">
      <b>內部用</b><br>
      這個入口給茗馥查看 / 管理這筆預約;不是給客戶看的確認信。
      <div style="text-align:center;margin-top:12px">
        <a href="${esc(internalManageUrl)}" style="display:inline-block;background:#F5A91D;color:#1C2D3A;font-size:15px;font-weight:800;padding:11px 18px;border-radius:12px;text-decoration:none">內部用：管理這筆預約</a>
      </div>
    </div>
  `;
  const adminEmailAlreadyDelivered =
    !shouldNotifyAdmin ||
    (Boolean(options.onlyPending) && await notificationWasDelivered(a.id, "admin_new", "email"));
  const adminEmailSent = adminEmailAlreadyDelivered
    ? true
    : await sendAppointmentEmailAndRecord({
        appointmentId: a.id,
        purpose: "admin_new",
        to: BINGE_EMAIL,
        subject: `🔔 新預約 ‧ ${a.name}${honor}（${intentStr}）${slotTw}`,
        html: realtorEmailLayout({
          title: "🔔 你有一筆新預約",
          preheader: `${a.name} ‧ ${intentStr} ‧ ${slotTw}`,
          bodyHtml: adminBody,
        }),
      });

  // ② LINE 給系統擁有者（茗馥 admin 群,自動 mint token）
  const lineText =
    `🔔 新預約\n` +
    `👤 ${a.name} ${honor}\n` +
    `📞 ${a.phone}\n` +
    `📧 ${a.email}\n` +
    (a.lineId ? `💬 LINE：${a.lineId}\n` : "") +
    `🎯 ${intentStr} ‧ ${urgencyStr}\n` +
    `📅 ${slotTw}\n` +
    `📍 ${meetStr}` +
    locLineText +
    (a.meetUrl ? `\n🎥 ${a.meetUrl}` : "") +
    (a.note ? `\n📝 ${a.note}` : "") +
    (a.aiSuggestion ? `\n🤖 ${a.aiSuggestion}` : "");
  const adminLineAlreadyDelivered =
    !shouldNotifyAdmin ||
    (Boolean(options.onlyPending) && await notificationWasDelivered(a.id, "admin_line_new", "line"));
  const lineSent = adminLineAlreadyDelivered
    ? true
    : await notifyAbinAdminGroup(lineText).catch((e) => {
        console.error("[appointment-notify] LINE 失敗:", e);
        return false;
      });
  if (!adminLineAlreadyDelivered) await recordAppointmentLineResult(a.id, lineSent);

  // ③ email 確認給客戶（2026-06-19 系統擁有者拍板開啟:預設寄,除非明設 APPOINTMENT_NOTIFY_CUSTOMER=0 才關）
  const customerAlreadyDelivered =
    !shouldNotifyCustomer ||
    (Boolean(options.onlyPending) && await notificationWasDelivered(a.id, "customer_confirmation", "email"));
  const customerDisabled = process.env.APPOINTMENT_NOTIFY_CUSTOMER === "0";
  const customerEmailSent = customerAlreadyDelivered
    ? true
    : await sendCustomerAppointmentConfirmation(a).catch((e) => {
        console.error("[appointment-notify] 客戶 email 失敗:", e);
        return false;
      });

  return {
    ok: adminEmailSent && lineSent && (customerEmailSent || customerDisabled),
    adminEmail: adminEmailAlreadyDelivered ? "skipped" : adminEmailSent ? "sent" : "failed",
    adminLine: adminLineAlreadyDelivered ? "skipped" : lineSent ? "sent" : "failed",
    customerEmail:
      customerAlreadyDelivered || customerDisabled
        ? "skipped"
        : customerEmailSent
          ? "sent"
          : "failed",
  };
}

export async function notifyAppointmentChange(
  a: NotifyInput,
  change: { type: "reschedule" | "cancel"; previousSlotTw?: string | null },
  options: { notifyCustomer?: boolean; notifyAdmin?: boolean; onlyPending?: boolean } = {},
): Promise<AppointmentNotificationDispatchResult> {
  const customerPurpose: AppointmentNotificationPurpose =
    change.type === "cancel" ? "customer_cancel" : "customer_reschedule";
  const adminPurpose: AppointmentNotificationPurpose =
    change.type === "cancel" ? "admin_customer_cancel" : "admin_customer_reschedule";
  const shouldNotifyCustomer = options.notifyCustomer !== false;
  const shouldNotifyAdmin = options.notifyAdmin === true;

  const customerAlreadyDelivered =
    Boolean(options.onlyPending) &&
    await notificationWasDelivered(a.id, customerPurpose, "email");
  const customerDisabled = process.env.APPOINTMENT_NOTIFY_CUSTOMER === "0";
  const customerEmailSent =
    !shouldNotifyCustomer || customerAlreadyDelivered || customerDisabled
      ? true
      : await sendCustomerAppointmentChangeEmail(a, change);

  const adminAlreadyDelivered =
    Boolean(options.onlyPending) &&
    await notificationWasDelivered(a.id, adminPurpose, "line");
  let adminLineSent = true;
  if (shouldNotifyAdmin && !adminAlreadyDelivered) {
    const slotTw = formatSlotRangeTw(a.slotAt, a.slotEndAt);
    const title = change.type === "cancel" ? "客戶取消預約" : "客戶改期";
    const lineText = [
      `${change.type === "cancel" ? "🚫" : "🔄"} ${title}`,
      `👤 ${a.name}`,
      change.previousSlotTw ? `原時段：${change.previousSlotTw}` : "",
      change.type === "reschedule" ? `新時段：${slotTw}` : `取消時段：${slotTw}`,
      `📞 ${a.phone}`,
    ].filter(Boolean).join("\n");
    adminLineSent = await notifyAbinAdminGroup(lineText).catch((e) => {
      console.error(`[appointment-notify] ${change.type} admin LINE 失敗:`, e);
      return false;
    });
    await recordAppointmentNotification({
      appointmentId: a.id,
      purpose: adminPurpose,
      channel: "line",
      recipient: process.env.ABIN_HITL_GROUP_ID || process.env.LINE_ADMIN_GROUP_ID || null,
      status: adminLineSent ? "sent" : "failed",
      provider: "line",
      error: adminLineSent ? null : "LINE push failed or group env missing",
    });
  }

  return {
    ok: customerEmailSent && adminLineSent,
    customerEmail:
      !shouldNotifyCustomer || customerAlreadyDelivered || customerDisabled
        ? "skipped"
        : customerEmailSent
          ? "sent"
          : "failed",
    adminLine:
      !shouldNotifyAdmin || adminAlreadyDelivered
        ? "skipped"
        : adminLineSent
          ? "sent"
          : "failed",
  };
}
