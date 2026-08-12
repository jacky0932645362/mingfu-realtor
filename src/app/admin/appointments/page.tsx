import { isCurrentUserAdmin } from "@/lib/admin-check";
import {
  intentEmoji,
  intentLabel,
  meetTypeEmoji,
  urgencyEmoji,
  listAppointmentFollowups,
  listAppointmentNotifications,
  listAppointments,
  getAppointmentRateLimitSettings,
  getAppointmentRateLimitStats,
  findOrphanedCalendarAppointments,
  meetTypeLabel,
  urgencyLabel,
  type AppointmentQueue,
  type MeetLocation,
} from "@/lib/appointment";
import type { AppointmentRow } from "@/lib/appointment-constants";
import { isGoogleBound, isGoogleConfigured, getCalendarDisplaySettings } from "@/lib/google-calendar";
import CalendarDisplayPanel from "./CalendarDisplayPanel";
import RateLimitPanel from "./RateLimitPanel";
import { appointmentMapsUrl, formatSlotRangeTw } from "@/lib/appointment-notify";
import { CIS, CHIP, type ChipTone } from "@/app/admin/_components/cis";
import { Icon, StatusDot } from "@/app/admin/_ui/icons";
import AppointmentActions from "./AppointmentActions";
import CustomLocationApprovalPanel from "./CustomLocationApprovalPanel";
import { listAppointmentOutboxSnapshots, type AppointmentOutboxSnapshot } from "./data";
import styles from "./appointments.module.css";

export const dynamic = "force-dynamic";

type SearchParams = {
  queue?: string;
  status?: string;
  q?: string;
  google?: string;
};

type AsyncTruth = {
  label: string;
  tone: ChipTone;
  detail: string;
  error?: string | null;
};

const QUEUES: Array<{ key: AppointmentQueue; label: string }> = [
  { key: "all", label: "全部案件" },
  { key: "today", label: "今日行程" },
  { key: "pending_confirmation", label: "待客戶確認" },
  { key: "overdue_contact", label: "首次聯絡逾時" },
  { key: "followup_due", label: "跟進到期" },
  { key: "sync_failed", label: "通知／日曆異常" },
  { key: "outcome_pending", label: "待填結果" },
];

const STATUSES = [
  { key: "all", label: "全部狀態" },
  { key: "pending_confirmation", label: "待確認" },
  { key: "confirmed", label: "已確認" },
  { key: "completed", label: "已完成" },
  { key: "cancelled", label: "已取消" },
  { key: "expired", label: "已逾期" },
];

const STATUS_LABELS: Record<string, string> = {
  pending_confirmation: "待客戶確認",
  confirmed: "已確認",
  completed: "已完成",
  cancelled: "已取消",
  expired: "確認逾期",
};

const ATTENDANCE_LABELS: Record<string, string> = {
  pending: "尚未確認出席",
  confirmed: "客戶已確認",
  arrived: "已到場",
  no_show: "未到場",
};

const OUTCOME_LABELS: Record<string, string> = {
  none: "尚未填結果",
  hot: "高意願",
  nurture: "持續培養",
  unqualified: "不適合",
  closed_won: "已成交",
  closed_lost: "未成交",
};

const CONTACT_LABELS: Record<string, string> = {
  uncontacted: "尚未聯絡",
  contacted: "已聯絡",
  waiting_customer: "等待客戶",
  followup_due: "待跟進",
  closed: "已結案",
};

const MODE_LABELS: Record<string, string> = {
  realtor: "房仲服務",
  collaboration: "合作洽談",
  interview: "採訪／訪談",
};

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function parseMeetLocation(raw: string | null): MeetLocation | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MeetLocation>;
    return parsed && typeof parsed.name === "string" ? (parsed as MeetLocation) : null;
  } catch {
    return null;
  }
}

function taipeiDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function statusTone(status: string): ChipTone {
  if (status === "confirmed") return "info";
  if (status === "completed") return "success";
  if (status === "pending_confirmation") return "warn";
  return "danger";
}

function attendanceTone(status: string | null): ChipTone {
  if (status === "arrived") return "success";
  if (status === "no_show") return "danger";
  if (status === "confirmed") return "info";
  return "neutral";
}

