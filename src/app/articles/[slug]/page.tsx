/**
 * /articles/[slug] — 文章內頁（2026-08-24）
 *
 * 跟 property/[slug] 的差別：物件成交後連結還要開得起來（客戶手上有連結），
 * 文章下架就是真的不想給人看，所以草稿／下架一律 404，沒有「舊連結還能開」的例外。
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getPublicArticleBySlug,
  listPublicArticles,
  categoryLabel,
  incrementArticleView,
} from "@/lib/article";
import { renderMarkdown, autoExcerpt, readMinutes } from "@/lib/markdown";
import { directImageUrl } from "@/lib/media-url";
import { OWNER, SOCIAL, SITE_URL } from "@/config/owner";
import SiteNav from "../../_components/SiteNav";
import home from "../../home.module.css";
import styles from "../articles.module.css";

const BRAND = OWNER.company || OWNER.name;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublicArticleBySlug(slug);
  if (!article) return { title: "文章不存在" };

  const description = article.excerpt?.trim() || autoExcerpt(article.content, 140);
  const url = `${SITE_URL}/articles/${slug}`;
  const image = article.cover_url ? directImageUrl(article.cover_url) : `${SITE_URL}/profile.jpg`;

  return {
    metadataBase: new URL(SITE_URL),
    title: `${article.title}｜${OWNER.name}`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: article.title,
      description,
      url,
      siteName: BRAND,
      locale: "zh_TW",
      images: [{ url: image, width: 1200, height: 630, alt: article.title }],
      publishedTime: article.published_at?.toISOString(),
    },
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description,
      images: [image],
    },
  };
}

function formatDate(d: Date | null): string {
  if (!d) return "";
  const dt = new Date(d);
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}`;
}

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = await getPublicArticleBySlug(slug);
  if (!article) notFound();

  incrementArticleView(article.id).catch(() => {});

  const related = await listPublicArticles({
    category: article.category || undefined,
    excludeSlug: article.slug,
    limit: 3,
  });

  const cover = article.cover_url ? directImageUrl(article.cover_url) : null;
  const html = renderMarkdown(article.content);

  // JSON-LD：讓 Google 認得這是一篇文章，不只是一堆文字。
  const JSON_LD = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.excerpt?.trim() || autoExcerpt(article.content, 140),
    ...(cover ? { image: [cover] } : {}),
    ...(article.published_at ? { datePublished: article.published_at.toISOString() } : {}),
    ...(article.updated_at ? { dateModified: article.updated_at.toISOString() } : {}),
    author: { "@type": "Person", name: OWNER.name, alternateName: OWNER.brandPersona },
    publisher: { "@type": "Organization", name: BRAND },
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}/articles/${article.slug}` },
  };

  return (
    <main className={home.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <SiteNav />

      <div className={styles.articleHead}>
        <div className={styles.articleMeta}>
          {article.category ? (
            <Link href={`/articles?category=${article.category}`} className={styles.cardCat}>
              {categoryLabel(article.category)}
            </Link>
          ) : null}
          <span className={styles.cardDate}>{formatDate(article.published_at)}</span>
          <span className={styles.cardDate}>・約 {readMinutes(article.content)} 分鐘讀完</span>
        </div>
        <h1 className={styles.articleTitle}>{article.title}</h1>
        {article.excerpt?.trim() ? <p className={styles.articleExcerpt}>{article.excerpt}</p> : null}
      </div>

      {cover ? (
        <div className={styles.articleCover}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt={article.title} fetchPriority="high" />
        </div>
      ) : null}

      {/* Markdown 渲染出的 HTML 已在 @/lib/markdown 先 escape 再套規則 ——
          原文裡的 <script> 等標籤只會變成純文字顯示，不會被瀏覽器執行。 */}
      <div className={styles.body} dangerouslySetInnerHTML={{ __html: html }} />

      {/* 稅務／法規類內容的免責聲明。分類是 tax 才顯示，不要每篇都塞。 */}
      {article.category === "tax" ? (
        <p className={styles.disclaimer}>
          ※ 本文為一般性說明，實際稅額與規定以國稅局最新公告及個案狀況為準。
          金額較大或情況特殊時，請務必找地政士或稅務專業人員確認。
        </p>
      ) : null}

      <div className={styles.articleCta}>
        <h2 className={styles.articleCtaTitle}>有其他問題想問？</h2>
        <p className={styles.articleCtaSub}>
          每個人的情況不一樣，文章講的是一般原則。您的狀況歡迎直接問我。
        </p>
        <div className={styles.articleCtaActions}>
          <Link href="/card/booking" className={`${home.btn} ${home.btnPrimary}`}>
            線上預約諮詢
          </Link>
          <a href={SOCIAL.line} target="_blank" rel="noopener noreferrer" className={`${home.btn} ${home.btnLine}`}>
            加LINE問問
          </a>
        </div>
      </div>

      {related.length > 0 ? (
        <section className={home.section} aria-labelledby="related-title">
          <div className={`${home.sectionInner} ${styles.related}`}>
            <h2 id="related-title" className={styles.relatedTitle}>你可能也想看</h2>
            <div className={styles.grid}>
              {related.map((a) => {
                const rc = a.cover_url ? directImageUrl(a.cover_url) : null;
                return (
                  <Link key={a.id} href={`/articles/${a.slug}`} className={styles.card}>
                    {rc ? (
                      <div className={styles.cardCover}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={rc} alt={a.title} loading="lazy" />
                      </div>
                    ) : null}
                    <div className={styles.cardBody}>
                      <div className={styles.cardMeta}>
                        {a.category ? <span className={styles.cardCat}>{categoryLabel(a.category)}</span> : null}
                      </div>
                      <h3 className={styles.cardTitle}>{a.title}</h3>
                      <span className={styles.cardGo}>看全文</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      <footer className={home.footer}>
        <p className={home.footerName}>
          {OWNER.name}｜{BRAND}
        </p>
        <p>{OWNER.address}｜電話：{OWNER.phone}</p>
        <p>
          <Link href="/articles" style={{ color: "inherit" }}>回文章列表</Link>
          {"　"}
          <Link href="/" style={{ color: "inherit" }}>回首頁</Link>
        </p>
      </footer>
    </main>
  );
}
