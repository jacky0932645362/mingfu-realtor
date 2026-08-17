"use server";
/**
 * 租客客戶資料庫 — 新增／編輯的 Server Action。
 * 對齊 customer-actions.ts 的做法。
 */
import { revalidatePath } from "next/cache";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import { createTenant, updateTenant, type TenantInput } from "@/lib/tenant";

type ActionResult = { ok: boolean; error?: string; id?: string };

function validate(input: TenantInput): string | null {
  if (!input.name.trim()) return "姓名必填";
  if (input.rentMin != null && input.rentMax != null && input.rentMin > input.rentMax) {
    return "租金下限不能大於上限";
  }
  return null;
}

export async function createTenantAction(input: TenantInput): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  try {
    const id = await createTenant(input);
    revalidatePath("/admin/tenants");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateTenantAction(id: string, input: TenantInput): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  try {
    await updateTenant(id, input);
    revalidatePath("/admin/tenants");
    revalidatePath(`/admin/tenants/${id}`);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
