"use server";
/**
 * 買方客戶資料庫 — 新增／編輯的 Server Action。
 * 對齊 appointment-rate-limit.ts 的做法（後台用 server action，不是 fetch API route）。
 */
import { revalidatePath } from "next/cache";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import { createCustomer, updateCustomer, type CustomerInput } from "@/lib/customer";

type ActionResult = { ok: boolean; error?: string; id?: string };

function validate(input: CustomerInput): string | null {
  if (!input.name.trim()) return "姓名必填";
  if (input.budgetMin != null && input.budgetMax != null && input.budgetMin > input.budgetMax) {
    return "預算下限不能大於上限";
  }
  return null;
}

export async function createCustomerAction(input: CustomerInput): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  try {
    const id = await createCustomer(input);
    revalidatePath("/admin/customers");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateCustomerAction(id: string, input: CustomerInput): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  try {
    await updateCustomer(id, input);
    revalidatePath("/admin/customers");
    revalidatePath(`/admin/customers/${id}`);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
