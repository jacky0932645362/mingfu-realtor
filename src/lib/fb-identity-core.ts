/**
 * 發文身分（2026-10-07，本人：「想增加可以多個帳號排程貼文，包含粉絲專頁還有多個個人帳號」）——
 * 純函式與常數，**不碰資料庫、不 import 任何東西**，node 測試（test-identity.mjs）直接讀得到。
 *
 * 一個「發文身分」＝ 一個能發文的主體：
 *   personal  個人帳號：桌機各存一份登入檔（auth/fb-state[-代號].json），用 Playwright 開瀏覽器發。
 *   page      粉絲專頁：①發到粉專自己的動態＝官方 API（不開瀏覽器）②以粉專身分發到社團＝
 *             用「管理它的個人帳號」的登入檔開瀏覽器，切換成粉專身分再發（2026-10-09 第二段）。
 *   ig／threads  Instagram／Threads 帳號：官方 API，可以連好幾組（2026-10-09）。
 *
 * 🔴 原本就有的那個帳號 ＝ 「主帳號」，代號固定 "main"。fb_task／fb_group／fb_delete_task 的
 *    identity_id 欄位**主帳號一律存 NULL**（舊資料本來就是 NULL，兩種寫法不會並存），
 *    其他身分才存自己的 id。沒新增任何身分時，所有行為跟加這個功能之前一模一樣。
 */

export const IDENTITY_KINDS = [
  { key: "personal", label: "個人帳號" },
  { key: "page", label: "粉絲專頁" },
  { key: "ig", label: "Instagram" },
  { key: "threads", label: "Threads" },
] as const;

export type IdentityKind = "personal" | "page" | "ig" | "threads";

export function isIdentityKind(v: unknown): v is IdentityKind {
  return v === "personal" || v === "page" || v === "ig" || v === "threads";
}

/**
 * 排程裡「走官方 API」的目標（fb_task_item.channel）：粉專動態／IG／Threads。
 * 每一個目標都要指定是哪一個身分（fb_task_item.target_identity_id）。
 */
export const API_CHANNELS = ["page", "ig", "threads"] as const;
export type ApiChannel = (typeof API_CHANNELS)[number];

export function isApiChannel(v: unknown): v is ApiChannel {
  return v === "page" || v === "ig" || v === "threads";
}

export function apiChannelLabel(c: string): string {
  return c === "page" ? "粉專動態" : c === "ig" ? "Instagram" : c === "threads" ? "Threads" : c;
}

/**
 * 「以粉專身分發到社團」切換之後，桌機打開 facebook.com/me 會被轉到「現在是誰」的個人檔案網址。
 * 這支判斷轉過去的網址是不是那個粉專——是才准發。比不出來一律當「不是」（寧可不發，不能用錯身分發）。
 *   finalUrl  打開 /me 之後瀏覽器停在的網址
 *   pageId    粉專的數字編號（官方 API 拿到的）
 *   pageUrl   粉專的網址（官方 API 回的 link，可能是 /profile.php?id=… 或 /自訂名稱）
 */
export function isActingAsPage(finalUrl: string, pageId: string | null | undefined, pageUrl?: string | null): boolean {
  let u: URL;
  try {
    u = new URL(finalUrl);
  } catch {
    return false;
  }
  if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return false;
  const id = String(pageId || "").trim();
  if (id && /^\d+$/.test(id)) {
    if (u.searchParams.get("id") === id) return true;
    if (u.pathname.split("/").filter(Boolean).includes(id)) return true;
  }
  const slug = pageSlugFromUrl(pageUrl);
  if (slug) {
    let first = u.pathname.split("/").filter(Boolean)[0] || "";
    try {
      first = decodeURIComponent(first);
    } catch {
      /* 網址編碼壞掉就照原字比 */
    }
    if (first.toLowerCase() === slug.toLowerCase()) return true;
  }
  return false;
}

