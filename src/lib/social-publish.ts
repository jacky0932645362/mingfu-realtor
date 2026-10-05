/**
 * IG／Threads 自動發文 —— 走官方 API，不是 Playwright。
 *
 * 2026-09-21 本人：「我發文也想要分享到 IG 跟 Threads」。
 *
 * 為什麼 IG／Threads 走 API、FB 卻走 Playwright：FB **個人主頁**沒有官方發文 API（只有粉專有），
 * 所以那邊只能開瀏覽器模擬；IG 專業帳號跟 Threads 都有官方的發文 API，而且 IG 對瀏覽器自動化
 * 抓得極兇（動不動就鎖帳號），走 API 才是安全的路。
 *
 * 查證過的官方規格（2026-09-21，developers.facebook.com）：
 *   IG（Instagram API with Instagram Login，不需要 FB 粉專，要 IG 專業帳號）
 *     ・權限 instagram_business_basic ＋ instagram_business_content_publish
 *     ・圖片只吃 JPEG、8MB、長寬比 4:5～1.91:1、寬 320～1440px；要放在公開網址上
 *     ・說明 2,200 字、hashtag 30 個；輪播最多 10 張；一天 100 篇
 *     ・流程：建容器 /{ig-id}/media → 查 status_code 到 FINISHED → /{ig-id}/media_publish
 *   Threads
 *     ・權限 threads_basic ＋ threads_content_publish
 *     ・內文 500 字；圖片 JPEG／PNG、8MB、寬 320～1440px；輪播 2～20 張；一天 250 篇
 *     ・流程：建容器 /{user-id}/threads → 查 status 到 FINISHED → /{user-id}/threads_publish
 *   兩邊：短效 token 1 小時 → 換長效 60 天 → 到期前用 refresh_access_token 續（token 要滿 24 小時才能續）
 *   兩邊：自己的帳號加成 Tester 就能發，不用送 App Review。
 *
 * 🔴 這個檔要能被桌機 runner 用裸 node（type-stripping）直接 import ——
 *    不能 import next/*、不能用 enum／namespace／parameter properties。跟 fb-factory.ts 同一條規矩。
 *
 * token 存在資料庫 social_account（不是 .env）：長效 token 60 天要續，續了要能寫回去，
 * Vercel 的環境變數改不動；而且桌機 runner 跟網站要共用同一把。
 */
import { db } from "@/lib/db";
import {
  getFbDraft,
  getFbTask,
  getTaskItems,
  getSocialVersions,
  markItemResult,
  parseFacts,
  setSocialStatus,
  isSocialPlatform,
  socialLabel,
  type SocialPlatform,
} from "@/lib/fb-factory";
import { getProperty } from "@/lib/property";
import { directImageUrl, parseImageList } from "@/lib/media-url";
import { IG_CAPTION_LIMIT, THREADS_TEXT_LIMIT, socialLength } from "@/lib/fb-social-copy";

/* ────────────────── 設定（.env） ────────────────── */

export type SocialAppConfig = { appId: string; appSecret: string };

/** 兩個平台在 Meta 開發者後台各有一組 App ID／Secret（同一個 Meta 應用程式底下，Instagram 跟 Threads 兩個產品各自給一組）。 */
export function socialAppConfig(platform: SocialPlatform): SocialAppConfig | null {
  const appId = (platform === "ig" ? process.env.IG_APP_ID : process.env.THREADS_APP_ID) || "";
  const appSecret = (platform === "ig" ? process.env.IG_APP_SECRET : process.env.THREADS_APP_SECRET) || "";
  if (!appId.trim() || !appSecret.trim()) return null;
  return { appId: appId.trim(), appSecret: appSecret.trim() };
}

/** OAuth 回跳的網站根網址。Meta 要求 https，所以連結帳號要在線上（Vercel）做，不能在 localhost。 */
export function socialSiteBase(): string {
  return (process.env.SOCIAL_OAUTH_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://mingfu-realtor.vercel.app").replace(
    /\/+$/,
    "",
  );
}

export function socialRedirectUri(platform: SocialPlatform): string {
  return `${socialSiteBase()}/api/social/oauth/${platform}/callback`;
}

