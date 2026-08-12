"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { OpenDay } from "@/lib/appointment-constants";
import { SOCIAL } from "../../_links";
import styles from "../Booking.module.css";

type AppointmentView = {
  id: string;
  name: string;
  email: string;
  status: string;
  attendanceStatus?: string | null;
  confirmationDeadline?: string | null;
  slotAt: string;
  slotEndAt: string;
  slotLabel: string;
  meetType: string;
  meetTypeLabel?: string | null;
  meetLocationLabel?: string | null;
  meetUrl: string | null;
  mapsUrl: string | null;
  calendarUrl: string | null;
  icsUrl: string | null;
  canConfirm?: boolean;
  canConfirmAttendance?: boolean;
  canCancel: boolean;
  canReschedule: boolean;
};

type ManageAction = "confirm_attendance" | "cancel" | "reschedule";

function statusLabel(status: string, attendance?: string | null): string {
  if (status === "pending_confirmation") return "等待 Email 確認";
  if (status === "confirmed" && attendance === "confirmed") return "已確認，會出席";
  if (status === "confirmed") return "預約已成立";
  if (status === "cancelled") return "已取消";
  if (status === "completed") return "已完成";
  if (status === "expired") return "確認逾時，時段已釋出";
  return "狀態更新中";
}

function getDurationMinutes(appointment: AppointmentView | null): number {
  if (!appointment) return 0;
  return Math.max(
    0,
    Math.round((new Date(appointment.slotEndAt).getTime() - new Date(appointment.slotAt).getTime()) / 60_000),
  );
}

