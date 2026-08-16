import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminCheckArgs, isCurrentUserAdmin } from "@/lib/admin-check";
import { listUpcomingFollowUps } from "@/lib/customer";
import { listUpcomingShowings } from "@/lib/showing";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import styles from "../customers/customers.module.css";

export const dynamic = "force-dynamic";

const AGENDA_DAYS = 14;

type AgendaEvent = {
  at: Date;
  dateKey: string;
  kind: "showing" | "followup";
  title: string;
  subtitle: string;
  href: string;
  overdue: boolean;
};

function taipeiDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

function dateGroupLabel(dateKey: string, todayKey: string, tomorrowKey: string): string {
  if (dateKey === todayKey) return "今天";
  if (dateKey === tomorrowKey) return "明天";
  const [y, m, d] = dateKey.split("-").map(Number);
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}（週${weekday}）`;
}

function formatTimeTw(date: Date): string {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default async function CalendarPage() {
  const { email } = await getAdminCheckArgs();
  if (!email) redirect("/api/auth/signin?callbackUrl=%2Fadmin%2Fcalendar");
  if (!(await isCurrentUserAdmin())) throw new Error("權限不足");

  const [showings, followUps] = await Promise.all([
    listUpcomingShowings(AGENDA_DAYS),
    listUpcomingFollowUps(AGENDA_DAYS),
  ]);

  const now = new Date();
  const todayKey = taipeiDateKey(now);
  const tomorrowKey = taipeiDateKey(new Date(now.getTime() + 86_400_000));

  const events: AgendaEvent[] = [
    ...showings.map((s): AgendaEvent => ({
      at: new Date(s.visited_at),
      dateKey: taipeiDateKey(new Date(s.visited_at)),
      kind: "showing",
      title: `${formatTimeTw(new Date(s.visited_at))}　${s.customer_name}｜${s.property_name}`,
      subtitle: s.customer_phone,
      href: `/admin/customers/${s.customer_id}`,
      overdue: false,
    })),
    ...followUps.map((c): AgendaEvent => ({
      at: new Date(c.next_follow_up_at as Date),
      dateKey: taipeiDateKey(new Date(c.next_follow_up_at as Date)),
      kind: "followup",
      title: `${formatTimeTw(new Date(c.next_follow_up_at as Date))}　追蹤 ${c.name}`,
      subtitle: c.next_step || c.phone,
      href: `/admin/customers/${c.id}`,
      overdue: new Date(c.next_follow_up_at as Date) < now,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const groups = new Map<string, AgendaEvent[]>();
  for (const ev of events) {
    if (!groups.has(ev.dateKey)) groups.set(ev.dateKey, []);
    groups.get(ev.dateKey)!.push(ev);
  }
  const orderedKeys = Array.from(groups.keys()).sort();

  return (
    <main className={styles.page} style={{ background: CIS.bg, color: CIS.text, fontFamily: CIS.font }}>
      <div className={styles.shell}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>
              <Icon name="calendar" size={26} />
              行事曆
            </h1>
            <p className={styles.subtitle} style={{ color: CIS.textSub }}>
              未來 {AGENDA_DAYS} 天的帶看與追蹤，逾期追蹤會排最前面
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link
              href="/admin/customers"
              className={styles.button}
              style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
            >
              買方客戶
            </Link>
            <Link
              href="/admin/appointments"
              className={styles.button}
              style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
            >
              預約後台
            </Link>
          </div>
        </div>

        {events.length === 0 ? (
          <div className={styles.empty} style={{ borderColor: CIS.cardBorder, color: CIS.textMute }}>
            未來 {AGENDA_DAYS} 天內沒有安排的帶看或追蹤。
          </div>
        ) : (
          <div style={{ display: "grid", gap: 22 }}>
            {orderedKeys.map((key) => {
              const isOverdueGroup = key < todayKey;
              return (
                <div key={key}>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 900,
                      marginBottom: 9,
                      color: isOverdueGroup ? "#fb7185" : CIS.text,
                    }}
                  >
                    {isOverdueGroup ? `⚠ 已逾期　${dateGroupLabel(key, todayKey, tomorrowKey)}` : dateGroupLabel(key, todayKey, tomorrowKey)}
                  </div>
                  <div className={styles.list}>
                    {groups.get(key)!.map((ev, i) => (
                      <Link
                        key={`${key}-${i}`}
                        href={ev.href}
                        className={styles.card}
                        style={{
                          background: CIS.card,
                          borderColor: ev.overdue ? "rgba(251,113,133,0.5)" : CIS.cardBorder,
                          color: CIS.text,
                          padding: "13px 16px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Icon name={ev.kind === "showing" ? "home" : "chat"} size={16} color={ev.kind === "showing" ? CIS.blueSoft : "#fbbf24"} />
                          <span style={{ fontSize: 16, fontWeight: 800 }}>{ev.title}</span>
                        </div>
                        <div style={{ color: CIS.textMute, fontSize: 14, marginTop: 4, marginLeft: 24 }}>{ev.subtitle}</div>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
