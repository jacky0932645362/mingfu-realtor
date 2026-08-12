/**
 * GA4 Measurement Protocol — 伺服器端 GA4 event sender
 *
 * 2026-05-11 P0:5/4-5/11 金流 vs GA4 對齊度 29%(2/7),iOS ATT + Adblocker 擋
 *   client-side gtag 漏 5/7 = 71%。server-side MP 補位。
 *
 * 為什麼要 MP:
 *   client gtag 受 iOS 14+ ATT、Adblocker、Brave 等擋,失敗率 30-50%
 *   server-side MP 直接 POST 到 GA4,不會被擋
 *   dedup 用 transaction_id(GA4 自動合併相同 transaction_id 的 purchase)
 *
 * 設定:
 *   1. GA4: 管理 (左下齒輪) → 資料串流 → 點 web stream → 「Measurement Protocol API 密鑰」 → 建立
 *   2. Vercel env: GA4_API_SECRET=<secret>
 *      (NEXT_PUBLIC_GA_ID 已設,直接用)
 *   3. 沒設 secret 時 graceful skip + console.warn (不擋付款 flow)
 *
 * Doc: https://developers.google.com/analytics/devguides/collection/protocol/ga4
 */

type Ga4Item = {
  item_id?: string;
  item_name?: string;
  item_category?: string;
  price?: number;
  quantity?: number;
  currency?: string;
};

type Ga4PurchaseInput = {
  /** 必填:交易編號,跟 client-side gtag 同(GA4 用此 dedup) */
  transactionId: string;
  /** 金額 */
  value: number;
  currency?: string; // 預設 TWD
  /** GA4 client_id (從 _ga cookie 拿,沒拿到 fallback memberId / transactionId) */
  clientId?: string | null;
  /** 內部會員 id → user_id (cross-device) */
  memberId?: string | null;
  /** 商品列表 */
  items?: Ga4Item[];
};

/** _ga cookie → client_id 解析 (`GA1.2.{client_id}.{timestamp}` 取第 3 段) */
export function parseGaClientId(gaCookie: string | null | undefined): string | null {
  if (!gaCookie) return null;
  const parts = gaCookie.split(".");
  if (parts.length < 4) return null;
  // 例 GA1.2.1234567890.1700000000 → 取 [2] + [3] = "1234567890.1700000000"
  return `${parts[2]}.${parts[3]}`;
}

/**
 * 主要 send function — GA4 server-side purchase
 * 失敗不擋付款 flow,記 log
 */
export async function sendPurchaseGa4Mp(opts: Ga4PurchaseInput): Promise<{
  ok: boolean;
  skipped?: boolean;
  error?: string;
}> {
  const measurementId = process.env.NEXT_PUBLIC_GA_ID;
  const apiSecret = process.env.GA4_API_SECRET;

  if (!measurementId || !apiSecret) {
    console.warn(
      `[ga4-mp] skipped purchase txn=${opts.transactionId} — missing NEXT_PUBLIC_GA_ID or GA4_API_SECRET`,
    );
    return { ok: false, skipped: true, error: "Missing GA4 credentials" };
  }

  // client_id 必填:沒拿到 _ga 就 fallback 用 memberId / transactionId
  const clientId =
    opts.clientId ||
    (opts.memberId ? `srv_${opts.memberId}` : null) ||
    `srv_${opts.transactionId}`;

  const body: Record<string, unknown> = {
    client_id: clientId,
    events: [
      {
        name: "purchase",
        params: {
          transaction_id: opts.transactionId,
          value: opts.value,
          currency: opts.currency || "TWD",
          items: opts.items || [
            {
              item_id: opts.transactionId,
              item_name: "太平洋房屋訂閱",
              item_category: "subscription",
              price: opts.value,
              quantity: 1,
              currency: opts.currency || "TWD",
            },
          ],
        },
      },
    ],
  };

  if (opts.memberId) {
    body.user_id = opts.memberId;
  }

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    // GA4 MP 成功時回 204 No Content,失敗回 4xx
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        `[ga4-mp] FAIL purchase txn=${opts.transactionId} status=${res.status}: ${text.slice(0, 300)}`,
      );
      return { ok: false, error: `HTTP ${res.status}` };
    }
    console.log(
      `[ga4-mp] ✅ purchase txn=${opts.transactionId} value=${opts.value} clientId=${clientId.slice(0, 20)}`,
    );
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ga4-mp] EXCEPTION purchase: ${msg}`);
    return { ok: false, error: msg };
  }
}

/**
 * Generic event sender — 任意 event 名稱 + params
 *
 * 2026-05-12 系統擁有者要求:fb 自動回覆 CTA 點擊 fire view_content
 *
 * 用法:
 *   await sendGa4Event("view_content", {keyword: "客變"}, {clientId, memberId})
 */
export async function sendGa4Event(
  eventName: string,
  params: Record<string, unknown>,
  opts: {
    clientId?: string | null;
    memberId?: string | null;
    timestampMicros?: number;
    consentGranted?: boolean;
  } = {},
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const measurementId = process.env.NEXT_PUBLIC_GA_ID;
  const apiSecret = process.env.GA4_API_SECRET;

  if (!measurementId || !apiSecret) {
    console.warn(
      `[ga4-mp] skipped event=${eventName} — missing NEXT_PUBLIC_GA_ID or GA4_API_SECRET`,
    );
    return { ok: false, skipped: true, error: "Missing GA4 credentials" };
  }

  const clientId =
    opts.clientId ||
    (opts.memberId ? `srv_${opts.memberId}` : null) ||
    `srv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const body: Record<string, unknown> = {
    client_id: clientId,
    events: [{ name: eventName, params }],
  };
  if (opts.memberId) body.user_id = opts.memberId;
  if (opts.timestampMicros) body.timestamp_micros = opts.timestampMicros;
  if (opts.consentGranted) {
    body.consent = {
      ad_user_data: "GRANTED",
      ad_personalization: "GRANTED",
    };
  }

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        `[ga4-mp] FAIL event=${eventName} status=${res.status}: ${text.slice(0, 300)}`,
      );
      return { ok: false, error: `HTTP ${res.status}` };
    }
    console.log(`[ga4-mp] ✅ event=${eventName} clientId=${clientId.slice(0, 20)}`);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ga4-mp] EXCEPTION event=${eventName}: ${msg}`);
    return { ok: false, error: msg };
  }
}

/**
 * Debug 版本 — 走 /debug/mp/collect 拿驗證結果,測試 payload 對不對
 * 用法:本機 / staging 開 ?ga4_debug=1 時走這
 */
export async function sendPurchaseGa4MpDebug(opts: Ga4PurchaseInput): Promise<{
  ok: boolean;
  validation: unknown;
}> {
  const measurementId = process.env.NEXT_PUBLIC_GA_ID;
  const apiSecret = process.env.GA4_API_SECRET;
  if (!measurementId || !apiSecret) {
    return { ok: false, validation: { error: "Missing credentials" } };
  }
  const clientId =
    opts.clientId ||
    (opts.memberId ? `srv_${opts.memberId}` : `srv_${opts.transactionId}`);

  const url = `https://www.google-analytics.com/debug/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      events: [
        {
          name: "purchase",
          params: {
            transaction_id: opts.transactionId,
            value: opts.value,
            currency: opts.currency || "TWD",
            items: opts.items || [],
          },
        },
      ],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const validation = await res.json().catch(() => ({}));
  return { ok: res.ok, validation };
}
