import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getAdminCheckArgs, isCurrentUserAdmin } from "@/lib/admin-check";
import { getSeller } from "@/lib/seller";
import { listReportsForSeller } from "@/lib/seller-report";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import SellerForm from "../SellerForm";
import SellerReportSection from "../SellerReportSection";
import styles from "../../customers/customers.module.css";

export const dynamic = "force-dynamic";

export default async function SellerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { email } = await getAdminCheckArgs();
  if (!email) redirect("/api/auth/signin?callbackUrl=%2Fadmin%2Fsellers");
  if (!(await isCurrentUserAdmin())) throw new Error("權限不足");

  const { id } = await params;
  const seller = await getSeller(id);
  if (!seller) notFound();
  const reports = await listReportsForSeller(id);

  return (
    <main className={styles.page} style={{ background: CIS.bg, color: CIS.text, fontFamily: CIS.font }}>
      <div className={styles.shell}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>
              <Icon name="user" size={26} />
              {seller.name}
            </h1>
            <p className={styles.subtitle} style={{ color: CIS.textSub }}>
              {[seller.phone, seller.line_id ? `LINE ${seller.line_id}` : null].filter(Boolean).join(" ・ ") || "尚未填寫聯絡方式"}
            </p>
          </div>
          <div className={styles.headerActions}>
            {seller.phone ? (
              <a
                href={`tel:${seller.phone}`}
                className={styles.button}
                style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
              >
                <Icon name="mobile" size={16} />
                撥打電話
              </a>
            ) : null}
            <Link
              href="/admin/sellers"
              className={styles.button}
              style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
            >
              返回列表
            </Link>
          </div>
        </div>
        <SellerReportSection sellerId={seller.id} reports={reports} />
        {/* key 綁 updated_at：回報紀錄存檔會順便更新屋主的回報時間，
            router.refresh() 只會給新 props，不會重新 mount，表單自己的 useState 不會跟著更新，
            所以用 key 強制换成新的 instance，對齊 tenants/[id] 的做法。 */}
        <SellerForm key={`${seller.id}-${seller.updated_at?.getTime() ?? 0}`} seller={seller} />
      </div>
    </main>
  );
}