function outcomeTone(status: string | null): ChipTone {
  if (status === "closed_won") return "success";
  if (status === "hot") return "warn";
  if (status === "closed_lost" || status === "unqualified") return "danger";
  if (status === "nurture") return "info";
  return "neutral";
}

// 急迫度色票：越快越好 = 紅（該今天打電話）、1-3 個月 = 黃、還不急 = 灰。2026-08-06
function urgencyTone(urgency: string | null): ChipTone {
  if (urgency === "asap") return "danger";
  if (urgency === "soon") return "warn";
  return "neutral";
}

function contactTone(status: string | null): ChipTone {
  if (status === "contacted" || status === "closed") return "success";
  if (status === "followup_due") return "warn";
  if (status === "waiting_customer") return "info";
  return "danger";
}

function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  const color = CHIP[tone];
  return (
    <span
      className={styles.chip}
      style={{ background: color.bg, color: color.color, borderColor: color.border }}
    >
      {children}
    </span>
  );
}

function latestTask(
  rows: AppointmentOutboxSnapshot[],
  prefix: "calendar_" | "notify_",
): AppointmentOutboxSnapshot | null {
  return rows.find((row) => row.task_type.startsWith(prefix)) || null;
}

function outboxTruth(
  task: AppointmentOutboxSnapshot | null,
  legacyStatus: string | null,
  emptyLabel: string,
): AsyncTruth {
  if (task) {
    if (task.status === "completed") {
      return {
        label: "已完成",
        tone: "success",
        detail: `${task.task_type} 已由背景工作完成`,
      };
    }
    if (task.status === "failed") {
      return {
        label: "失敗",
        tone: "danger",
        detail: `${task.task_type} 已嘗試 ${task.attempts} 次`,
        error: task.last_error,
      };
    }
    if (task.status === "retry") {
      return {
        label: "等待重試",
        tone: "warn",
        detail: `${task.task_type} 已嘗試 ${task.attempts} 次，系統將重試`,
        error: task.last_error,
      };
    }
    return {
      label: task.status === "processing" ? "處理中" : "已排隊",
      tone: "info",
      detail: `${task.task_type} 尚未完成，不代表已送達`,
    };
  }
  if (legacyStatus === "sent" || legacyStatus === "completed" || legacyStatus === "synced") {
    return { label: "已完成", tone: "success", detail: "既有紀錄顯示已完成" };
  }
  if (legacyStatus === "failed") {
    return { label: "失敗", tone: "danger", detail: "既有紀錄顯示失敗" };
  }
  if (legacyStatus === "pending" || legacyStatus === "queued") {
    return { label: "待處理", tone: "info", detail: "尚未取得完成證據" };
  }
  return { label: emptyLabel, tone: "neutral", detail: "目前沒有可驗證的執行紀錄" };
}

function hasAsyncFailure(row: AppointmentRow, tasks: AppointmentOutboxSnapshot[]): boolean {
  const calendarTask = latestTask(tasks, "calendar_");
  const notificationTask = latestTask(tasks, "notify_");
  const calendarFailed = calendarTask
    ? calendarTask.status === "failed" || calendarTask.status === "retry"
    : row.calendar_sync_status === "failed";
  const notificationFailed = notificationTask
    ? notificationTask.status === "failed" || notificationTask.status === "retry"
    : Boolean(row.last_notify_error);
  return (
    calendarFailed ||
    notificationFailed
  );
}