const IG_GRAPH = (process.env.IG_GRAPH_BASE || "https://graph.instagram.com").replace(/\/+$/, "");
const THREADS_GRAPH = (process.env.THREADS_GRAPH_BASE || "https://graph.threads.net/v1.0").replace(/\/+$/, "");

const IG_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];
const THREADS_SCOPES = ["threads_basic", "threads_content_publish"];

/* ────────────────── 資料表 social_account ────────────────── */

export type SocialAccountRow = {
  platform: string;
  user_id: string;
  username: string | null;
  access_token: string;
  token_expires_at: Date | null;
  scopes: string | null;
  connected_at: Date;
  refreshed_at: Date | null;
  updated_at: Date | null;
};

let tableEnsured = false;
export async function ensureSocialAccountTable(): Promise<void> {
  if (tableEnsured) return;
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS social_account (
      platform         VARCHAR(16)  NOT NULL,
      user_id          VARCHAR(64)  NOT NULL,
      username         VARCHAR(120) NULL,
      access_token     TEXT         NOT NULL,
      token_expires_at DATETIME     NULL,
      scopes           VARCHAR(300) NULL,
      connected_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      refreshed_at     DATETIME     NULL,
      updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (platform)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tableEnsured = true;
}

export async function getSocialAccount(platform: SocialPlatform): Promise<SocialAccountRow | null> {
  await ensureSocialAccountTable();
  const rows = await db.$queryRaw<SocialAccountRow[]>`SELECT * FROM social_account WHERE platform = ${platform} LIMIT 1`;
  return rows[0] || null;
}

export async function saveSocialAccount(data: {
  platform: SocialPlatform;
  userId: string;
  username: string | null;
  accessToken: string;
  expiresAt: Date | null;
  scopes: string[];
}): Promise<void> {
  await ensureSocialAccountTable();
  await db.$executeRawUnsafe(
    `INSERT INTO social_account (platform, user_id, username, access_token, token_expires_at, scopes, connected_at, refreshed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id), username = VALUES(username), access_token = VALUES(access_token),
       token_expires_at = VALUES(token_expires_at), scopes = VALUES(scopes),
       connected_at = CURRENT_TIMESTAMP, refreshed_at = NULL, updated_at = CURRENT_TIMESTAMP`,
    data.platform,
    data.userId,
    data.username,
    data.accessToken,
    data.expiresAt,
    data.scopes.join(",").slice(0, 300),
  );
}

export async function disconnectSocialAccount(platform: SocialPlatform): Promise<void> {
  await ensureSocialAccountTable();
  await db.$executeRawUnsafe("DELETE FROM social_account WHERE platform = ?", platform);
}

/** 給後台「帳號連結」頁看的狀態（不含 token 本體）。 */
export type SocialAccountStatus = {
  platform: SocialPlatform;
  label: string;
  appConfigured: boolean;
  connected: boolean;
  username: string | null;
  userId: string | null;
  expiresAt: Date | null;
  daysLeft: number | null;
  connectedAt: Date | null;
  refreshedAt: Date | null;
  redirectUri: string;
  scopes: string[];
};

export async function socialAccountStatus(platform: SocialPlatform): Promise<SocialAccountStatus> {
  const acc = await getSocialAccount(platform);
  const expiresAt = acc?.token_expires_at ?? null;
  return {
    platform,
    label: socialLabel(platform),
    appConfigured: Boolean(socialAppConfig(platform)),
    connected: Boolean(acc),
    username: acc?.username ?? null,
    userId: acc?.user_id ?? null,
    expiresAt,
    daysLeft: expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000) : null,
    connectedAt: acc?.connected_at ?? null,
    refreshedAt: acc?.refreshed_at ?? null,
    redirectUri: socialRedirectUri(platform),
    scopes: platform === "ig" ? IG_SCOPES : THREADS_SCOPES,
  };
}

export async function allSocialAccountStatus(): Promise<Record<SocialPlatform, SocialAccountStatus>> {
  const [ig, threads] = await Promise.all([socialAccountStatus("ig"), socialAccountStatus("threads")]);
  return { ig, threads };
}

/* ────────────────── HTTP 小工具 ────────────────── */

