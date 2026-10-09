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
 *
 * 🆕 2026-10-09 多組帳號＋粉絲專頁（本人：「一、二都要做，IG/Threads 也要多組，可以讓我任意切換、自己選擇」）：
 *   ・帳號不再一個平台只有一組：每一個 IG／Threads 帳號、每一個粉專，都是「發文身分」（fb_identity，kind＝ig｜threads｜page），
 *     鑰匙放 fb_identity_token（不會送到畫面）。舊的 social_account 表保留不刪（2026-10-09 查過是空的，從沒連過）。
 *   ・排程的 IG／Threads／粉專動態目標，每一個都記著要發到哪個身分（fb_task_item.target_identity_id）。
 *   ・粉專走 Facebook 登入（另一組 FB_APP_ID／FB_APP_SECRET＝Meta 應用程式本身的編號），授權一次會把
 *     「你管理的全部粉專」一起帶進來，每個粉專各一把粉專鑰匙（從長效使用者鑰匙換來的粉專鑰匙不會過期）。
 *   ・官方文件（2026-10-09 查）：發粉專動態 POST /{page-id}/feed（message），權限要 pages_manage_posts＋
 *     pages_read_engagement 等，用粉專鑰匙；目前版本 v25.0。多張照片＝先 /{page-id}/photos published=false
 *     一張一張傳，再 /feed 帶 attached_media（這一段官方 posts 頁沒寫、是長期通用的做法，還沒對真粉專跑過）。
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
import {
  ensureFbIdentityTable,
  getIdentity,
  getIdentityToken,
  updateIdentityToken,
  upsertApiIdentity,
  listIdentities,
  type FbIdentityRow,
} from "@/lib/fb-identity";
import { getProperty } from "@/lib/property";
import { directImageUrl, parseImageList } from "@/lib/media-url";
import { IG_CAPTION_LIMIT, THREADS_TEXT_LIMIT, socialLength } from "@/lib/fb-social-copy";

/** 走官方 API 的平台：IG／Threads（social）＋粉專（fb）。OAuth 網址上的 [platform] 也是這三個。 */
export type OAuthPlatform = SocialPlatform | "fb";
export type ApiTargetChannel = SocialPlatform | "page";

export function isOAuthPlatform(v: unknown): v is OAuthPlatform {
  return v === "ig" || v === "threads" || v === "fb";
}

/* ────────────────── 設定（.env） ────────────────── */

export type SocialAppConfig = { appId: string; appSecret: string };

/**
 * 三組 App ID／Secret（都在同一個 Meta 應用程式底下）：
 *   ig       Instagram 產品給的那組（IG_APP_ID）
 *   threads  Threads 產品給的那組（THREADS_APP_ID）
 *   fb       應用程式本身的編號（FB_APP_ID）—— 粉專走 Facebook 登入用這組
 */
export function socialAppConfig(platform: OAuthPlatform): SocialAppConfig | null {
  const appId = (platform === "ig" ? process.env.IG_APP_ID : platform === "threads" ? process.env.THREADS_APP_ID : process.env.FB_APP_ID) || "";
  const appSecret =
    (platform === "ig" ? process.env.IG_APP_SECRET : platform === "threads" ? process.env.THREADS_APP_SECRET : process.env.FB_APP_SECRET) || "";
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

export function socialRedirectUri(platform: OAuthPlatform): string {
  return `${socialSiteBase()}/api/social/oauth/${platform}/callback`;
}

const IG_GRAPH = (process.env.IG_GRAPH_BASE || "https://graph.instagram.com").replace(/\/+$/, "");
const THREADS_GRAPH = (process.env.THREADS_GRAPH_BASE || "https://graph.threads.net/v1.0").replace(/\/+$/, "");
/** 粉專（Facebook Graph API）。2026-10-09 官方文件範例是 v25.0；Meta 改版時改這個環境變數就好。 */
const FB_GRAPH_VERSION = process.env.FB_GRAPH_VERSION || "v25.0";
const FB_GRAPH = `https://graph.facebook.com/${FB_GRAPH_VERSION}`;

const IG_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];
const THREADS_SCOPES = ["threads_basic", "threads_content_publish"];
/**
 * 發粉專貼文最少要的三個：列出自己管理的粉專／發文／讀貼文（發文權限的前置）。
 * 2026-10-10 本人建應用程式時對過畫面：要求的權限一定要先在「管理粉絲專頁」使用案例裡按「新增」，
 * 沒加的會讓授權畫面直接報錯——所以只要真的用得到的，留言管理那些不要。
 */
