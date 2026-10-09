"use server";
/**
 * FB 貼文工廠 — Server Action。做法對齊 article-actions.ts / property-actions.ts。
 * 每一支開頭先 isCurrentUserAdmin()（Server Action 是可以被直接 POST 的公開端點）。
 *
 * 接的是另一台建好的表：fb_draft / fb_group / fb_task / fb_task_item。
 */
import { revalidatePath } from "next/cache";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import { getProperty } from "@/lib/property";
import { clashNoteFor } from "@/lib/fb-rhythm";
import { parseFbPhotoLines, parseFbVideoLine } from "@/lib/media-url";
import {
  buildFacts,
  buildPostText,
  buildMarketplace,
  buildManualDraft,
  scenarioLabel,
  MP_TITLE_LIMIT,
} from "@/lib/fb-copy";
import {
  createFbDraft,
  deleteFbDraft,
  setDraftStatus,
  updateDraftText,
  updateMarketplacePrice,
  updateMarketplaceCondition,
  updateMarketplaceTitle,
  updateMarketplaceLocation,
  setMarketplaceGroups,
  setDraftPhotos,
  setDraftVideo,
  getFbDraft,
  addFbGroups,
  setGroupActive,
  setGroupsActive,
  setGroupsHidden,
  hideNonHailineGroups,
  setGroupCooldown,
  setGroupAccepts,
  deleteFbGroup,
  getFbGroup,
  createFbTask,
  deleteFbTask,
  rescheduleTask,
  DEFAULT_EXPIRE_HOURS,
  JITTER_MAX_MINUTES,
  rollJitterSec,
  jitterWindowLabel,
  listFbTasks,
  setTaskStatus,
  getFbTask,
  getTaskItems,
  markItemResult,
  finishTask,
  parseLocalDateTime,
  normalizeGroupUrl,
  parseGroupKey,
  isChannel,
  createDeleteTask,
  cancelDeleteTask,
  listDeletableDrafts,
  listDeletableGroups,
  MARKETPLACE_CONDITIONS,
  isSocialPlatform,
  socialLabel,
  updateSocialText,
  setSocialStatus,
  getSocialVersions,
  type SocialPlatform,
} from "@/lib/fb-factory";
import { publishSocialForDraft, disconnectSocialAccount, refreshSocialTokenIfNeeded } from "@/lib/social-publish";
import { IG_CAPTION_LIMIT, THREADS_TEXT_LIMIT, socialLength } from "@/lib/fb-social-copy";
import { getIdentity, type FbIdentityRow } from "@/lib/fb-identity";
import { normalizeIdentityId, sameIdentity, loginStateOf } from "@/lib/fb-identity-core";
import {
  normalizePacificInput,
  setDraftPacificUrl,
  checkOneDraftOnPacific,
  checkAllDraftsOnPacific,
  resetDraftPacific,
  setDraftArchived,
} from "@/lib/fb-pacific";
import { setRecycleEnabled } from "@/lib/fb-recycle";

type Result = { ok: boolean; error?: string; id?: string; message?: string };

function revalidateAll() {
  for (const p of ["", "/board", "/compose", "/library", "/groups", "/schedule", "/activity", "/delete", "/social"]) {
    revalidatePath(`/admin/fb${p}`);
  }
}

async function guard(): Promise<string | null> {
  return (await isCurrentUserAdmin()) ? null : "權限不足";
}

/* ────────────────── 產生文案 ────────────────── */

