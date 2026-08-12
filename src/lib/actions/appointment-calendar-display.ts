"use server";
/**
 * 後台設定「Google 日曆事件要長什麼樣」（2026-08-06 系統擁有者）。
 *
 * 系統擁有者看到自己日曆寫「太平洋房屋預約｜蕭茗馥」覺得奇怪，要能自己改標題、自己挑顏色。
 * 設定存在既有的 appointment_config 表（跟 Google refresh token、日曆 ID 同一張）。
 *
 * 只寫兩個 key，不碰任何預約資料、不碰 Google 授權。
 */
import { revalidatePath } from "next/cache";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import { setConfig, getCalendarDisplaySettings } from "@/lib/google-calendar";
import {
  CALENDAR_COLOR_CONFIG_KEY,
  CALENDAR_TITLE_CONFIG_KEY,
  normalizeCalendarColorId,
  normalizeCalendarTitleTemplate,
} from "@/lib/appointment-calendar-display";

export async function saveCalendarDisplayAction(input: {
  titleTemplate: string;
  colorId: string;
}): Promise<{ ok: boolean; error?: string; titleTemplate?: string; colorId?: string }> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: "權限不足" };

  // 一律正規化再存：顏色只認 Google 真的有的 11 個色號，標題空白會回退成預設樣板
  const titleTemplate = normalizeCalendarTitleTemplate(input.titleTemplate);
  const colorId = normalizeCalendarColorId(input.colorId);

  try {
    await setConfig(CALENDAR_TITLE_CONFIG_KEY, titleTemplate);
    await setConfig(CALENDAR_COLOR_CONFIG_KEY, colorId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // 不相信寫入成功，回讀一次再回報
  const back = await getCalendarDisplaySettings();
  if (back.titleTemplate !== titleTemplate || back.colorId !== colorId) {
    return { ok: false, error: "存進去了但回讀對不上，請重新整理再看一次" };
  }

  revalidatePath("/admin/appointments");
  return { ok: true, titleTemplate: back.titleTemplate, colorId: back.colorId };
}
