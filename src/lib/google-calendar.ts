/**
 * Google Calendar 整合 — 預約系統綁定系統擁有者的 Google 日曆（2026-06-19）
 * - OAuth(refresh token,系統擁有者本人授權一次)→ 查 timed events 擋已排行程 + 建/改/刪 event + 視訊產 Google Meet
 * - refresh token 存 appointment_config 表
 * - 🛡️ Graceful:沒綁定 / 出錯一律安全 fallback(timed events 回 [] → 規則制照常;建 event 回 null → 不擋預約)
 *
 * 啟用前提(一次性):
 *   1. Google Cloud Console 該 OAuth client 加 redirect URI: {BASE}/api/appointment/google/callback
 *   2. 系統擁有者點後台「綁定 Google 日曆」→ 授權同意
 */
import { db } from "@/lib/db";
import {
  CALENDAR_COLOR_CONFIG_KEY,
  CALENDAR_TITLE_CONFIG_KEY,
  DEFAULT_CALENDAR_TITLE_TEMPLATE,
  normalizeCalendarColorId,
  normalizeCalendarTitleTemplate,
} from "@/lib/appointment-calendar-display";
import { collectCalendarEventIds } from "@/lib/google-calendar-pagination";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const CAL_API = "https://www.googleapis.com/calendar/v3";

const CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.AUTH_GOOGLE_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET || "";
const BASE_URL = process.env.APPOINTMENT_BASE_URL || "https://example.com";
export const GOOGLE_REDIRECT_URI = `${BASE_URL}/api/appointment/google/callback`;
const SCOPE = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly";

export function isGoogleConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

// ---- config 表(存 refresh token / calendar id)----
let cfgEnsured = false;
async function ensureConfigTable(): Promise<void> {
  if (cfgEnsured) return;
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS appointment_config (
      k          VARCHAR(64) NOT NULL,
      v          LONGTEXT    NULL,
      updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (k)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  cfgEnsured = true;
}

export async function getConfig(k: string): Promise<string | null> {
  await ensureConfigTable();
  const rows = await db.$queryRaw<{ v: string | null }[]>`SELECT v FROM appointment_config WHERE k = ${k} LIMIT 1`;
  return rows[0]?.v ?? null;
}

export async function setConfig(k: string, v: string | null): Promise<void> {
  await ensureConfigTable();
  await db.$executeRaw`
    INSERT INTO appointment_config (k, v) VALUES (${k}, ${v})
    ON DUPLICATE KEY UPDATE v = ${v}, updated_at = NOW()
  `;
}

export async function isGoogleBound(): Promise<boolean> {
  if (!isGoogleConfigured()) return false;
  return Boolean(await getConfig("google_refresh_token"));
}

async function getCalendarId(): Promise<string> {
  return (await getConfig("google_calendar_id")) || "primary";
}

/**
 * 日曆事件的「長相」設定（2026-08-06 系統擁有者）：標題樣板 + 顏色。
 * 兩支產生事件的路徑（appointment-outbox 與本檔 createCalendarEvent）都讀這裡，
 * 免得改一邊漏一邊。沒設定就回預設 = 跟 2026-08-06 之前完全一樣。
 */
export async function getCalendarDisplaySettings(): Promise<{ titleTemplate: string; colorId: string }> {
  const [tpl, color] = await Promise.all([
    getConfig(CALENDAR_TITLE_CONFIG_KEY),
    getConfig(CALENDAR_COLOR_CONFIG_KEY),
  ]);
  return {
    titleTemplate: normalizeCalendarTitleTemplate(tpl || DEFAULT_CALENDAR_TITLE_TEMPLATE),
    colorId: normalizeCalendarColorId(color),
  };
}

// ---- OAuth ----
export function getAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // 強制每次給 refresh token
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

/** 用 authorization code 換 refresh token,存 DB。回成功與否。*/
export async function exchangeCodeForToken(code: string): Promise<boolean> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    if (!res.ok) {
      console.error("[google-cal] code 換 token 失敗:", (await res.text()).slice(0, 200));
      return false;
    }
    const d = await res.json();
    if (!d.refresh_token) {
      console.error("[google-cal] 回應無 refresh_token(可能未帶 prompt=consent)");
      return false;
    }
    await setConfig("google_refresh_token", d.refresh_token);
    return true;
  } catch (e) {
    console.error("[google-cal] exchangeCode 例外:", e);
    return false;
  }
}