function matchesQueue(
  row: AppointmentRow,
  queue: AppointmentQueue,
  tasks: AppointmentOutboxSnapshot[],
  now: Date,
): boolean {
  if (queue === "all") return true;
  if (queue === "today") {
    return (
      taipeiDateKey(new Date(row.slot_at)) === taipeiDateKey(now) &&
      ["pending_confirmation", "confirmed", "completed"].includes(row.status)
    );
  }
  if (queue === "pending_confirmation") return row.status === "pending_confirmation";
  if (queue === "overdue_contact") {
    return (
      (row.contact_status || "uncontacted") === "uncontacted" &&
      new Date(row.created_at).getTime() < now.getTime() - 2 * 60 * 60_000 &&
      !["cancelled", "expired"].includes(row.status)
    );
  }
  if (queue === "followup_due") {
    return Boolean(
      row.next_followup_at &&
        new Date(row.next_followup_at).getTime() <= now.getTime() &&
        row.contact_status !== "closed",
    );
  }
  if (queue === "sync_failed") return hasAsyncFailure(row, tasks);
  return (
    new Date(row.slot_at).getTime() < now.getTime() &&
    ["confirmed", "completed"].includes(row.status) &&
    (!row.outcome_status || row.outcome_status === "none")
  );
}

function queryHref(current: SearchParams, next: Partial<SearchParams>): string {
  const params = new URLSearchParams();
  const merged = { ...current, ...next };
  if (merged.queue && merged.queue !== "all") params.set("queue", merged.queue);
  if (merged.status && merged.status !== "all") params.set("status", merged.status);
  if (merged.q) params.set("q", merged.q);
  const query = params.toString();
  return `/admin/appointments${query ? `?${query}` : ""}`;
}

