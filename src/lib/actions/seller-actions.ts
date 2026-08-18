"use server";
/**
 * 屋主客戶資料庫 — 新增／編輯的 Server Action。
 * 對齊 tenant-actions.ts 的做法。
 */
import { revalidatePath } from "next/cache";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import { createSeller, updateSeller, type SellerInput } from "@/lib/seller";

type ActionResult = { ok: boolean; error?: string; id?: string };

function validate(input: SellerInput): string | null {
  if (!input.name.trim()) return "姓名必填";
  if (input.listingPrice != null && input.floorPrice != null && input.floorPrice > input.listingPrice) {
    return "底價不能高於開價";
  }
  return null;
}

export async function createSellerAction(input: SellerInput): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  try {
    const id = await createSeller(input);
    revalidatePath("/admin/sellers");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateSellerAction(id: string, input: SellerInput): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  try {
    await updateSeller(id, input);
    revalidatePath("/admin/sellers");
    revalidatePath(`/admin/sellers/${id}`);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
