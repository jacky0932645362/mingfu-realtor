/**
 * 客戶預約系統 — 純常數 + 規則 + 時區 helper（2026-06-19）
 * ⚠️ 不 import db / 任何 server-only 模組,client + server 都可安全 import（前台表單需要 INTENTS 等）。
 * ⏰ 時區:DB 存 UTC,台灣牆鐘用固定 +8 換算（台灣無日光節約,offset 永遠 +8）。
 */

// ---- 可預約規則 ----
// 2026-07-17：時段改「15 分鐘為單位選起始時間 + 選時長」（方案 A）。
//   slotMinutes=15 同時是「併發防撞號 slot lock」的格粒度（見 appointment.ts occupiedSlotHours）—
//   所有起訖都對齊 15 分鐘網格，任何時間重疊都會在 lock 表撞 PK。
export const BOOKING_RULES = {
  startHour: 10, // 每天 10:00 開始
  endHour: 18, // 最後一格結束 18:00（晚 6 點後不開放,系統擁有者拍板）
  slotMinutes: 15, // 15 分鐘一格（起始時間 + 併發鎖粒度）
  minDurationMin: 30, // 最短談 30 分（系統擁有者拍板）
  durations: [30, 60, 90, 120, 180], // 可選時長（分鐘）
  // 2026-08-12：改成七天全開。原本 [1,2,3,4,5] 只開平日，但房仲的主戰場是假日看屋，
  //   週末關掉等於把最會成交的兩天擋在門外（蕭茗馥拍板）。
  //   generateOpenSlots 與 appointment-public-validation 都讀這個值，改這裡就好。
  workDays: [0, 1, 2, 3, 4, 5, 6], // 日一二三四五六 —— 七天全開
  leadHours: 2, // 至少提前 2 小時
  daysAhead: 14, // 開放未來 14 天
} as const;

export const DURATION_OPTIONS = BOOKING_RULES.durations;

// slotMinutes 曾=60；改 15 分後，slot_end_at=NULL 的「歷史」預約（欄位 2026-06-25 才加）
// 其真實時長是 1 小時，不能跟著 slotMinutes 縮成 15 分。所有「NULL end 預設多久」一律用這個常數，
// 與 slotMinutes 脫鉤（顯示 / isSlotTaken / getBookedSlots / 補鎖 migration / 改期 全部一致）。2026-07-17
export const LEGACY_DEFAULT_DURATION_MIN = 60;

// ---- 意圖（含動態 placeholder:選哪類,備註提示就換哪句）----
// interviewOnly 的（面試）只在 /card/booking?type=interview 專用連結顯示;預設客戶端不出現。2026-07-17
export const INTENTS = [
  { key: "buy", label: "買房", emoji: "🏠", placeholder: "例:想找沙鹿三房、預算 1,200 萬、自住自用" },
  { key: "sell", label: "賣房", emoji: "🏷️", placeholder: "例:梧棲透天想賣、換屋週轉、希望盡快出售" },
  { key: "rent", label: "租賃", emoji: "🔑", placeholder: "例:想租 or 出租、想要的區域、預算、何時要" },
  { key: "legal", label: "法律諮詢", emoji: "⚖️", placeholder: "例:繼承過戶、產權問題、買賣糾紛、貸款疑問" },
  { key: "interview", label: "面試", emoji: "🧑‍💼", placeholder: "例:應徵職位、方便聯絡的時間、想先了解的事", interviewOnly: true },
  { key: "other", label: "其他", emoji: "💬", placeholder: "簡單描述你想找茗馥聊的事" },
] as const;

export const URGENCIES = [
  { key: "asap", label: "越快越好(這個月)", emoji: "🔥" },
  { key: "soon", label: "1-3 個月", emoji: "🙂" },
  { key: "explore", label: "先了解、還不急", emoji: "👀" },
] as const;

// 2026-08-12：原範本有「分公司」「工作室」兩個範例地點（台中西屯的假地址），
// 蕭茗馥只有梧棲一間門市，全部移除，只留門市 / 電話 / 視訊 / 客戶指定四種。
export const MEET_TYPES = [
  { key: "office", label: "門市面談", emoji: "🏢", desc: "太平洋房屋 梧棲市鎮加盟店・台中市梧棲區四維中路338號" },
  { key: "phone", label: "電話聯繫", emoji: "📞", desc: "茗馥主動來電" },
  { key: "video", label: "線上視訊", emoji: "💻", desc: "Google Meet / LINE 視訊" },
  // 2026-06-25 第 4 種:客戶自己指定見面地點（Google Places 自動完成 + 純文字備案）
  { key: "custom", label: "我指定地點", emoji: "📍", desc: "你來指定見面地點" },
] as const;