export async function generateFromPropertyAction(
  propertyId: string,
  scenario: string,
): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };

  try {
    const p = await getProperty(propertyId);
    if (!p) return { ok: false, error: "找不到這筆物件" };

    const facts = buildFacts(p);
    const { text, warnings: w1 } = buildPostText(p, scenario);
    const { payload, warnings: w2 } = buildMarketplace(p, text);

    const site = process.env.NEXT_PUBLIC_SITE_URL || "https://mingfu-realtor.vercel.app";
    const id = await createFbDraft({
      title: `${p.district ? `${p.district}區 ` : ""}${p.community || p.headline || p.title}`.slice(0, 200),
      sourcePropertyId: p.id,
      propertyUrl: p.slug && !site.includes("localhost") ? `${site}/property/${p.slug}` : null,
      facts,
      postText: text,
      marketplace: payload,
    });

    revalidateAll();
    const warns = [...new Set([...w1, ...w2])].filter((x) => x.startsWith("🔴"));
    return {
      ok: true,
      id,
      message: `已產生「${scenarioLabel(scenario)}」${warns.length ? `（有 ${warns.length} 個要處理的問題）` : ""}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "產生失敗" };
  }
}

export async function generateManualAction(input: {
  title: string;
  body: string;
  /** 「一行一個」的原始字串：網址或桌機路徑都行。parseFbPhotoLines 轉成陣列（去空行/去重/網址轉直連/限 10）。 */
  photos?: string;
  /** 一支影片：網址或桌機路徑。parseFbVideoLine 只是去頭尾空白。 */
  video?: string;
}): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!input.title.trim()) return { ok: false, error: "給這篇一個名字，之後在貼文庫才找得到" };
  if (!input.body.trim()) return { ok: false, error: "內文不能空白" };

  try {
    const photos = parseFbPhotoLines(input.photos, 10);
    const video = parseFbVideoLine(input.video);
    const { postText, facts } = buildManualDraft({ title: input.title, body: input.body, photos, video });
    const id = await createFbDraft({
      title: input.title.trim().slice(0, 200),
      sourcePropertyId: null,
      propertyUrl: null,
      facts,
      postText,
      marketplace: null,
    });
    revalidateAll();
    const parts = [photos.length ? `${photos.length} 張照片` : "", video ? "1 支影片" : ""].filter(Boolean);
    return { ok: true, id, message: parts.length ? `已存進貼文庫（含 ${parts.join("、")}）` : "已存進貼文庫" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "存檔失敗" };
  }
}

/** 改「手動填的文案」自己帶的照片（存進 facts_json.photos）。從物件庫產的文案照片走物件庫，不走這裡。 */
export async function updateDraftPhotosAction(id: string, photos: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const list = parseFbPhotoLines(photos, 10);
    await setDraftPhotos(id, list);
    revalidateAll();
    return { ok: true, message: list.length ? `已存 ${list.length} 筆` : "已清空照片" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "儲存失敗" };
  }
}

/**
 * 改這篇要附的影片（存進 facts_json.video）。跟照片不同：不管是不是從物件庫產的文案都能改
 * （物件庫的影片是給官網嵌入用的 YouTube 連結，不是 FB 用得到的檔案本體）。
 */
export async function updateDraftVideoAction(id: string, video: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const v = parseFbVideoLine(video);
    await setDraftVideo(id, v);
    revalidateAll();
    return { ok: true, message: v ? "已存影片" : "已移除影片" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "儲存失敗" };
  }
}

/* ────────────────── IG／Threads（2026-09-21） ────────────────── */

/** 改某平台的版本內文（存進 social_json、標 edited）。空字串＝回到從一般貼文推導的版本。 */
export async function updateSocialTextAction(id: string, platform: string, text: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!isSocialPlatform(platform)) return { ok: false, error: "平台不對" };
  const limit = platform === "ig" ? IG_CAPTION_LIMIT : THREADS_TEXT_LIMIT;
  if (socialLength(text) > limit) return { ok: false, error: `${socialLabel(platform)} 上限 ${limit} 字，現在 ${socialLength(text)} 字` };
  try {
    await updateSocialText(id, platform, text);
    revalidateAll();
    return { ok: true, message: text.trim() ? "已儲存（之後不會再被一般貼文的改動蓋掉）" : "已清空，回到自動從一般貼文帶的版本" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "儲存失敗" };
  }
}

/**
 * 現在就發到 IG／Threads —— 不排程、不經過 runner，這個網站直接打官方 API。
 * 🔴 這是真的公開發出去。按鈕上會再問一次。
 */
export async function publishSocialNowAction(id: string, platform: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!isSocialPlatform(platform)) return { ok: false, error: "平台不對" };
  try {
    const r = await publishSocialForDraft(id, platform as SocialPlatform);
    revalidateAll();
    const skipped = r.photosSkipped.length ? `（跳過 ${r.photosSkipped.length} 張照片：${r.photosSkipped.map((x) => x.reason).join("；")}）` : "";
    return { ok: true, message: `已發到 ${socialLabel(platform)}${r.url ? `：${r.url}` : ""}，用了 ${r.photosUsed} 張照片${skipped}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "發文失敗" };
  }
}

/** 把某平台的狀態退回「還沒發」（例如發了之後在平台上刪掉、想重發）。 */
export async function resetSocialStatusAction(id: string, platform: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!isSocialPlatform(platform)) return { ok: false, error: "平台不對" };
  try {
    await setSocialStatus(id, platform, "draft");
    revalidateAll();
    return { ok: true, message: "已退回「還沒發」" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "失敗" };
  }
}

/** 解除某平台的帳號連結（把存的 token 刪掉）。要重連就再按一次連結。 */
export async function disconnectSocialAction(platform: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!isSocialPlatform(platform)) return { ok: false, error: "平台不對" };
  try {
    await disconnectSocialAccount(platform);
    revalidateAll();
    return { ok: true, message: `已解除 ${socialLabel(platform)} 的連結` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "失敗" };
  }
}

/** 手動續一次長效 token（平常發文前會自動續，這顆是給人放心按的）。 */
export async function refreshSocialTokenAction(platform: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!isSocialPlatform(platform)) return { ok: false, error: "平台不對" };
  const r = await refreshSocialTokenIfNeeded(platform);
  revalidateAll();
  if (r.refreshed) return { ok: true, message: "已續 60 天" };
  return { ok: true, message: r.note ? `沒續：${r.note}` : "還不用續（剩超過 20 天）" };
}

/**
 * 把一則文案的狀態退回「還沒貼」，讓它可以再排一次。
 *
 * 為什麼要這個：房仲同一個物件本來就會隔一陣子再推一次。但發過之後 status 變成 posted，
 * 排程頁的下拉只撈 `queue:'todo'`（status='draft'）→ 那則就永遠選不到、表單還會整個
 * 變成「沒有還沒貼的文案可以排」。以前只能重產一則新的，等於每推一次就多一則重複草稿。
 * （2026-09-11 本人問「Marketplace 排程沒東西可選」才發現這個缺口。）
 *
 * ⚠️ 只改狀態，不刪 FB 上已經發出去的貼文，也不動內容。
 */
