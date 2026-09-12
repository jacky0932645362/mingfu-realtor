import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminCheckArgs } from "@/lib/admin-check";
import { listLicenses } from "@/lib/post591-license";
import styles from "../customers/customers.module.css";
import LicenseManager from "./LicenseManager";

export const dynamic = "force-dynamic";

export default async function Post591LicensePage() {
  const { email } = await getAdminCheckArgs();
  if (!email) redirect("/api/auth/signin?callbackUrl=%2Fadmin%2Fpost591-license");

  const licenses = await listLicenses();

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>591／樂屋外掛授權碼</h1>
            <p className={styles.subtitle}>
              「物件上架助手」給同事測試用的授權碼——建立、續期、調整電腦數上限、停用，都在這頁。
              一組碼可以綁好幾台電腦（用外掛自己產生的安裝編號分辨，不是看帳號），額滿要用新電腦時，
              把舊的移除或調高上限就能解。
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link href="/admin/properties" className={styles.button}>
              回物件管理
            </Link>
          </div>
        </div>

        <LicenseManager licenses={licenses} />
      </div>
    </div>
  );
}