/** 依模式回傳要顯示的需求選項：interview 專用連結才出現「面試」，預設客戶端不出現。2026-07-17 */
export function intentsForMode(interview: boolean): ReadonlyArray<(typeof INTENTS)[number]> {
  return interview
    ? INTENTS.filter((i) => i.key === "interview" || i.key === "other")
    : INTENTS.filter((i) => !("interviewOnly" in i && i.interviewOnly));
}

/**
 * 客戶自訂見面地點（meet_type='custom' 時填）。
 * source='google' = 從 Google Places 建議選的（有座標）；
 * source='manual' = Google 搜不到、客戶直接打字（無座標、未定位）。
 */
export type MeetLocation = {
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
  source: "google" | "manual";
};

export type IntentKey = (typeof INTENTS)[number]["key"];
export type UrgencyKey = (typeof URGENCIES)[number]["key"];
export type MeetTypeKey = (typeof MEET_TYPES)[number]["key"];

export const BOOKING_MODES = [
  { key: "realtor", label: "房產諮詢" },
  { key: "collaboration", label: "異業合作 / 媒體採訪" },
  { key: "interview", label: "面試預約" },
] as const;

export type BookingMode = (typeof BOOKING_MODES)[number]["key"];
export const BOOKING_MODE_KEYS = BOOKING_MODES.map((mode) => mode.key) as readonly string[];

/** 合作洽談的正式分類。key 供系統判斷，label 供日曆與後台顯示。 */
export const COLLABORATION_INTENTS = [
  { key: "video", label: "內容／影音合作", description: "YouTube、短影音、Podcast、聯名內容" },
  { key: "course", label: "講座／分享會", description: "房產講座、企業內訓、社區分享會" },
  { key: "brand", label: "異業／商務合作", description: "建商、代銷、金融或裝修異業合作" },
  { key: "media", label: "媒體採訪", description: "採訪、節目、專題或資料邀請" },
] as const;

export type CollaborationIntentKey = (typeof COLLABORATION_INTENTS)[number]["key"];
export type CollaborationIntent = {
  key: CollaborationIntentKey;
  label: (typeof COLLABORATION_INTENTS)[number]["label"];
};

/**
 * 只回傳 allowlist 內的合作分類。舊資料沒有 key 時，從 purpose 的中文前綴回推。
 * label 永遠取系統常數，不信任客戶端自行送入的文字。
 */
export function resolveCollaborationIntent(input: {
  key?: unknown;
  label?: unknown;
  purpose?: unknown;
}): CollaborationIntent | null {
  const key = String(input.key || "").trim();
  const byKey = COLLABORATION_INTENTS.find((item) => item.key === key);
  if (byKey) return { key: byKey.key, label: byKey.label };

  const label = String(input.label || "").trim();
  const byLabel = COLLABORATION_INTENTS.find((item) => item.label === label);
  if (byLabel) return { key: byLabel.key, label: byLabel.label };

  const purpose = String(input.purpose || "").trim();
  const byPurpose = COLLABORATION_INTENTS.find((item) =>
    purpose === item.label || purpose.startsWith(`${item.label}：`) || purpose.startsWith(`${item.label}:`),
  );
  return byPurpose ? { key: byPurpose.key, label: byPurpose.label } : null;
}

export type AppointmentStatus = "pending_confirmation" | "confirmed" | "completed" | "cancelled" | "expired";
export type AppointmentAttendanceStatus = "pending" | "confirmed" | "arrived" | "no_show";
export type AppointmentOutcomeStatus = "none" | "hot" | "nurture" | "unqualified" | "closed_won" | "closed_lost";
export type AppointmentContactStatus = "uncontacted" | "contacted" | "waiting_customer" | "followup_due" | "closed";

export const BOOKING_CONFIRMATION_HOLD_MINUTES = 15;

export type AppointmentQualification = {
  area?: string;
  budget?: string;
  purpose?: string;
  collaborationIntentKey?: CollaborationIntentKey;
  collaborationIntentLabel?: CollaborationIntent["label"];
  propertyAddress?: string;
  propertyType?: string;
  legalTopic?: string;
  role?: string;
  targetDate?: string;
};

export type AppointmentMeetingPolicy = {
  leadHours: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  publicDurations: readonly number[];
};

