import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminCheckArgs, isCurrentUserAdmin } from "@/lib/admin-check";
import {
  listTenants,
  tenantStats,
  TENANT_STAGES,
  TENANT_PROPERTY_TYPES,
  type TenantQueue,
  type TenantRow,
} from "@/lib/tenant";
import { CIS, CHIP, type ChipTone } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import styles from "../customers/customers.module.css";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  grade?: string;
  stage?: string;
  queue?: string;
};

const QUEUES: Array<{ key: TenantQueue; label: string; icon: Parameters<typeof Icon>[0]["name"] }> = [
  { key: "all", label: "全部租客", icon: "users" },
  { key: "overdue_followup", label: "逾期追蹤", icon: "critical" },
  { key: "followup_today", label: "今天要追蹤", icon: "clock" },
  { key: "high_grade", label: "A 級客戶", icon: "star" },
];

const STAGE_LABELS: Record<string, string> = Object.fromEntries(TENANT_STAGES.map((s) => [s.key, s.label]));
const PROPERTY_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  TENANT_PROPERTY_TYPES.map((t) => [t.key, t.label]),
);

function propertyTypesText(row: TenantRow): string {
  const keys = (row.property_types || "").split(",").filter(Boolean);
  const labels = keys.map((k) => PROPERTY_TYPE_LABELS[k] || k);
  if (row.property_type_other) labels.push(row.property_type_other);
  return labels.join("、");
}

function gradeTone(grade: string): ChipTone {
  if (grade === "A") return "warn";
  if (grade === "B") return "info";
  return "neutral";
}

function stageTone(stage: string): ChipTone {
  if (stage === "closed") return "success";
  if (stage === "nurturing" || stage === "negotiating") return "warn";
  if (stage === "paused") return "neutral";
  if (stage === "new") return "neutral";
  return "info";
}

function formatDateTw(date: Date | null): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  const color = CHIP[tone];
  return (
    <span className={styles.chip} style={{ background: color.bg, color: color.color, borderColor: color.border }}>
      {children}
    </span>
  );
}

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { email } = await getAdminCheckArgs();
  if (!email) redirect("/api/auth/signin?callbackUrl=%2Fadmin%2Ftenants");
  if (!(await isCurrentUserAdmin())) throw new Error("權限不足");

  const sp = await searchParams;
  const queue = QUEUES.some((item) => item.key === sp.queue) ? (sp.queue as TenantQueue) : "all";
  const grade = sp.grade || "all";
  const stage = sp.stage || "all";
  const search = sp.q || "";

  const [tenants, stats] = await Promise.all([
    listTenants({ queue, grade, stage, search }),
    tenantStats(),
  ]);

  return (
    <main className={styles.page} style={{ background: CIS.bg, color: CIS.text, fontFamily: CIS.font }}>
      <div className={styles.shell}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>
              <Icon name="key" size={26} />
              租客客戶
            </h1>
            <p className={styles.subtitle} style={{ color: CIS.textSub }}>
              共 {stats.total} 位　A級 {stats.gradeA}　B級 {stats.gradeB}　C級 {stats.gradeC}
              {stats.overdueFollowup > 0 ? `　⚠ 逾期追蹤 ${stats.overdueFollowup}` : ""}
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
              href="/admin/calendar"
              className={styles.button}
              style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
            >
              <Icon name="calendar" size={15} />
              行事曆
            </Link>
            <Link
              href="/admin/tenants/new"
              className={styles.button}
              style={{ background: CIS.blue, color: "#fff" }}
            >
              <Icon name="check" size={16} />
              新增租客
            </Link>
          </div>
        </div>

        <form className={styles.toolbar} method="get">
          <input type="hidden" name="queue" value={queue} />
          <div className={styles.searchWrap}>
            <Icon name="search" size={16} color={CIS.textMute} />
            <input
              className={styles.searchInput}
              style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text }}
              type="text"
              name="q"
              defaultValue={search}
              placeholder="搜尋姓名／電話／LINE／區域"
            />
          </div>
          <select
            name="grade"
            defaultValue={grade}
            className={styles.select}
            style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text }}
          >
            <option value="all">全部等級</option>
            <option value="A">A 級</option>
            <option value="B">B 級</option>
            <option value="C">C 級</option>
          </select>
          <select
            name="stage"
            defaultValue={stage}
            className={styles.select}
            style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text }}
          >
            <option value="all">全部階段</option>
            {TENANT_STAGES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <button type="submit" className={styles.button} style={{ background: CIS.blueDeep, color: "#fff" }}>
            <Icon name="search" size={15} />
            搜尋
          </button>
        </form>

        <div className={styles.queueTabs}>
          {QUEUES.map((item) => {
            const active = item.key === queue;
            return (
              <Link
                key={item.key}
                href={`/admin/tenants?queue=${item.key}`}
                className={styles.tab}
                style={{
                  background: active ? CIS.blue : "rgba(255,255,255,0.05)",
                  color: active ? "#fff" : CIS.textSub,
                  border: `1px solid ${active ? CIS.blue : CIS.cardBorder}`,
                }}
              >
                <Icon name={item.icon} size={14} />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className={styles.list}>
          {tenants.length === 0 ? (
            <div className={styles.empty} style={{ borderColor: CIS.cardBorder, color: CIS.textMute }}>
              目前沒有符合條件的租客。
            </div>
          ) : (
            tenants.map((t: TenantRow) => {
              const overdue = t.next_follow_up_at ? new Date(t.next_follow_up_at) < new Date() : false;
              const propertyText = propertyTypesText(t);
              return (
                <Link
                  key={t.id}
                  href={`/admin/tenants/${t.id}`}
                  className={styles.card}
                  style={{ background: CIS.card, borderColor: CIS.cardBorder, color: CIS.text }}
                >
                  <div className={styles.cardHeader}>
                    <div>
                      <div className={styles.identity}>
                        {t.name}
                        {t.phone ? <span style={{ color: CIS.textMute, fontWeight: 400, fontSize: 15 }}> ・ {t.phone}</span> : null}
                      </div>
                      {t.area || propertyText ? (
                        <div style={{ color: CIS.textMute, fontSize: 14, marginTop: 3 }}>
                          {[t.area, propertyText].filter(Boolean).join("．")}
                          {t.rent_min || t.rent_max ? `　${t.rent_min ?? "?"}~${t.rent_max ?? "?"}元/月` : ""}
                        </div>
                      ) : null}
                    </div>
                    <div className={styles.chips}>
                      <Chip tone={gradeTone(t.grade)}>{t.grade} 級</Chip>
                      <Chip tone={stageTone(t.stage)}>{STAGE_LABELS[t.stage] || t.stage}</Chip>
                    </div>
                  </div>
                  {t.next_step ? (
                    <div style={{ marginTop: 9, fontSize: 15 }}>
                      下一步：{t.next_step}
                    </div>
                  ) : null}
                  {t.next_follow_up_at ? (
                    <div style={{ marginTop: 5, fontSize: 14, color: overdue ? "#fb7185" : CIS.textMute, fontWeight: overdue ? 800 : 400 }}>
                      {overdue ? "⚠ 逾期追蹤：" : "追蹤時間："}
                      {formatDateTw(t.next_follow_up_at)}
                    </div>
                  ) : null}
                </Link>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}
