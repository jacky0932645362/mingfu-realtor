/**
 * 房產知識文章 — 資料層（2026-08-24）
 * raw SQL 讀寫 article 表，對齊 property.ts / seller.ts 的做法（不依賴 prisma client 重生）。
 *
 * 全 additive：新表，不改任何既有表／邏輯。
 *
 * 這是第五個模組。跟 property 的差別：property 賣的是「這一間」，
 * 文章賣的是「這個人懂」——目的不是導到單一物件，是讓搜「房地合一稅怎麼算」
 * 的人進來、發現寫得清楚、記住這個房仲。所以文章頁不塞物件廣告。
 *
 * 內容存 Markdown 原文（不存 HTML）：
 * 存 HTML 的話，之後想改版面或修渲染邏輯就得整批重跑改資料；
 * 存原文則渲染是唯讀的推導，隨時可改。渲染在 @/lib/markdown。
 */
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";

export type ArticleRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  category: string | null;
  content: string;
  cover_url: string | null;
  status: string;
  sort_order: number;
  view_count: number;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date | null;
};

export type ArticleQueue = "all" | "published" | "draft";

export const ARTICLE_STATUSES = [
  { key: "draft", label: "草稿（不公開）" },
  { key: "published", label: "已發佈" },
  { key: "hidden", label: "已下架" },
] as const;

/**
 * 分類。
 * ⚠️ 照客戶會問的問題分，不是照房仲內部的業務別分 ——
 *    客戶不會想「這屬於賣方業務」，他想的是「我要賣房子」。
 */
export const ARTICLE_CATEGORIES = [
  { key: "buy", label: "買房" },
  { key: "sell", label: "賣房" },
  { key: "tax", label: "稅務" },
  { key: "loan", label: "房貸" },
  { key: "rent", label: "租屋" },
  { key: "market", label: "市場觀察" },
] as const;

export function categoryLabel(key: string | null): string {
  if (!key) return "";
  return ARTICLE_CATEGORIES.find((c) => c.key === key)?.label || key;
}

export function articleStatusLabel(key: string): string {
  return ARTICLE_STATUSES.find((s) => s.key === key)?.label || key;
}

/** 網址短碼。跟 property 同一套字母表（去掉 0/o/1/l/i，唸給人聽不會錯）。 */
const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function randomSlug(len = 6): string {
  let out = "";
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i += 1) out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  return out;
}

/**
 * 整理使用者填的 slug。
 * 文章的 slug 跟物件不同，**盡量讓它可讀**（`/articles/land-tax-guide` 對 SEO
 * 與分享出去的觀感都比 `/articles/x7k2mp` 好），所以開放自訂，只做安全性正規化。
 */
export function normalizeArticleSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

let tableEnsured = false;