export async function resetDraftStatusAction(id: string, channel: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!isChannel(channel)) return { ok: false, error: "通路不對" };
  try {
    const draft = await getFbDraft(id);
    if (!draft) return { ok: false, error: "找不到這則文案" };
    if (channel === "marketplace" && !draft.marketplace_json) {
      return { ok: false, error: "這則文案沒有 Marketplace 版本" };
    }
    await setDraftStatus(id, channel, "draft");
    revalidateAll();
    return {
      ok: true,
      message: `已退回「還沒貼」，現在可以到排程頁再排一次（FB 上已發的那篇不受影響）`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "重設失敗" };
  }
}

export async function updateDraftTextAction(
  id: string,
  channel: string,
  text: string,
): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!isChannel(channel)) return { ok: false, error: "通路不對" };
  if (!text.trim()) return { ok: false, error: "內文不能空白" };
  try {
    await updateDraftText(id, channel, text);
    revalidateAll();
    return { ok: true, message: "已儲存" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "儲存失敗" };
  }
}

/**
 * Marketplace 價格單獨存、單獨改 —— 跟一般貼文的 post_text 完全分開的欄位，
 * 改這裡不會動到一般貼文裡寫的價格（2026-09-05 本人要求兩邊分開寫）。
 */
export async function updateMarketplacePriceAction(id: string, priceWan: number | null): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const priceTwd = priceWan != null && Number.isFinite(priceWan) && priceWan > 0 ? Math.round(priceWan * 10_000) : null;
    await updateMarketplacePrice(id, priceTwd);
    revalidateAll();
    return { ok: true, message: "已儲存" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "儲存失敗" };
  }
}

/**
 * Marketplace 的「狀況」（全新／二手…）。2026-09-06 本人要求：發文之前就要選好，
 * 不要留到桌機跑 post-marketplace.mjs 那一刻才用暫定值頂著。
 */
export async function updateMarketplaceConditionAction(id: string, condition: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!MARKETPLACE_CONDITIONS.includes(condition as (typeof MARKETPLACE_CONDITIONS)[number])) {
    return { ok: false, error: "不是有效的狀況選項" };
  }
  try {
    await updateMarketplaceCondition(id, condition);
    revalidateAll();
    return { ok: true, message: "已儲存" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "儲存失敗" };
  }
}

/** 改 Marketplace 的標題（獨立欄位，不會動到一般貼文）。 */
export async function updateMarketplaceTitleAction(id: string, title: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const t = title.trim();
  if (!t) return { ok: false, error: "標題不能空白，Marketplace 標題是必填" };
  if (t.length > MP_TITLE_LIMIT) {
    return { ok: false, error: `標題 ${t.length} 字，超過 FB 的 ${MP_TITLE_LIMIT} 字上限` };
  }
  try {
    await updateMarketplaceTitle(id, t);
    revalidateAll();
    return { ok: true, message: "已儲存" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "儲存失敗" };
  }
}

/** 改 Marketplace 的地點（給自己看／複製用；桌機實際填進 FB 的是物件的縣市＋區）。 */
export async function updateMarketplaceLocationAction(id: string, location: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    await updateMarketplaceLocation(id, location.trim());
    revalidateAll();
    return { ok: true, message: "已儲存" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "儲存失敗" };
  }
}

/**
 * 存「打算上架去哪些社團」的清單。⚠️ 這個 Server Action 本身只是寫進資料庫，
 * 不會去 FB 按任何東西——真的勾選是桌機 `post-marketplace.mjs --publish --crosspost`
 * 讀這個清單去做（2026-09-06 Phase 3），還沒接進這個網頁後台的按鈕（Phase 4）。
 */
export async function updateMarketplaceGroupsAction(id: string, groupIds: string[]): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    await setMarketplaceGroups(id, groupIds);
    revalidateAll();
    return { ok: true, message: "已儲存" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "儲存失敗" };
  }
}

