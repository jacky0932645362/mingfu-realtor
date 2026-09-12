"use server";
/**
 * 591／樂屋上架外掛的授權碼管理 — Server Action。對齊 seller-actions.ts 的做法。
 */
import { revalidatePath } from "next/cache";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import { createLicense, setRevoked, extendLicense, setSeatLimit, removeInstall, deleteLicense, listInstalls, type InstallRow } from "@/lib/post591-license";

type ActionResult = { ok: boolean; error?: string; key?: string };

export async function listInstallsAction(key: string): Promise<InstallRow[]> {
  if (!(await isCurrentUserAdmin())) return [];
  return listInstalls(key);
}

export async function createLicenseAction(input: { label: string; seatLimit: number; expiresAt: string }): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  if (!input.label.trim()) return { ok: false, error: "備註必填（例如「第一批同事」）" };
  const expiresAt = new Date(input.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) return { ok: false, error: "到期日格式不對" };
  try {
    const lic = await createLicense({ label: input.label, seatLimit: input.seatLimit, expiresAt });
    revalidatePath("/admin/post591-license");
    return { ok: true, key: lic.license_key };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setRevokedAction(key: string, revoked: boolean): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  try {
    await setRevoked(key, revoked);
    revalidatePath("/admin/post591-license");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function extendLicenseAction(key: string, expiresAt: string): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return { ok: false, error: "到期日格式不對" };
  try {
    await extendLicense(key, d);
    revalidatePath("/admin/post591-license");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setSeatLimitAction(key: string, seatLimit: number): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  try {
    await setSeatLimit(key, seatLimit);
    revalidatePath("/admin/post591-license");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function removeInstallAction(key: string, installId: string): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  try {
    await removeInstall(key, installId);
    revalidatePath("/admin/post591-license");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteLicenseAction(key: string): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  try {
    await deleteLicense(key);
    revalidatePath("/admin/post591-license");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