export class SocialApiError extends Error {
  platform: SocialPlatform;
  status: number;
  constructor(platform: SocialPlatform, status: number, message: string) {
    super(message);
    this.name = "SocialApiError";
    this.platform = platform;
    this.status = status;
  }
}

type Json = Record<string, unknown>;

function describeApiError(body: unknown): string {
  const b = (body || {}) as { error?: { message?: string; error_user_msg?: string; error_user_title?: string; code?: number; error_subcode?: number } ; error_message?: string };
  const e = b.error;
  if (e) {
    const parts = [e.error_user_title, e.error_user_msg || e.message].filter(Boolean);
    const code = [e.code, e.error_subcode].filter((x) => x != null).join("/");
    return `${parts.join("：") || "API 回錯"}${code ? `（code ${code}）` : ""}`;
  }
  if (typeof b.error_message === "string") return b.error_message;
  return typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200);
}

async function apiGet(platform: SocialPlatform, url: string, params: Record<string, string>): Promise<Json> {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) throw new SocialApiError(platform, res.status, describeApiError(body));
  return body;
}

async function apiPost(platform: SocialPlatform, url: string, params: Record<string, string>): Promise<Json> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) form.set(k, v);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) throw new SocialApiError(platform, res.status, describeApiError(body));
  return body;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ────────────────── OAuth ────────────────── */

/** 帳號連結第一步：把本人送去 Meta 的授權畫面。state 由呼叫端產生並存進 cookie 防 CSRF。 */
export function socialAuthorizeUrl(platform: SocialPlatform, state: string): string {
  const cfg = socialAppConfig(platform);
  if (!cfg) throw new Error(`還沒設定 ${platform === "ig" ? "IG_APP_ID／IG_APP_SECRET" : "THREADS_APP_ID／THREADS_APP_SECRET"}`);
  const u = new URL(platform === "ig" ? "https://www.instagram.com/oauth/authorize" : "https://threads.net/oauth/authorize");
  u.searchParams.set("client_id", cfg.appId);
  u.searchParams.set("redirect_uri", socialRedirectUri(platform));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", (platform === "ig" ? IG_SCOPES : THREADS_SCOPES).join(","));
  u.searchParams.set("state", state);
  if (platform === "ig") u.searchParams.set("force_reauth", "true");
  return u.toString();
}

/**
 * 帳號連結第二步：拿 code 換短效 token → 換 60 天長效 token → 查帳號名 → 存進資料庫。
 * 兩個平台的端點長得幾乎一樣，只差網域跟 grant_type 的名字。
 */