export async function deleteDraftAction(id: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    await deleteFbDraft(id);
    revalidateAll();
    return { ok: true, message: "已刪除" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}

/* ────────────────── 社團清單 ────────────────── */

export async function addGroupsAction(input: {
  raw: string;
  accepts: string;
  cooldownDays: number;
  /** 2026-10-07 發文身分：加進哪個身分的社團清單。不給＝主帳號。 */
  identityId?: string;
}): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const identity = await getIdentity(input.identityId);
  if (!identity) return { ok: false, error: "找不到這個發文身分" };

  const accepts = ["post", "marketplace", "both"].includes(input.accepts) ? input.accepts : "both";
  const cooldown = Number.isFinite(input.cooldownDays)
    ? Math.max(0, Math.min(90, Math.floor(input.cooldownDays)))
    : 7;

  const entries: Array<{ name: string; url: string; accepts: string; cooldownDays: number }> = [];
  for (const line of input.raw.split(/[\r\n]+/)) {
    const t = line.trim();
    if (!t) continue;
    const [maybeName, maybeUrl] = t.includes("|") ? t.split("|") : [null, t];
    const url = normalizeGroupUrl((maybeUrl ?? t).trim());
    if (!url) continue;
    const key = parseGroupKey(url);
    const name = (maybeName ?? "").trim() || `社團 ${key}`;
    entries.push({ name: name.slice(0, 200), url: url.slice(0, 400), accepts, cooldownDays: cooldown });
  }
  if (entries.length === 0) return { ok: false, error: "一個都沒解析出來，檢查一下貼的內容" };

  try {
    const { added, updated } = await addFbGroups(entries, normalizeIdentityId(identity.id));
    revalidateAll();
    return { ok: true, message: `加了 ${added} 個${updated > 0 ? `，更新了 ${updated} 個本來就有的` : ""}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "加入失敗" };
  }
}

export async function toggleGroupAction(id: string, active: boolean): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    await setGroupActive(id, active);
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "改不動" };
  }
}

/** 一次開/關多個社團（勾選式 UI 的「套用」）。 */
export async function bulkToggleGroupsAction(ids: string[], active: boolean): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    await setGroupsActive(ids, active);
    revalidateAll();
    return { ok: true, message: `${active ? "啟用" : "停用"}了 ${ids.length} 個社團` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "改不動" };
  }
}

export async function updateGroupSettingAction(input: {
  id: string;
  cooldownDays?: number;
  accepts?: string;
}): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    if (typeof input.cooldownDays === "number") await setGroupCooldown(input.id, input.cooldownDays);
    if (input.accepts) await setGroupAccepts(input.id, input.accepts);
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "改不動" };
  }
}

/**
 * 永久刪除。⚠️ 只對「手動加錯的」有意義 —— 桌機抓來的社團刪了，
 * 下次 `npm run groups` 又會回來。要收起來用「封存」。
 */
export async function deleteGroupAction(id: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    await deleteFbGroup(id);
    revalidateAll();
    return { ok: true, message: "已永久刪除" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}

/** 封存 / 取消封存（可批次）。封存的不顯示、不能選來發文，但重抓不會把它叫回來。 */
export async function archiveGroupsAction(ids: string[], hidden: boolean): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (ids.length === 0) return { ok: false, error: "沒有選到社團" };
  try {
    await setGroupsHidden(ids, hidden);
    revalidateAll();
    return { ok: true, message: `${hidden ? "封存" : "取消封存"}了 ${ids.length} 個社團` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "改不動" };
  }
}

/** 一鍵把「名稱裡沒有台中/海線關鍵字、也還沒勾啟用」的社團全部封存。2026-10-07：只動這個身分的清單。 */
export async function archiveNonHailineAction(identityId?: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const { hidden } = await hideNonHailineGroups(normalizeIdentityId(identityId));
    revalidateAll();
    return {
      ok: true,
      message:
        hidden > 0
          ? `封存了 ${hidden} 個非台中/海線的社團（已勾啟用的沒動）`
          : "沒有可以封存的 —— 剩下的不是台中/海線就是你已經勾了",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "改不動" };
  }
}

/* ────────────────── 排程 ────────────────── */

/**
 * 排程用的發文身分檢查（2026-10-07）。
 * 擋：找不到、已停用、粉絲專頁（第二段才做）。**不擋**「桌機還沒回報登入有效」——
 * 剛用 .bat 登入完、runner 下一輪（最多 5 分）才會回報，這段空窗不能讓人排不了；
 * 真的沒登入，runner 到點會明講哪個身分沒登入並把任務標失敗，這裡只在訊息尾巴提醒。
 */
async function resolveScheduleIdentity(
  raw: string | undefined,
): Promise<{ ok: true; identity: FbIdentityRow; warn: string } | { ok: false; error: string }> {
  const identity = await getIdentity(raw);
  if (!identity) return { ok: false, error: "找不到這個發文身分（可能被刪掉了），重新整理頁面再選" };
  if (identity.is_active !== 1) return { ok: false, error: `發文身分「${identity.name}」已停用，到「發文身分」頁重新啟用才能排` };
  if (identity.kind !== "personal") {
    return { ok: false, error: `「${identity.name}」是粉絲專頁，粉專發文還沒開放（要先設定官方 API）` };
  }
  const state = loginStateOf(identity);
  const warn =
    identity.is_default !== 1 && state !== "ok"
      ? ` ⚠️ 桌機回報「${identity.name}」${state === "missing" ? "還沒登入或登入失效" : "登入狀態還沒確認"}——到點發不出去的話，先到「發文身分」頁照步驟登入。`
      : "";
  return { ok: true, identity, warn };
}

export async function scheduleTaskAction(input: {
  draftId: string;
  channel: string;
  runAt: string;
  postToTimeline: boolean;
  groupIds: string[];
  autoPublish: boolean;
  /** true = run_at 設成現在（下次 runner 輪詢就發，約 5 分內）。一般貼文、Marketplace 都能用。 */
  runNow?: boolean;
  /** Marketplace 專用：到點也照 draft 的 groupIds 一起勾社團上架。 */
  crosspost?: boolean;
  /** 一般貼文專用（2026-09-21）：同時發到 IG／Threads（官方 API，runner 認領後先發這兩個）。 */
  shareIg?: boolean;
  shareThreads?: boolean;
  /** 2026-10-07 發文身分：用哪個身分發。不給＝主帳號（跟加這個功能之前一模一樣）。 */
  identityId?: string;
}): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!isChannel(input.channel)) return { ok: false, error: "通路不對" };

  const draft = await getFbDraft(input.draftId);
  if (!draft) return { ok: false, error: "找不到這則文案" };

  const runAt = input.runNow ? new Date() : parseLocalDateTime(input.runAt);
  if (!runAt) return { ok: false, error: "時間格式不對" };

  const idRes = await resolveScheduleIdentity(input.identityId);
  if (!idRes.ok) return { ok: false, error: idRes.error };
  const identityId = normalizeIdentityId(idRes.identity.id); // 主帳號＝null
  const isMain = identityId === null;
  const who = isMain ? "" : `（用「${idRes.identity.name}」發）`;

  // Marketplace（Phase 4，2026-09-06）：到點桌機 runner 會跑 post-marketplace.mjs 真的發。
  // 一定是全自動（沒人在旁邊按「發佈」），所以 autoPublish 恆為 true。
  if (input.channel === "marketplace") {
    if (!draft.marketplace_json) return { ok: false, error: "這則文案沒有 Marketplace 版本" };
    try {
      // 擬真抖動：排定時間的才抖（0～JITTER_MAX_MINUTES 分），「立即發佈」不抖 —— 他按立即就是要現在
      const jitterSec = input.runNow ? 0 : rollJitterSec();
      const id = await createFbTask({
        draftId: input.draftId,
        title: draft.title,
        channel: "marketplace",
        runAt,
        postToTimeline: false,
        groups: [],
        autoPublish: true,
        crosspost: Boolean(input.crosspost),
        jitterSec,
        identityId,
      });
      await setDraftStatus(input.draftId, "marketplace", "scheduled");
      revalidateAll();
      const 社團 = input.crosspost ? "（含勾社團）" : "";
      const 抖動 = jitterWindowLabel(runAt);
      const 撞 = await clashWarning(id, draft.title, "marketplace", runAt);
      return {
        ok: true,
        id,
        message:
          (input.runNow
            ? `已排「立即發佈」${社團}${who}。桌機 runner 下次輪詢（約 5 分內）會開瀏覽器發 —— 桌機要開著、runner 要在跑。`
            : `已排在 ${input.runAt.replace("T", " ")} 發佈${社團}${who}${抖動 ? `，擬真抖動：實際會在 ${抖動}` : ""}。到點桌機 runner 自動發；桌機關著就等開機，超過 ${DEFAULT_EXPIRE_HOURS} 小時沒發會失效。`) +
          撞 +
          idRes.warn,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "排程失敗" };
    }
  }

  // IG／Threads 是整個系統只連一組的官方 API 帳號，只跟主帳號綁在一起：
  // 其他身分排的任務不能再勾（否則同一則文案每個身分各發一次 IG／Threads＝同一篇洗好幾遍）
  const shareIg = isMain && Boolean(input.shareIg);
  const shareThreads = isMain && Boolean(input.shareThreads);
  if (!input.postToTimeline && input.groupIds.length === 0 && !shareIg && !shareThreads) {
    return { ok: false, error: "至少要挑一個地方（自己的動態、社團、IG 或 Threads）" };
  }
  // IG／Threads 的內文有硬上限，排程當下就擋，不要到點才在 runner 那邊失敗
  if (shareIg || shareThreads) {
    const v = getSocialVersions(draft);
    if (shareIg && socialLength(v.ig.text) > IG_CAPTION_LIMIT) return { ok: false, error: `IG 版本超過 ${IG_CAPTION_LIMIT} 字，先去貼文庫那則的 Instagram 分頁改短` };
    if (shareThreads && socialLength(v.threads.text) > THREADS_TEXT_LIMIT) return { ok: false, error: `Threads 版本超過 ${THREADS_TEXT_LIMIT} 字，先去貼文庫那則的 Threads 分頁改短` };
  }

  const groups: Array<{ id: string; name: string; url: string }> = [];
  for (const gid of input.groupIds) {
    const g = await getFbGroup(gid);
    if (!g) continue;
    // 🔴 社團清單是每個身分各自的（各帳號加入的社團不一樣）。挑到別的身分的社團就擋下來——
    //    拿 A 帳號的登入去發 B 帳號才有的社團，輕則發不進去、重則發到不該發的地方。
    if (!sameIdentity(g.identity_id, identityId)) {
      return { ok: false, error: `社團「${g.name}」不是「${idRes.identity.name}」的社團，重新整理頁面再挑一次` };
    }
    groups.push({ id: g.id, name: g.name, url: g.url });
  }

  try {
    // 擬真抖動：排定時間的才抖，「立即發佈」不抖 —— 跟 Marketplace 那支同一個規則
    const jitterSec = input.runNow ? 0 : rollJitterSec();
    const id = await createFbTask({
      draftId: input.draftId,
      title: draft.title,
      channel: "post",
      runAt,
      postToTimeline: input.postToTimeline,
      groups,
      autoPublish: input.autoPublish,
      jitterSec,
      shareIg,
      shareThreads,
      identityId,
    });
    await setDraftStatus(input.draftId, "post", "scheduled");
    revalidateAll();
    const 抖動 = jitterWindowLabel(runAt);
    const 尾 = 抖動 ? `；擬真抖動：實際會在 ${抖動}（不會剛好準點，這是故意的）` : "";
    const 撞 = await clashWarning(id, draft.title, "post", runAt);
    const 社群 = [shareIg ? "Instagram" : "", shareThreads ? "Threads" : ""].filter(Boolean).join("＋");
    const 社群尾 = 社群 ? `；${社群} 到點由桌機 runner 用官方 API 發（不開瀏覽器）` : "";
    const 只有社群 = !input.postToTimeline && groups.length === 0;
    return {
      ok: true,
      id,
      message:
        (input.runNow
          ? 只有社群
            ? `已排「立即發佈」。桌機 runner 下次輪詢（約 5 分內）會用官方 API 發到 ${社群}（沒有 FB 目標）`
            : input.autoPublish
              ? `已排「立即發佈」${who}。桌機 runner 下次輪詢（約 5 分內）會開瀏覽器發（會真的按發布）${社群尾}`
              : `已排「立即發佈」${who}。桌機 runner 下次輪詢（約 5 分內）會開瀏覽器備好、停在最後一步等你按發布${社群尾}`
          : 只有社群
            ? `已排程，到點桌機 runner 用官方 API 發到 ${社群}（沒有 FB 目標）${尾}`
            : input.autoPublish
              ? `已排程${who}，到點桌機自己開瀏覽器發（會真的按發布）${尾}${社群尾}`
              : `已排程${who}，到點桌機備好、停在最後一步等你按發布${尾}${社群尾}`) +
        撞 +
        idRes.warn,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "排程失敗" };
  }
}

/**
 * 排下去（或改時間）當場檢查：跟別的「等時間到」任務是不是排太近。
 * 太近不擋（桌機本來就一次只發一件、會自己排隊），但要講清楚後面那筆會晚發。
 */
async function clashWarning(id: string, title: string, channel: string, runAt: Date): Promise<string> {
  const [posts, mps] = await Promise.all([
    listFbTasks({ channel: "post", status: "pending" }),
    listFbTasks({ channel: "marketplace", status: "pending" }),
  ]);
  const note = clashNoteFor(
    { id, title, channel, runAt },
    [...posts, ...mps].map((t) => ({ id: t.id, title: t.title, channel: t.channel, runAt: new Date(t.run_at) })),
  );
  return note ? ` ⚠️ ${note}。` : "";
}

/** 改一個排程的時間（不用取消重排）。runAt 是 datetime-local 的字串。 */
export async function rescheduleTaskAction(id: string, runAt: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const when = parseLocalDateTime(runAt);
  if (!when) return { ok: false, error: "時間格式不對" };
  try {
    const task = await getFbTask(id);
    if (!task) return { ok: false, error: "找不到這個排程" };
    if (task.status === "running") {
      return { ok: false, error: "這個排程正在執行中，等它跑完、或先「取消排程」再重排" };
    }
    await rescheduleTask(id, when);
    const channel = isChannel(task.channel) ? task.channel : "post";
    await setDraftStatus(task.draft_id, channel, "scheduled");
    revalidateAll();
    const 抖動 = JITTER_MAX_MINUTES > 0 ? `（擬真抖動重抽：實際會在 ${jitterWindowLabel(when)}）` : "";
    const 撞 = await clashWarning(id, task.title, channel, when);
    return { ok: true, message: `已改到 ${runAt.replace("T", " ")}${抖動}${撞}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "改時間失敗" };
  }
}

