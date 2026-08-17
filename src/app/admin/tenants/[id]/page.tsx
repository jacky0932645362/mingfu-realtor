import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getAdminCheckArgs, isCurrentUserAdmin } from "@/lib/admin-check";
import { getTenant } from "@/lib/tenant";
import { listShowingsForTenant } from "@/lib/tenant-showing";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import TenantForm from "../TenantForm";
import TenantShowingSection from "../TenantShowingSection";
import styles from "../../customers/customers.module.css";

export const dynamic = "force-dynamic";

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { email } = await getAdminCheckArgs();
  if (!email) redirect("/api/auth/signin?callbackUrl=%2Fadmin%2Ftenants");
  if (!(await isCurrentUserAdmin())) throw new Error("權限不足");

  const { id } = await params;
  const tenant = await getTenant(id);
  if (!tenant) notFound();
  const showings = await listShowingsForTenant(id);

  return (
    <main className={styles.page} style={{ background: CIS.bg, color: CIS.text, fontFamily: CIS.font }}>
      <div className={styles.shell}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>
              <Icon name="user" size={26} />
              {tenant.name}
            </h1>
            <p className={styles.subtitle} style={{ color: CIS.textSub }}>
              {[tenant.phone, tenant.line_id ? `LINE ${tenant.line_id}` : null].filter(Boolean).join(" ・ ") || "尚未填寫聯絡方式"}
            </p>
          </div>
          <div className={styles.headerActions}>
            {tenant.phone ? (
              <a
                href={`tel:${tenant.phone}`}
                className={styles.button}
                style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
              >
                <Icon name="mobile" size={16} />
                撥打電話
              </a>
            ) : null}
            <Link
              href="/admin/tenants"
              className={styles.button}
              style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
            >
              返回列表
            </Link>
          </div>
        </div>
        <TenantShowingSection tenantId={tenant.id} showings={showings} />
        {/* key 綁 updated_at：帶看紀錄存檔會順便更新租客的追蹤時間，
            router.refresh() 只會給新 props，不會重新 mount，表單自己的 useState 不會跟著換，
            所以用 key 強制换成新的 instance，讓表單重新從新資料初始化。對齊 customers/[id] 的做法。 */}
        <TenantForm key={`${tenant.id}-${tenant.updated_at?.getTime() ?? 0}`} tenant={tenant} />
      </div>
    </main>
  );
}