// ---- access token(refresh token 換,module cache)----
let accessTokenCache: { token: string; exp: number } | null = null;
async function getAccessToken(): Promise<string | null> {
  if (accessTokenCache && accessTokenCache.exp > Date.now() + 60_000) return accessTokenCache.token;
  const refresh = await getConfig("google_refresh_token");
  if (!refresh || !isGoogleConfigured()) return null;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refresh,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error("[google-cal] refresh token 失敗:", (await res.text()).slice(0, 200));
      return null;
    }
    const d = await res.json();
    if (!d.access_token) return null;
    accessTokenCache = { token: d.access_token, exp: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
    return d.access_token;
  } catch (e) {
    console.error("[google-cal] getAccessToken 例外:", e);
    return null;
  }
}

export async function disconnectGoogle(): Promise<void> {
  await setConfig("google_refresh_token", null);
  accessTokenCache = null;
}

// ---- timed events(查已排行程,擋預約)----
export type BusyRange = { start: number; end: number; eventId?: string }; // epoch ms

export class GoogleCalendarUnavailableError extends Error {
  constructor(readonly reason: "not_bound" | "token_unavailable" | "api_unavailable" | "config_unavailable") {
    super(`google_calendar_${reason}`);
    this.name = "GoogleCalendarUnavailableError";
  }
}

type CalendarEventTime = {
  date?: string;
  dateTime?: string;
};

type CalendarEvent = {
  id?: string;
  status?: string;
  transparency?: string;
  start?: CalendarEventTime;
  end?: CalendarEventTime;
};

function eventToBusyRange(event: CalendarEvent): BusyRange | null {
  if (event.status === "cancelled") return null;
  if (event.transparency === "transparent") return null;

  // Google all-day events use start.date/end.date. These are reminders for系統擁有者,
  // not hard blockers for customer appointment slots.
  if (!event.start?.dateTime || !event.end?.dateTime) return null;

  const start = new Date(event.start.dateTime).getTime();
  const end = new Date(event.end.dateTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end, eventId: event.id };
}

async function fetchBusyRanges(
  token: string,
  fromIso: string,
  toIso: string,
  excludeEventId?: string | null,
): Promise<BusyRange[]> {
  const calId = await getCalendarId();
  const url = new URL(`${CAL_API}/calendars/${encodeURIComponent(calId)}/events`);
  url.searchParams.set("timeMin", fromIso);
  url.searchParams.set("timeMax", toIso);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("showDeleted", "false");
  url.searchParams.set("maxResults", "2500");
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    console.error("[google-cal] events list 失敗:", detail);
    throw new GoogleCalendarUnavailableError("api_unavailable");
  }
  const data = (await res.json()) as { items?: CalendarEvent[] };
  return (data.items || [])
    .filter((event) => !excludeEventId || event.id !== excludeEventId)
    .map(eventToBusyRange)
    .filter((range): range is BusyRange => Boolean(range));
}

/**
 * 列出某段期間 Google 日曆上還存在的事件 ID（2026-08-06 系統擁有者）。
 *
 * 用途：後台開啟時比對「資料庫說預約還在、但 Google 上那個事件已經被手動刪掉」的情況。
 * 系統擁有者測試時習慣直接在 Google 滑掉事件，後台不會知道，時段就一直被佔著。
 *
 * ⚠️ 回傳 `null` 代表「問不到」（沒綁定 / API 掛了 / 逾時），**不是「一個都沒有」**。
 *    呼叫端必須分清楚這兩者 —— 當成空集合的話會把所有預約都誤判成孤兒，全部標紅。
 *    這正是「工具查詢失敗 = 不知道，不是沒有」。
 */
export async function listCalendarEventIds(fromIso: string, toIso: string): Promise<Set<string> | null> {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const calId = await getCalendarId();
    return await collectCalendarEventIds(async (pageToken) => {
      const url = new URL(`${CAL_API}/calendars/${encodeURIComponent(calId)}/events`);
      url.searchParams.set("timeMin", fromIso);
      url.searchParams.set("timeMax", toIso);
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("showDeleted", "false");
      url.searchParams.set("maxResults", "2500");
      // nextPageToken 必須同時拉回，否則第二頁以後的真實事件會被誤判為孤兒。
      url.searchParams.set("fields", "nextPageToken,items(id)");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        throw new Error(`google_calendar_events_list_${res.status}: ${detail}`);
      }
      return (await res.json()) as {
        items?: Array<{ id?: string | null }>;
        nextPageToken?: string | null;
      };
    });
  } catch (e) {
    console.error("[google-cal] listCalendarEventIds 例外:", e);
    return null;
  }
}

