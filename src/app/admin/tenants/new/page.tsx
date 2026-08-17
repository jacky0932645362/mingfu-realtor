import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminCheckArgs, isCurrentUserAdmin } from "@/lib/admin-check";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import TenantForm from "../TenantForm";
import styles from "../../customers/customers.module.css";

export const dynamic = "force-dynamic";

export default async function NewTenantPage() {
  const { email } = await getAdminCheckArgs();
  if (!email) redirect("/api/auth/signin?callbackUrl=%2Fadmin%2Ftenants%2Fnew");
  if (!(await isCurrentUserAdmin())) throw new Error("權限不足");

  return (
    <main className={styles.page} style={{ background: CIS.bg, color: CIS.text, fontFamily: CIS.font }}>
      <div className={styles.shell}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>
              <Icon name="check" size={26} />
              新增租客
            </h1>
          </div>
          <div className={styles.headerActions}>
            <Link
              href="/admin/tenants"
              className={styles.button}
              style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
            >
              返回列表
            </Link>
          </div>
        </div>
        <TenantForm />
      </div>
    </main>
  );
}