// 2026-08-12：
//   ① 門市面談 leadHours 12 → 4。假日臨時起意想看屋的客人不少，12 小時等於
//      「週六早上想約當天下午」直接約不到，把最衝動的那批客戶擋在門外（蕭茗馥拍板）。
//   ② 一併移除 hq / studio 兩筆。MEET_TYPES 已經拿掉這兩個地點，MeetTypeKey 不再包含它們，
//      留著會讓 `npm run build` 的型別檢查失敗（dev 模式不會擋，上 Vercel 才爆）。
export const APPOINTMENT_MEETING_POLICIES: Record<MeetTypeKey, AppointmentMeetingPolicy> = {
  office: { leadHours: 4, bufferBeforeMin: 15, bufferAfterMin: 15, publicDurations: [60] },
  phone: { leadHours: 2, bufferBeforeMin: 10, bufferAfterMin: 10, publicDurations: [30, 60] },
  video: { leadHours: 2, bufferBeforeMin: 10, bufferAfterMin: 10, publicDurations: [30, 60] },
  custom: { leadHours: 24, bufferBeforeMin: 45, bufferAfterMin: 45, publicDurations: [60] },
};

export function appointmentMeetingPolicy(meetType: string): AppointmentMeetingPolicy {
  return APPOINTMENT_MEETING_POLICIES[meetType as MeetTypeKey] || APPOINTMENT_MEETING_POLICIES.office;
}

export const INTENT_KEYS = INTENTS.map((i) => i.key) as readonly string[];
export const URGENCY_KEYS = URGENCIES.map((u) => u.key) as readonly string[];
export const MEET_TYPE_KEYS = MEET_TYPES.map((m) => m.key) as readonly string[];

export function intentLabel(key: string): string {
  return INTENTS.find((i) => i.key === key)?.label || key;
}
export function urgencyLabel(key: string): string {
  return URGENCIES.find((u) => u.key === key)?.label || key;
}
export function meetTypeLabel(key: string): string {
  return MEET_TYPES.find((m) => m.key === key)?.label || key;
}

// 2026-08-06：後台案件卡把「目的／需求」升成大標，需要跟前台表單同一顆 emoji（同一份清單 = 不會漂）。
export function intentEmoji(key: string): string {
  return INTENTS.find((i) => i.key === key)?.emoji || "💬";
}
export function urgencyEmoji(key: string): string {
  return URGENCIES.find((u) => u.key === key)?.emoji || "";
}
export function meetTypeEmoji(key: string): string {
  return MEET_TYPES.find((m) => m.key === key)?.emoji || "";
}

// ---- 台灣時區 helper ----
const TW_OFFSET_MS = 8 * 3600_000;