export async function cancelTaskAction(id: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const task = await getFbTask(id);
    await deleteFbTask(id);
    if (task) {
      // 通路要看 task.channel —— 寫死 "post" 的話，取消 Marketplace 排程會錯改到一般貼文的狀態。
      const channel = isChannel(task.channel) ? task.channel : "post";
      // 🔴 同一則文案可能同時有好幾個排程（不同時間、不同社團組合）。只有在「這則已經
      //    沒有別的還在排的任務」時，才把狀態退回「還沒貼」——否則會害還沒發的那筆在貼文庫
      //    顯示成 draft，還可能被誤排第三次。（2026-09-07：本人取消重複的 23 個地方那筆時踩到。）
      const others = await listFbTasks({ channel });
      const stillScheduled = others.some(
        (t) => t.draft_id === task.draft_id && (t.status === "pending" || t.status === "running"),
      );
      if (!stillScheduled) await setDraftStatus(task.draft_id, channel, "draft");
    }
    revalidateAll();
    return { ok: true, message: "已取消" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "取消失敗" };
  }
}

/**
 * 手動把某個目標標成處理完（Marketplace、或桌機沒開自己補貼的）。
 * 記在 fb_task_item 上，跟 runner 記的長一樣 —— 執行紀錄要回答的是「這則貼文活多久」，
 * 誰按的送出鍵不影響那個答案。note 會寫「手動」。
 */
