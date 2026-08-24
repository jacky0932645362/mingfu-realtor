"use server";
/**
 * 房屋物件資料庫 — 新增／編輯／刪除的 Server Action。
 * 對齊 seller-actions.ts 的做法。
 */
import { revalidatePath } from "next/cache";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import {
  createProperty,
  updateProperty,
  deleteProperty,
  generateUniqueSlug,
  normalizeSlug,
  slugTaken,
  type PropertyInput,
} from "@/lib/property";

type ActionResult = { ok: boolean; error?: string; id?: string; slug?: string };

function validate(input: PropertyInput): string | null {
  if (!input.title.trim()) return "物件標題必填";
  if (input.status === "published") {
    // 上架 = 客戶看得到。沒價格沒照片的頁面丟給客戶只會扣分，擋在這裡而不是讓他自己發現。
    if (input.price == null) return "要上架的話「總價」必填（草稿可以先空著）";
    if (!input.coverUrl && !input.photoUrls?.trim() && !input.videoUrls?.trim()) {
      return "要上架的話至少要有一張照片或一支影片（草稿可以先空著）";
    }
  }
  return null;
}

/** 短碼：沒填就自動產生；填了就正規化並檢查沒被占用。 */
async function resolveSlug(raw: string, exceptId?: string): Promise<{ slug?: string; error?: string }> {
  const wanted = normalizeSlug(raw);
  if (!wanted) return { slug: await generateUniqueSlug() };
  if (wanted.length < 2) return { error: "自訂網址至少 2 個字元" };
  if (await slugTaken(wanted, exceptId)) return { error: `網址「${wanted}」已經有其他物件在用了` };
  return { slug: wanted };
}

export async function createPropertyAction(input: PropertyInput): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  try {
    const { slug, error } = await resolveSlug(input.slug);
    if (error || !slug) return { ok: false, error: error || "網址產生失敗" };
    const id = await createProperty({ ...input, slug });
    revalidatePath("/admin/properties");
    revalidatePath("/property");
    revalidatePath(`/property/${slug}`);
    return { ok: true, id, slug };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updatePropertyAction(id: string, input: PropertyInput): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  try {
    const { slug, error } = await resolveSlug(input.slug, id);
    if (error || !slug) return { ok: false, error: error || "網址產生失敗" };
    await updateProperty(id, { ...input, slug });
    revalidatePath("/admin/properties");
    revalidatePath(`/admin/properties/${id}`);
    revalidatePath("/property");
    revalidatePath(`/property/${slug}`);
    return { ok: true, id, slug };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deletePropertyAction(id: string): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  try {
    await deleteProperty(id);
    revalidatePath("/admin/properties");
    revalidatePath("/property");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
