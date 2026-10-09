"use server";
/**
 * 發文身分（2026-10-07）— Server Action。每一支開頭先 isCurrentUserAdmin()
 * （Server Action 是可以被直接 POST 的公開端點）。做法對齊 fb-actions.ts。
 */
import { revalidatePath } from "next/cache";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import {
  createPersonalIdentity,
  renameIdentity,
  setIdentityActive,
  deleteIdentity,
} from "@/lib/fb-identity";

type Result = { ok: boolean; error?: string; id?: string; authKey?: string | null; message?: string };

function revalidateAll() {
  for (const p of ["/identities", "/schedule", "/groups", "/delete", ""]) revalidatePath(`/admin/fb${p}`);
}

async function guard(): Promise<string | null> {
  return (await isCurrentUserAdmin()) ? null : "權限不足";
}

export async function createIdentityAction(name: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const r = await createPersonalIdentity(name);
    if (r.ok) revalidateAll();
    return r.ok
      ? { ok: true, id: r.id, authKey: r.authKey ?? null, message: "已新增。接著照卡片上的步驟，到桌機登入這個帳號一次" }
      : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "新增失敗" };
  }
}

export async function renameIdentityAction(id: string, name: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const r = await renameIdentity(id, name);
    if (r.ok) revalidateAll();
    return r.ok ? { ok: true, message: "改好了" } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "改名失敗" };
  }
}

export async function setIdentityActiveAction(id: string, active: boolean): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const r = await setIdentityActive(id, active);
    if (r.ok) revalidateAll();
    return r.ok ? { ok: true, message: active ? "已啟用" : "已停用（排程選單不會再出現，原本排好的會在到點時被擋下）" } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "改不動" };
  }
}

export async function deleteIdentityAction(id: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const r = await deleteIdentity(id);
    if (r.ok) revalidateAll();
    return r.ok ? { ok: true, message: "已刪除" } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}