export async function markItemAction(input: {
  itemId: string;
  result: string;
  note?: string;
}): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!["posted", "skipped", "failed"].includes(input.result)) {
    return { ok: false, error: "結果只能是 posted／skipped／failed" };
  }
  try {
    await markItemResult(
      input.itemId,
      input.result as "posted" | "skipped" | "failed",
      input.note || "手動",
    );
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "記錄失敗" };
  }
}

export async function completeTaskAction(id: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    // 把還 pending 的 item 當作跳過，然後收尾
    const items = await getTaskItems(id);
    for (const it of items) {
      if (it.status === "pending") await markItemResult(it.id, "skipped", "手動收尾，沒貼這個");
    }
    await finishTask(id, "手動收尾");
    await setTaskStatus(id, "done");
    const task = await getFbTask(id);
    if (task) {
      // 🔴 修這裡之前這行寫死 "post"——Marketplace 任務點「貼完了」會錯改到一般貼文的狀態，
      // 而且 Marketplace 任務本來就沒有 fb_task_item（沒有逐一目標），anyPosted 永遠算 false，
      // 結果不管有沒有貼都被標成「還沒貼」。Marketplace 沒有逐項紀錄，點這顆鈕本身就是「貼了」的宣告。
      const channel = isChannel(task.channel) ? task.channel : "post";
      const anyPosted =
        channel === "marketplace" || (await getTaskItems(id)).some((i) => i.status === "posted");
      await setDraftStatus(task.draft_id, channel, anyPosted ? "posted" : "draft");
    }
    revalidateAll();
    return { ok: true, message: "收工" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "收尾失敗" };
  }
}

