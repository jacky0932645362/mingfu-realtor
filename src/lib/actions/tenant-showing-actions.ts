"use server";
/**
 * 租客帶看紀錄 — 新增／編輯的 Server Action。
 * 對齊 showing-actions.ts 的做法。
 */
import { revalidatePath } from "next/cache";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import { createTenantShowing, updateTenantShowing, type TenantShowingInput } from "@/lib/tenant-showing";
import { touchTenantFollowUp } from "@/lib/tenant";

type ActionResult = { ok: boolean; error?: string; id?: string };

function validate(input: TenantShowingInput): string | null {
  if (!input.propertyName.trim()) return "物件名稱必填";
  if (Number.isNaN(input.visitedAt.getTime())) return "帶看時間格式不正確";
  return null;
}

export async function createTenantShowingAction(
  input: TenantShowingInput,
  followUp?: { lastContactAt?: Date | null; nextFollowUpAt?: Date | null },
): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  try {
    const id = await createTenantShowing(input);
    if (followUp && (followUp.lastContactAt !== undefined || followUp.nextFollowUpAt !== undefined)) {
      await touchTenantFollowUp(input.tenantId, followUp);
    }
    revalidatePath(`/admin/tenants/${input.tenantId}`);
    revalidatePath("/admin/tenants");
    revalidatePath("/admin/calendar");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateTenantShowingAction(id: string, input: TenantShowingInput): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  try {
    await updateTenantShowing(id, input);
    revalidatePath(`/admin/tenants/${input.tenantId}`);
    revalidatePath("/admin/calendar");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
