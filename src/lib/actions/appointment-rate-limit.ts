"use server";
/**
 * 後台調整「預約防灌爆」三道限制 + 一鍵解除目前所有限制（2026-08-06 系統擁有者）。
 *
 * 系統擁有者：「我不要讓系統自動卡我，我要自己處理。幾次才算太頻繁、幾分鐘後自動解除，
 *        這個我要從後臺設定。」
 *
 * 設定存 appointment_config（跟 Google refresh token、日曆設定同一張表）。
 */
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import { setConfig } from "@/lib/google-calendar";
import {
  clearAppointmentRateLimitsWithAudit,
  getAppointmentRateLimitSettings,
} from "@/lib/appointment";
import {
  RATE_LIMIT_CONFIG_KEYS,
  normalizeRateLimitSettings,
  type AppointmentRateLimitSettings,
} from "@/lib/appointment-rate-limit-settings";

export async function saveRateLimitSettingsAction(
  input: Partial<AppointmentRateLimitSettings>,
): Promise<{ ok: boolean; error?: string; settings?: AppointmentRateLimitSettings }> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };

  // 一律正規化再存：負數／超大值／填字都會被夾回合理範圍，視窗至少 1 分鐘
  const s = normalizeRateLimitSettings(input);
  try {
    await setConfig(RATE_LIMIT_CONFIG_KEYS.ipLimit, String(s.ipLimit));
    await setConfig(RATE_LIMIT_CONFIG_KEYS.ipWindowMin, String(s.ipWindowMin));
    await setConfig(RATE_LIMIT_CONFIG_KEYS.contactLimit, String(s.contactLimit));
    await setConfig(RATE_LIMIT_CONFIG_KEYS.contactWindowMin, String(s.contactWindowMin));
    await setConfig(RATE_LIMIT_CONFIG_KEYS.duplicateWindowMin, String(s.duplicateWindowMin));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // 不相信寫入成功，回讀一次再回報
  const back = await getAppointmentRateLimitSettings();
  const same = (Object.keys(s) as Array<keyof AppointmentRateLimitSettings>).every((k) => back[k] === s[k]);
  if (!same) return { ok: false, error: "存進去了但回讀對不上，請重新整理再看一次" };

  revalidatePath("/admin/appointments");
  return { ok: true, settings: back };
}

/**
 * 立刻解除目前卡住的所有限制。
 * 清除計數桶、推進解除世代並留下操作者稽核紀錄；不動任何既有預約資料。
 */
export async function clearRateLimitsAction(): Promise<{
  ok: boolean;
  cleared?: number;
  generation?: number;
  clearedAt?: string;
  error?: string;
}> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };
  try {
    const session = await auth();
    const user = session?.user as {
      id?: string;
      email?: string | null;
      impAdminUserId?: string;
      impAdminEmail?: string;
    } | undefined;
    const operator = user?.impAdminUserId || user?.impAdminEmail || user?.id || user?.email || null;
    const result = await clearAppointmentRateLimitsWithAudit({
      createdBy: operator,
      reason: "admin_clear_all_limits",
    });
    revalidatePath("/admin/appointments");
    return {
      ok: true,
      cleared: result.cleared,
      generation: result.generation,
      clearedAt: result.clearedAt.toISOString(),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
