/**
 * Meta Conversions API (CAPI) — 伺服器端 Pixel event sender
 *
 * 2026-05-04 接通 (03 軍師驗收後發現 5/2-5/4 Subscribe=10 / Purchase=2 反向)
 *
 * 為什麼要 CAPI:
 *   client-side fbq 在 iOS 14+ ATT 拒絕後失敗率 30%+
 *   client + server 雙 fire (帶同 event_id 讓 Meta 去重)
 *   → 預期 Purchase 收回率從 ~70% → 95%+
 *
 * 設定:
 *   1. 進 https://business.facebook.com/events_manager2/list/pixel/463926512068453/settings
 *   2. Conversions API → Generate Access Token
 *   3. Vercel env: META_CAPI_ACCESS_TOKEN=<token>
 *   4. 沒設 token 時,所有 send 函式 graceful skip + console.warn (不會擋付款 flow)
 *
 * Doc: https://developers.facebook.com/docs/marketing-api/conversions-api
 */
import { createHash } from "crypto";

const META_CAPI_API_VERSION = "v21.0";

// Meta standard events 全集合 (https://developers.facebook.com/docs/meta-pixel/reference#standard-events)
type CapiEventName =
  | "Purchase"
  | "Subscribe"
  | "Lead"
  | "CompleteRegistration"
  | "InitiateCheckout"
  | "AddPaymentInfo"
  | "AddToCart"
  | "ViewContent"
  | "Search"
  | "Contact"
  | "Schedule";

type CapiUserData = {
  email?: string | null;
  phone?: string | null;
  externalId?: string | null;
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
  fbp?: string | null; // _fbp cookie
  fbc?: string | null; // _fbc cookie
};

type CapiCustomData = {
  currency?: string;
  value?: number;
  contentIds?: string[];
  contentType?: string; // "product" | "product_group"
  contentName?: string;
  contentCategory?: string;
  orderId?: string;
};

type CapiSendOptions = {
  eventName: CapiEventName;
  eventId: string; // 與 client fbq eventID 同步,Meta 自動 dedup
  eventTime?: number; // unix seconds, default now
  eventSourceUrl?: string;
  actionSource?: "website" | "email" | "app" | "phone_call" | "chat" | "physical_store" | "system_generated" | "other";
  userData?: CapiUserData;
  customData?: CapiCustomData;
};

/**
 * SHA-256 hash + lowercase trim (Meta CAPI 要求 PII 必須 hash)
 */
function hashSha256(value: string): string {
  return createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}

function normalizePhoneForMeta(value: string): string {
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.startsWith("886")) return digits;
  if (digits.startsWith("0")) return `886${digits.slice(1)}`;
  return digits;
}

/**
 * 主要 send function — 失敗不擋付款 flow,記 log
 */
