import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminCheckArgs, isCurrentUserAdmin } from "@/lib/admin-check";
import {
  listDeals,
  sumChildrenByDeal,
  dealStats,
  computeIncomeTotal,
  DEAL_PAYMENT_STATUSES,
  DEAL_SIDES,
  type DealRow,
} from "@/lib/deal";
import { CIS, CHIP, type ChipTone } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import styles from "./deals.module.css";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; status?: string; month?: string };

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  DEAL_PAYMENT_STATUSES.map((s) => [s.key, s.label]),
);
const SIDE_LABELS: Record<string, string> = Object.fromEntries(DEAL_SIDES.map((s) => [s.key, s.label]));

function statusTone(status: string): ChipTone {
  if (status === "paid") return "success";
  if (status === "partial") return "warn";
  return "danger";
}

function fmtWan(yuan: number): string {
  const wan = Math.round((yuan / 10000) * 10) / 10;
  return `${wan.toLocaleString("zh-TW")} 萬`;
}

/** 產生最近 15 個月的 'YYYY-MM' 選項 */
function recentMonths(count = 15): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < count; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
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

export default async function DealsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { email } = await getAdminCheckArgs();
  if (!email) redirect("/api/auth/signin?callbackUrl=%2Fadmin%2Fdeals");
  if (!(await isCurrentUserAdmin())) throw new Error("權限不足");

  const sp = await searchParams;
  const status = sp.status || "all";
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : "";
  const search = sp.q || "";

  const deals = await listDeals({ paymentStatus: status, month, search });
  const children = await sumChildrenByDeal(deals.map((d) => d.id));
  const stats = await dealStats(month ? { month } : undefined);

  const scopeLabel = month ? `${month.replace("-", " 年 ")} 月` : "全部";

  return (
    <main className={styles.page} style={{ background: CIS.bg, color: CIS.text, fontFamily: CIS.font }}>
      <div className={styles.shell}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>
              <Icon name="money" size={26} />
              成交記帳
            </h1>
            <p className={styles.subtitle} style={{ color: CIS.textSub }}>
              每筆成交的收入、成本、拆帳，自動算你實拿多少。
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link
              href="/admin/customers"
              className={styles.button}
              style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
            >
              <Icon name="users" size={15} />
              客戶
            </Link>
            <Link
              href="/admin/properties"
              className={styles.button}
              style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
            >
              <Icon name="building" size={15} />
              物件
            </Link>
            <Link
              href="/admin/deals/new"
              className={styles.button}
              style={{ background: CIS.blue, color: "#fff" }}
            >
              <Icon name="add" size={16} />
              新增成交
            </Link>
          </div>
        </div>

        <div className={styles.statRow}>
          <div className={styles.statCard} style={{ background: CIS.card, borderColor: CIS.blue }}>
            <div className={styles.statLabel} style={{ color: CIS.blueSoft }}>{scopeLabel}實拿</div>
            <div className={styles.statValue} style={{ color: CIS.text }}>{fmtWan(stats.takeHome)}</div>
            <div className={styles.statSub} style={{ color: CIS.textMute }}>
              收入 {fmtWan(stats.incomeTotal)}
            </div>
          </div>
          <div className={styles.statCard} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
            <div className={styles.statLabel} style={{ color: CIS.textMute }}>{scopeLabel}成交</div>
            <div className={styles.statValue} style={{ color: CIS.text }}>{stats.count} 件</div>
          </div>
          <div className={styles.statCard} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
            <div className={styles.statLabel} style={{ color: CIS.textMute }}>成本 + 拆帳</div>
            <div className={styles.statValue} style={{ color: CIS.text }}>
              {fmtWan(stats.expenseTotal + stats.splitTotal)}
            </div>
          </div>
          <div className={styles.statCard} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
            <div className={styles.statLabel} style={{ color: CIS.textMute }}>還沒收齊</div>
            <div className={styles.statValue} style={{ color: stats.outstandingCount > 0 ? "#fbbf24" : CIS.text }}>
              {stats.outstandingCount} 件
            </div>
          </div>
        </div>

        <form className={styles.toolbar} method="get">
          <div className={styles.searchWrap}>
            <Icon name="search" size={16} color={CIS.textMute} />
            <input
              className={styles.searchInput}
              style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text }}
              type="text"
              name="q"
              defaultValue={search}
              placeholder="搜尋案名／區域／備註"
            />
          </div>
          <select
            name="month"
            defaultValue={month}
            className={styles.select}
            style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text }}
          >
            <option value="">全部月份</option>
            {recentMonths().map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select
            name="status"
            defaultValue={status}
            className={styles.select}
            style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text }}
          >
            <option value="all">全部收款狀態</option>
            {DEAL_PAYMENT_STATUSES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <button type="submit" className={styles.button} style={{ background: CIS.blueDeep, color: "#fff" }}>
            <Icon name="search" size={15} />
            篩選
          </button>
        </form>

        <div className={styles.list}>
          {deals.length === 0 ? (
            <div className={styles.empty} style={{ borderColor: CIS.cardBorder, color: CIS.textMute }}>
              目前沒有符合條件的成交紀錄。點右上角「新增成交」記第一筆。
            </div>
          ) : (
            deals.map((deal: DealRow) => {
              const income = computeIncomeTotal(deal);
              const child = children[deal.id] || { expenseTotal: 0, splitTotal: 0 };
              const takeHome = income - child.expenseTotal - child.splitTotal;
              return (
                <Link
                  key={deal.id}
                  href={`/admin/deals/${deal.id}`}
                  className={styles.card}
                  style={{ background: CIS.card, borderColor: CIS.cardBorder, color: CIS.text }}
                >
                  <div className={styles.cardHeader}>
                    <div>
                      <div className={styles.identity}>{deal.title}</div>
                      <div className={styles.cardMeta} style={{ color: CIS.textMute }}>
                        {deal.deal_date}
                        {deal.district ? `　${deal.district}` : ""}
                        {`　${SIDE_LABELS[deal.side] || deal.side}`}
                        {deal.total_price ? `　成交 ${fmtWan(deal.total_price)}` : ""}
                      </div>
                    </div>
                    <div className={styles.chips}>
                      <Chip tone={statusTone(deal.payment_status)}>
                        {STATUS_LABELS[deal.payment_status] || deal.payment_status}
                      </Chip>
                    </div>
                  </div>
                  <div className={styles.cardMoneyRow}>
                    <span style={{ color: CIS.textSub }}>
                      收入 <strong style={{ color: CIS.text }}>{fmtWan(income)}</strong>
                    </span>
                    <span style={{ color: CIS.textSub }}>
                      成本+拆帳{" "}
                      <strong style={{ color: CIS.text }}>
                        {fmtWan(child.expenseTotal + child.splitTotal)}
                      </strong>
                    </span>
                    <span style={{ color: CIS.textSub }}>
                      實拿{" "}
                      <strong className={takeHome >= 0 ? styles.moneyPos : styles.moneyNeg}>
                        {fmtWan(takeHome)}
                      </strong>
                    </span>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}
