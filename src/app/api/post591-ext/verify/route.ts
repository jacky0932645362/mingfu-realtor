/**
 * 591／樂屋上架外掛的授權驗證 API（2026-09-12）
 *
 * 外掛的 license.js 打這裡：開啟外掛頁（省流量、快取幾小時）跟每次按「上架」（一定打，
 * 順便記一次上架次數）都會呼叫。**不收物件資料、不收使用者姓名電話**——外掛本來就沒有送這些東西，
 * 只送授權碼、這台電腦的安裝編號、外掛版本、是不是「上架」這個事件。
 *
 * 🔴 這條路不走後台的 email 白名單（呼叫的是同事的瀏覽器外掛，不是登入的人）。
 *    公開端點，用 IP 限速擋濫用（同一組碼、同一支腳本本來就會常態呼叫，額度給寬一點）。
 */
import { NextResponse } from "next/server";
import { verifyLicense } from "@/lib/post591-license";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const limit = rateLimit(`post591-verify:${ip}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }
  const { key, installId, version, event } = (body || {}) as Record<string, unknown>;
  if (typeof key !== "string" || typeof installId !== "string") {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }

  try {
    const result = await verifyLicense({
      key,
      installId,
      version: typeof version === "string" ? version.slice(0, 20) : undefined,
      event: typeof event === "string" ? event.slice(0, 20) : undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error("post591-ext/verify 失敗：", e);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
