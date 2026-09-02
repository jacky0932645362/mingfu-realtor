import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getAdminCheckArgs, isCurrentUserAdmin } from "@/lib/admin-check";
import { getDealDetail } from "@/lib/deal";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import DealForm from "../DealForm";
import styles from "../deals.module.css";

export const dynamic = "force-dynamic";

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { email } = await getAdminCheckArgs();
  if (!email) redirect("/api/auth/signin?callbackUrl=%2Fadmin%2Fdeals");
  if (!(await isCurrentUserAdmin())) throw new Error("權限不足");

  const { id } = await params;
  const detail = await getDealDetail(id);
  if (!detail) notFound();

  return (
    <main className={styles.page} style={{ background: CIS.bg, color: CIS.text, fontFamily: CIS.font }}>
      <div className={styles.shell}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>
              <Icon name="money" size={26} />
              {detail.deal.title}
            </h1>
            <p className={styles.subtitle} style={{ color: CIS.textSub }}>
              成交日 {detail.deal.deal_date}
              {detail.deal.district ? `　${detail.deal.district}` : ""}
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link
              href="/admin/deals"
              className={styles.button}
              style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
            >
              返回列表
            </Link>
          </div>
        </div>
        <DealForm
          key={`${detail.deal.id}-${detail.deal.updated_at?.getTime() ?? 0}`}
          detail={detail}
        />
      </div>
    </main>
  );
}
