"use server";
/**
 * 房產知識文章 — 新增／編輯／刪除的 Server Action。
 * 對齊 property-actions.ts 的做法。
 */
import { revalidatePath } from "next/cache";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import {
  createArticle,
  updateArticle,
  deleteArticle,
  generateUniqueSlug,
  normalizeArticleSlug,
  slugTaken,
  type ArticleInput,
} from "@/lib/article";

type ActionResult = { ok: boolean; error?: string; id?: string; slug?: string };

function validate(input: ArticleInput): string | null {
  if (!input.title.trim()) return "文章標題必填";
  if (!input.content.trim()) return "內文不能空白";
  if (input.status === "published") {
    // 發佈＝Google 會收錄、客戶會讀到。太短的文章對 SEO 與信任都是負分，擋在這裡。
    if (input.content.trim().length < 200) return "要發佈的話內文至少 200 字（草稿可以先短）";
    if (!input.category) return "要發佈的話請選一個分類（草稿可以先空著）";
  }
  return null;
}

/**
 * 網址：沒填就自動產生短碼；填了就正規化並檢查沒被占用。
 * ⚠️ 文章的網址一旦發佈就會被 Google 收錄、被人分享出去，**之後改網址等於斷連結**。
 *    所以編輯既有文章時要改 slug 請三思，這裡不擋，但值得知道代價。
 */
async function resolveSlug(raw: string, exceptId?: string): Promise<{ slug?: string; error?: string }> {
  const wanted = normalizeArticleSlug(raw);
  if (!wanted) return { slug: await generateUniqueSlug() };
  if (wanted.length < 2) return { error: "自訂網址至少 2 個字元" };
  if (await slugTaken(wanted, exceptId)) return { error: `網址「${wanted}」已經有其他文章在用了` };
  return { slug: wanted };
}

/** 三個地方會受影響：後台列表、公開列表、文章本身。 */
function revalidateAll(slug?: string) {
  revalidatePath("/admin/articles");
  revalidatePath("/articles");
  if (slug) revalidatePath(`/articles/${slug}`);
  revalidatePath("/sitemap.xml");
}

export async function createArticleAction(input: ArticleInput): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  try {
    const { slug, error } = await resolveSlug(input.slug);
    if (error || !slug) return { ok: false, error: error || "網址產生失敗" };
    const id = await createArticle({ ...input, slug });
    revalidateAll(slug);
    return { ok: true, id, slug };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "新增失敗" };
  }
}

export async function updateArticleAction(id: string, input: ArticleInput): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  try {
    const { slug, error } = await resolveSlug(input.slug, id);
    if (error || !slug) return { ok: false, error: error || "網址產生失敗" };
    await updateArticle(id, { ...input, slug });
    revalidateAll(slug);
    return { ok: true, id, slug };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "儲存失敗" };
  }
}

export async function deleteArticleAction(id: string): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  try {
    await deleteArticle(id);
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}