/* ────────────────── 自動刪文 ────────────────── */

export async function createDeleteTaskAction(input: {
  draftId: string;
  matchText: string;
  runAt: string;
  maxItems: number;
  olderThanDays: number | null;
  autoConfirm: boolean;
}): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };

  const draft = await getFbDraft(input.draftId);
  if (!draft) return { ok: false, error: "找不到這則文案" };

  const runAt = parseLocalDateTime(input.runAt);
  if (!runAt) return { ok: false, error: "時間格式不對" };

  const matchText = input.matchText.trim();
  // 太短的比對字串會連別篇貼文一起刪掉 —— 跟桌機 delete-groups.mjs --from-post 同一道防線（8 字）。
  if (matchText.length < 8) {
    return { ok: false, error: "比對文字至少要 8 個字，太短容易連別篇貼文一起刪掉" };
  }

  const maxItems = Number.isFinite(input.maxItems) ? Math.max(1, Math.min(50, Math.floor(input.maxItems))) : 15;
  const olderThanDays =
    input.olderThanDays != null && Number.isFinite(input.olderThanDays) && input.olderThanDays >= 0
      ? Math.floor(input.olderThanDays)
      : null;

  try {
    const id = await createDeleteTask({
      draftId: input.draftId,
      title: draft.title,
      matchText,
      maxItems,
      olderThanDays,
      runAt,
      autoConfirm: input.autoConfirm,
    });
    revalidateAll();
    return {
      ok: true,
      id,
      message: input.autoConfirm
        ? "已排程，到點桌機會自動刪掉對得上的社團貼文"
        : "已排程，到點桌機只會先看、產生預覽清單，不會真的刪",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "排程失敗" };
  }
}

export async function cancelDeleteTaskAction(id: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    await cancelDeleteTask(id);
    revalidateAll();
    return { ok: true, message: "已取消" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "取消失敗" };
  }
}

/* ────────────────── 自動刪文：按社團／按工作流一鍵清空（2026-09-19） ────────────────── */

/**
 * 兩個新入口共用的核心：跟 createDeleteTaskAction 差在時間固定「馬上」（run_at=now）、
 * 比對字串是系統從 fb_task_item 反推出來的（不是手打），可以多帶一個 groupId 限定社團。
 */
async function quickDeleteCore(input: {
  draftId: string;
  title: string;
  matchText: string;
  maxItems: number;
  groupId: string | null;
  autoConfirm: boolean;
}): Promise<Result> {
  const matchText = input.matchText.trim();
  // 理論上這裡的 matchText 是系統從已發文案反推的，不會太短；還是照舊擋一次，
  // 跟桌機 delete-groups.mjs --from-post 同一道防線一致。
  if (matchText.length < 8) {
    return { ok: false, error: `「${input.title}」的比對指紋太短（只剩「${matchText}」），沒辦法安全清空，要用進階排程手動給比對字。` };
  }
  try {
    const id = await createDeleteTask({
      draftId: input.draftId,
      title: input.title,
      matchText,
      maxItems: Math.max(1, Math.min(50, input.maxItems)),
      olderThanDays: null,
      runAt: new Date(),
      autoConfirm: input.autoConfirm,
      groupId: input.groupId,
    });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "排程失敗" };
  }
}

/** 按工作流清空：這一則文案發過的所有地方（自己的動態＋全部社團）一次排掉。 */
export async function quickDeleteDraftAction(draftId: string, autoConfirm: boolean): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };

  const rows = await listDeletableDrafts();
  const row = rows.find((r) => r.draftId === draftId);
  if (!row) return { ok: false, error: "找不到這則文案發過的紀錄" };
  if (row.alreadyQueued) return { ok: false, error: "已經排過清空了，看下面的清單" };
  if (row.groupPostedCount === 0) {
    return { ok: false, error: "這篇只發在自己的動態，沒有發到社團——這條路是走社團的「你的內容」，自己動態那篇要手動刪。" };
  }

  const res = await quickDeleteCore({
    draftId: row.draftId,
    title: row.title,
    matchText: row.matchPreview,
    // 桌機是「每個社團各開一次你的內容」，這個數字是每個社團最多幾篇——留一點餘裕給同一篇在同一社團發過兩次的情況
    maxItems: Math.max(3, row.groupPostedCount + 2),
    groupId: null,
    autoConfirm,
  });
  if (res.ok) revalidateAll();
  return res.ok
    ? { ...res, message: autoConfirm ? "已排入，桌機馬上會清掉" : "已排入，桌機會先預覽、不會真的刪" }
    : res;
}