export async function socialExchangeCode(platform: SocialPlatform, rawCode: string): Promise<SocialAccountStatus> {
  const cfg = socialAppConfig(platform);
  if (!cfg) throw new Error("App ID／Secret 沒設定");
  // Instagram 回來的 code 尾巴會多一個 "#_"，官方文件叫你自己砍掉
  const code = rawCode.replace(/#_$/, "");

  const tokenUrl = platform === "ig" ? "https://api.instagram.com/oauth/access_token" : "https://graph.threads.net/oauth/access_token";
  const short = await apiPost(platform, tokenUrl, {
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    grant_type: "authorization_code",
    redirect_uri: socialRedirectUri(platform),
    code,
  });
  // IG 的回應有時包在 data[0] 裡（舊格式），兩種都接
  const shortTok = (short.access_token as string | undefined) ||
    ((short.data as Array<{ access_token?: string; user_id?: string }> | undefined)?.[0]?.access_token ?? "");
  const shortUserId = String(
    (short.user_id as string | number | undefined) ??
      ((short.data as Array<{ user_id?: string }> | undefined)?.[0]?.user_id ?? ""),
  );
  if (!shortTok) throw new Error(`${socialLabel(platform)} 沒回短效 token：${JSON.stringify(short).slice(0, 200)}`);

  const longUrl = platform === "ig" ? `${IG_GRAPH}/access_token` : "https://graph.threads.net/access_token";
  const long = await apiGet(platform, longUrl, {
    grant_type: platform === "ig" ? "ig_exchange_token" : "th_exchange_token",
    client_secret: cfg.appSecret,
    access_token: shortTok,
  });
  const token = String(long.access_token || "");
  const expiresIn = Number(long.expires_in || 60 * 86_400);
  if (!token) throw new Error(`${socialLabel(platform)} 沒回長效 token：${JSON.stringify(long).slice(0, 200)}`);

  const me =
    platform === "ig"
      ? await apiGet("ig", `${IG_GRAPH}/me`, { fields: "user_id,username", access_token: token })
      : await apiGet("threads", `${THREADS_GRAPH}/me`, { fields: "id,username", access_token: token });
  const userId = String((platform === "ig" ? me.user_id : me.id) || shortUserId || "");
  if (!userId) throw new Error(`${socialLabel(platform)} 查不到帳號 ID`);

  await saveSocialAccount({
    platform,
    userId,
    username: me.username ? String(me.username) : null,
    accessToken: token,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    scopes: platform === "ig" ? IG_SCOPES : THREADS_SCOPES,
  });
  return socialAccountStatus(platform);
}

/**
 * 長效 token 60 天到期。剩不到 20 天、而且上次拿到 token 已超過 24 小時（官方規定滿一天才能續）→ 續一次。
 * 每次發文前呼叫；續不成不擋發文（token 還沒過期就照發），只把錯誤丟回去給呼叫端印。
 */
export async function refreshSocialTokenIfNeeded(platform: SocialPlatform): Promise<{ refreshed: boolean; note?: string }> {
  const acc = await getSocialAccount(platform);
  if (!acc) return { refreshed: false, note: "沒連結" };
  const exp = acc.token_expires_at ? acc.token_expires_at.getTime() : 0;
  const daysLeft = exp ? (exp - Date.now()) / 86_400_000 : 0;
  const lastIssued = (acc.refreshed_at || acc.connected_at).getTime();
  const ageHours = (Date.now() - lastIssued) / 3_600_000;
  if (exp && daysLeft > 20) return { refreshed: false };
  if (ageHours < 24) return { refreshed: false, note: "token 還沒滿 24 小時，官方不讓續" };
  try {
    const url = platform === "ig" ? `${IG_GRAPH}/refresh_access_token` : "https://graph.threads.net/refresh_access_token";
    const r = await apiGet(platform, url, {
      grant_type: platform === "ig" ? "ig_refresh_token" : "th_refresh_token",
      access_token: acc.access_token,
    });
    const token = String(r.access_token || "");
    const expiresIn = Number(r.expires_in || 60 * 86_400);
    if (!token) return { refreshed: false, note: "續 token 沒回新 token" };
    await db.$executeRawUnsafe(
      "UPDATE social_account SET access_token = ?, token_expires_at = ?, refreshed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE platform = ?",
      token,
      new Date(Date.now() + expiresIn * 1000),
      platform,
    );
    return { refreshed: true };
  } catch (e) {
    return { refreshed: false, note: `續 token 失敗：${e instanceof Error ? e.message : String(e)}` };
  }
}

/* ────────────────── 照片 ────────────────── */

export type PhotoCheck = { url: string; ok: boolean; reason?: string };

const CLOUDINARY_RE = /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.*)$/i;

/**
 * 把照片網址整理成兩個平台吃得下的樣子：
 *   ・Cloudinary 的：直接在網址上加轉檔參數（轉 JPEG、最寬 1440、自動品質）——這是 Cloudinary 的
 *     URL 功能，不用重新上傳，IG「只吃 JPEG」跟兩邊「寬不能超過 1440」一次解決。
 *   ・別家（Google Drive 直連等）：先 HEAD 一下看 Content-Type 是不是圖片。
 *     Drive 分享權限沒開會拿到 text/html（登入頁）—— 跟 FB 那邊 preparePhotos() 踩過的是同一個坑。
 *   ・桌機路徑（D:\\...）：API 抓不到本機檔案，直接跳過並講清楚。
 */
export function cloudinaryForSocial(url: string): string {
  const m = CLOUDINARY_RE.exec(url);
  if (!m) return url;
  const rest = m[2];
  // 已經有我們加過的轉檔段就不重複加
  if (/^f_jpg,/.test(rest)) return url;
  return `${m[1]}f_jpg,q_auto:good,w_1440,c_limit/${rest.replace(/\.(png|webp|heic|gif)$/i, ".jpg")}`;
}