export default function BookingManageClient({ token }: { token: string }) {
  const [appointment, setAppointment] = useState<AppointmentView | null>(null);
  const [days, setDays] = useState<OpenDay[]>([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [mode, setMode] = useState<"view" | "reschedule">("view");
  const [loading, setLoading] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const existingDuration = useMemo(() => getDurationMinutes(appointment), [appointment]);
  const fittingDays = useMemo(
    () =>
      days
        .map((day) => ({
          ...day,
          slots: day.slots.filter((slot) => slot.maxDurationMin >= existingDuration),
        }))
        .filter((day) => day.slots.length > 0),
    [days, existingDuration],
  );
  const selectedSlotLabel = useMemo(() => {
    for (const day of days) {
      const slot = day.slots.find((candidate) => candidate.iso === selectedSlot);
      if (slot) return `${day.label} ${slot.label}`;
    }
    return "";
  }, [days, selectedSlot]);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setError("缺少預約管理金鑰。請回到確認信，重新點擊「管理預約」。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/appointment/manage?token=${encodeURIComponent(token)}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        appointment?: AppointmentView;
        error?: string;
      };
      if (!response.ok || !data.appointment) {
        setAppointment(null);
        setError(data.error || "讀取預約失敗，請稍後再試。");
        return;
      }
      setAppointment(data.appointment);
    } catch {
      setError("網路連線中斷，請重新整理頁面。");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadSlots = useCallback(async (meetType: string) => {
    setLoadingSlots(true);
    try {
      const params = new URLSearchParams();
      if (meetType) params.set("meetType", meetType);
      const response = await fetch(`/api/appointment/slots?${params.toString()}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { days?: OpenDay[] };
      setDays(response.ok && Array.isArray(data.days) ? data.days : []);
    } catch {
      setDays([]);
    } finally {
      setLoadingSlots(false);
    }
  }, []);

  useEffect(() => {
    setIsInAppBrowser(/line|liff|fbav|fban|fb_iab|instagram|messenger|micromessenger|threads|; wv\)| wv;/i.test(navigator.userAgent || ""));
    void load();
  }, [load]);

  useEffect(() => {
    if (!appointment?.confirmationDeadline || appointment.status !== "pending_confirmation") {
      setRemainingSeconds(0);
      return;
    }
    const tick = () => {
      setRemainingSeconds(
        Math.max(0, Math.ceil((new Date(appointment.confirmationDeadline as string).getTime() - Date.now()) / 1000)),
      );
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [appointment?.confirmationDeadline, appointment?.status]);

  const submit = async (action: ManageAction) => {
    if (!appointment) return;
    if (action === "cancel" && !window.confirm("確定取消這次預約？取消後時段會立即釋出。")) return;
    if (action === "reschedule" && !selectedSlot) {
      setError("請先選擇新的預約時段。");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/appointment/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action, slotIso: selectedSlot }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        appointment?: AppointmentView;
        status?: string;
        attendanceStatus?: string;
        slotAt?: string;
        slotEndAt?: string;
        slotLabel?: string;
        error?: string;
      };
      if (!response.ok) {
        if (data.appointment) {
          setAppointment(data.appointment);
          setError(data.error || "主要操作已完成，但後續通知仍在等待處理。請稍後重新整理確認。");
          setMode("view");
          setSelectedSlot("");
          return;
        }
        if (response.status === 409 && action === "reschedule") {
          setSelectedSlot("");
          await loadSlots(appointment.meetType);
          setError(`${data.error || "這個時段已無法預約。"} 可選時間已更新，請重新選擇。`);
          return;
        }
        setError(data.error || "操作失敗，請稍後再試。");
        if (response.status === 409 || response.status === 410) await load();
        return;
      }

      if (data.appointment) {
        setAppointment(data.appointment);
      } else if (action === "confirm_attendance") {
        setAppointment({
          ...appointment,
          status: data.status || "confirmed",
          attendanceStatus: data.attendanceStatus || "confirmed",
          confirmationDeadline: null,
          canConfirm: false,
          canConfirmAttendance: false,
        });
      } else if (action === "cancel") {
        setAppointment({
          ...appointment,
          status: "cancelled",
          canCancel: false,
          canReschedule: false,
          canConfirm: false,
          canConfirmAttendance: false,
        });
      } else {
        setAppointment({
          ...appointment,
          slotAt: data.slotAt || appointment.slotAt,
          slotEndAt: data.slotEndAt || appointment.slotEndAt,
          slotLabel: data.slotLabel || selectedSlotLabel,
        });
      }

      if (action === "confirm_attendance") {
        setMessage("已確認預約與出席。茗馥會依這個時間準備，請把行程加入你的行事曆。");
      } else if (action === "cancel") {
        setMessage("預約已取消，原時段已釋出。");
      } else {
        setMessage("預約已改期，請以這一頁與最新確認信的時間為準。");
        setMode("view");
        setSelectedSlot("");
        await loadSlots(appointment.meetType);
      }
    } catch {
      setError("網路連線中斷，無法確認操作結果。請重新整理後查看目前狀態，避免重複操作。");
    } finally {
      setBusy(false);
    }
  };

  const pending = appointment?.status === "pending_confirmation";
  const expired = appointment?.status === "expired" || Boolean(pending && appointment?.confirmationDeadline && remainingSeconds <= 0);
  const cancelled = appointment?.status === "cancelled";
  const completed = appointment?.status === "completed";
  const confirmed = appointment?.status === "confirmed";
  const canConfirmAttendance = Boolean(
    appointment &&
      !expired &&
      !cancelled &&
      !completed &&
      (pending || appointment.canConfirm || appointment.canConfirmAttendance || (confirmed && appointment.attendanceStatus === "pending")),
  );

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.brand}>太平洋房屋 梧棲市鎮加盟店</div>
          <h1 className={styles.title}>管理我的預約</h1>
          <p className={styles.lead}>確認是否出席、查看時間，或在開放期限內改期與取消。</p>
        </header>

        {loading ? <div className={styles.inlineNotice}>正在讀取預約…</div> : null}
        {error ? <div className={styles.errorNotice} role="alert">{error}</div> : null}
        {message ? <div className={styles.successNotice} role="status">{message}</div> : null}

        {appointment ? (
          <section
            className={`${styles.statusPanel} ${pending ? styles.statusPanelWarning : ""} ${expired || cancelled ? styles.statusPanelDanger : ""}`}
          >
            <h2 className={styles.statusTitle}>{statusLabel(expired ? "expired" : appointment.status, appointment.attendanceStatus)}</h2>
            <p className={styles.statusText}>
              {expired
                ? "Email 確認期限已過，系統不再保留這個時段。請重新預約，避免直接前往。"
                : pending
                  ? "請在保留時間內按下「確認預約，我會出席」。完成後預約才正式成立。"
                  : cancelled
                    ? "這筆預約已取消，不需要前往。需要新時間請重新預約。"
                    : completed
                      ? "這次預約已完成。若要安排下一次會談，請重新預約。"
                      : appointment.attendanceStatus === "confirmed"
                        ? "你已確認會出席。時間有變動時，請提早使用下方功能處理。"
                        : "預約已成立；請再按一次出席確認，讓茗馥知道你會依約到場。"}
            </p>

            {pending && !expired && appointment.confirmationDeadline ? (
              <span className={styles.countdown} aria-live="polite">
                保留剩餘 {String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:{String(remainingSeconds % 60).padStart(2, "0")}
              </span>
            ) : null}

            <div className={styles.infoList}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>姓名</span>
                <span className={styles.infoValue}>{appointment.name}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>目前狀態</span>
                <span className={styles.infoValue}>{statusLabel(expired ? "expired" : appointment.status, appointment.attendanceStatus)}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>預約時段</span>
                <span className={styles.infoValue}>{appointment.slotLabel}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>聯繫方式</span>
                <span className={styles.infoValue}>{appointment.meetTypeLabel || appointment.meetType}</span>
              </div>
              {appointment.meetLocationLabel ? (
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>見面地點</span>
                  <span className={styles.infoValue}>{appointment.meetLocationLabel}</span>
                </div>
              ) : null}
            </div>

            {canConfirmAttendance ? (
              <button
                type="button"
                className={styles.primaryButton}
                disabled={busy}
                onClick={() => void submit("confirm_attendance")}
              >
                {busy ? "確認中…" : pending ? "確認預約，我會出席" : "確認我會出席"}
              </button>
            ) : null}

            {confirmed && !expired ? (
              <>
                {isInAppBrowser && appointment.icsUrl ? (
                  <div className={styles.warningNotice}>
                    LINE／Facebook／Instagram 內建瀏覽器可能無法下載行事曆。請用右上角選單改用 Safari 或 Chrome 開啟。
                  </div>
                ) : null}
                <div className={styles.actions}>
                  {appointment.icsUrl && !isInAppBrowser ? (
                    <a className={`${styles.actionLink} ${styles.actionLinkPrimary}`} href={appointment.icsUrl} download>
                      加入手機行事曆
                    </a>
                  ) : null}
                  {appointment.calendarUrl ? (
                    <a className={styles.actionLink} href={appointment.calendarUrl} target="_blank" rel="noopener noreferrer">
                      加入 Google 日曆
                    </a>
                  ) : null}
                  {appointment.mapsUrl ? (
                    <a className={styles.actionLink} href={appointment.mapsUrl} target="_blank" rel="noopener noreferrer">
                      開啟地圖導航
                    </a>
                  ) : null}
                  {appointment.meetUrl ? (
                    <a className={styles.actionLink} href={appointment.meetUrl} target="_blank" rel="noopener noreferrer">
                      加入線上視訊
                    </a>
                  ) : null}
                </div>
              </>
            ) : null}

            {appointment.canReschedule && mode === "reschedule" ? (
              <div className={styles.reschedule}>
                <h3 className={styles.sectionTitle}>選擇新的開始時間</h3>
                <p className={styles.sectionHint}>保留原本 {existingDuration} 分鐘，只更換開始時間。</p>
                <div className={styles.slotStatus}>
                  <span className={styles.sectionHint}>{loadingSlots ? "更新可選時段中…" : "以下均為台灣時間（UTC+8）"}</span>
                  <button
                    type="button"
                    className={styles.retryButton}
                    disabled={loadingSlots}
                    onClick={() => void loadSlots(appointment.meetType)}
                  >
                    重新整理
                  </button>
                </div>
                {fittingDays.length ? (
                  <div>
                    {fittingDays.map((day) => (
                      <div className={styles.field} key={day.date}>
                        <span className={styles.label}>{day.label}</span>
                        <div className={styles.slotGrid}>
                          {day.slots.map((slot) => (
                            <button
                              key={slot.iso}
                              type="button"
                              className={`${styles.slotButton} ${selectedSlot === slot.iso ? styles.slotButtonActive : ""}`}
                              onClick={() => {
                                setSelectedSlot(slot.iso);
                                setError("");
                              }}
                            >
                              {slot.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.inlineNotice}>
                    目前沒有可改期時段，請直接聯絡茗馥協助處理。
                  </div>
                )}
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    disabled={busy || !selectedSlot}
                    onClick={() => void submit("reschedule")}
                  >
                    {busy ? "改期中…" : "確認改期"}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={busy}
                    onClick={() => {
                      setMode("view");
                      setSelectedSlot("");
                    }}
                  >
                    暫不改期
                  </button>
                </div>
              </div>
            ) : null}

            <div className={styles.actions}>
              {appointment.canReschedule && mode === "view" ? (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={busy}
                  onClick={() => {
                    setMode("reschedule");
                    void loadSlots(appointment.meetType);
                  }}
                >
                  我要改期
                </button>
              ) : null}
              {appointment.canCancel ? (
                <button type="button" className={styles.dangerButton} disabled={busy} onClick={() => void submit("cancel")}>
                  取消預約
                </button>
              ) : null}
              <a className={styles.actionLink} href={SOCIAL.line} target="_blank" rel="noopener noreferrer">
                聯絡茗馥
              </a>
            </div>

            {expired || cancelled || completed ? (
              <div className={styles.actions}>
                <a className={`${styles.actionLink} ${styles.actionLinkPrimary}`} href="/card/booking">
                  重新預約
                </a>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
