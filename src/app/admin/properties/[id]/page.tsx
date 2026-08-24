import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getAdminCheckArgs, isCurrentUserAdmin } from "@/lib/admin-check";
import { getProperty, statusLabel } from "@/lib/property";
import { SITE_URL } from "@/config/owner";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import PropertyForm from "../PropertyForm";
import ShareLinkBar from "../ShareLinkBar";
import styles from "../../customers/customers.module.css";

export const dynamic = "force-dynamic";

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { email } = await getAdminCheckArgs();
  if (!email) redirect("/api/auth/signin?callbackUrl=%2Fadmin%2Fproperties");
  if (!(await isCurrentUserAdmin())) throw new Error("權限不足");

  const { id } = await params;
  const property = await getProperty(id);
  if (!property) notFound();

  const isPublic = ["published", "reserved", "sold"].includes(property.status);
  const publicUrl = `${SITE_URL.replace(/\/$/, "")}/property/${property.slug}`;

  return (
    <main className={styles.page} style={{ background: CIS.bg, color: CIS.text, fontFamily: CIS.font }}>
      <div className={styles.shell}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>
              <Icon name="building" size={26} />
              {property.title}
            </h1>
            <p className={styles.subtitle} style={{ color: CIS.textSub }}>
              {statusLabel(property.status)}
              {property.price ? `　${property.price} 萬` : ""}
              {`　瀏覽 ${property.view_count} 次`}
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
            {/* 把這筆物件轉成「591 後台可以直接貼上」的內容。放在標題列是因為
                填完資料的下一個動作十之八九就是拿去刊登，不該埋在頁面最下面。 */}
            <Link
              href={`/admin/properties/${property.id}/export-591`}
              className={styles.button}
              style={{ background: CIS.blue, color: "#fff" }}
            >
              <Icon name="upload" size={15} />
              產生 591 上架包
            </Link>
          </div>
        </div>

        <ShareLinkBar url={publicUrl} isPublic={isPublic} />

        {/* key 綁 updated_at：存檔後 router.refresh() 只會給新 props，不會重新 mount，
            表單自己的 useState 不會跟著更新，所以用 key 強制換成新的 instance，
            對齊 sellers/[id] 的做法。 */}
        <PropertyForm
          key={`${property.id}-${property.updated_at?.getTime() ?? 0}`}
          property={property}
          siteUrl={SITE_URL}
        />
      </div>
    </main>
  );
}
