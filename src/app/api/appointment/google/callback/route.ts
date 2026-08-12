/**
 * GET /api/appointment/google/callback — Google 授權回呼,用 code 換 refresh token 存 DB
 * 🚨 只 admin(同瀏覽器 session)。換完導回 /admin/appointments?google=bound|fail
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import { exchangeCodeForToken } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";
const OAUTH_STATE_COOKIE = "appointment_google_oauth_state";

function stateMatches(received: string | null, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function redirectAndClear(back: URL): NextResponse {
  const response = NextResponse.redirect(back);
  response.cookies.set(OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/appointment/google/callback",
    maxAge: 0,
  });
  return response;
}

export async function GET(req: NextRequest) {
  const back = new URL("/admin/appointments", req.url);
  if (!(await isCurrentUserAdmin())) {
    return redirectAndClear(new URL("/admin", req.url));
  }
  const err = req.nextUrl.searchParams.get("error");
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!stateMatches(state, req.cookies.get(OAUTH_STATE_COOKIE)?.value)) {
    back.searchParams.set("google", "state_invalid");
    return redirectAndClear(back);
  }
  if (err || !code) {
    back.searchParams.set("google", "fail");
    return redirectAndClear(back);
  }
  const ok = await exchangeCodeForToken(code);
  back.searchParams.set("google", ok ? "bound" : "fail");
  return redirectAndClear(back);
}
