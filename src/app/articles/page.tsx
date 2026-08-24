/**
 * /articles — 全部文章（2026-08-24）
 *
 * 這是「房產知識」那條內容線的落地頁，跟 /property 的目的不一樣：
 * 物件頁要的是現在就想看房的人，文章要的是**還在研究階段**的人 ——
 * 搜「房地合一稅怎麼算」「買房流程」的人現在不會找房仲，但他會記住誰講得清楚。
 * 所以列表頁不放物件推薦、不放急迫的銷售話術。
 */
import type { Metadata } from "next";
import Link from "next/link";
import { OWNER, SITE_URL } from "@/config/owner";
import {
  listPublicArticles,
  categoryLabel,
  ARTICLE_CATEGORIES,
  type ArticleRow,
} from "@/lib/article";
import { autoExcerpt } from "@/lib/markdown";
import { directImageUrl } from "@/lib/media-url";
import SiteNav from "../_components/SiteNav";
import home from "../home.module.css";
import styles from "./articles.module.css";

/** 文章不需要即時，一小時重建一次就夠（也省掉每個訪客都打一次資料庫）。 */
export const revalidate = 3600;

const BRAND = OWNER.company || OWNER.name;

const DESCRIPTION =
  `房產知識文章：房地合一稅、買房流程、實價登錄怎麼查、房貸與議價眉角。` +
  `由${OWNER.name}（${OWNER.brandPersona}）整理，台中海線房產顧問，用客戶聽得懂的話講清楚。`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `房產知識文章｜買房賣房該知道的事｜${OWNER.name}`,
  description: DESCRIPTION,
  keywords: [
    "房產知識", "買房流程", "賣房流程", "房地合一稅", "實價登錄怎麼查",
    "房貸", "議價技巧", "台中海線房產", OWNER.name, "房仲蕭邦",
  ],
  alternates: { canonical: `${SITE_URL}/articles` },
  openGraph: {
    type: "website",
    title: `房產知識文章｜${OWNER.name}`,
    description: DESCRIPTION,
    url: `${SITE_URL}/articles`,
    siteName: BRAND,
    locale: "zh_TW",
  },
};

/** 發佈日期。固定用 zh-TW 的數字格式，避開「上午/下午」那個 hydration 坑。 */
function formatDate(d: Date | null): string {
  if (!d) return "";
  const dt = new Date(d);
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}`;
}

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const sp = await searchParams;
  const category =
    sp.category && ARTICLE_CATEGORIES.some((c) => c.key === sp.category) ? sp.category : "all";

  // 資料庫連不上時，這頁要還能顯示（至少導覽與說明在），不要整頁 500。
  let articles: ArticleRow[] = [];
  let allForChips: ArticleRow[] = [];
  try {
    articles = await listPublicArticles({ category });
    allForChips = category === "all" ? articles : await listPublicArticles();
  } catch {
    articles = [];
    allForChips = [];
  }

  // 篩選列只列出「真的有文章」的分類，免得點進空的分類。
  const activeCats = ARTICLE_CATEGORIES.filter((c) => allForChips.some((a) => a.category === c.key));

  return (
    <main className={home.page}>
      <SiteNav />

      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.heroEyebrow}>ARTICLES</p>
          <h1 className={styles.heroTitle}>買房賣房，該知道的事</h1>
          <p className={styles.heroSub}>
            不是教科書，是實際會遇到的問題。用聽得懂的話講，該注意的地方直接講。
          </p>
        </div>
      </section>

      <section className={home.section} aria-labelledby="list-title">
        <div className={home.sectionInner}>
          <h2 id="list-title" className={home.title}>
            {category === "all" ? "全部文章" : `${categoryLabel(category)}相關`}
          </h2>
          <p className={home.sub}>
            {articles.length > 0 ? `共 ${articles.length} 篇` : "　"}
          </p>

          {activeCats.length > 1 ? (
            <div className={styles.filterRow}>
              <Link
                href="/articles"
                className={`${styles.chip} ${category === "all" ? styles.chipActive : ""}`}
              >
                全部
              </Link>
              {activeCats.map((c) => (
                <Link
                  key={c.key}
                  href={`/articles?category=${c.key}`}
                  className={`${styles.chip} ${category === c.key ? styles.chipActive : ""}`}
                >
                  {c.label}
                </Link>
              ))}
            </div>
          ) : null}

          {articles.length === 0 ? (
            <div className={styles.empty}>
              這個分類目前還沒有文章。
              <br />
              有想知道的房產問題，直接<Link href="/card/booking">問我</Link>也可以。
            </div>
          ) : (
            <div className={styles.grid}>
              {articles.map((a) => {
                const cover = a.cover_url ? directImageUrl(a.cover_url) : null;
                return (
                  <Link key={a.id} href={`/articles/${a.slug}`} className={styles.card}>
                    {cover ? (
                      <div className={styles.cardCover}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={cover} alt={a.title} loading="lazy" />
                      </div>
                    ) : null}
                    <div className={styles.cardBody}>
                      <div className={styles.cardMeta}>
                        {a.category ? (
                          <span className={styles.cardCat}>{categoryLabel(a.category)}</span>
                        ) : null}
                        <span className={styles.cardDate}>{formatDate(a.published_at)}</span>
                      </div>
                      <h3 className={styles.cardTitle}>{a.title}</h3>
                      <p className={styles.cardExcerpt}>
                        {a.excerpt?.trim() || autoExcerpt(a.content)}
                      </p>
                      <span className={styles.cardGo}>看全文</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <footer className={home.footer}>
        <p className={home.footerName}>
          {OWNER.name}｜{BRAND}
        </p>
        <p>{OWNER.address}｜電話：{OWNER.phone}</p>
        <p>
          <Link href="/" style={{ color: "inherit" }}>回首頁</Link>
          {"　"}
          <Link href="/property" style={{ color: "inherit" }}>銷售物件</Link>
          {"　"}
          <Link href="/sell" style={{ color: "inherit" }}>委託賣房</Link>
          {"　"}
          <Link href="/tools" style={{ color: "inherit" }}>工具網站</Link>
        </p>
      </footer>
    </main>
  );
}