async function sniffContentType(url: string): Promise<string | null> {
  try {
    const head = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8_000) });
    if (head.ok) return head.headers.get("content-type");
    if (head.status !== 405 && head.status !== 403) return `http ${head.status}`;
  } catch {
    /* 有些主機不接 HEAD，往下用 GET */
  }
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(10_000) });
    const ct = res.headers.get("content-type");
    try {
      await res.body?.cancel();
    } catch {
      /* 不用讀完 */
    }
    return res.ok ? ct : `http ${res.status}`;
  } catch (e) {
    return `抓不到（${e instanceof Error ? e.message.slice(0, 60) : "error"}）`;
  }
}

export async function checkSocialPhotos(platform: SocialPlatform, urls: string[]): Promise<PhotoCheck[]> {
  const max = platform === "ig" ? 10 : 20;
  const out: PhotoCheck[] = [];
  for (const raw of urls) {
    const s = (raw || "").trim();
    if (!s) continue;
    if (!/^https?:\/\//i.test(s)) {
      out.push({ url: s, ok: false, reason: "不是公開網址（桌機路徑 API 抓不到）—— 先用照片欄的上傳鈕丟到 Cloudinary" });
      continue;
    }
    if (CLOUDINARY_RE.test(s)) {
      out.push({ url: cloudinaryForSocial(s), ok: true });
      continue;
    }
    const url = directImageUrl(s);
    const ct = (await sniffContentType(url)) || "";
    const okType = platform === "ig" ? /^image\/jpe?g/i.test(ct) : /^image\/(jpe?g|png)/i.test(ct);
    if (okType) out.push({ url, ok: true });
    else if (/text\/html/i.test(ct)) out.push({ url, ok: false, reason: "抓到的是網頁不是圖片 —— 多半是 Google Drive 分享權限沒開（要「知道連結的人皆可查看」）" });
    else if (/^image\//i.test(ct)) out.push({ url, ok: false, reason: `${ct} —— ${platform === "ig" ? "IG 只吃 JPEG" : "Threads 只吃 JPEG／PNG"}，換成 Cloudinary 網址會自動轉檔` });
    else out.push({ url, ok: false, reason: `Content-Type 是「${ct || "空的"}」，不是圖片` });
  }
  // 超過上限的砍掉（也標出來讓人知道）
  const good = out.filter((p) => p.ok);
  if (good.length > max) {
    let n = 0;
    for (const p of out) {
      if (!p.ok) continue;
      n += 1;
      if (n > max) {
        p.ok = false;
        p.reason = `超過 ${socialLabel(platform)} 一篇最多 ${max} 張`;
      }
    }
  }
  return out;
}

/** 一則文案的照片來源（跟 runner API 的 claim、貼文庫那頁同一套規則）：接物件的走物件庫，手動的走 facts.photos。 */
export async function draftPhotoUrls(draftId: string): Promise<string[]> {
  const draft = await getFbDraft(draftId);
  if (!draft) return [];
  if (draft.source_property_id) {
    const prop = await getProperty(draft.source_property_id);
    if (!prop) return [];
    return [...(prop.cover_url ? [directImageUrl(prop.cover_url.trim())] : []), ...parseImageList(prop.photo_urls)]
      .filter((u, i, a) => u && a.indexOf(u) === i)
      .slice(0, 10);
  }
  return (parseFacts(draft.facts_json).photos ?? []).slice(0, 10);
}

/* ────────────────── 真的發：Instagram ────────────────── */

async function waitContainer(
  platform: SocialPlatform,
  containerId: string,
  token: string,
  maxMs = 90_000,
): Promise<void> {
  const base = platform === "ig" ? IG_GRAPH : THREADS_GRAPH;
  const fields = platform === "ig" ? "status_code,status" : "status,error_message";
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const r = await apiGet(platform, `${base}/${containerId}`, { fields, access_token: token });
    const st = String(r.status_code || r.status || "").toUpperCase();
    if (st === "FINISHED" || st === "PUBLISHED") return;
    if (st === "ERROR" || st === "EXPIRED") {
      throw new SocialApiError(platform, 400, `媒體容器處理失敗（${st}）${r.error_message ? `：${r.error_message}` : r.status ? `：${r.status}` : ""}`);
    }
    await sleep(3_000);
  }
  throw new SocialApiError(platform, 408, "媒體容器等太久還沒處理完（90 秒），這次先放棄");
}

