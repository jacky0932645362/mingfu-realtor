/**
 * GET /api/appointment/google/auth — 系統擁有者點「綁定 Google 日曆」→ 導去 Google 授權同意頁
 * 🚨 只 admin。
 */
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import { getAuthUrl, isGoogleConfigured } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";
const OAUTH_STATE_COOKIE = "appointment_google_oauth_state";

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isGoogleConfigured()) {
    return NextResponse.json(
      { error: "Google OAuth client 未設定(需 env GOOGLE_CALENDAR_CLIENT_ID/SECRET 或沿用 AUTH_GOOGLE_*)" },
      { status: 500 },
    );
  }
  const state = randomUUID().replace(/-/g, "");
  const response = NextResponse.redirect(getAuthUrl(state));
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/appointment/google/callback",
    maxAge: 10 * 60,
  });
  return response;
}
