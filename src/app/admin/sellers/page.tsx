import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminCheckArgs, isCurrentUserAdmin } from "@/lib/admin-check";
import {
  listSellers,
  sellerStats,
  SELLER_STAGES,
  SELLER_PROPERTY_TYPES,
  type SellerQueue,
  type SellerRow,
} from "@/lib/seller";
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

const QUEUES: Array<{ key: SellerQueue; label: string; icon: Parameters<typeof Icon>[0]["name"] }> = [
  { key: "all", label: "全部屋主", icon: "users" },
  { key: "overdue_report", label: "逾期回報", icon: "critical" },
  { key: "report_today", label: "今天要回報", icon: "clock" },
  { key: "high_grade", label: "A 級急售", icon: "star" },
];

const STAGE_LABELS: Record<string, string> = Object.fromEntries(SELLER_STAGES.map((s) => [s.key, s.label]));
const PROPERTY_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  SELLER_PROPERTY_TYPES.map((t) => [t.key, t.label]),
);

function propertyTypeText(row: SellerRow): string {
  if (!row.property_type) return row.property_type_other || "";
  return PROPERTY_TYPE_LABELS[row.property_type] || row.property_type;
}

function gradeTone(grade: string): ChipTone {
  if (grade === "A") return "danger";
  if (grade === "B") return "info";
  return "neutral";
}

function stageTone(stage: string): ChipTone {
  if (stage === "closed") return "success";
  if (stage === "negotiating" || stage === "showing") return "warn";
  if (stage === "expired") return "danger";
  if (stage === "paused" || stage === "pending") return "neutral";
  return "info";
}

function formatDateTw(date: Date | null): string {
  if (!date) return "";
  // Node（SSR）對 zh-TW 上午/下午前面實測吐 U+2009（THIN SPACE），瀏覽器（hydrate）
  // 吐一般空格 U+0020，會觸發 hydration mismatch，統一換成一般空格。
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date)).replace(/[ -​  ]/g, " ");
}

function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  const color = CHIP[tone];
  return (
    <span className={styles.chip} style={{ background: color.bg, color: color.color, borderColor: color.border }}>
      {children}
    </span>
  );
}

export default async function SellersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { email } = await getAdminCheckArgs();
  if (!email) redirect("/api/auth/signin?callbackUrl=%2Fadmin%2Fsellers");
  if (!(await isCurrentUserAdmin())) throw new Error("權限不足");

  const sp = await searchParams;
  const queue = QUEUES.some((item) => item.key === sp.queue) ? (sp.queue as SellerQueue) : "all";
  const grade = sp.grade || "all";
  const stage = sp.stage || "all";
  const search = sp.q || "";

  const [sellers, stats] = await Promise.all([
    listSellers({ queue, grade, stage, search }),
    sellerStats(),
  ]);

  return (
    <main className={styles.page} style={{ background: CIS.bg, color: CIS.text, fontFamily: CIS.font }}>
      <div className={styles.shell}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>
              <Icon name="home" size={26} />
              屋主客戶
            </h1>
            <p className={styles.subtitle} style={{ color: CIS.textSub }}>
              共 {stats.total} 位　A級急售 {stats.gradeA}　B級一般 {stats.gradeB}　C級不急賣 {stats.gradeC}
              {stats.overdueReport > 0 ? `　⚠ 逾期回報 ${stats.overdueReport}` : ""}
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
              href="/admin/tenants"
              className={styles.button}
              style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
            >
              租客客戶
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
              href="/admin/sellers/new"
              className={styles.button}
              style={{ background: CIS.blue, color: "#fff" }}
            >
              <Icon name="check" size={16} />
              新增屋主
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
              placeholder="搜尋姓名／電話／LINE／售屋地址"
            />
          </div>
          <select
            name="grade"
            defaultValue={grade}
            className={styles.select}
            style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text }}
          >
            <option value="all">全部等級</option>
            <option value="A">A｜急售</option>
            <option value="B">B｜一般</option>
            <option value="C">C｜不急賣</option>
          </select>
          <select
            name="stage"
            defaultValue={stage}
            className={styles.select}
            style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text }}
          >
            <option value="all">全部階段</option>
            {SELLER_STAGES.map((s) => (
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
                href={`/admin/sellers?queue=${item.key}`}
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
          {sellers.length === 0 ? (
            <div className={styles.empty} style={{ borderColor: CIS.cardBorder, color: CIS.textMute }}>
              目前沒有符合條件的屋主。
            </div>
          ) : (
            sellers.map((s: SellerRow) => {
              const overdue = s.next_report_at ? new Date(s.next_report_at) < new Date() : false;
              const propertyText = propertyTypeText(s);
              return (
                <Link
                  key={s.id}
                  href={`/admin/sellers/${s.id}`}
                  className={styles.card}
                  style={{ background: CIS.card, borderColor: CIS.cardBorder, color: CIS.text }}
                >
                  <div className={styles.cardHeader}>
                    <div>
                      <div className={styles.identity}>
                        {s.name}
                        {s.phone ? <span style={{ color: CIS.textMute, fontWeight: 400, fontSize: 15 }}> ・ {s.phone}</span> : null}
                      </div>
                      {s.property_address || propertyText ? (
                        <div style={{ color: CIS.textMute, fontSize: 14, marginTop: 3 }}>
                          {[s.property_address, propertyText].filter(Boolean).join("．")}
                          {s.listing_price ? `　開價 ${s.listing_price}萬` : ""}
                        </div>
                      ) : null}
                    </div>
                    <div className={styles.chips}>
                      <Chip tone={gradeTone(s.grade)}>{s.grade} 級</Chip>
                      <Chip tone={stageTone(s.stage)}>{STAGE_LABELS[s.stage] || s.stage}</Chip>
                    </div>
                  </div>
                  {s.next_step ? (
                    <div style={{ marginTop: 9, fontSize: 15 }}>
                      下一步：{s.next_step}
                    </div>
                  ) : null}
                  {s.next_report_at ? (
                    <div style={{ marginTop: 5, fontSize: 14, color: overdue ? "#fb7185" : CIS.textMute, fontWeight: overdue ? 800 : 400 }}>
                      {overdue ? "⚠ 逾期回報：" : "下次回報："}
                      {formatDateTw(s.next_report_at)}
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