export async function publishToInstagram(input: { caption: string; photos: string[] }): Promise<{ id: string; permalink: string | null }> {
  const acc = await getSocialAccount("ig");
  if (!acc) throw new Error("Instagram 還沒連結帳號（FB 貼文工廠 → IG／Threads 帳號）");
  const token = acc.access_token;
  const uid = acc.user_id;
  if (!input.photos.length) throw new Error("IG 一定要有照片才能發（Threads 可以純文字，IG 不行）");
  if (socialLength(input.caption) > IG_CAPTION_LIMIT) throw new Error(`IG 說明超過 ${IG_CAPTION_LIMIT} 字`);

  let containerId: string;
  if (input.photos.length === 1) {
    const r = await apiPost("ig", `${IG_GRAPH}/${uid}/media`, { image_url: input.photos[0], caption: input.caption, access_token: token });
    containerId = String(r.id);
  } else {
    const children: string[] = [];
    for (const url of input.photos.slice(0, 10)) {
      const r = await apiPost("ig", `${IG_GRAPH}/${uid}/media`, { image_url: url, is_carousel_item: "true", access_token: token });
      children.push(String(r.id));
    }
    const r = await apiPost("ig", `${IG_GRAPH}/${uid}/media`, {
      media_type: "CAROUSEL",
      children: children.join(","),
      caption: input.caption,
      access_token: token,
    });
    containerId = String(r.id);
  }
  await waitContainer("ig", containerId, token);
  const pub = await apiPost("ig", `${IG_GRAPH}/${uid}/media_publish`, { creation_id: containerId, access_token: token });
  const mediaId = String(pub.id);
  let permalink: string | null = null;
  try {
    const m = await apiGet("ig", `${IG_GRAPH}/${mediaId}`, { fields: "permalink", access_token: token });
    permalink = m.permalink ? String(m.permalink) : null;
  } catch {
    /* 拿不到連結不算失敗 */
  }
  return { id: mediaId, permalink };
}

/* ────────────────── 真的發：Threads ────────────────── */

export async function publishToThreads(input: { text: string; photos: string[] }): Promise<{ id: string; permalink: string | null }> {
  const acc = await getSocialAccount("threads");
  if (!acc) throw new Error("Threads 還沒連結帳號（FB 貼文工廠 → IG／Threads 帳號）");
  const token = acc.access_token;
  const uid = acc.user_id;
  if (!input.text.trim()) throw new Error("Threads 內文是空的");
  if (socialLength(input.text) > THREADS_TEXT_LIMIT) throw new Error(`Threads 內文超過 ${THREADS_TEXT_LIMIT} 字`);

  let containerId: string;
  if (input.photos.length === 0) {
    const r = await apiPost("threads", `${THREADS_GRAPH}/${uid}/threads`, { media_type: "TEXT", text: input.text, access_token: token });
    containerId = String(r.id);
  } else if (input.photos.length === 1) {
    const r = await apiPost("threads", `${THREADS_GRAPH}/${uid}/threads`, {
      media_type: "IMAGE",
      image_url: input.photos[0],
      text: input.text,
      access_token: token,
    });
    containerId = String(r.id);
  } else {
    const children: string[] = [];
    for (const url of input.photos.slice(0, 20)) {
      const r = await apiPost("threads", `${THREADS_GRAPH}/${uid}/threads`, {
        media_type: "IMAGE",
        image_url: url,
        is_carousel_item: "true",
        access_token: token,
      });
      children.push(String(r.id));
    }
    for (const id of children) await waitContainer("threads", id, token, 60_000);
    const r = await apiPost("threads", `${THREADS_GRAPH}/${uid}/threads`, {
      media_type: "CAROUSEL",
      children: children.join(","),
      text: input.text,
      access_token: token,
    });
    containerId = String(r.id);
  }
  await waitContainer("threads", containerId, token);
  const pub = await apiPost("threads", `${THREADS_GRAPH}/${uid}/threads_publish`, { creation_id: containerId, access_token: token });
  const mediaId = String(pub.id);
  let permalink: string | null = null;
  try {
    const m = await apiGet("threads", `${THREADS_GRAPH}/${mediaId}`, { fields: "permalink", access_token: token });
    permalink = m.permalink ? String(m.permalink) : null;
  } catch {
    /* 拿不到連結不算失敗 */
  }
  return { id: mediaId, permalink };
}

