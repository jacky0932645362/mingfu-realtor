/**
 * 發文身分（2026-10-07，本人：「想增加可以多個帳號排程貼文，包含粉絲專頁還有多個個人帳號」）——
 * 純函式與常數，**不碰資料庫、不 import 任何東西**，node 測試（test-identity.mjs）直接讀得到。
 *
 * 一個「發文身分」＝ 一個能發文的主體：
 *   personal  個人帳號：桌機各存一份登入檔（auth/fb-state[-代號].json），用 Playwright 開瀏覽器發。
 *   page      粉絲專頁：（第二段才做）走官方 API，不開瀏覽器。
 *
 * 🔴 原本就有的那個帳號 ＝ 「主帳號」，代號固定 "main"。fb_task／fb_group／fb_delete_task 的
 *    identity_id 欄位**主帳號一律存 NULL**（舊資料本來就是 NULL，兩種寫法不會並存），
 *    其他身分才存自己的 id。沒新增任何身分時，所有行為跟加這個功能之前一模一樣。
 */

export const IDENTITY_KINDS = [
  { key: "personal", label: "個人帳號" },
  { key: "page", label: "粉絲專頁" },
] as const;

export type IdentityKind = "personal" | "page";

export function isIdentityKind(v: unknown): v is IdentityKind {
  return v === "personal" || v === "page";
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
