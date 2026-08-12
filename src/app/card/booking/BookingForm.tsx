"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefCallback,
} from "react";
import {
  BOOKING_CONFIRMATION_HOLD_MINUTES,
  BOOKING_MODES,
  COLLABORATION_INTENTS,
  MEET_TYPES,
  URGENCIES,
  appointmentMeetingPolicy,
  type BookingMode,
  type MeetLocation,
  type OpenDay,
} from "@/lib/appointment-constants";
import { SOCIAL } from "../_links";
import styles from "./Booking.module.css";
import {
  TRACKING_CONSENT_CHANGED_EVENT,
  hasVerifiedTrackingConsent,
} from "@/lib/tracking-consent";

type ApprovalState = "locked" | "checking" | "approved" | "invalid" | "unavailable";
type FieldErrors = Record<string, string>;
type Qualification = Record<string, string>;

type DoneState = {
  status: "pending_confirmation" | "confirmed";
  confirmationDeadline: string | null;
  slotLabel: string;
  meetUrl: string | null;
  mapsUrl: string | null;
  calendarUrl: string | null;
  icsUrl: string | null;
  manageUrl: string | null;
};

type IntentOption = {
  key: string;
  label: string;
  description: string;
  apiIntent: "buy" | "sell" | "rent" | "legal" | "interview" | "other";
};

