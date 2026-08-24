import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getAdminCheckArgs, isCurrentUserAdmin } from "@/lib/admin-check";
import { getArticle, articleStatusLabel } from "@/lib/article";
import { SITE_URL } from "@/config/owner";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import ArticleForm from "../ArticleForm";
import { cloudinaryEnabled } from "@/lib/cloudinary";
import ShareLinkBar from "../../properties/ShareLinkBar";
import styles from "../../customers/customers.module.css";

export const dynamic = "force-dynamic";

export default async function ArticleDetailAdminPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { email } = await getAdminCheckArgs();
  if (!email) redirect("/api/auth/signin?callbackUrl=%2Fadmin%2Farticles");
  if (!(await isCurrentUserAdmin())) throw new Error("權限不足");

  const { id } = await params;
  const article = await getArticle(id);
  if (!article) notFound();

  const isPublic = article.status === "published";
  const publicUrl = `${SITE_URL.replace(/\/$/, "")}/articles/${article.slug}`;

  return (
    <main className={styles.page} style={{ background: CIS.bg, color: CIS.text, fontFamily: CIS.font }}>
      <div className={styles.shell}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>
              <Icon name="book" size={26} />
              {article.title}
            </h1>
            <p className={styles.subtitle} style={{ color: CIS.textSub }}>
              {articleStatusLabel(article.status)}
              {`　瀏覽 ${article.view_count} 次`}
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link
              href="/admin/articles"
              className={styles.button}
              style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
            >
              返回列表
            </Link>
          </div>
        </div>

        <ShareLinkBar url={publicUrl} isPublic={isPublic} />

        {/* key 綁 updated_at：存檔後 router.refresh() 只會給新 props，不會重新 mount，
            表單自己的 useState 不會跟著更新，對齊 properties/[id] 的做法。 */}
        <ArticleForm
          key={`${article.id}-${article.updated_at?.getTime() ?? 0}`}
          article={article}
          uploadEnabled={cloudinaryEnabled()}
        />
      </div>
    </main>
  );
}