export async function getBusyRanges(fromIso: string, toIso: string): Promise<BusyRange[]> {
  const token = await getAccessToken();
  if (!token) return []; // 沒綁定 → 不擋,規則制照常
  try {
    return await fetchBusyRanges(token, fromIso, toIso);
  } catch (e) {
    console.error("[google-cal] getBusyRanges 例外:", e);
    return [];
  }
}

/**
 * 公開預約最終寫入前使用的 fail-closed 查詢。
 * OAuth 完全未設定時視為停用整合；一旦有 OAuth 設定，未綁定或 Google API 故障都必須拒絕預約。
 */
export async function getBusyRangesStrict(
  fromIso: string,
  toIso: string,
  options?: { excludeEventId?: string | null },
): Promise<BusyRange[]> {
  if (!isGoogleConfigured()) return [];
  try {
    const refresh = await getConfig("google_refresh_token");
    if (!refresh) throw new GoogleCalendarUnavailableError("not_bound");
    const token = await getAccessToken();
    if (!token) throw new GoogleCalendarUnavailableError("token_unavailable");
    return await fetchBusyRanges(token, fromIso, toIso, options?.excludeEventId);
  } catch (error) {
    if (error instanceof GoogleCalendarUnavailableError) throw error;
    console.error("[google-cal] strict availability failed:", error);
    throw new GoogleCalendarUnavailableError("config_unavailable");
  }
}

// ---- 建 event(視訊產 Google Meet)----
export async function createCalendarEvent(opts: {
  summary: string;
  description: string;
  startIso: string;
  endIso: string;
  withMeet: boolean;
  location?: string | null;
  attendeeEmail?: string | null;
  attendeeName?: string | null;
}): Promise<{ eventId: string; meetUrl: string | null } | null> {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const calId = await getCalendarId();
    const display = await getCalendarDisplaySettings();
    const body: Record<string, unknown> = {
      summary: opts.summary,
      description: opts.description,
      start: { dateTime: opts.startIso, timeZone: "Asia/Taipei" },
      end: { dateTime: opts.endIso, timeZone: "Asia/Taipei" },
      // 顏色改由後台設定（2026-08-06 系統擁有者）。沒設定時仍是孔雀藍 colorId 7，跟以前一樣。
      colorId: display.colorId,
    };
    if (opts.location) body.location = opts.location;
    if (opts.withMeet) {
      body.conferenceData = {
        createRequest: { requestId: `appt-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } },
      };
    }
    const shouldInviteCustomer = process.env.APPOINTMENT_GOOGLE_INVITE_CUSTOMER === "1" && !!opts.attendeeEmail;
    if (shouldInviteCustomer) {
      body.attendees = [{ email: opts.attendeeEmail, displayName: opts.attendeeName || undefined }];
    }
    const p = new URLSearchParams({ conferenceDataVersion: "1" });
    if (shouldInviteCustomer) p.set("sendUpdates", "all");
    const url = `${CAL_API}/calendars/${encodeURIComponent(calId)}/events?${p.toString()}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error("[google-cal] 建 event 失敗:", (await res.text()).slice(0, 200));
      return null;
    }
    const d = await res.json();
    const meetUrl =
      d?.hangoutLink ||
      (d?.conferenceData?.entryPoints || []).find((e: { entryPointType?: string; uri?: string }) => e.entryPointType === "video")?.uri ||
      null;
    return { eventId: d.id, meetUrl };
  } catch (e) {
    console.error("[google-cal] createCalendarEvent 例外:", e);
    return null;
  }
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const token = await getAccessToken();
  if (!token || !eventId) return;
  try {
    const calId = await getCalendarId();
    await fetch(`${CAL_API}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    console.error("[google-cal] deleteCalendarEvent 例外:", e);
  }
}

export async function updateCalendarEventTime(eventId: string, startIso: string, endIso: string): Promise<void> {
  const token = await getAccessToken();
  if (!token || !eventId) return;
  try {
    const calId = await getCalendarId();
    await fetch(`${CAL_API}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        start: { dateTime: startIso, timeZone: "Asia/Taipei" },
        end: { dateTime: endIso, timeZone: "Asia/Taipei" },
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    console.error("[google-cal] updateCalendarEventTime 例外:", e);
  }
}
