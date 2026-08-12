/**
 * 太平洋房屋 bot(@mrbin)推「茗馥官方 Line AI 客服機器人」admin 群 — HITL 接手通知用
 *
 * 2026-06-04: HITL 通知必須走太平洋房屋 bot 推茗馥監控群(太平洋房屋 bot 不在那群,所以不能用 notifyLineGroup)。
 * 6/01 長期 token 全失效 → 一律 client_credentials 即時 mint(ABIN_LINE_CHANNEL_ID + ABIN_LINE_CHANNEL_SECRET)。
 */
let _abinTokenCache = "";
let _abinTokenExp = 0;

type AbinLineMessage =
  | { type: "text"; text: string }
  | { type: "flex"; altText: string; contents: unknown };

export type AbinAdminGroupDeliveryResult = {
  success: boolean;
  provider: "line-abin";
  reason?: string;
  retryable: boolean;
  providerStatus?: number;
  responseSample?: string;
};

async function getAbinToken(): Promise<string | null> {
  if (_abinTokenCache && Date.now() < _abinTokenExp) return _abinTokenCache;
  const cid = process.env.ABIN_LINE_CHANNEL_ID;
  const secret = process.env.ABIN_LINE_CHANNEL_SECRET;
  if (!cid || !secret) {
    console.error("[abin-notify] 缺 ABIN_LINE_CHANNEL_ID / SECRET, 無法 mint");
    return null;
  }
  try {
    const res = await fetch("https://api.line.me/v2/oauth/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: cid, client_secret: secret }).toString(),
    });
    if (!res.ok) {
      console.error("[abin-notify] mint 失敗", res.status, (await res.text()).slice(0, 150));
      return null;
    }
    const d = (await res.json()) as { access_token?: string };
    if (d.access_token) {
      _abinTokenCache = d.access_token;
      _abinTokenExp = Date.now() + 25 * 24 * 60 * 60 * 1000; // 比 30 天少 5 天 buffer
      return d.access_token;
    }
    return null;
  } catch (e) {
    console.error("[abin-notify] mint exception:", e);
    return null;
  }
}

async function rawPush(
  token: string,
  groupId: string,
  messages: AbinLineMessage[],
): Promise<Response> {
  return fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: groupId, messages }),
  });
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

/**
 * 太平洋房屋 bot 推 admin 監控群，回傳可供 outbox 判斷是否值得重試的完整原因。
 * 太平洋房屋 bot 不在這個群組，admin 通知不得改走 LINE_CHANNEL_* token。
 */
export async function notifyAbinAdminGroupMessagesNow(
  messages: AbinLineMessage | AbinLineMessage[],
): Promise<AbinAdminGroupDeliveryResult> {
  const groupId = process.env.ABIN_HITL_GROUP_ID || process.env.LINE_ADMIN_GROUP_ID;
  if (!groupId) {
    console.log("[abin-notify] 未設 ABIN_HITL_GROUP_ID/LINE_ADMIN_GROUP_ID, 跳過");
    return {
      success: false,
      provider: "line-abin",
      reason: "missing_abin_admin_group_id",
      retryable: false,
    };
  }
  if (!process.env.ABIN_LINE_CHANNEL_ID || !process.env.ABIN_LINE_CHANNEL_SECRET) {
    return {
      success: false,
      provider: "line-abin",
      reason: "missing_abin_line_credentials",
      retryable: false,
    };
  }
  const payload = Array.isArray(messages) ? messages : [messages];
  if (payload.length === 0 || payload.length > 5) {
    return {
      success: false,
      provider: "line-abin",
      reason: "invalid_abin_line_message_count",
      retryable: false,
    };
  }
  let token = await getAbinToken();
  if (!token) {
    return {
      success: false,
      provider: "line-abin",
      reason: "abin_line_token_unavailable",
      retryable: true,
    };
  }
  try {
    let res = await rawPush(token, groupId, payload);
    if (res.ok) {
      return { success: true, provider: "line-abin", retryable: false, providerStatus: res.status };
    }
    if (res.status === 401) {
      // token 失效 → 強制重 mint 重試
      _abinTokenExp = 0;
      token = await getAbinToken();
      if (!token) {
        return {
          success: false,
          provider: "line-abin",
          reason: "abin_line_token_refresh_failed",
          retryable: true,
          providerStatus: res.status,
        };
      }
      res = await rawPush(token, groupId, payload);
      if (res.ok) {
        return { success: true, provider: "line-abin", retryable: false, providerStatus: res.status };
      }
    }
    const responseSample = (await res.text().catch(() => "")).slice(0, 500);
    console.error("[abin-notify] push 失敗", res.status, responseSample.slice(0, 150));
    return {
      success: false,
      provider: "line-abin",
      reason: `abin_line_http_${res.status}`,
      retryable: isRetryableStatus(res.status),
      providerStatus: res.status,
      responseSample,
    };
  } catch (e) {
    console.error("[abin-notify] push exception:", e);
    return {
      success: false,
      provider: "line-abin",
      reason: "abin_line_network_error",
      retryable: true,
      responseSample: e instanceof Error ? e.message.slice(0, 500) : "unknown",
    };
  }
}

/** 保留舊 boolean contract，既有 HITL caller 不必改。 */
export async function notifyAbinAdminGroup(text: string): Promise<boolean> {
  const result = await notifyAbinAdminGroupMessagesNow({ type: "text", text });
  return result.success;
}
