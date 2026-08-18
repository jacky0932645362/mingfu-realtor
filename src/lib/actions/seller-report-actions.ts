"use server";
/**
 * 屋主回報／議價紀錄 — 新增／編輯的 Server Action。
 * 對齊 tenant-showing-actions.ts 的做法。
 */
import { revalidatePath } from "next/cache";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import { createSellerReport, updateSellerReport, type SellerReportInput } from "@/lib/seller-report";
import { touchSellerReport } from "@/lib/seller";

type ActionResult = { ok: boolean; error?: string; id?: string };

function validate(input: SellerReportInput): string | null {
  if (Number.isNaN(input.reportDate.getTime())) return "回報日期格式不正確";
  if (input.type === "negotiation" && !input.content?.trim()) return "議價內容必填";
  return null;
}

export async function createSellerReportAction(
  input: SellerReportInput,
  followUp?: { lastReportAt?: Date | null; nextReportAt?: Date | null },
): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  try {
    const id = await createSellerReport(input);
    if (followUp && (followUp.lastReportAt !== undefined || followUp.nextReportAt !== undefined)) {
      await touchSellerReport(input.sellerId, followUp);
    }
    revalidatePath(`/admin/sellers/${input.sellerId}`);
    revalidatePath("/admin/sellers");
    revalidatePath("/admin/calendar");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateSellerReportAction(id: string, input: SellerReportInput): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  try {
    await updateSellerReport(id, input);
    revalidatePath(`/admin/sellers/${input.sellerId}`);
    revalidatePath("/admin/calendar");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