export async function sendCapiEvent(opts: CapiSendOptions): Promise<{
  ok: boolean;
  skipped?: boolean;
  error?: string;
  responseText?: string;
}> {
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID || process.env.META_PIXEL_ID;

  if (!accessToken || !pixelId) {
    console.warn(
      `[meta-capi] skipped ${opts.eventName} eventId=${opts.eventId} — missing META_CAPI_ACCESS_TOKEN or NEXT_PUBLIC_META_PIXEL_ID`,
    );
    return { ok: false, skipped: true, error: "Missing CAPI credentials" };
  }

  // 組 user_data (PII 必須 hash)
  const userData: Record<string, unknown> = {};
  if (opts.userData?.email) userData.em = [hashSha256(opts.userData.email)];
  if (opts.userData?.phone) userData.ph = [hashSha256(normalizePhoneForMeta(opts.userData.phone))];
  if (opts.userData?.externalId) userData.external_id = [hashSha256(opts.userData.externalId)];
  if (opts.userData?.clientIpAddress) userData.client_ip_address = opts.userData.clientIpAddress;
  if (opts.userData?.clientUserAgent) userData.client_user_agent = opts.userData.clientUserAgent;
  if (opts.userData?.fbp) userData.fbp = opts.userData.fbp;
  if (opts.userData?.fbc) userData.fbc = opts.userData.fbc;

  // 組 custom_data
  const customData: Record<string, unknown> = {};
  if (opts.customData?.currency) customData.currency = opts.customData.currency;
  if (opts.customData?.value != null) customData.value = opts.customData.value;
  if (opts.customData?.contentIds) customData.content_ids = opts.customData.contentIds;
  if (opts.customData?.contentType) customData.content_type = opts.customData.contentType;
  if (opts.customData?.contentName) customData.content_name = opts.customData.contentName;
  if (opts.customData?.contentCategory) customData.content_category = opts.customData.contentCategory;
  if (opts.customData?.orderId) customData.order_id = opts.customData.orderId;

  const event = {
    event_name: opts.eventName,
    event_time: opts.eventTime ?? Math.floor(Date.now() / 1000),
    event_id: opts.eventId, // 給 Meta dedup
    event_source_url: opts.eventSourceUrl ?? "https://example.com/payment/success",
    action_source: opts.actionSource ?? "website",
    user_data: userData,
    custom_data: customData,
  };

  const body = {
    data: [event],
    // test_event_code: process.env.META_CAPI_TEST_EVENT_CODE, // 開發測試用
  };

  const url = `https://graph.facebook.com/${META_CAPI_API_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(
        `[meta-capi] FAIL ${opts.eventName} eventId=${opts.eventId} status=${res.status}: ${text.slice(0, 300)}`,
      );
      return { ok: false, error: `HTTP ${res.status}`, responseText: text };
    }
    console.log(
      `[meta-capi] ✅ ${opts.eventName} eventId=${opts.eventId} value=${opts.customData?.value || 0}`,
    );
    return { ok: true, responseText: text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[meta-capi] EXCEPTION ${opts.eventName}: ${msg}`);
    return { ok: false, error: msg };
  }
}

/**
 * Helper: 一次性付款成功 → fire Purchase
 */
export async function sendPurchaseCapi(opts: {
  serial: string; // ECPay MerchantTradeNo,作為 event_id
  amount: number;
  email?: string | null;
  phone?: string | null; // 2026-07-20 線下課報名多帶 phone → advanced matching 命中率大增(email 稀疏時靠它)
  memberId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  contentName?: string | null; // 課名 / 方案名
  contentIds?: string[]; // courseId 等
  eventSourceUrl?: string | null;
}) {
  return sendCapiEvent({
    eventName: "Purchase",
    eventId: `purchase_${opts.serial}`,
    eventSourceUrl: opts.eventSourceUrl ?? undefined,
    userData: {
      email: opts.email,
      phone: opts.phone,
      externalId: opts.memberId,
      clientIpAddress: opts.ip,
      clientUserAgent: opts.userAgent,
      fbp: opts.fbp,
      fbc: opts.fbc,
    },
    customData: {
      currency: "TWD",
      value: opts.amount,
      orderId: opts.serial,
      contentName: opts.contentName ?? undefined,
      contentIds: opts.contentIds,
    },
  });
}

/**
 * 2026-05-07 補完 funnel events server CAPI fire
 * Meta「事件覆蓋率」warning 顯示 AddToCart / InitiateCheckout / etc 沒被 CAPI 覆蓋
 *   → 75% 覆蓋率 = CPA -46.8%
 *   → iOS 14+ ATT 擋 client fbq → server CAPI 補位
 */

type FunnelEventInput = {
  /** event_id 必須跟 client fbq 同步 (Meta dedup) */
  eventId: string;
  /** 商品 / 方案 名稱 */
  contentName?: string;
  /** product_set_id / plan_id */
  contentIds?: string[];
  contentType?: "product" | "product_group";
  contentCategory?: string;
  /** 金額 */
  value?: number;
  email?: string | null;
  memberId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  eventSourceUrl?: string;
};

function buildFunnelCapiEvent(eventName: CapiEventName, opts: FunnelEventInput) {
  return sendCapiEvent({
    eventName,
    eventId: opts.eventId,
    eventSourceUrl: opts.eventSourceUrl,
    userData: {
      email: opts.email,
      externalId: opts.memberId,
      clientIpAddress: opts.ip,
      clientUserAgent: opts.userAgent,
      fbp: opts.fbp,
      fbc: opts.fbc,
    },
    customData: {
      currency: "TWD",
      value: opts.value,
      contentIds: opts.contentIds,
      contentType: opts.contentType || "product",
      contentName: opts.contentName,
    },
  });
}