const FB_PAGE_SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement"];

export function scopesFor(platform: OAuthPlatform): string[] {
  return platform === "ig" ? IG_SCOPES : platform === "threads" ? THREADS_SCOPES : FB_PAGE_SCOPES;
}

/* ────────────────── 帳號（＝發文身分）的鑰匙 ────────────────── */

const KIND_OF: Record<ApiTargetChannel, "ig" | "threads" | "page"> = { ig: "ig", threads: "threads", page: "page" };

export function apiTargetLabel(c: ApiTargetChannel): string {
  return c === "page" ? "粉專" : socialLabel(c);
}

type ResolvedAccount = { identity: FbIdentityRow; userId: string; token: string };

/**
 * 找這個目標要用哪個身分的鑰匙。
 *   identityId 有給 → 一定要是那個身分、種類要對、啟用中、有鑰匙，不然丟錯（不會偷偷換成別的帳號）
 *   identityId 空（2026-10-09 以前排的舊資料，當時只有一組）→ 那個平台剛好只有一個啟用中的帳號才用它；
 *     有好幾個就丟錯請本人重排，不猜。
 */
export async function resolveApiAccount(channel: ApiTargetChannel, identityId: string | null | undefined): Promise<ResolvedAccount> {
  await ensureFbIdentityTable();
  const kind = KIND_OF[channel];
  let identity: FbIdentityRow | null;
  if (identityId) {
    identity = await getIdentity(identityId);
    if (!identity) throw new Error(`${apiTargetLabel(channel)} 帳號已經被刪掉了，這個目標沒發`);
    if (identity.kind !== kind) throw new Error(`「${identity.name}」不是 ${apiTargetLabel(channel)} 帳號，這個目標沒發`);
  } else {
    const all = (await listIdentities({ onlyActive: true })).filter((r) => r.kind === kind);
    if (all.length === 0) throw new Error(`${apiTargetLabel(channel)} 還沒連結帳號 —— 去「FB 貼文工廠 → 發文身分」按連結`);
    if (all.length > 1) throw new Error(`${apiTargetLabel(channel)} 連了 ${all.length} 個帳號，這筆是舊排程沒指定發哪個，請重新排一次`);
    identity = all[0];
  }
  if (identity.is_active !== 1) throw new Error(`「${identity.name}」已停用，這個目標沒發`);
  const tok = await getIdentityToken(identity.id);
  if (!tok) throw new Error(`「${identity.name}」沒有授權鑰匙，重新連結一次`);
  const userId = kind === "page" ? identity.page_id : identity.ext_user_id;
  if (!userId) throw new Error(`「${identity.name}」缺帳號編號，重新連結一次`);
  return { identity, userId, token: tok.access_token };
}

/* ────────────────── HTTP 小工具 ────────────────── */

