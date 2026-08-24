import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminCheckArgs, isCurrentUserAdmin } from "@/lib/admin-check";
import { SITE_URL } from "@/config/owner";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import PropertyForm from "../PropertyForm";
import { cloudinaryEnabled } from "@/lib/cloudinary";
import styles from "../../customers/customers.module.css";

export const dynamic = "force-dynamic";

export default async function NewPropertyPage() {
  const { email } = await getAdminCheckArgs();
  if (!email) redirect("/api/auth/signin?callbackUrl=%2Fadmin%2Fproperties%2Fnew");
  if (!(await isCurrentUserAdmin())) throw new Error("權限不足");

  return (
    <main className={styles.page} style={{ background: CIS.bg, color: CIS.text, fontFamily: CIS.font }}>
      <div className={styles.shell}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>
              <Icon name="building" size={26} />
              新增物件
            </h1>
            <p className={styles.subtitle} style={{ color: CIS.textSub }}>
              資料還沒齊也沒關係，先存成「草稿」，之後隨時回來補。
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link
              href="/admin/properties"
              className={styles.button}
              style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
            >
              返回列表
            </Link>
          </div>
        </div>
        <PropertyForm siteUrl={SITE_URL} uploadEnabled={cloudinaryEnabled()} />
      </div>
    </main>
  );
}