export async function ensureArticleTable(): Promise<void> {
  if (tableEnsured) return;
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS article (
      id            VARCHAR(64)   NOT NULL,
      slug          VARCHAR(80)   NOT NULL,
      title         VARCHAR(160)  NOT NULL,
      excerpt       VARCHAR(300)  NULL,
      category      VARCHAR(20)   NULL,
      content       LONGTEXT      NOT NULL,
      cover_url     VARCHAR(600)  NULL,
      status        VARCHAR(20)   NOT NULL DEFAULT 'draft',
      sort_order    INT           NOT NULL DEFAULT 0,
      view_count    INT           NOT NULL DEFAULT 0,
      published_at  DATETIME      NULL,
      created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP     NULL,
      PRIMARY KEY (id),
      UNIQUE KEY article_slug_uniq (slug),
      KEY article_status_idx (status),
      KEY article_category_idx (category),
      KEY article_sort_idx (sort_order, published_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tableEnsured = true;
}

/* ────────────────── 後台查詢 ────────────────── */

export async function listArticles(opts?: {
  queue?: ArticleQueue;
  category?: string;
  search?: string;
  limit?: number;
}): Promise<ArticleRow[]> {
  await ensureArticleTable();
  const filters: string[] = ["1=1"];
  const params: unknown[] = [];

  const queue = opts?.queue || "all";
  if (queue === "published") filters.push("status = 'published'");
  else if (queue === "draft") filters.push("status IN ('draft','hidden')");

  if (opts?.category && opts.category !== "all") {
    filters.push("category = ?");
    params.push(opts.category);
  }

  const search = opts?.search?.trim().slice(0, 120);
  if (search) {
    const pattern = `%${search.replace(/[%_]/g, "\\$&")}%`;
    filters.push("(title LIKE ? OR excerpt LIKE ? OR slug LIKE ?)");
    params.push(pattern, pattern, pattern);
  }

  const rows = await db.$queryRawUnsafe<ArticleRow[]>(
    `SELECT * FROM article
      WHERE ${filters.join(" AND ")}
      ORDER BY sort_order DESC, COALESCE(published_at, created_at) DESC
      LIMIT ?`,
    ...params,
    Math.min(opts?.limit || 200, 500),
  );
  return rows;
}

export async function getArticle(id: string): Promise<ArticleRow | null> {
  await ensureArticleTable();
  const rows = await db.$queryRaw<ArticleRow[]>`SELECT * FROM article WHERE id = ${id} LIMIT 1`;
  return rows[0] || null;
}

export async function articleStats(): Promise<{ total: number; published: number; draft: number; views: number }> {
  await ensureArticleTable();
  const rows = await db.$queryRaw<Array<{ total: bigint; published: bigint; draft: bigint; views: bigint | null }>>`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN status IN ('draft','hidden') THEN 1 ELSE 0 END) AS draft,
      SUM(view_count) AS views
    FROM article
  `;
  const r = rows[0];
  return {
    total: Number(r?.total || 0),
    published: Number(r?.published || 0),
    draft: Number(r?.draft || 0),
    views: Number(r?.views || 0),
  };
}

/* ────────────────── 公開頁查詢 ────────────────── */

/** 公開文章列表。只回 published —— 草稿與下架的在公開端一律當作不存在。 */
export async function listPublicArticles(opts?: {
  category?: string;
  limit?: number;
  excludeSlug?: string;
}): Promise<ArticleRow[]> {
  await ensureArticleTable();
  const filters: string[] = ["status = 'published'"];
  const params: unknown[] = [];
  if (opts?.category && opts.category !== "all") {
    filters.push("category = ?");
    params.push(opts.category);
  }
  if (opts?.excludeSlug) {
    filters.push("slug <> ?");
    params.push(opts.excludeSlug);
  }
  const rows = await db.$queryRawUnsafe<ArticleRow[]>(
    `SELECT * FROM article
      WHERE ${filters.join(" AND ")}
      ORDER BY sort_order DESC, COALESCE(published_at, created_at) DESC
      LIMIT ?`,
    ...params,
    Math.min(opts?.limit || 60, 200),
  );
  return rows;
}

/**
 * 用 slug 取公開文章。
 *
 * ⚠️ 跟 property 不同：物件成交後連結還要能開（連結已經發給客戶了），
 *    文章沒有這個問題 —— 下架就是不想再給人看，所以 hidden 一律不回。
 */
export async function getPublicArticleBySlug(slug: string): Promise<ArticleRow | null> {
  await ensureArticleTable();
  const rows = await db.$queryRaw<ArticleRow[]>`
    SELECT * FROM article WHERE slug = ${slug} AND status = 'published' LIMIT 1
  `;
  return rows[0] || null;
}

/** 公開頁瀏覽次數 +1。失敗不要影響頁面顯示。 */
export async function incrementArticleView(id: string): Promise<void> {
  try {
    await db.$executeRawUnsafe("UPDATE article SET view_count = view_count + 1 WHERE id = ?", id);
  } catch {
    /* 統計數字掉一筆無所謂，不值得讓整頁掛掉 */
  }
}

/* ────────────────── 寫入 ────────────────── */

export type ArticleInput = {
  slug: string;
  title: string;
  excerpt: string | null;
  category: string | null;
  content: string;
  coverUrl: string | null;
  status: string;
  sortOrder: number;
};

export async function slugTaken(slug: string, exceptId?: string): Promise<boolean> {
  await ensureArticleTable();
  const rows = exceptId
    ? await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM article WHERE slug = ${slug} AND id <> ${exceptId} LIMIT 1`
    : await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM article WHERE slug = ${slug} LIMIT 1`;
  return rows.length > 0;
}

export async function generateUniqueSlug(): Promise<string> {
  await ensureArticleTable();
  for (let i = 0; i < 12; i += 1) {
    const s = randomSlug();
    if (!(await slugTaken(s))) return s;
  }
  return randomSlug(8);
}

export async function createArticle(data: ArticleInput): Promise<string> {
  await ensureArticleTable();
  const id = randomUUID();
  // 發佈時間只在「第一次變成 published」時寫入，之後編輯不要動它 ——
  // 改個錯字就把文章日期跳到今天，讀者會以為是新文章。
  const publishedAt = data.status === "published" ? new Date() : null;
  await db.$executeRawUnsafe(
    `INSERT INTO article
      (id, slug, title, excerpt, category, content, cover_url, status, sort_order, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    data.slug,
    data.title,
    data.excerpt,
    data.category,
    data.content,
    data.coverUrl,
    data.status,
    data.sortOrder,
    publishedAt,
  );
  return id;
}

export async function updateArticle(id: string, data: ArticleInput): Promise<void> {
  await ensureArticleTable();
  // COALESCE：已經有發佈時間就保留原值，第一次發佈才蓋上現在時間。
  const now = data.status === "published" ? new Date() : null;
  await db.$executeRawUnsafe(
    `UPDATE article SET
       slug = ?, title = ?, excerpt = ?, category = ?, content = ?,
       cover_url = ?, status = ?, sort_order = ?,
       published_at = CASE WHEN ? IS NULL THEN published_at ELSE COALESCE(published_at, ?) END,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    data.slug,
    data.title,
    data.excerpt,
    data.category,
    data.content,
    data.coverUrl,
    data.status,
    data.sortOrder,
    now,
    now,
    id,
  );
}

export async function deleteArticle(id: string): Promise<void> {
  await ensureArticleTable();
  await db.$executeRawUnsafe("DELETE FROM article WHERE id = ?", id);
}
