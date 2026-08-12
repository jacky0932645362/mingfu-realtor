/**
 * 輕量級 rate-limit（進程內記憶體）
 * 不用 Redis 就能擋 brute force / bot abuse
 *
 * 限制：Vercel serverless 每個 instance 各自計數，不跨實例共享。
 * 要跨實例共享得接 Upstash Redis（未接上前這個就夠）。
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// 簡單 LRU：超過 5000 個 key 就清最舊的
function gc() {
  if (buckets.size < 5000) return;
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.resetAt < now) buckets.delete(k);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetIn: number; // 毫秒
};

/**
 * @param key       識別用 (通常是 IP 或 userId)
 * @param limit     時間窗內最多幾次
 * @param windowMs  時間窗（毫秒）
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  gc();
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetIn: windowMs };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: bucket.resetAt - now,
    };
  }

  bucket.count++;
  return {
    allowed: true,
    remaining: limit - bucket.count,
    resetIn: bucket.resetAt - now,
  };
}

/** 從 Next.js Request 拿 IP */
export function getClientIp(req: Request): string {
  const headers = req.headers;
  // 2026-07-03 資安修:原本先取 x-forwarded-for 最左值 = client 可偽造(每換一個假 XFF 就拿新限速桶,
  //   列舉攻擊繞過限速)。改優先用邊緣層設定、client 無法偽造的來源:Cloudflare cf-connecting-ip(本站走 CF)
  //   > Vercel x-real-ip;x-forwarded-for 因最左可被 client 偽造,只當最後手段且取「最右側」trusted hop。
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return "unknown";
}
