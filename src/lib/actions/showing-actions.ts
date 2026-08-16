"use server";
/**
 * 帶看紀錄 — 新增／編輯的 Server Action。
 * 對齊 customer-actions.ts 的做法。
 */
import { revalidatePath } from "next/cache";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import { createShowing, updateShowing, type ShowingInput } from "@/lib/showing";
import { touchCustomerFollowUp } from "@/lib/customer";

type ActionResult = { ok: boolean; error?: string; id?: string };

function validate(input: ShowingInput): string | null {
  if (!input.propertyName.trim()) return "物件名稱必填";
  if (Number.isNaN(input.visitedAt.getTime())) return "帶看時間格式不正確";
  return null;
}

export async function createShowingAction(
  input: ShowingInput,
  followUp?: { lastContactAt?: Date | null; nextFollowUpAt?: Date | null },
): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  try {
    const id = await createShowing(input);
    if (followUp && (followUp.lastContactAt !== undefined || followUp.nextFollowUpAt !== undefined)) {
      await touchCustomerFollowUp(input.customerId, followUp);
    }
    revalidatePath(`/admin/customers/${input.customerId}`);
    revalidatePath("/admin/customers");
    revalidatePath("/admin/calendar");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateShowingAction(id: string, input: ShowingInput): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  try {
    await updateShowing(id, input);
    revalidatePath(`/admin/customers/${input.customerId}`);
    revalidatePath("/admin/calendar");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