export class SocialApiError extends Error {
  platform: OAuthPlatform;
  status: number;
  constructor(platform: OAuthPlatform, status: number, message: string) {
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

async function apiGet(platform: OAuthPlatform, url: string, params: Record<string, string>): Promise<Json> {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) throw new SocialApiError(platform, res.status, describeApiError(body));
  return body;
}

async function apiPost(platform: OAuthPlatform, url: string, params: Record<string, string>): Promise<Json> {
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
export function socialAuthorizeUrl(platform: OAuthPlatform, state: string): string {
  const cfg = socialAppConfig(platform);
  if (!cfg) {
    const need = platform === "ig" ? "IG_APP_ID／IG_APP_SECRET" : platform === "threads" ? "THREADS_APP_ID／THREADS_APP_SECRET" : "FB_APP_ID／FB_APP_SECRET";
    throw new Error(`還沒設定 ${need}`);
  }
  const u = new URL(
    platform === "ig"
      ? "https://www.instagram.com/oauth/authorize"
      : platform === "threads"
        ? "https://threads.net/oauth/authorize"
        : `https://www.facebook.com/${FB_GRAPH_VERSION}/dialog/oauth`,
  );
  u.searchParams.set("client_id", cfg.appId);
  u.searchParams.set("redirect_uri", socialRedirectUri(platform));
  u.searchParams.set("response_type", "code");
  // 粉專：2026-10-10 本人建的是「商家版」應用程式，左欄是「商家專用 Facebook 登入」。這種登入官方做法是
  // 帶 config_id（在後台建一組「設定」，權限勾在那裡），而不是帶 scope。有設定 FB_LOGIN_CONFIG_ID 就用它，
  // 沒有才退回傳統的 scope 寫法。
  const fbConfigId = platform === "fb" ? (process.env.FB_LOGIN_CONFIG_ID || "").trim() : "";
  if (fbConfigId) u.searchParams.set("config_id", fbConfigId);
  else u.searchParams.set("scope", scopesFor(platform).join(","));
  u.searchParams.set("state", state);
  // IG：每次都讓本人重新選帳號（要連第二、第三組 IG 才選得到別的）
  if (platform === "ig") u.searchParams.set("force_reauth", "true");
  // 粉專：每次都重新問要授權哪些粉專（新增粉專後再按一次就帶得進來）
  if (platform === "fb") u.searchParams.set("auth_type", "rerequest");
  return u.toString();
}

export type ConnectResult = { platform: OAuthPlatform; names: string[]; created: number };

/**
 * 帳號連結第二步：拿 code 換短效 token → 換 60 天長效 token → 查帳號 → 存成發文身分。
 * IG／Threads：一次一個帳號。粉專：一次把授權的全部粉專都存進來。
 */
export async function socialExchangeCode(platform: OAuthPlatform, rawCode: string): Promise<ConnectResult> {
  const cfg = socialAppConfig(platform);
  if (!cfg) throw new Error("App ID／Secret 沒設定");
  if (platform === "fb") return fbExchangeCode(cfg, rawCode);

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
  const username = me.username ? String(me.username) : null;

  const r = await upsertApiIdentity({
    kind: platform,
    extId: userId,
    name: username ? `@${username}` : `${socialLabel(platform)} ${userId}`,
    username,
    accessToken: token,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    scopes: scopesFor(platform),
  });
  return { platform, names: [username ? `@${username}` : userId], created: r.created ? 1 : 0 };
}

/** 粉專：code → 使用者鑰匙 → 長效使用者鑰匙 → /me/accounts 列出管理的粉專（各帶一把粉專鑰匙）→ 每個粉專存成身分。 */
async function fbExchangeCode(cfg: SocialAppConfig, code: string): Promise<ConnectResult> {
  const short = await apiGet("fb", `${FB_GRAPH}/oauth/access_token`, {
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    redirect_uri: socialRedirectUri("fb"),
    code,
  });
  const shortTok = String(short.access_token || "");
  if (!shortTok) throw new Error(`Facebook 沒回使用者鑰匙：${JSON.stringify(short).slice(0, 200)}`);
  const long = await apiGet("fb", `${FB_GRAPH}/oauth/access_token`, {
    grant_type: "fb_exchange_token",
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    fb_exchange_token: shortTok,
  });
  const userTok = String(long.access_token || shortTok);

  const names: string[] = [];
  let created = 0;
  let url: string | null = `${FB_GRAPH}/me/accounts`;
  let params: Record<string, string> = { fields: "id,name,access_token,link,tasks", limit: "100", access_token: userTok };
  for (let guard = 0; url && guard < 10; guard += 1) {
    const page = await apiGet("fb", url, params);
    const data = (page.data as Array<{ id?: string; name?: string; access_token?: string; link?: string; tasks?: string[] }>) || [];
    for (const p of data) {
      if (!p.id || !p.access_token) continue;
      // 官方 posts 文件：發文要能做 CREATE_CONTENT。做不到的粉專（只是分析師之類）就不收，免得排了才失敗
      if (Array.isArray(p.tasks) && !p.tasks.includes("CREATE_CONTENT")) continue;
      const r = await upsertApiIdentity({
        kind: "page",
        extId: p.id,
        name: p.name || `粉專 ${p.id}`,
        username: null,
        pageUrl: p.link || `https://www.facebook.com/${p.id}`,
        accessToken: p.access_token,
        // 從長效使用者鑰匙換來的粉專鑰匙沒有到期日
        expiresAt: null,
        scopes: FB_PAGE_SCOPES,
      });
      names.push(p.name || p.id);
      if (r.created) created += 1;
    }
    const next = (page.paging as { next?: string } | undefined)?.next;
    url = next || null;
    params = {};
  }
  if (!names.length) throw new Error("授權成功，但沒有拿到任何「可以發文」的粉專（授權畫面要勾選粉專、而且你要是那個粉專的管理員）");
  return { platform: "fb", names, created };
}

/**
 * IG／Threads 長效 token 60 天到期。剩不到 20 天、而且上次拿到 token 已超過 24 小時（官方規定滿一天才能續）→ 續一次。
 * 每次發文前呼叫；續不成不擋發文（token 還沒過期就照發），只把錯誤丟回去給呼叫端印。粉專鑰匙不會過期，不用續。
 */
export async function refreshIdentityTokenIfNeeded(identityId: string): Promise<{ refreshed: boolean; note?: string }> {
  const identity = await getIdentity(identityId);
  if (!identity || (identity.kind !== "ig" && identity.kind !== "threads")) return { refreshed: false };
  const platform = identity.kind as SocialPlatform;
  const acc = await getIdentityToken(identity.id);
  if (!acc) return { refreshed: false, note: "沒連結" };
  const exp = acc.token_expires_at ? new Date(acc.token_expires_at).getTime() : 0;
  const daysLeft = exp ? (exp - Date.now()) / 86_400_000 : 0;
  const lastIssued = new Date(acc.refreshed_at || acc.connected_at).getTime();
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
    await updateIdentityToken(identity.id, token, new Date(Date.now() + expiresIn * 1000));
    return { refreshed: true };
  } catch (e) {
    return { refreshed: false, note: `續 token 失敗：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 全部 IG／Threads 帳號都檢查一次要不要續（後台「發文身分」頁的按鈕用）。 */
export async function refreshAllIdentityTokens(): Promise<string[]> {
  const rows = (await listIdentities({ onlyActive: true })).filter((r) => r.kind === "ig" || r.kind === "threads");
  const out: string[] = [];
  for (const r of rows) {
    const res = await refreshIdentityTokenIfNeeded(r.id);
    out.push(`${r.name}：${res.refreshed ? "已續期" : res.note || "還不用續"}`);
  }
  return out;
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

type ApiAccount = { userId: string; token: string };

export async function publishToInstagram(acc: ApiAccount, input: { caption: string; photos: string[] }): Promise<{ id: string; permalink: string | null }> {
  const { token, userId: uid } = acc;
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

export async function publishToThreads(acc: ApiAccount, input: { text: string; photos: string[] }): Promise<{ id: string; permalink: string | null }> {
  const { token, userId: uid } = acc;
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

/* ────────────────── 真的發：粉專動態（2026-10-09） ────────────────── */

/**
 * 粉專自己的動態。沒照片＝/feed 只帶 message；有照片＝每張先用 /photos published=false 傳上去拿 id，
 * 再一次 /feed 帶 attached_media（多張圖一則貼文）。最多 10 張，跟 FB 個人帳號那條一樣。
 */
export async function publishToPage(acc: ApiAccount, input: { message: string; photos: string[] }): Promise<{ id: string; permalink: string | null }> {
  const { token, userId: pageId } = acc;
  if (!input.message.trim()) throw new Error("粉專貼文內文是空的");
  const params: Record<string, string> = { message: input.message, access_token: token };
  const photos = input.photos.slice(0, 10);
  if (photos.length) {
    const ids: string[] = [];
    for (const url of photos) {
      const r = await apiPost("fb", `${FB_GRAPH}/${pageId}/photos`, { url, published: "false", access_token: token });
      if (!r.id) throw new SocialApiError("fb", 400, `照片上傳沒回編號：${JSON.stringify(r).slice(0, 120)}`);
      ids.push(String(r.id));
    }
    ids.forEach((id, i) => {
      params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
    });
  }
  const pub = await apiPost("fb", `${FB_GRAPH}/${pageId}/feed`, params);
  const postId = String(pub.id || "");
  if (!postId) throw new SocialApiError("fb", 400, `發文沒回編號：${JSON.stringify(pub).slice(0, 120)}`);
  let permalink: string | null = null;
  try {
    const m = await apiGet("fb", `${FB_GRAPH}/${postId}`, { fields: "permalink_url", access_token: token });
    permalink = m.permalink_url ? String(m.permalink_url) : null;
  } catch {
    /* 拿不到連結不算失敗 */
  }
  return { id: postId, permalink };
}

/* ────────────────── 高階：發一則文案到某個帳號 ────────────────── */

export type SocialPublishResult = {
  channel: ApiTargetChannel;
  identityName: string;
  id: string;
  url: string | null;
  photosUsed: number;
  photosSkipped: PhotoCheck[];
  tokenNote?: string;
};

/**
 * 發一則 fb_draft 到某個 IG／Threads／粉專帳號。
 *   IG／Threads：內文＝貼文庫那則的 IG／Threads 版本；成功把 social_json 標 posted＋記連結
 *   粉專：內文＝一般貼文（post_text，跟發社團同一份）
 * 照片＝物件庫／facts.photos。失敗直接丟 Error（訊息給人看的，中文）。
 */
export async function publishSocialForDraft(
  draftId: string,
  channel: ApiTargetChannel,
  identityId?: string | null,
): Promise<SocialPublishResult> {
  const draft = await getFbDraft(draftId);
  if (!draft) throw new Error("找不到這則文案");
  const acc = await resolveApiAccount(channel, identityId);
  const tok = channel === "page" ? { refreshed: false } : await refreshIdentityTokenIfNeeded(acc.identity.id);
  // 續期過的話要重讀一次鑰匙
  const token = tok.refreshed ? (await getIdentityToken(acc.identity.id))?.access_token || acc.token : acc.token;
  const account = { userId: acc.userId, token };

  const text = channel === "page" ? (draft.post_text || "").trim() : getSocialVersions(draft)[channel].text.trim();
  if (!text) throw new Error(`${apiTargetLabel(channel)} 的內文是空的`);

  const checks = await checkSocialPhotos(channel === "page" ? "threads" : channel, await draftPhotoUrls(draftId));
  const photos = checks.filter((c) => c.ok).map((c) => c.url).slice(0, channel === "page" ? 10 : undefined);
  const skipped = checks.filter((c) => !c.ok);
  if (channel === "ig" && photos.length === 0) {
    const why = skipped.length ? skipped.map((s) => `・${s.reason}`).join("\n") : "這則文案沒有照片";
    throw new Error(`IG 一定要有照片，但沒有一張能用：\n${why}`);
  }

  const r =
    channel === "ig"
      ? await publishToInstagram(account, { caption: text, photos })
      : channel === "threads"
        ? await publishToThreads(account, { text, photos })
        : await publishToPage(account, { message: text, photos });
  if (isSocialPlatform(channel)) await setSocialStatus(draftId, channel, "posted", r.permalink);
  return {
    channel,
    identityName: acc.identity.name,
    id: r.id,
    url: r.permalink,
    photosUsed: photos.length,
    photosSkipped: skipped,
    tokenNote: "note" in tok ? (tok as { note?: string }).note : undefined,
  };
}

/* ────────────────── 高階：一份排程工作裡走官方 API 的目標 ────────────────── */

export type SocialItemOutcome = {
  itemId: string;
  platform: ApiTargetChannel;
  identityName: string;
  ok: boolean;
  url: string | null;
  note: string;
};

/**
 * runner 認領一般貼文工作後先呼叫這個：把 fb_task_item 裡 channel='ig'｜'threads'｜'page' 的 pending 目標
 * 逐個用 API 發掉、回寫 posted／failed。一個目標失敗不影響其他的，也不影響後面的 FB 社團。
 * 失敗的 item 不重試（多半是「沒連結帳號」「照片不合規」這種要人處理的），note 寫清楚原因。
 */
export async function publishSocialItemsForTask(taskId: string): Promise<SocialItemOutcome[]> {
  const task = await getFbTask(taskId);
  if (!task) return [];
  const items = (await getTaskItems(taskId)).filter(
    (i) => i.status === "pending" && (i.channel === "ig" || i.channel === "threads" || i.channel === "page"),
  );
  const out: SocialItemOutcome[] = [];
  for (const item of items) {
    const channel = item.channel as ApiTargetChannel;
    let name = apiTargetLabel(channel);
    try {
      const r = await publishSocialForDraft(task.draft_id, channel, item.target_identity_id ?? null);
      name = r.identityName;
      const skipped = r.photosSkipped.length ? `；跳過 ${r.photosSkipped.length} 張照片` : "";
      const note = `${r.url || `已發（id ${r.id}）`}${skipped}`;
      await markItemResult(item.id, "posted", note.slice(0, 300));
      out.push({ itemId: item.id, platform: channel, identityName: name, ok: true, url: r.url, note });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markItemResult(item.id, "failed", msg.slice(0, 300));
      out.push({ itemId: item.id, platform: channel, identityName: name, ok: false, url: null, note: msg });
    }
  }
  return out;
}