export default async function AppointmentsAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!(await isCurrentUserAdmin())) throw new Error("權限不足");

  const sp = await searchParams;
  const queue = QUEUES.some((item) => item.key === sp.queue) ? (sp.queue as AppointmentQueue) : "all";
  const status = STATUSES.some((item) => item.key === sp.status) ? String(sp.status) : "all";
  const search = String(sp.q || "").trim().slice(0, 120);
  const now = new Date();

  const [allRows, googleBound, calendarDisplay, rateSettings, rateLimitStats, orphanCheck] = await Promise.all([
    listAppointments({ search, limit: 500 }),
    isGoogleBound(),
    getCalendarDisplaySettings(),
    getAppointmentRateLimitSettings(),
    getAppointmentRateLimitStats(),
    // 2026-08-06 系統擁有者：比對「資料庫說還在、Google 上卻已被刪掉」的預約。一次 API 呼叫。
    //   問不到 Google 時回 checked:false，**不會把所有預約都誤判成孤兒**。
    findOrphanedCalendarAppointments().catch(() => ({ checked: false, orphanIds: new Set<string>() })),
  ]);
  const orphanedCalendarIds = orphanCheck.orphanIds;
  const [outboxRows, followupRows, notificationRows] = await Promise.all([
    listAppointmentOutboxSnapshots(allRows.map((row) => row.id)),
    listAppointmentFollowups(allRows.map((row) => row.id)),
    listAppointmentNotifications(allRows.map((row) => row.id)),
  ]);

  const tasksByAppointment = new Map<string, AppointmentOutboxSnapshot[]>();
  for (const task of outboxRows) {
    const current = tasksByAppointment.get(task.appointment_id) || [];
    current.push(task);
    tasksByAppointment.set(task.appointment_id, current);
  }
  const followupIds = new Set(followupRows.map((row) => row.appointment_id));
  const notificationCounts = notificationRows.reduce<Record<string, number>>((counts, row) => {
    counts[row.appointment_id] = (counts[row.appointment_id] || 0) + 1;
    return counts;
  }, {});

  const queueCounts = Object.fromEntries(
    QUEUES.map((item) => [
      item.key,
      allRows.filter((row) =>
        matchesQueue(row, item.key, tasksByAppointment.get(row.id) || [], now),
      ).length,
    ]),
  ) as Record<AppointmentQueue, number>;

  const rows = allRows.filter((row) => {
    if (status !== "all" && row.status !== status) return false;
    return matchesQueue(row, queue, tasksByAppointment.get(row.id) || [], now);
  });

  const pendingCount = queueCounts.pending_confirmation;
  const overdueCount = queueCounts.overdue_contact;
  const failureCount = queueCounts.sync_failed;
  const outcomePendingCount = queueCounts.outcome_pending;
  const googleConfigured = isGoogleConfigured();

  return (
    <main className={styles.page} style={{ background: CIS.bg, color: CIS.text, fontFamily: CIS.font }}>
      <div className={styles.shell}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>
              <Icon name="calendar" size={25} />
              預約營運工作區
            </h1>
            <p className={styles.subtitle} style={{ color: CIS.textMute }}>
              先處理逾時與異常，再追蹤到場、結果及實際成交。
            </p>
          </div>
          <div style={{ color: googleBound ? "#4ade80" : "#fbbf24", fontSize: 15, fontWeight: 800 }}>
            <StatusDot tone={googleBound ? "green" : "yellow"} title={googleBound ? "已綁定" : "未綁定"} />
            {" "}
            {googleBound
              ? "Google 日曆已綁定"
              : googleConfigured
                ? "Google 日曆尚未綁定"
                : "Google 日曆尚未設定"}
          </div>
        </div>

        {sp.google === "bound" ? (
          <div style={{ color: "#4ade80", marginBottom: 12, fontSize: 15 }}>Google 日曆綁定成功。</div>
        ) : null}
        {sp.google === "fail" ? (
          <div style={{ color: "#fb7185", marginBottom: 12, fontSize: 15 }}>
            Google 日曆綁定失敗，請確認 OAuth 設定後重試。
          </div>
        ) : null}

        {/* 2026-08-06 系統擁有者：Google 上被手動刪掉的事件，後台要看得出來 */}
        {googleBound && orphanedCalendarIds.size > 0 ? (
          <div
            style={{
              background: "rgba(251,146,60,.1)", border: "1px solid #7c4a12", borderRadius: 10,
              padding: "10px 14px", marginBottom: 14, color: "#fdba74", fontSize: 15, lineHeight: 1.85,
            }}
          >
            ⚠️ 有 <b>{orphanedCalendarIds.size}</b> 筆預約的 Google 日曆事件已經不存在了（多半是直接在日曆上刪掉的）。
            這些<b>時段還被佔著</b>，下面會用橘框標出來 —— 按那幾筆的「取消預約」正式收掉就會釋放。
          </div>
        ) : null}
        {googleBound && !orphanCheck.checked ? (
          <div
            style={{
              background: "rgba(148,163,184,.08)", border: "1px solid #2a3441", borderRadius: 10,
              padding: "9px 14px", marginBottom: 14, color: "#94a3b8", fontSize: 14.5, lineHeight: 1.8,
            }}
          >
            這次沒能問到 Google 日曆，所以<b>沒有做「事件是否還在」的比對</b>（不是代表沒問題，是這次不知道）。重新整理可以再試一次。
          </div>
        ) : null}

        {/* 2026-08-06 系統擁有者：三道防灌爆限制原本寫死，他自己測試時被鎖 1 小時測不下去 */}
        <RateLimitPanel
          initial={rateSettings}
          activeBuckets={rateLimitStats.activeBuckets}
          blockedCreateBuckets={rateLimitStats.blockedCreateBuckets}
          borderColor={CIS.cardBorder}
        />

        {/* 2026-08-06 系統擁有者：日曆標題「太平洋房屋預約」要能自己改、顏色要能自己挑。綁定了才有意義，沒綁不顯示。 */}
        {googleBound ? (
          <CalendarDisplayPanel
            initialTitleTemplate={calendarDisplay.titleTemplate}
            initialColorId={calendarDisplay.colorId}
            borderColor={CIS.cardBorder}
          />
        ) : null}

        <CustomLocationApprovalPanel />

        <div className={styles.summaryGrid}>
          {[
            ["待客戶確認", pendingCount, "#fbbf24"],
            ["首次聯絡逾時", overdueCount, "#fb7185"],
            ["同步／通知異常", failureCount, "#fb7185"],
            ["會後結果待填", outcomePendingCount, "#7eb0ef"],
          ].map(([label, value, color]) => (
            <div
              key={String(label)}
              className={styles.summary}
              style={{ background: CIS.card, borderColor: CIS.cardBorder }}
            >
              <div className={styles.summaryLabel} style={{ color: CIS.textMute }}>{label}</div>
              <div className={styles.summaryValue} style={{ color: String(color) }}>{value}</div>
            </div>
          ))}
        </div>

        <form className={styles.toolbar} method="get">
          <input type="hidden" name="queue" value={queue} />
          <input type="hidden" name="status" value={status} />
          <label className={styles.searchWrap}>
            <Icon name="search" size={16} color={CIS.textMute} />
            <input
              className={styles.searchInput}
              name="q"
              defaultValue={search}
              placeholder="搜尋姓名、電話、Email 或案件編號"
              aria-label="搜尋預約"
              style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}`, color: CIS.text }}
            />
          </label>
          <button
            className={styles.button}
            type="submit"
            style={{ background: CIS.blue, border: `1px solid ${CIS.blue}`, color: "#fff" }}
          >
            搜尋
          </button>
          {search ? (
            <a
              className={styles.button}
              href={queryHref(sp, { q: undefined })}
              style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}`, color: CIS.textSub }}
            >
              清除
            </a>
          ) : null}
        </form>

        <nav className={styles.queueTabs} aria-label="營運佇列">
          {QUEUES.map((item) => {
            const active = queue === item.key;
            return (
              <a
                key={item.key}
                className={styles.tab}
                href={queryHref(sp, { queue: item.key })}
                style={{
                  background: active ? CIS.blue : CIS.card,
                  color: active ? "#fff" : CIS.textSub,
                  border: `1px solid ${active ? CIS.blue : CIS.cardBorder}`,
                }}
              >
                {item.label}
                <span
                  className={styles.count}
                  style={{ background: active ? "rgba(255,255,255,0.18)" : CIS.bgSoft }}
                >
                  {queueCounts[item.key]}
                </span>
              </a>
            );
          })}
        </nav>

        <nav className={styles.statusTabs} aria-label="預約狀態">
          {STATUSES.map((item) => {
            const active = status === item.key;
            return (
              <a
                key={item.key}
                className={styles.tab}
                href={queryHref(sp, { status: item.key })}
                style={{
                  background: active ? "rgba(90,145,225,0.18)" : "transparent",
                  color: active ? CIS.blueSoft : CIS.textMute,
                  border: `1px solid ${active ? CIS.blue : CIS.cardBorder}`,
                }}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        {rows.length === 0 ? (
          <div
            className={styles.empty}
            style={{ color: CIS.textMute, borderColor: CIS.cardBorder, background: CIS.card }}
          >
            此佇列目前沒有符合條件的預約。
          </div>
        ) : (
          <div className={styles.list}>
            {rows.map((row) => {
              const tasks = tasksByAppointment.get(row.id) || [];
              const calendarTask = latestTask(tasks, "calendar_");
              const notificationTask = latestTask(tasks, "notify_");
              const calendarTruth = outboxTruth(
                calendarTask,
                row.calendar_sync_status,
                row.google_event_id ? "既有日曆事件" : "未建立日曆",
              );
              const legacyNotifyStatus =
                row.customer_email_status === "failed" ||
                row.admin_email_status === "failed" ||
                row.line_notify_status === "failed"
                  ? "failed"
                  : row.customer_email_status === "sent" ||
                      row.admin_email_status === "sent" ||
                      row.line_notify_status === "sent"
                    ? "sent"
                    : null;
              const notificationTruth = outboxTruth(notificationTask, legacyNotifyStatus, "未發送");
              const intents = parseJsonArray(row.intent);
              const intentText = intents.length ? intents.map(intentLabel).join("、") : "未指定";
              const location = row.meet_type === "custom" ? parseMeetLocation(row.meet_location) : null;
              const mapsUrl = appointmentMapsUrl(row.meet_type, location);
              const slotLabel = formatSlotRangeTw(
                new Date(row.slot_at),
                row.slot_end_at ? new Date(row.slot_end_at) : null,
              );
              const isInactive = ["cancelled", "expired"].includes(row.status);

              return (
                <article
                  key={row.id}
                  className={`${styles.card} ${isInactive ? styles.mutedCard : ""}`}
                  style={{ background: CIS.card, borderColor: CIS.cardBorder }}
                >
                  <header className={styles.cardHeader}>
                    <div>
                      <div className={styles.slot}>{slotLabel}</div>
                      <div className={styles.identity} style={{ color: CIS.textMute }}>
                        {/* 顯示優先序（2026-08-06）：你手填的 CRM 編號 > 自動編號 AP-260806-01 > 舊資料的 32 碼 id */}
                        案件編號：{row.case_reference || row.case_no || row.id}
                      </div>
                      {/* 2026-08-06 系統擁有者：他習慣直接在 Google 上滑掉事件，後台不知道 → 時段一直被佔著 */}
                      {orphanedCalendarIds.has(row.id) ? (
                        <div
                          style={{
                            marginTop: 6, background: "rgba(251,146,60,.12)", border: "1px solid #7c4a12",
                            borderRadius: 8, padding: "7px 10px", color: "#fdba74", fontSize: 14, lineHeight: 1.8, maxWidth: 560,
                          }}
                        >
                          ⚠️ <b>這筆的 Google 日曆事件已經不存在了</b>（多半是直接在日曆上刪掉的）。
                          <br />
                          資料庫這邊還算它有效，<b>時段會一直被佔住</b>。請按下面的
                          <b style={{ color: "#fca5a5" }}>「取消預約」</b>
                          正式收掉 —— 那會釋放時段並通知客戶，兩邊才會乾淨。
                        </div>
                      ) : null}
                    </div>
                    <div className={styles.chips}>
                      {row.ai_heat === "high" ? (
                        <Chip tone="warn"><Icon name="hot" size={12} /> 高溫</Chip>
                      ) : null}
                      <Chip tone={statusTone(row.status)}>
                        {STATUS_LABELS[row.status] || row.status}
                      </Chip>
                      <Chip tone={contactTone(row.contact_status)}>
                        {CONTACT_LABELS[row.contact_status || "uncontacted"] || row.contact_status}
                      </Chip>
                      <Chip tone={attendanceTone(row.attendance_status)}>
                        {ATTENDANCE_LABELS[row.attendance_status || "pending"] || row.attendance_status}
                      </Chip>
                      <Chip tone={outcomeTone(row.outcome_status)}>
                        {OUTCOME_LABELS[row.outcome_status || "none"] || row.outcome_status}
                      </Chip>
                    </div>
                  </header>

                  <div className={styles.contactRow}>
                    <b style={{ color: CIS.text }}>{row.name}</b>
                    <a href={`tel:${row.phone}`} style={{ color: CIS.blueSoft }}>{row.phone}</a>
                    <a href={`mailto:${row.email}`} style={{ color: CIS.blueSoft }}>{row.email}</a>
                    {row.line_id ? <span style={{ color: CIS.textMute }}>LINE：{row.line_id}</span> : null}
                  </div>

                  {/* 2026-08-06 系統擁有者：「這筆到底要幹嘛」原本是一排 13px 灰字，掃過去看不到 →
                      升成卡片主標（目的／需求大字 + 急迫度色票），方式與來源退到第二行。 */}
                  <div
                    className={styles.purpose}
                    style={{ background: "rgba(90,145,225,0.08)", borderColor: "rgba(90,145,225,0.30)" }}
                  >
                    <div className={styles.purposeHead}>
                      <span className={styles.purposeEmoji}>
                        {intents.length ? intentEmoji(intents[0]) : "💬"}
                      </span>
                      <span className={styles.purposeTitle} style={{ color: CIS.text }}>
                        {MODE_LABELS[row.booking_mode || "realtor"] || row.booking_mode}
                        <span className={styles.purposeSep} style={{ color: CIS.textMute }}>／</span>
                        {intentText}
                      </span>
                      {row.urgency ? (
                        <span
                          className={styles.purposeUrgency}
                          style={{
                            background: CHIP[urgencyTone(row.urgency)].bg,
                            color: CHIP[urgencyTone(row.urgency)].color,
                            borderColor: CHIP[urgencyTone(row.urgency)].border,
                          }}
                        >
                          {urgencyEmoji(row.urgency)} {urgencyLabel(row.urgency)}
                        </span>
                      ) : null}
                    </div>
                    <div className={styles.purposeSub} style={{ color: CIS.textMute }}>
                      <span>
                        {meetTypeEmoji(row.meet_type)} 方式：
                        <b style={{ color: CIS.textSub }}>{meetTypeLabel(row.meet_type)}</b>
                      </span>
                      <span>
                        來源：{row.utm_source || row.source || "unknown"}
                        {row.utm_campaign ? ` / ${row.utm_campaign}` : ""}
                      </span>
                    </div>
                  </div>

                  {location ? (
                    <div className={styles.facts}>
                      <span className={styles.location} style={{ color: CIS.textMute }}>
                        <Icon name="location" size={14} />
                        <b style={{ color: CIS.text }}>{location.name}</b>
                        {location.address ? <span>{location.address}</span> : null}
                        {mapsUrl ? (
                          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{ color: CIS.blueSoft }}>
                            開啟地圖
                          </a>
                        ) : null}
                      </span>
                    </div>
                  ) : null}

                  <section className={styles.section} style={{ borderColor: CIS.cardBorder }}>
                    <div className={styles.sectionTitle} style={{ color: CIS.textSub }}>
                      <Icon name="health" size={14} />
                      執行狀態【只顯示可驗證結果】
                    </div>
                    <div className={styles.syncGrid}>
                      <div className={styles.syncRow}>
                        <Chip tone={calendarTruth.tone}>日曆：{calendarTruth.label}</Chip>
                        <div style={{ color: CIS.textMute }}>
                          {calendarTruth.detail}
                          {calendarTruth.error || row.calendar_sync_error ? (
                            <div className={styles.syncError} style={{ color: "#fb7185" }}>
                              {calendarTruth.error || row.calendar_sync_error}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className={styles.syncRow}>
                        <Chip tone={notificationTruth.tone}>通知：{notificationTruth.label}</Chip>
                        <div style={{ color: CIS.textMute }}>
                          {notificationTruth.detail}
                          {notificationCounts[row.id] ? `，共 ${notificationCounts[row.id]} 筆紀錄` : ""}
                          {notificationTruth.error || row.last_notify_error ? (
                            <div className={styles.syncError} style={{ color: "#fb7185" }}>
                              {notificationTruth.error || row.last_notify_error}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </section>

                  {row.ai_summary || row.ai_next_action || row.note ? (
                    <section className={styles.section} style={{ borderColor: CIS.cardBorder }}>
                      <div className={styles.sectionTitle} style={{ color: CIS.textSub }}>
                        <Icon name="bot" size={14} />
                        案件摘要
                      </div>
                      {row.ai_summary ? <div className={styles.note} style={{ color: CIS.textSub }}>AI 摘要：{row.ai_summary}</div> : null}
                      {row.ai_next_action ? <div className={styles.note} style={{ color: CIS.blueSoft }}>建議下一步：{row.ai_next_action}</div> : null}
                      {row.note ? <div className={styles.note} style={{ color: CIS.textMute }}>客戶備註：{row.note}</div> : null}
                    </section>
                  ) : null}

                  <section className={styles.section} style={{ borderColor: CIS.cardBorder }}>
                    <AppointmentActions
                      id={row.id}
                      status={row.status}
                      customerName={row.name}
                      phone={row.phone}
                      email={row.email}
                      lineId={row.line_id}
                      slotLabel={slotLabel}
                      intentLabel={intentText}
                      meetUrl={row.meet_url}
                      mapsUrl={mapsUrl}
                      note={row.note}
                      aiSummary={row.ai_summary}
                      aiNextAction={row.ai_next_action}
                      followupCreated={followupIds.has(row.id)}
                      attendanceStatus={row.attendance_status || "pending"}
                      outcomeStatus={row.outcome_status || "none"}
                      outcomeNote={row.outcome_note || ""}
                      contactStatus={row.contact_status || "uncontacted"}
                      nextFollowupAt={row.next_followup_at ? new Date(row.next_followup_at).toISOString() : null}
                      estimatedCommission={row.estimated_commission == null ? "" : String(row.estimated_commission)}
                      actualCommission={row.actual_commission == null ? "" : String(row.actual_commission)}
                      caseReference={row.case_reference || ""}
                    />
                  </section>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

export const metadata = { title: "預約營運工作區 | 太平洋房屋後台" };