/** UTC Date → 台灣牆鐘字串,例「2026/06/23（週二） 14:00」*/
export function formatSlotTw(d: Date): string {
  const tw = new Date(d.getTime() + TW_OFFSET_MS);
  const wd = ["日", "一", "二", "三", "四", "五", "六"][tw.getUTCDay()];
  const y = tw.getUTCFullYear();
  const m = String(tw.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(tw.getUTCDate()).padStart(2, "0");
  const h = tw.getUTCHours();
  const mi = String(tw.getUTCMinutes()).padStart(2, "0");
  const endH = String((h + 1) % 24).padStart(2, "0");
  return `${y}/${m}/${dd}（週${wd}） ${String(h).padStart(2, "0")}:${mi}–${endH}:00`;
}

// ---- DB row 型別 ----
export type AppointmentRow = {
  id: string;
  booking_mode: BookingMode | null;
  name: string;
  gender: string;
  phone: string;
  email: string;
  line_id: string | null;
  meet_type: string;
  /** 客戶自訂見面地點 JSON（MeetLocation 字串化）；非 custom 為 null。2026-06-25 */
  meet_location: string | null;
  intent: string | null;
  qualification_json: string | null;
  urgency: string | null;
  note: string | null;
  slot_at: Date;
  slot_end_at: Date | null;
  status: string;
  confirmation_deadline: Date | null;
  attendance_status: AppointmentAttendanceStatus | null;
  outcome_status: AppointmentOutcomeStatus | null;
  outcome_note: string | null;
  contact_status: AppointmentContactStatus | null;
  first_contacted_at: Date | null;
  next_followup_at: Date | null;
  estimated_commission: number | null;
  actual_commission: number | null;
  case_reference: string | null;
  /** 顯示用的人話案件編號 AP-260806-01（2026-08-06）。`id` 是系統內部用的 32 碼亂數，不對外顯示。 */
  case_no: string | null;
  ai_heat: string | null;
  ai_film: number;
  ai_suggestion: string | null;
  ai_summary: string | null;
  ai_next_action: string | null;
  ai_profile: string | null;
  google_event_id: string | null;
  meet_url: string | null;
  calendar_sync_status: string | null;
  calendar_sync_error: string | null;
  calendar_synced_at: Date | null;
  customer_email_status: string | null;
  admin_email_status: string | null;
  line_notify_status: string | null;
  last_notify_error: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  referrer: string | null;
  user_agent: string | null;
  device: string | null;
  from_page: string | null;
  funnel_session_id: string | null;
  tracking_consent_receipt_id: string | null;
  tracking_consent_subject_id: string | null;
  tracking_consent_version: string | null;
  analytics_consent_granted: number | boolean;
  marketing_consent_granted: number | boolean;
  tracking_consent_at: Date | null;
  ga_client_id: string | null;
  meta_fbp: string | null;
  meta_fbc: string | null;
  idempotency_key: string | null;
  source: string | null;
  created_at: Date;
  updated_at: Date | null;
  cancelled_at: Date | null;
  reminder_24h_sent_at: Date | null;
  customer_reminder_24h_sent_at: Date | null;
  admin_reminder_24h_sent_at: Date | null;
};

// ---- 純規則:產生未來開放時段（台灣時區,扣非營業日 / 營業時間 / lead / 已佔）----
// 2026-07-17：15 分鐘網格。每個「起始時間」帶 maxDurationMin＝從它起連續空著、到下一筆已佔或 18:00
//   為止的分鐘數（給前端過濾時長按鈕：只顯示 ≤ maxDurationMin 的時長）。
//   blockedIso＝不可用的 15 分鐘格 ISO 集合（已佔預約 + Google 日曆 busy，皆由 slots route 展開成 15 分格點）。
export type OpenSlot = { iso: string; label: string; maxDurationMin: number };
export type OpenDay = { date: string; label: string; weekday: number; slots: OpenSlot[] };

export function generateOpenSlots(
  now: Date,
  blockedIso: Set<string>,
  options?: { leadHours?: number; minDurationMin?: number; durations?: readonly number[] },
): OpenDay[] {
  const days: OpenDay[] = [];
  const leadHours = options?.leadHours ?? BOOKING_RULES.leadHours;
  const minDurationMin = options?.minDurationMin ?? BOOKING_RULES.minDurationMin;
  const durations = options?.durations?.length ? options.durations : BOOKING_RULES.durations;
  const minTime = now.getTime() + leadHours * 3600_000;
  const tw = new Date(now.getTime() + TW_OFFSET_MS);
  const baseY = tw.getUTCFullYear();
  const baseM = tw.getUTCMonth();
  const baseD = tw.getUTCDate();
  const wdLabel = ["日", "一", "二", "三", "四", "五", "六"];
  const step = BOOKING_RULES.slotMinutes; // 15
  const dayStartMin = BOOKING_RULES.startHour * 60; // 600
  const dayEndMin = BOOKING_RULES.endHour * 60; // 1080
  const maxDur = Math.max(...durations);

  for (let d = 0; d <= BOOKING_RULES.daysAhead; d++) {
    const dayTw = new Date(Date.UTC(baseY, baseM, baseD + d));
    const wd = dayTw.getUTCDay();
    if (!(BOOKING_RULES.workDays as readonly number[]).includes(wd)) continue; // 非營業日不排
    const y = dayTw.getUTCFullYear();
    const m = dayTw.getUTCMonth();
    const dd = dayTw.getUTCDate();
    // 台灣「當天分鐘數」→ 真實 UTC ISO（台灣 = UTC+8，故 UTC 時 = 台灣時 - 8）
    const isoAt = (minOfDay: number) =>
      new Date(Date.UTC(y, m, dd, Math.floor(minOfDay / 60) - 8, minOfDay % 60, 0)).toISOString();
    // 某 15 分格是否可用（在營業時段內、過 lead time、未被佔）
    const freeAt = (minOfDay: number): boolean => {
      if (minOfDay < dayStartMin || minOfDay >= dayEndMin) return false;
      const iso = isoAt(minOfDay);
      if (new Date(iso).getTime() < minTime) return false;
      return !blockedIso.has(iso);
    };

    const slots: OpenSlot[] = [];
    // 最後一個起點 = 18:00 - 最短時長（例 17:30 才容得下 30 分）
    for (let s = dayStartMin; s <= dayEndMin - minDurationMin; s += step) {
      if (!freeAt(s)) continue;
      // 從 s 起連續可用的分鐘數（碰到已佔格或 18:00 就停）
      let avail = 0;
      for (let t = s; t < dayEndMin && freeAt(t); t += step) avail += step;
      if (avail < minDurationMin) continue;
      const h = Math.floor(s / 60);
      const mi = s % 60;
      slots.push({
        iso: isoAt(s),
        label: `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`,
        maxDurationMin: Math.min(avail, maxDur),
      });
    }
    if (slots.length) {
      days.push({
        date: `${y}-${String(m + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`,
        label: `${m + 1}/${dd}（週${wdLabel[wd]}）`,
        weekday: wd,
        slots,
      });
    }
  }
  return days;
}