/** 加進結帳流程 — 進 /checkout 頁 */
export async function sendInitiateCheckoutCapi(opts: FunnelEventInput) {
  return buildFunnelCapiEvent("InitiateCheckout", opts);
}

/** Backward-compatible alias。 */
export async function sendInitiateCheckoutCapiReal(opts: FunnelEventInput) {
  return sendInitiateCheckoutCapi(opts);
}

/** AddPaymentInfo — 跳 ECPay 前 */
export async function sendAddPaymentInfoCapi(opts: FunnelEventInput) {
  return sendCapiEvent({
    eventName: "AddPaymentInfo" as CapiEventName,
    eventId: opts.eventId,
    eventSourceUrl: opts.eventSourceUrl,
    userData: {
      email: opts.email,
      externalId: opts.memberId,
      clientIpAddress: opts.ip,
      clientUserAgent: opts.userAgent,
      fbp: opts.fbp,
      fbc: opts.fbc,
    },
    customData: {
      currency: "TWD",
      value: opts.value,
      contentIds: opts.contentIds,
      contentName: opts.contentName,
    },
  });
}

/** AddToCart — 加購物車 */
export async function sendAddToCartCapi(opts: FunnelEventInput) {
  return sendCapiEvent({
    eventName: "AddToCart" as CapiEventName,
    eventId: opts.eventId,
    eventSourceUrl: opts.eventSourceUrl,
    userData: {
      email: opts.email,
      externalId: opts.memberId,
      clientIpAddress: opts.ip,
      clientUserAgent: opts.userAgent,
      fbp: opts.fbp,
      fbc: opts.fbc,
    },
    customData: {
      currency: "TWD",
      value: opts.value,
      contentIds: opts.contentIds,
      contentName: opts.contentName,
    },
  });
}

/** CompleteRegistration — 註冊完成 */
export async function sendCompleteRegistrationCapi(opts: FunnelEventInput) {
  return sendCapiEvent({
    eventName: "CompleteRegistration",
    eventId: opts.eventId,
    eventSourceUrl: opts.eventSourceUrl,
    userData: {
      email: opts.email,
      externalId: opts.memberId,
      clientIpAddress: opts.ip,
      clientUserAgent: opts.userAgent,
      fbp: opts.fbp,
      fbc: opts.fbc,
    },
    customData: {
      contentName: opts.contentName || "ShonKo Member Signup",
    },
  });
}

/** ViewContent — 看訂閱頁 / 課程頁 */
export async function sendViewContentCapi(opts: FunnelEventInput) {
  return sendCapiEvent({
    eventName: "ViewContent" as CapiEventName,
    eventId: opts.eventId,
    eventSourceUrl: opts.eventSourceUrl,
    userData: {
      email: opts.email,
      externalId: opts.memberId,
      clientIpAddress: opts.ip,
      clientUserAgent: opts.userAgent,
      fbp: opts.fbp,
      fbc: opts.fbc,
    },
    customData: {
      currency: "TWD",
      value: opts.value,
      contentIds: opts.contentIds,
      contentType: opts.contentType || "product",
      contentName: opts.contentName,
      contentCategory: opts.contentCategory,
    },
  });
}

/**
 * Helper: 訂閱成功 → fire Purchase + Subscribe
 */
export async function sendSubscribeCapi(opts: {
  serial: string;
  amount: number;
  email?: string | null;
  memberId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
}) {
  // 1) Purchase (給廣告 optimization 鎖 conversion)
  const purchaseResult = await sendPurchaseCapi(opts);

  // 2) Subscribe (內部追蹤)
  const subscribeResult = await sendCapiEvent({
    eventName: "Subscribe",
    eventId: `subscribe_${opts.serial}`,
    userData: {
      email: opts.email,
      externalId: opts.memberId,
      clientIpAddress: opts.ip,
      clientUserAgent: opts.userAgent,
      fbp: opts.fbp,
      fbc: opts.fbc,
    },
    customData: {
      currency: "TWD",
      value: opts.amount,
      orderId: opts.serial,
    },
  });

  return { purchase: purchaseResult, subscribe: subscribeResult };
}
