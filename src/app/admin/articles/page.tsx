import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminCheckArgs, isCurrentUserAdmin } from "@/lib/admin-check";
import {
  listArticles,
  articleStats,
  categoryLabel,
  articleStatusLabel,
  ARTICLE_CATEGORIES,
  type ArticleQueue,
  type ArticleRow,
} from "@/lib/article";
import { directImageUrl } from "@/lib/media-url";
import { CIS, CHIP, type ChipTone } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import styles from "../customers/customers.module.css";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  category?: string;
  queue?: string;
};

const QUEUES: Array<{ key: ArticleQueue; label: string; icon: Parameters<typeof Icon>[0]["name"] }> = [
  { key: "all", label: "全部文章", icon: "home" },
  { key: "published", label: "已發佈", icon: "globe" },
  { key: "draft", label: "草稿／下架", icon: "edit" },
];

function statusTone(status: string): ChipTone {
  if (status === "published") return "success";
  if (status === "hidden") return "warn";
  return "neutral";
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}`;
}

export default async function ArticlesAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { email } = await getAdminCheckArgs();
  if (!email) redirect("/api/auth/signin?callbackUrl=%2Fadmin%2Farticles");
  if (!(await isCurrentUserAdmin())) throw new Error("權限不足");

  const sp = await searchParams;
  const queue = QUEUES.some((item) => item.key === sp.queue) ? (sp.queue as ArticleQueue) : "all";
  const category = sp.category || "all";
  const search = sp.q || "";

  const [articles, stats] = await Promise.all([
    listArticles({ queue, category, search }),
    articleStats(),
  ]);

  return (
    <main className={styles.page} style={{ background: CIS.bg, color: CIS.text, fontFamily: CIS.font }}>
      <div className={styles.shell}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>
              <Icon name="book" size={26} />
              房產知識文章
            </h1>
            <p className={styles.subtitle} style={{ color: CIS.textSub }}>
              共 {stats.total} 篇　已發佈 {stats.published}　草稿／下架 {stats.draft}
              {stats.views > 0 ? `　累計瀏覽 ${stats.views}` : ""}
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link
              href="/articles"
              target="_blank"
              className={styles.button}
              style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
            >
              <Icon name="externalLink" size={15} />
              看公開頁
            </Link>
            <Link
              href="/admin/articles/new"
              className={styles.button}
              style={{ background: CIS.blue, color: "#fff" }}
            >
              <Icon name="add" size={16} />
              新增文章
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
              placeholder="搜尋標題／摘要／網址"
            />
          </div>
          <select
            name="category"
            defaultValue={category}
            className={styles.select}
            style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text }}
          >
            <option value="all">全部分類</option>
            {ARTICLE_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
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
                href={`/admin/articles?queue=${item.key}`}
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
          {articles.length === 0 ? (
            <div className={styles.empty} style={{ borderColor: CIS.cardBorder, color: CIS.textMute }}>
              還沒有文章。點右上角「新增文章」開始第一篇。
            </div>
          ) : (
            articles.map((a: ArticleRow) => {
              const cover = a.cover_url ? directImageUrl(a.cover_url) : null;
              return (
                <Link
                  key={a.id}
                  href={`/admin/articles/${a.id}`}
                  className={styles.card}
                  style={{ background: CIS.card, borderColor: CIS.cardBorder, color: CIS.text }}
                >
                  <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                    {cover ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={cover}
                        alt=""
                        style={{
                          width: 116,
                          height: 84,
                          flexShrink: 0,
                          objectFit: "cover",
                          borderRadius: 8,
                          border: `1px solid ${CIS.cardBorder}`,
                          background: CIS.bgSoft,
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 116,
                          height: 84,
                          flexShrink: 0,
                          borderRadius: 8,
                          border: `1px dashed ${CIS.cardBorder}`,
                          background: CIS.bgSoft,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: CIS.textMute,
                          fontSize: 12,
                        }}
                      >
                        沒有封面
                      </div>
                    )}

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className={styles.cardHeader}>
                        <div style={{ minWidth: 0 }}>
                          <div className={styles.identity}>{a.title}</div>
                          <div style={{ color: CIS.textMute, fontSize: 14, marginTop: 3 }}>
                            {[a.category ? categoryLabel(a.category) : null, formatDate(a.published_at)]
                              .filter(Boolean)
                              .join("．")}
                          </div>
                        </div>
                        <div className={styles.chips}>
                          <span
                            className={styles.chip}
                            style={{
                              background: CHIP[statusTone(a.status)].bg,
                              color: CHIP[statusTone(a.status)].color,
                              borderColor: CHIP[statusTone(a.status)].border,
                            }}
                          >
                            {articleStatusLabel(a.status)}
                          </span>
                        </div>
                      </div>

                      <div
                        style={{
                          marginTop: 8,
                          display: "flex",
                          gap: 14,
                          flexWrap: "wrap",
                          alignItems: "center",
                          fontSize: 14,
                          color: CIS.textSub,
                        }}
                      >
                        <span style={{ color: CIS.textMute }}>
                          <Icon name="eye" size={13} /> {a.view_count}
                        </span>
                        <code style={{ color: CIS.textMute, fontSize: 13 }}>/articles/{a.slug}</code>
                      </div>

                      {a.excerpt ? (
                        <div style={{ marginTop: 7, fontSize: 15, color: CIS.text }}>{a.excerpt}</div>
                      ) : null}
                    </div>
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