/** 粉專網址的自訂名稱（facebook.com/房仲蕭邦 → "房仲蕭邦"）；profile.php 這種沒有自訂名稱的回 null。 */
export function pageSlugFromUrl(pageUrl: string | null | undefined): string | null {
  if (!pageUrl) return null;
  try {
    const u = new URL(pageUrl);
    if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return null;
    const first = decodeURIComponent(u.pathname.split("/").filter(Boolean)[0] || "");
    if (!first || /^(profile\.php|pages|people|groups|me)$/i.test(first)) return null;
    return first;
  } catch {
    return null;
  }
}

export function identityKindLabel(kind: string): string {
  return IDENTITY_KINDS.find((k) => k.key === kind)?.label || kind;
}

/** 主帳號的固定代號。 */
export const DEFAULT_IDENTITY_ID = "main";
export const DEFAULT_IDENTITY_NAME = "主帳號";

/**
 * 寫進資料庫／拿來比對的 identity_id。
 * 主帳號（空值、"main"）一律變 null；其他原樣（去頭尾空白）。
 */
export function normalizeIdentityId(id: string | null | undefined): string | null {
  const s = (id ?? "").trim();
  if (!s || s === DEFAULT_IDENTITY_ID) return null;
  return s;
}

/** 給畫面／API 用的 id：null → "main"。 */
export function identityIdForDisplay(id: string | null | undefined): string {
  return normalizeIdentityId(id) ?? DEFAULT_IDENTITY_ID;
}

/** 兩個 identity_id 是不是同一個身分（null／空／"main" 都算主帳號）。 */
export function sameIdentity(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeIdentityId(a) === normalizeIdentityId(b);
}

/* ────────────────── 登入代號 → 登入檔檔名 ────────────────── */

/**
 * 登入代號：小寫英數與 -，1～24 字，開頭要是英數。
 * 🔴 這個字串會被拼進檔名（auth/fb-state-<代號>.json），所以一律先驗過再拼，
 *    不吃使用者自己打的任意字串（../、斜線、空白全擋掉）。
 */
export function isValidAuthKey(k: unknown): k is string {
  return typeof k === "string" && /^[a-z0-9][a-z0-9-]{0,23}$/.test(k);
}

/** 沒有 0/o/1/l/i 這些長得像的字，唸給本人聽也不會唸錯。 */
const KEY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** 產生登入代號，例：acct-k7m2。random 可注入（測試用）。 */
export function makeAuthKey(random: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 4; i += 1) s += KEY_ALPHABET[Math.floor(random() * KEY_ALPHABET.length)];
  return `acct-${s}`;
}

/**
 * 登入檔檔名。主帳號（沒有代號）沿用原本的 fb-state.json —— **不動既有的登入檔**；
 * 其他身分 fb-state-<代號>.json。代號不合法直接丟錯，不要默默退回主帳號的檔
 * （退回去＝拿錯帳號的鑰匙去發文，是這整個功能最不能發生的事）。
 */
export function authFileNameFor(authKey: string | null | undefined): string {
  if (authKey == null || authKey === "") return "fb-state.json";
  if (!isValidAuthKey(authKey)) throw new Error(`登入代號不合法：「${authKey}」`);
  return `fb-state-${authKey}.json`;
}

/* ────────────────── 登入狀態（桌機 runner 回報，網站只負責顯示） ────────────────── */

/** 超過這麼久沒回報，就不再當「現在是有效的」。runner 排程每 5 分鐘跑一輪，一天沒回報＝多半沒在跑。 */
export const LOGIN_REPORT_STALE_HOURS = 24;

export type LoginState = "ok" | "missing" | "stale" | "unknown";

export function loginStateOf(
  row: { login_ok: number | null; login_checked_at: Date | string | null },
  now: Date = new Date(),
): LoginState {
  if (row.login_ok == null || !row.login_checked_at) return "unknown";
  const age = now.getTime() - new Date(row.login_checked_at).getTime();
  if (age > LOGIN_REPORT_STALE_HOURS * 3_600_000) return "stale";
  return row.login_ok === 1 ? "ok" : "missing";
}

export function loginStateLabel(s: LoginState): string {
  switch (s) {
    case "ok":
      return "登入有效";
    case "missing":
      return "還沒登入／登入失效";
    case "stale":
      return "桌機超過一天沒回報";
    default:
      return "還沒回報";
  }
}