/**
 * 按社團清空：這一個社團被貼過的全部文案一次排掉。一個社團可能收過好幾則不同文案，
 * 每則的比對字串不一樣，所以拆成好幾筆清空任務（各自只限這個社團＋各自的內文比對），
 * 不是一筆刪全部 —— 這樣才不會不小心刪到這個社團裡跟這套系統無關的貼文。
 */
export async function quickDeleteGroupAction(groupId: string, autoConfirm: boolean): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };

  const rows = await listDeletableGroups();
  const row = rows.find((r) => r.groupId === groupId);
  if (!row) return { ok: false, error: "找不到這個社團被貼過的紀錄" };
  if (row.alreadyQueued) return { ok: false, error: "已經排過清空了，看下面的清單" };

  let created = 0;
  const errors: string[] = [];
  for (const d of row.drafts) {
    const res = await quickDeleteCore({
      draftId: d.draftId,
      title: d.title,
      matchText: d.matchPreview,
      maxItems: d.count + 3,
      groupId,
      autoConfirm,
    });
    if (res.ok) created++;
    else if (res.error) errors.push(res.error);
  }

  if (created === 0) {
    return { ok: false, error: errors[0] || "排程失敗" };
  }
  revalidateAll();
  const 篇數 = row.drafts.length;
  return {
    ok: true,
    message:
      (autoConfirm ? `已排入 ${created} 筆，桌機馬上會清掉` : `已排入 ${created} 筆，桌機會先預覽、不會真的刪`) +
      (created < 篇數 ? `（${篇數 - created} 筆失敗：${errors[0] || ""}）` : ""),
  };
}

/* ────────────────── 上架／下架看板：太平洋官網綁定與成交檢查（2026-10-05 第二階段） ────────────────── */

const PACIFIC_STATUS_TEXT: Record<string, string> = {
  ok: "官網上還在",
  never_seen: "官網打開是空的，連結可能貼錯",
  gone: "官網已下架（多半是成交）",
  changed: "官網內容對不上，可能換成別戶",
};

/** 綁定（或改、或清空）官網網址；綁好立刻檢查一次，順便記下這戶的基準。 */
export async function bindPacificUrlAction(draftId: string, raw: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    if (!raw.trim()) {
      await setDraftPacificUrl(draftId, null);
      revalidateAll();
      return { ok: true, message: "已解除綁定" };
    }
    const url = normalizePacificInput(raw);
    if (!url) return { ok: false, error: "看不懂這個網址。請貼太平洋官網物件頁網址（含 saleID=S…），或直接貼編號如 S2906738" };
    await setDraftPacificUrl(draftId, url);
    const r = await checkOneDraftOnPacific(draftId);
    revalidateAll();
    if (!r || r.status == null) return { ok: true, message: `已綁定，但這次官網抓不到：${r?.note || ""}` };
    return { ok: true, message: `已綁定：${PACIFIC_STATUS_TEXT[r.status] || r.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "綁定失敗" };
  }
}

export async function checkPacificOneAction(draftId: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const r = await checkOneDraftOnPacific(draftId);
    revalidateAll();
    if (!r) return { ok: false, error: "這則沒有綁官網網址" };
    return { ok: true, message: r.status ? PACIFIC_STATUS_TEXT[r.status] || r.status : r.note };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "檢查失敗" };
  }
}

export async function checkPacificAllAction(): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const list = await checkAllDraftsOnPacific();
    revalidateAll();
    const gone = list.filter((r) => r.status === "gone" || r.status === "changed").length;
    const failed = list.filter((r) => r.status == null).length;
    const parts = [`檢查了 ${list.length} 則`];
    if (gone) parts.push(`${gone} 則官網已下架`);
    if (failed) parts.push(`${failed} 則這次抓不到`);
    return { ok: true, message: list.length ? parts.join("，") : "還沒有任何一則綁官網網址" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "檢查失敗" };
  }
}

export async function resetPacificAction(draftId: string): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const r = await resetDraftPacific(draftId);
  revalidateAll();
  return r.ok ? { ok: true, message: "已恢復" } : { ok: false, error: r.error };
}

export async function archiveDraftAction(draftId: string, archived: boolean): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    await setDraftArchived(draftId, archived);
    revalidateAll();
    return { ok: true, message: archived ? "已封存" : "已取消封存" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "封存失敗" };
  }
}

/** 看板「自動重新曝光」開關（第三階段，2026-10-05）。 */
export async function setRecycleAction(draftId: string, on: boolean): Promise<Result> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const r = await setRecycleEnabled(draftId, on);
    revalidateAll();
    return r;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "設定失敗" };
  }
}