/* ────────────────── 高階：發一則文案到某平台 ────────────────── */

export type SocialPublishResult = {
  platform: SocialPlatform;
  id: string;
  url: string | null;
  photosUsed: number;
  photosSkipped: PhotoCheck[];
  tokenNote?: string;
};

/**
 * 發一則 fb_draft 的 IG／Threads 版本。內文＝貼文庫那則存的（或推導的）、照片＝物件庫／facts.photos。
 * 成功就把 social_json 標 posted＋記連結。失敗直接丟 Error（訊息給人看的，中文）。
 */
export async function publishSocialForDraft(draftId: string, platform: SocialPlatform): Promise<SocialPublishResult> {
  const draft = await getFbDraft(draftId);
  if (!draft) throw new Error("找不到這則文案");
  const acc = await getSocialAccount(platform);
  if (!acc) throw new Error(`${socialLabel(platform)} 還沒連結帳號 —— 去「FB 貼文工廠 → IG／Threads 帳號」按連結`);
  const tok = await refreshSocialTokenIfNeeded(platform);

  const version = getSocialVersions(draft)[platform];
  const text = version.text.trim();
  if (!text) throw new Error(`${socialLabel(platform)} 版本內文是空的`);

  const checks = await checkSocialPhotos(platform, await draftPhotoUrls(draftId));
  const photos = checks.filter((c) => c.ok).map((c) => c.url);
  const skipped = checks.filter((c) => !c.ok);
  if (platform === "ig" && photos.length === 0) {
    const why = skipped.length ? skipped.map((s) => `・${s.reason}`).join("\n") : "這則文案沒有照片";
    throw new Error(`IG 一定要有照片，但沒有一張能用：\n${why}`);
  }

  const r =
    platform === "ig"
      ? await publishToInstagram({ caption: text, photos })
      : await publishToThreads({ text, photos });
  await setSocialStatus(draftId, platform, "posted", r.permalink);
  return { platform, id: r.id, url: r.permalink, photosUsed: photos.length, photosSkipped: skipped, tokenNote: tok.note };
}

/* ────────────────── 高階：一份排程工作裡的 IG／Threads 目標 ────────────────── */

export type SocialItemOutcome = {
  itemId: string;
  platform: SocialPlatform;
  ok: boolean;
  url: string | null;
  note: string;
};

/**
 * runner 認領一般貼文工作後先呼叫這個：把 fb_task_item 裡 channel='ig'｜'threads' 的 pending 目標
 * 逐個用 API 發掉、回寫 posted／failed。一個平台失敗不影響另一個，也不影響後面的 FB 社團。
 * 失敗的 item 不重試（多半是「沒連結帳號」「照片不合規」這種要人處理的），note 寫清楚原因。
 */
export async function publishSocialItemsForTask(taskId: string): Promise<SocialItemOutcome[]> {
  const task = await getFbTask(taskId);
  if (!task) return [];
  const items = (await getTaskItems(taskId)).filter((i) => i.status === "pending" && isSocialPlatform(i.channel));
  const out: SocialItemOutcome[] = [];
  for (const item of items) {
    const platform = item.channel as SocialPlatform;
    try {
      const r = await publishSocialForDraft(task.draft_id, platform);
      const skipped = r.photosSkipped.length ? `；跳過 ${r.photosSkipped.length} 張照片` : "";
      const note = `${r.url || `已發（id ${r.id}）`}${skipped}`;
      await markItemResult(item.id, "posted", note.slice(0, 300));
      out.push({ itemId: item.id, platform, ok: true, url: r.url, note });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markItemResult(item.id, "failed", msg.slice(0, 300));
      out.push({ itemId: item.id, platform, ok: false, url: null, note: msg });
    }
  }
  return out;
}
