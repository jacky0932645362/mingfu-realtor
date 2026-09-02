"use server";
/**
 * 成交記帳 — 新增／編輯／刪除的 Server Action。
 * 對齊 customer-actions.ts 的做法（後台用 server action，不是 fetch API route）。
 */
import { revalidatePath } from "next/cache";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import {
  createDeal,
  updateDeal,
  deleteDeal,
  DEAL_SIDES,
  DEAL_PAYMENT_STATUSES,
  DEAL_EXPENSE_CATEGORIES,
  DEAL_SPLIT_KINDS,
  type DealInput,
} from "@/lib/deal";

type ActionResult = { ok: boolean; error?: string; id?: string };

const SIDE_KEYS: string[] = DEAL_SIDES.map((s) => s.key);
const STATUS_KEYS: string[] = DEAL_PAYMENT_STATUSES.map((s) => s.key);
const CATEGORY_KEYS: string[] = DEAL_EXPENSE_CATEGORIES.map((c) => c.key);
const KIND_KEYS: string[] = DEAL_SPLIT_KINDS.map((k) => k.key);

function nonNegative(n: number | null | undefined): boolean {
  return n == null || (Number.isFinite(n) && n >= 0);
}

function validate(input: DealInput): string | null {
  if (!input.title.trim()) return "案名必填";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dealDate)) return "成交日格式不對";
  if (!SIDE_KEYS.includes(input.side)) return "「代表哪一方」選項不正確";
  if (!STATUS_KEYS.includes(input.paymentStatus)) return "收款狀態選項不正確";

  for (const key of ["totalPrice", "feeSeller", "feeBuyer", "incomeOther", "receivedAmount"] as const) {
    if (!nonNegative(input[key])) return "金額不能是負數";
  }

  for (const e of input.expenses) {
    if (!CATEGORY_KEYS.includes(e.category)) return "成本分類不正確";
    if (!nonNegative(e.amount)) return "成本金額不能是負數";
    if (e.spentOn && !/^\d{4}-\d{2}-\d{2}$/.test(e.spentOn)) return "成本的日期格式不對";
  }

  for (const s of input.splits) {
    if (!s.party.trim()) return "拆帳對象必填（要分給誰）";
    if (!KIND_KEYS.includes(s.kind)) return "拆帳方式不正確";
    if (!nonNegative(s.amount)) return "拆帳金額不能是負數";
    if (s.kind === "percent" && (s.rate == null || s.rate < 0 || s.rate > 100)) {
      return "拆帳比例要介於 0 到 100";
    }
  }

  return null;
}

export async function createDealAction(input: DealInput): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  try {
    const id = await createDeal(input);
    revalidatePath("/admin/deals");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateDealAction(id: string, input: DealInput): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  try {
    await updateDeal(id, input);
    revalidatePath("/admin/deals");
    revalidatePath(`/admin/deals/${id}`);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteDealAction(id: string): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  try {
    await deleteDeal(id);
    revalidatePath("/admin/deals");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