function readCookie(name: string): string {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function readGaClientId(): string {
  const parts = readCookie("_ga").split(".");
  return parts.length >= 4 ? `${parts[2]}.${parts[3]}` : "";
}

const MODE_DESCRIPTIONS: Record<BookingMode, string> = {
  realtor: "買賣、租賃、房產法律或其他不動產問題",
  collaboration: "異業合作、媒體採訪、講座或品牌合作",
  interview: "應徵太平洋房屋 梧棲市鎮加盟店相關職務",
};

const MODE_INTENTS: Record<BookingMode, IntentOption[]> = {
  realtor: [
    { key: "buy", label: "買房", description: "找自住、置產或換屋物件", apiIntent: "buy" },
    { key: "sell", label: "賣房", description: "估價、出售或換屋規劃", apiIntent: "sell" },
    { key: "rent", label: "租賃", description: "找出租物件或委託出租", apiIntent: "rent" },
    { key: "legal", label: "房產法律", description: "繼承、產權、買賣糾紛", apiIntent: "legal" },
    { key: "other", label: "其他房產問題", description: "不確定分類也可以先說明", apiIntent: "other" },
  ],
  collaboration: [
    ...COLLABORATION_INTENTS.map((item) => ({ ...item, apiIntent: "other" as const })),
  ],
  interview: [
    { key: "realtor", label: "房仲業務", description: "門市業務、儲備幹部或轉職諮詢", apiIntent: "interview" },
    { key: "operations", label: "行政／客服", description: "營運、行政、客服相關職務", apiIntent: "interview" },
    { key: "marketing", label: "影音／行銷", description: "剪輯、內容、社群或廣告職務", apiIntent: "interview" },
    { key: "job_other", label: "其他職務", description: "尚未確定職缺，先聊適合方向", apiIntent: "interview" },
  ],
};

// 2026-08-12：拿掉 hq / studio（範本的假地點），只留實際存在的梧棲門市與遠距方式。
const MEET_TYPES_BY_MODE: Record<BookingMode, readonly string[]> = {
  realtor: ["office", "phone", "video", "custom"],
  collaboration: ["office", "video", "phone", "custom"],
  interview: ["office", "video", "phone"],
};

const TW_OFFSET_MS = 8 * 60 * 60_000;
const PROFILE_KEY = "booking_profile_v2";
const SESSION_KEY = "booking_session";

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} 分鐘`;
  if (minutes % 60 === 0) return `${minutes / 60} 小時`;
  return `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分鐘`;
}

function formatTimeRange(iso: string, duration: number): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + duration * 60_000);
  const hm = (value: Date) => {
    const tw = new Date(value.getTime() + TW_OFFSET_MS);
    return `${String(tw.getUTCHours()).padStart(2, "0")}:${String(tw.getUTCMinutes()).padStart(2, "0")}`;
  };
  return `${hm(start)}–${hm(end)}`;
}

function formatTwDateTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "";
  const tw = new Date(value.getTime() + TW_OFFSET_MS);
  return `${tw.getUTCMonth() + 1}/${tw.getUTCDate()} ${String(tw.getUTCHours()).padStart(2, "0")}:${String(tw.getUTCMinutes()).padStart(2, "0")}`;
}

function parseMeetLocation(value: unknown): MeetLocation | null {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== "object") return null;
  const raw = candidate as Record<string, unknown>;
  const name = String(raw.name || raw.label || "").trim();
  if (!name) return null;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  return {
    name: name.slice(0, 120),
    address: String(raw.address || "").trim().slice(0, 200),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    placeId: String(raw.placeId || raw.place_id || "").trim().slice(0, 200) || null,
    source: raw.source === "google" ? "google" : "manual",
  };
}

function qualificationFields(mode: BookingMode, intent: string) {
  if (mode === "collaboration") {
    return [
      { key: "organization", label: "公司／單位名稱", placeholder: "例：XX 品牌、XX 媒體", required: true },
      { key: "role", label: "你的職稱／角色", placeholder: "例：行銷經理、製作人", required: true },
      { key: "purpose", label: "希望合作的內容", placeholder: "請說明形式、對象與希望茗馥參與的部分", required: true, multiline: true },
      { key: "targetDate", label: "預計合作日期", placeholder: "例：8 月中、尚未確定", required: true },
    ];
  }
  if (mode === "interview") {
    return [
      { key: "role", label: "想應徵的職務", placeholder: "例：台中房仲業務", required: true },
      { key: "experience", label: "相關經歷", placeholder: "例：房仲 2 年；無經驗但有業務背景", required: true, multiline: true },
      { key: "targetDate", label: "最快可到職日期", placeholder: "例：隨時、8/15 之後", required: true },
      { key: "portfolio", label: "作品集／履歷連結", placeholder: "選填；可貼 Google Drive、LinkedIn 等網址", required: false },
    ];
  }
  if (intent === "buy" || intent === "rent") {
    return [
      { key: "area", label: "希望區域", placeholder: "例：北屯、西屯、七期", required: true },
      { key: "budget", label: intent === "buy" ? "購屋預算" : "每月租金預算", placeholder: "例：1,500 萬；每月 30,000 元", required: true },
      { key: "purpose", label: "需求重點", placeholder: "例：自住三房、有車位、近學區", required: true, multiline: true },
      { key: "targetDate", label: intent === "buy" ? "預計購屋時間" : "預計入住時間", placeholder: "例：3 個月內", required: true },
    ];
  }
  if (intent === "sell") {
    return [
      { key: "propertyAddress", label: "物件大約位置", placeholder: "例：梧棲區四維中路，填到路名即可", required: true },
      { key: "propertyType", label: "物件類型", placeholder: "例：電梯大樓三房、透天", required: true },
      { key: "purpose", label: "出售原因／期待", placeholder: "例：換屋，希望先了解行情與銷售期", required: true, multiline: true },
      { key: "targetDate", label: "希望出售時間", placeholder: "例：3 個月內、先評估", required: true },
    ];
  }
  if (intent === "legal") {
    return [
      { key: "legalTopic", label: "問題類型", placeholder: "例：繼承、共有、漏水、買賣糾紛", required: true },
      { key: "purpose", label: "事情摘要", placeholder: "請簡述已發生的情況與目前卡住的地方", required: true, multiline: true },
      { key: "targetDate", label: "是否有期限", placeholder: "例：8/20 前要回覆；目前沒有", required: true },
    ];
  }
  return [
    { key: "purpose", label: "想討論的事情", placeholder: "請簡單說明背景與你希望獲得的協助", required: true, multiline: true },
    { key: "targetDate", label: "希望處理時間", placeholder: "例：這個月、先了解", required: true },
  ];
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className={styles.fieldError}>{message}</p> : null;
}

function SectionHeading({
  step,
  title,
  hint,
}: {
  step: number;
  title: string;
  hint: string;
}) {
  return (
    <div className={styles.sectionHeading}>
      <span className={styles.step}>{step}</span>
      <div>
        <h2 className={styles.sectionTitle}>{title}</h2>
        <p className={styles.sectionHint}>{hint}</p>
      </div>
    </div>
  );
}

function Progress({ current }: { current: number }) {
  const labels = ["目的", "需求", "方式", "時間", "資料"];
  return (
    <div className={styles.progress} aria-label={`預約進度：第 ${current} 步，共 5 步`}>
      {labels.map((label, index) => (
        <div key={label} className={`${styles.progressItem} ${index + 1 <= current ? styles.progressItemActive : ""}`}>
          <span className={styles.progressBar} />
          {label}
        </div>
      ))}
    </div>
  );
}

export default function BookingForm() {
  const [bookingMode, setBookingMode] = useState<BookingMode | "">("");
  const [intentKey, setIntentKey] = useState("");
  const [meetType, setMeetType] = useState("");
  const [days, setDays] = useState<OpenDay[]>([]);
  const [activeDate, setActiveDate] = useState("");
  const [selectedStart, setSelectedStart] = useState("");
  const [duration, setDuration] = useState(0);
  const [allowedDurations, setAllowedDurations] = useState<readonly number[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotError, setSlotError] = useState("");

  const [approvalToken, setApprovalToken] = useState("");
  const [approvalState, setApprovalState] = useState<ApprovalState>("locked");
  const [approvedLocation, setApprovedLocation] = useState<MeetLocation | null>(null);
  const [approvedDuration, setApprovedDuration] = useState<number | null>(null);
  const [approvedStartAt, setApprovedStartAt] = useState("");
  const [approvedEndAt, setApprovedEndAt] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [lineId, setLineId] = useState("");
  const [urgency, setUrgency] = useState("");
  const [qualification, setQualification] = useState<Qualification>({});
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<DoneState | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(BOOKING_CONFIRMATION_HOLD_MINUTES * 60);

  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const slotRequestRef = useRef(0);
  const viewTrackedRef = useRef(false);

  const registerRef = useCallback(
    (key: string): RefCallback<HTMLElement> =>
      (node) => {
        fieldRefs.current[key] = node;
      },
    [],
  );

  const clearError = useCallback((key: string) => {
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setSubmitError("");
  }, []);

  const track = useCallback(
    (event: string, detail = "", mode: BookingMode | "" = bookingMode) => {
      if (!trackingEnabled || !sessionId) return;
      try {
        const params = new URLSearchParams(window.location.search);
        void fetch("/api/appointment/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            sessionId,
            event,
            detail,
            bookingMode: mode || null,
            utmSource: params.get("utm_source") || params.get("src") || "",
            utmMedium: params.get("utm_medium") || "",
            utmCampaign: params.get("utm_campaign") || "",
            utmContent: params.get("utm_content") || "",
            utmTerm: params.get("utm_term") || "",
            fromPage: window.location.pathname,
          }),
        }).catch(() => {});
      } catch {
        // Tracking must never block booking.
      }
    },
    [bookingMode, sessionId, trackingEnabled],
  );

  useEffect(() => {
    const sync = () => setTrackingEnabled(hasVerifiedTrackingConsent());
    sync();
    window.addEventListener(TRACKING_CONSENT_CHANGED_EVENT, sync);
    return () => window.removeEventListener(TRACKING_CONSENT_CHANGED_EVENT, sync);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedMode = params.get("mode");
    const initialMode: BookingMode | "" =
      params.get("type") === "interview"
        ? "interview"
        : requestedMode === "realtor" || requestedMode === "collaboration" || requestedMode === "interview"
          ? requestedMode
          : "";
    if (initialMode) setBookingMode(initialMode);

    try {
      const stored = JSON.parse(window.localStorage.getItem(PROFILE_KEY) || "{}") as Record<string, string>;
      setName(String(params.get("name") || stored.name || ""));
      setPhone(String(params.get("phone") || stored.phone || ""));
      setEmail(String(params.get("email") || stored.email || ""));
      setLineId(String(params.get("lineId") || stored.lineId || ""));
    } catch {
      // Prefill is optional.
    }

    setIsInAppBrowser(/line|liff|fbav|fban|fb_iab|instagram|messenger|micromessenger|threads|; wv\)| wv;/i.test(navigator.userAgent || ""));
  }, []);

  useEffect(() => {
    if (!trackingEnabled) {
      setSessionId("");
      window.localStorage.removeItem(SESSION_KEY);
      return;
    }
    let sid = window.localStorage.getItem(SESSION_KEY) || "";
    if (!sid) {
      sid = window.crypto.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(SESSION_KEY, sid);
    }
    setSessionId(sid);
  }, [trackingEnabled]);

  useEffect(() => {
    if (!trackingEnabled || !sessionId || viewTrackedRef.current) return;
    viewTrackedRef.current = true;
    track("view");
  }, [sessionId, track, trackingEnabled]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = String(params.get("location_approval") || "").trim();
    if (!token) return;

    const controller = new AbortController();
    setApprovalToken(token);
    setApprovalState("checking");
    fetch(`/api/appointment/location-approval?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok || data.approved !== true) {
          setApprovalState(response.status === 404 || response.status === 410 ? "invalid" : "unavailable");
          return;
        }
        const approval = data.approval && typeof data.approval === "object"
          ? (data.approval as Record<string, unknown>)
          : data;
        const location = parseMeetLocation(
          approval.location || approval.meetLocation || approval.approvedLocation || approval.meet_location,
        );
        setApprovedLocation(location);
        const constraints = data.constraints && typeof data.constraints === "object"
          ? (data.constraints as Record<string, unknown>)
          : approval.constraints && typeof approval.constraints === "object"
            ? (approval.constraints as Record<string, unknown>)
            : approval;
        const durationValue = Number(
          constraints.durationMinutes ||
          constraints.approvedDurationMinutes ||
          constraints.duration,
        );
        setApprovedDuration(Number.isFinite(durationValue) && durationValue > 0 ? Math.round(durationValue) : null);
        setApprovedStartAt(String(constraints.allowedStartAt || constraints.startAt || ""));
        setApprovedEndAt(String(constraints.allowedEndAt || constraints.endAt || ""));
        setApprovalState(location ? "approved" : "invalid");

        const prefill = approval.contact && typeof approval.contact === "object"
          ? (approval.contact as Record<string, unknown>)
          : approval;
        if (prefill.name) setName((current) => current || String(prefill.name));
        if (prefill.phone) setPhone((current) => current || String(prefill.phone));
        if (prefill.email) setEmail((current) => current || String(prefill.email));
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name !== "AbortError") setApprovalState("unavailable");
      });
    return () => controller.abort();
  }, []);

  const loadSlots = useCallback(async (selectedMeetType: string) => {
    if (!selectedMeetType) return;
    const requestId = ++slotRequestRef.current;
    setLoadingSlots(true);
    setSlotError("");
    try {
      const params = new URLSearchParams({ meetType: selectedMeetType });
      const response = await fetch(`/api/appointment/slots?${params.toString()}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        days?: OpenDay[];
        durations?: number[];
        error?: string;
      };
      if (requestId !== slotRequestRef.current) return;
      if (!response.ok) throw new Error(data.error || "slots_failed");
      let nextDays = Array.isArray(data.days) ? data.days : [];
      if (selectedMeetType === "custom" && (approvedStartAt || approvedEndAt || approvedDuration)) {
        const minTime = approvedStartAt ? new Date(approvedStartAt).getTime() : Number.NEGATIVE_INFINITY;
        const maxTime = approvedEndAt ? new Date(approvedEndAt).getTime() : Number.POSITIVE_INFINITY;
        const durationMs = (approvedDuration || 60) * 60_000;
        nextDays = nextDays
          .map((day) => ({
            ...day,
            slots: day.slots.filter((slot) => {
              const start = new Date(slot.iso).getTime();
              return start >= minTime && start + durationMs <= maxTime;
            }),
          }))
          .filter((day) => day.slots.length > 0);
      }
      setDays(nextDays);
      setActiveDate((current) => nextDays.some((day) => day.date === current) ? current : nextDays[0]?.date || "");
      const policyDurations = appointmentMeetingPolicy(selectedMeetType).publicDurations;
      const serverDurations = Array.isArray(data.durations)
        ? data.durations.filter((value) => Number.isInteger(value) && value > 0)
        : [];
      let nextDurations: readonly number[] = serverDurations.length ? serverDurations : policyDurations;
      if (selectedMeetType === "custom" && approvedDuration) nextDurations = [approvedDuration];
      setAllowedDurations(nextDurations);
      setSelectedStart((current) => {
        const exists = nextDays.some((day) => day.slots.some((slot) => slot.iso === current));
        if (!exists) setDuration(0);
        return exists ? current : "";
      });
    } catch {
      if (requestId !== slotRequestRef.current) return;
      setDays([]);
      setActiveDate("");
      setSelectedStart("");
      setDuration(0);
      setSlotError("目前無法取得可預約時段，請重新整理時段；不用重填其他資料。");
    } finally {
      if (requestId === slotRequestRef.current) setLoadingSlots(false);
    }
  }, [approvedDuration, approvedEndAt, approvedStartAt]);

  useEffect(() => {
    if (!meetType) return;
    setSelectedStart("");
    setDuration(0);
    clearError("slot");
    clearError("duration");
    void loadSlots(meetType);
  }, [clearError, loadSlots, meetType]);

  useEffect(() => {
    if (!done || done.status !== "pending_confirmation" || !done.confirmationDeadline) return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((new Date(done.confirmationDeadline as string).getTime() - Date.now()) / 1000));
      setRemainingSeconds(seconds);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [done]);

  const intentOptions = bookingMode ? MODE_INTENTS[bookingMode] : [];
  const selectedIntent = intentOptions.find((option) => option.key === intentKey) || null;
  const meetingOptions = bookingMode
    ? MEET_TYPES.filter((option) => MEET_TYPES_BY_MODE[bookingMode].includes(option.key))
    : [];
  const activeDay = days.find((day) => day.date === activeDate) || null;
  const selectedSlot = useMemo(
    () => days.flatMap((day) => day.slots.map((slot) => ({ ...slot, dayLabel: day.label })))
      .find((slot) => slot.iso === selectedStart) || null,
    [days, selectedStart],
  );
  const availableDurations = selectedSlot
    ? allowedDurations.filter((value) => value <= selectedSlot.maxDurationMin)
    : [];
  const requiredQualificationFields = bookingMode && intentKey
    ? qualificationFields(bookingMode, intentKey)
    : [];
  const customReady = approvalState === "approved" && Boolean(approvedLocation);

  const currentStep = !bookingMode
    ? 1
    : !intentKey
      ? 2
      : !meetType
        ? 3
        : !selectedStart || !duration
          ? 4
          : 5;

  const chooseMode = (mode: BookingMode) => {
    setBookingMode(mode);
    setIntentKey("");
    setMeetType(approvalToken && customReady && mode !== "interview" ? "custom" : "");
    setQualification({});
    setErrors({});
    track("mode_select", mode, mode);
  };

  const chooseIntent = (key: string) => {
    setIntentKey(key);
    setQualification({});
    clearError("intent");
  };

  const chooseMeetType = (type: string) => {
    if (type === "custom" && !customReady) return;
    setMeetType(type);
    clearError("meetType");
    track("meet_type_select", type);
  };

  const chooseSlot = (iso: string) => {
    setSelectedStart(iso);
    setDuration(0);
    clearError("slot");
    clearError("duration");
    track("slot_select", iso);
  };

  const updateQualification = (key: string, value: string) => {
    setQualification((current) => ({ ...current, [key]: value }));
    clearError(`qualification.${key}`);
  };

  const focusFirstError = (nextErrors: FieldErrors) => {
    const first = Object.keys(nextErrors)[0];
    if (!first) return;
    window.setTimeout(() => {
      const target = fieldRefs.current[first];
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    }, 0);
  };

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (!bookingMode) next.bookingMode = "請先選擇這次預約的目的。";
    if (!intentKey) next.intent = "請選擇最接近的需求。";
    if (!meetType) next.meetType = "請選擇聯繫或見面的方式。";
    if (meetType === "custom" && !customReady) next.meetType = "指定地點必須使用茗馥核准後提供的專屬連結。";
    if (!selectedStart) next.slot = "請選擇可預約的日期與開始時間。";
    if (!duration) next.duration = "請選擇預約時長。";
    if (!name.trim()) next.name = "請填寫姓名。";
    if (!/^[0-9+\-() ]{6,20}$/.test(phone.trim())) next.phone = "請填寫可聯絡的正確電話。";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) next.email = "請填寫正確 Email，確認連結會寄到這裡。";
    if (!urgency) next.urgency = bookingMode === "interview" ? "請選擇目前可安排面談的時間。" : "請選擇希望處理的時間。";
    for (const field of requiredQualificationFields) {
      if (field.required && !String(qualification[field.key] || "").trim()) {
        next[`qualification.${field.key}`] = `請填寫${field.label}。`;
      }
    }
    return next;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError("");
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      focusFirstError(nextErrors);
      return;
    }
    if (!bookingMode || !selectedIntent || !selectedSlot) return;

    setSubmitting(true);
    const key = idempotencyKey || window.crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    setIdempotencyKey(key);
    track("contact_complete", bookingMode);
    track("qualification_complete", selectedIntent.key);
    track("submit_start", selectedStart);

    try {
      const params = new URLSearchParams(window.location.search);
      const qualificationPayload = {
        ...qualification,
        collaborationIntentKey: bookingMode === "collaboration" ? selectedIntent.key : undefined,
        collaborationIntentLabel: bookingMode === "collaboration" ? selectedIntent.label : undefined,
        purpose:
          bookingMode === "collaboration"
            ? `${selectedIntent.label}：${qualification.purpose || ""}`
            : qualification.purpose || selectedIntent.label,
        interviewTrack: bookingMode === "interview" ? selectedIntent.label : undefined,
      };
      const response = await fetch("/api/appointment/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          bookingMode,
          slotIso: selectedStart,
          durationMinutes: duration,
          meetType,
          meetLocation: meetType === "custom" ? approvedLocation : null,
          customLocationApprovalToken: meetType === "custom" ? approvalToken : "",
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          lineId: lineId.trim(),
          intent: [selectedIntent.apiIntent],
          urgency,
          qualification: qualificationPayload,
          note: note.trim(),
          website,
          funnelSessionId: trackingEnabled ? sessionId : "",
          idempotencyKey: key,
          tracking: {
            utmSource: trackingEnabled ? params.get("utm_source") || params.get("src") || "" : "",
            utmMedium: trackingEnabled ? params.get("utm_medium") || "" : "",
            utmCampaign: trackingEnabled ? params.get("utm_campaign") || "" : "",
            utmContent: trackingEnabled ? params.get("utm_content") || "" : "",
            utmTerm: trackingEnabled ? params.get("utm_term") || "" : "",
            referrer: trackingEnabled ? document.referrer || "" : "",
            fromPage: trackingEnabled ? window.location.pathname : "",
            funnelSessionId: trackingEnabled ? sessionId : "",
          },
          trackingIdentifiers: trackingEnabled
            ? {
                gaClientId: readGaClientId(),
                fbp: readCookie("_fbp"),
                fbc: readCookie("_fbc"),
              }
            : {},
        }),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || data.ok !== true) {
        const message = String(data.error || "送出失敗，請稍後再試。");
        const code = String(data.code || "");
        const staleSlotCodes = new Set([
          "",
          "slot_conflict",
          "calendar_conflict",
          "lead_time_required",
          "duration_not_allowed",
          "outside_booking_window",
        ]);
        if (response.status === 409 && staleSlotCodes.has(code)) {
          setSelectedStart("");
          setDuration(0);
          setErrors({ slot: `${message} 系統已更新可選時段，請重新選擇。` });
          setSubmitError("你選的時間已變動，其他資料都已保留。");
          await loadSlots(meetType);
          focusFirstError({ slot: message });
          setIdempotencyKey("");
          return;
        }
        if (code === "idempotency_conflict" || code === "idempotency_closed") {
          setIdempotencyKey("");
        }
        setSubmitError(message);
        track("submit_error", String(response.status));
        return;
      }

      window.localStorage.setItem(PROFILE_KEY, JSON.stringify({ name, phone, email, lineId }));
      const fallbackDeadline = new Date(Date.now() + BOOKING_CONFIRMATION_HOLD_MINUTES * 60_000).toISOString();
      setDone({
        status: data.status === "confirmed" ? "confirmed" : "pending_confirmation",
        confirmationDeadline: String(data.confirmationDeadline || fallbackDeadline),
        slotLabel: String(data.slotLabel || `${selectedSlot.dayLabel} ${formatTimeRange(selectedStart, duration)}`),
        meetUrl: typeof data.meetUrl === "string" ? data.meetUrl : null,
        mapsUrl: typeof data.mapsUrl === "string" ? data.mapsUrl : null,
        calendarUrl: typeof data.calendarUrl === "string" ? data.calendarUrl : null,
        icsUrl: typeof data.icsUrl === "string" ? data.icsUrl : null,
        manageUrl: typeof data.manageUrl === "string" ? data.manageUrl : null,
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setSubmitError("網路連線中斷，資料尚未確認送出。請重試；系統會用同一組識別碼避免重複預約。");
      track("submit_error", "network");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    const pending = done.status === "pending_confirmation";
    const expired = pending && remainingSeconds <= 0;
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <header className={styles.header}>
            <div className={styles.brand}>太平洋房屋 梧棲市鎮加盟店</div>
            <h1 className={styles.title}>預約進度</h1>
          </header>
          <section className={`${styles.statusPanel} ${pending ? styles.statusPanelWarning : ""} ${expired ? styles.statusPanelDanger : ""}`}>
            <h2 className={styles.statusTitle}>
              {expired ? "保留時間已到" : pending ? "還差一步：到 Email 按確認" : "預約已確認"}
            </h2>
            <p className={styles.statusText}>
              {expired
                ? "這個時段可能已釋出。請使用 Email 內的連結查看狀態；若已過期，重新選一個時間即可。"
                : pending
                  ? `系統先替你保留時段 ${BOOKING_CONFIRMATION_HOLD_MINUTES} 分鐘。請到 Email 點「確認預約」，完成後才算正式成立。`
                  : "預約已成立，請把時間加入行事曆；有變動可使用確認信中的管理連結。"}
            </p>
            {pending && !expired ? (
              <span className={styles.countdown} aria-live="polite">
                剩餘 {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
              </span>
            ) : null}
            <div className={styles.infoList}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>預約時段</span>
                <span className={styles.infoValue}>{done.slotLabel}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>確認信</span>
                <span className={styles.infoValue}>{email}</span>
              </div>
            </div>
            {isInAppBrowser && done.icsUrl ? (
              <div className={styles.warningNotice}>
                LINE／Facebook／Instagram 內建瀏覽器可能無法下載行事曆。請用右上角選單改用 Safari 或 Chrome 開啟。
              </div>
            ) : null}
            <div className={styles.actions}>
              {!pending && done.icsUrl && !isInAppBrowser ? (
                <a className={`${styles.actionLink} ${styles.actionLinkPrimary}`} href={done.icsUrl} download>
                  加入手機行事曆
                </a>
              ) : null}
              {!pending && done.calendarUrl ? (
                <a className={styles.actionLink} href={done.calendarUrl} target="_blank" rel="noopener noreferrer">
                  加入 Google 日曆
                </a>
              ) : null}
              {done.manageUrl ? <a className={styles.actionLink} href={done.manageUrl}>管理預約</a> : null}
              <a className={styles.actionLink} href={SOCIAL.line} target="_blank" rel="noopener noreferrer">
                聯絡茗馥
              </a>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.brand}>太平洋房屋 梧棲市鎮加盟店</div>
          <h1 className={styles.title}>預約與茗馥聊聊</h1>
          <p className={styles.lead}>先告訴我這次要談什麼，系統只會顯示適合的方式、時長與必要問題。</p>
          <Progress current={currentStep} />
        </header>

        <form className={styles.form} onSubmit={submit} noValidate>
          <section className={styles.section}>
            <SectionHeading step={1} title="這次預約的目的是？" hint="先選類型，後面的問題才會符合你的情境。" />
            <div className={styles.optionGrid} role="radiogroup" aria-label="預約目的">
              {BOOKING_MODES.map((mode, index) => (
                <button
                  key={mode.key}
                  ref={index === 0 ? registerRef("bookingMode") : undefined}
                  type="button"
                  role="radio"
                  aria-checked={bookingMode === mode.key}
                  className={`${styles.option} ${bookingMode === mode.key ? styles.optionActive : ""}`}
                  onClick={() => chooseMode(mode.key)}
                >
                  <span className={styles.optionTitle}>{mode.label}</span>
                  <span className={styles.optionDescription}>{MODE_DESCRIPTIONS[mode.key]}</span>
                </button>
              ))}
            </div>
            <FieldError message={errors.bookingMode} />
          </section>

          {bookingMode ? (
            <section className={styles.section}>
              <SectionHeading
                step={2}
                title={bookingMode === "interview" ? "想談哪一類職務？" : bookingMode === "collaboration" ? "合作方向是什麼？" : "主要需求是什麼？"}
                hint="選最接近的一項即可，詳細內容會在最後補充。"
              />
              <div className={`${styles.optionGrid} ${styles.optionGridTwo}`} role="radiogroup" aria-label="預約需求">
                {intentOptions.map((option, index) => (
                  <button
                    key={option.key}
                    ref={index === 0 ? registerRef("intent") : undefined}
                    type="button"
                    role="radio"
                    aria-checked={intentKey === option.key}
                    className={`${styles.option} ${intentKey === option.key ? styles.optionActive : ""}`}
                    onClick={() => chooseIntent(option.key)}
                  >
                    <span className={styles.optionTitle}>{option.label}</span>
                    <span className={styles.optionDescription}>{option.description}</span>
                  </button>
                ))}
              </div>
              <FieldError message={errors.intent} />
            </section>
          ) : null}

          {bookingMode && intentKey ? (
            <section className={styles.section}>
              <SectionHeading step={3} title="希望怎麼談？" hint="不同方式會有不同提前時間與可預約時長。" />
              <div className={`${styles.optionGrid} ${styles.optionGridTwo}`} role="radiogroup" aria-label="見面方式">
                {meetingOptions.map((option, index) => {
                  const isCustom = option.key === "custom";
                  const customLocationApprovalState = approvalState;
                  const isLocked = isCustom && customLocationApprovalState !== "approved";
                  return (
                    <button
                      key={option.key}
                      ref={index === 0 ? registerRef("meetType") : undefined}
                      type="button"
                      role="radio"
                      aria-checked={meetType === option.key}
                      disabled={isLocked}
                      className={`${styles.option} ${meetType === option.key ? styles.optionActive : ""} ${isLocked ? styles.optionDisabled : ""}`}
                      onClick={() => chooseMeetType(option.key)}
                    >
                      <span className={styles.optionTitle}>
                        {option.label}
                        {isCustom ? (customReady ? "（已核准）" : "（需先核准）") : ""}
                      </span>
                      <span className={styles.optionDescription}>
                        {isCustom
                          ? customReady
                            ? "地點已由茗馥核准，送出時不能自行更換"
                            : "先與茗馥確認地點，取得專屬預約連結後才可選"
                          : option.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
              <FieldError message={errors.meetType} />

              {approvalState === "checking" ? <div className={styles.inlineNotice}>正在驗證指定地點核准資料…</div> : null}
              {approvalState === "approved" && !approvedLocation ? (
                <div className={styles.errorNotice}>核准連結缺少已同意的地點，無法開放指定地點。請聯絡茗馥重新產生連結。</div>
              ) : null}
              {approvalState === "invalid" ? (
                <div className={styles.errorNotice}>指定地點核准連結已失效、已使用或被撤銷，請重新聯絡茗馥。</div>
              ) : null}
              {approvalState === "unavailable" ? (
                <div className={styles.warningNotice}>核准服務暫時無法驗證，請稍後重新整理；不用重新申請。</div>
              ) : null}
              {!customReady && approvalState !== "checking" ? (
                <div className={styles.inlineNotice}>
                  需要指定其他地點？請先
                  {" "}<a className={styles.link} href={SOCIAL.line} target="_blank" rel="noopener noreferrer">加茗馥私人 LINE</a>
                  {" "}確認。取得專屬連結後，系統會直接帶入核准地點。
                </div>
              ) : null}
              {meetType === "custom" && approvedLocation ? (
                <div className={styles.field}>
                  <span className={styles.label}>茗馥已核准的指定地點</span>
                  <div className={styles.locationValue}>
                    <span className={styles.locationName}>{approvedLocation.name}</span>
                    {approvedLocation.address ? <span className={styles.locationAddress}>{approvedLocation.address}</span> : null}
                    {approvedStartAt || approvedEndAt || approvedDuration ? (
                      <span className={styles.locationAddress}>
                        核准條件：
                        {approvedStartAt ? ` ${formatTwDateTime(approvedStartAt)}` : ""}
                        {approvedEndAt ? ` 至 ${formatTwDateTime(approvedEndAt)}` : ""}
                        {approvedDuration ? `，${durationLabel(approvedDuration)}` : ""}
                      </span>
                    ) : null}
                  </div>
                  <p className={styles.sectionHint}>此地點已鎖定，若要更換請先與茗馥重新確認。</p>
                </div>
              ) : null}
            </section>
          ) : null}

          {meetType ? (
            <section className={styles.section}>
              <SectionHeading
                step={4}
                title="選擇日期、時間與時長"
                hint={`「${MEET_TYPES.find((option) => option.key === meetType)?.label || "目前方式"}」可選 ${appointmentMeetingPolicy(meetType).publicDurations.map(durationLabel).join("、")}。`}
              />
              <div ref={registerRef("slot")} tabIndex={-1}>
                <div className={styles.slotStatus}>
                  <span className={styles.sectionHint}>{loadingSlots ? "正在讀取最新時段…" : "顯示台灣時間（UTC+8）"}</span>
                  <button type="button" className={styles.retryButton} disabled={loadingSlots} onClick={() => void loadSlots(meetType)}>
                    重新整理時段
                  </button>
                </div>
                {slotError ? <div className={styles.errorNotice}>{slotError}</div> : null}
                {!loadingSlots && !slotError && days.length === 0 ? (
                  <div className={styles.inlineNotice}>
                    目前沒有可預約時段。可改選其他聯繫方式，或
                    {" "}<a className={styles.link} href={SOCIAL.line} target="_blank" rel="noopener noreferrer">直接聯絡茗馥</a>。
                  </div>
                ) : null}
                {days.length ? (
                  <>
                    <div className={styles.dayTabs} role="tablist" aria-label="可預約日期">
                      {days.map((day) => (
                        <button
                          key={day.date}
                          type="button"
                          role="tab"
                          aria-selected={activeDate === day.date}
                          className={`${styles.dayTab} ${activeDate === day.date ? styles.dayTabActive : ""}`}
                          onClick={() => {
                            setActiveDate(day.date);
                            setSelectedStart("");
                            setDuration(0);
                            clearError("slot");
                          }}
                        >
                          {day.label}
                        </button>
                      ))}
                    </div>
                    {activeDay ? (
                      <div className={styles.slotGrid}>
                        {activeDay.slots.map((slot) => (
                          <button
                            key={slot.iso}
                            type="button"
                            className={`${styles.slotButton} ${selectedStart === slot.iso ? styles.slotButtonActive : ""}`}
                            onClick={() => chooseSlot(slot.iso)}
                          >
                            {slot.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
              <FieldError message={errors.slot} />

              {selectedSlot ? (
                <div className={styles.field} ref={registerRef("duration")} tabIndex={-1}>
                  <span className={styles.label}>預約時長</span>
                  {availableDurations.length ? (
                    <div className={styles.durationRow}>
                      {availableDurations.map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={`${styles.durationButton} ${duration === value ? styles.durationButtonActive : ""}`}
                          onClick={() => {
                            setDuration(value);
                            clearError("duration");
                          }}
                        >
                          {durationLabel(value)}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.errorNotice}>這個開始時間放不下可選時長，請改選較早的時間。</div>
                  )}
                  <FieldError message={errors.duration} />
                </div>
              ) : null}

              {selectedSlot && duration ? (
                <div className={styles.selectionSummary}>
                  已選：{selectedSlot.dayLabel} {formatTimeRange(selectedStart, duration)}，共 {durationLabel(duration)}
                </div>
              ) : null}
            </section>
          ) : null}

          {selectedStart && duration && bookingMode && selectedIntent ? (
            <section className={styles.section}>
              <SectionHeading step={5} title="聯絡資料與必要背景" hint="Email 用來確認預約；LINE ID 選填，不需要留下私人 LINE 帳號密碼。" />
              <div className={styles.twoColumn}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="booking-name">姓名</label>
                  <input
                    id="booking-name"
                    ref={registerRef("name") as RefCallback<HTMLInputElement>}
                    className={`${styles.input} ${errors.name ? styles.inputError : ""}`}
                    value={name}
                    onChange={(event) => { setName(event.target.value); clearError("name"); }}
                    autoComplete="name"
                    maxLength={80}
                    aria-invalid={Boolean(errors.name)}
                  />
                  <FieldError message={errors.name} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="booking-phone">電話</label>
                  <input
                    id="booking-phone"
                    ref={registerRef("phone") as RefCallback<HTMLInputElement>}
                    className={`${styles.input} ${errors.phone ? styles.inputError : ""}`}
                    value={phone}
                    onChange={(event) => { setPhone(event.target.value); clearError("phone"); }}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={20}
                    placeholder="0912-345-678"
                    aria-invalid={Boolean(errors.phone)}
                  />
                  <FieldError message={errors.phone} />
                </div>
              </div>
              <div className={styles.twoColumn}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="booking-email">Email</label>
                  <input
                    id="booking-email"
                    ref={registerRef("email") as RefCallback<HTMLInputElement>}
                    className={`${styles.input} ${errors.email ? styles.inputError : ""}`}
                    value={email}
                    onChange={(event) => { setEmail(event.target.value); clearError("email"); }}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    maxLength={160}
                    placeholder="確認連結會寄到這裡"
                    aria-invalid={Boolean(errors.email)}
                  />
                  <FieldError message={errors.email} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="booking-line">
                    LINE ID <span className={styles.optional}>（選填）</span>
                  </label>
                  <input
                    id="booking-line"
                    className={styles.input}
                    value={lineId}
                    onChange={(event) => setLineId(event.target.value)}
                    maxLength={120}
                    autoComplete="off"
                    placeholder="方便聯絡才填，不是必填"
                  />
                </div>
              </div>

              <div className={styles.field} ref={registerRef("urgency")} tabIndex={-1}>
                <span className={styles.label}>
                  {bookingMode === "interview" ? "目前可安排面談的時間" : "希望多久內處理"}
                </span>
                <div className={styles.durationRow} role="radiogroup">
                  {URGENCIES.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      role="radio"
                      aria-checked={urgency === option.key}
                      className={`${styles.durationButton} ${urgency === option.key ? styles.durationButtonActive : ""}`}
                      onClick={() => { setUrgency(option.key); clearError("urgency"); }}
                    >
                      {bookingMode === "interview" && option.key === "asap"
                        ? "可盡快安排"
                        : bookingMode === "interview" && option.key === "soon"
                          ? "1–3 個月內"
                          : bookingMode === "interview" && option.key === "explore"
                            ? "先了解機會"
                            : option.label}
                    </button>
                  ))}
                </div>
                <FieldError message={errors.urgency} />
              </div>

              {requiredQualificationFields.map((field) => {
                const errorKey = `qualification.${field.key}`;
                const common = {
                  id: `qualification-${field.key}`,
                  ref: registerRef(errorKey) as RefCallback<HTMLInputElement & HTMLTextAreaElement>,
                  className: `${field.multiline ? styles.textarea : styles.input} ${errors[errorKey] ? styles.inputError : ""}`,
                  value: qualification[field.key] || "",
                  onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                    updateQualification(field.key, event.target.value),
                  placeholder: field.placeholder,
                  maxLength: field.multiline ? 1000 : 240,
                  "aria-invalid": Boolean(errors[errorKey]),
                };
                return (
                  <div className={styles.field} key={field.key}>
                    <label className={styles.label} htmlFor={common.id}>
                      {field.label} {!field.required ? <span className={styles.optional}>（選填）</span> : null}
                    </label>
                    {field.multiline ? <textarea {...common} rows={3} /> : <input {...common} />}
                    <FieldError message={errors[errorKey]} />
                  </div>
                );
              })}

              <div className={styles.field}>
                <label className={styles.label} htmlFor="booking-note">
                  補充說明 <span className={styles.optional}>（選填）</span>
                </label>
                <textarea
                  id="booking-note"
                  className={styles.textarea}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="有文件、特殊安排或其他背景，可在這裡補充。"
                />
              </div>

              <label className={styles.honeypot} aria-hidden="true">
                請勿填寫
                <input value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" />
              </label>

              <div className={styles.summary}>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>預約目的</span>
                  <strong>{BOOKING_MODES.find((mode) => mode.key === bookingMode)?.label}／{selectedIntent.label}</strong>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>方式</span>
                  <strong>{MEET_TYPES.find((option) => option.key === meetType)?.label}</strong>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>時間</span>
                  <strong>{selectedSlot?.dayLabel || activeDay?.label || ""} {formatTimeRange(selectedStart, duration)}（{durationLabel(duration)}）</strong>
                </div>
              </div>

              {submitError ? <div className={styles.errorNotice} role="alert">{submitError}</div> : null}
              <button className={styles.submit} type="submit" disabled={submitting}>
                {submitting ? "正在保留時段…" : "送出並保留時段"}
              </button>
              <p className={styles.submitHint}>
                送出後時段先保留 {BOOKING_CONFIRMATION_HOLD_MINUTES} 分鐘。請到 Email 點確認連結，才算正式預約完成。
              </p>
            </section>
          ) : null}
        </form>
      </div>
    </main>
  );
}
