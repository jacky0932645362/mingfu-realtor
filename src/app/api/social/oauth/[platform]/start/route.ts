/**
 * IG／Threads 帳號連結 —— 第一步：把已登入的管理員送去 Meta 的授權畫面。
 *
 * 只有後台白名單的人能按（不然任何人都能把自己的 IG 綁進我們的系統）。
 * state 是一次性的亂數，放進 httpOnly cookie，回跳時比對防 CSRF。
 *
 * 🔴 Meta 要求 redirect_uri 是 https 而且要跟開發者後台登記的一字不差 ——
 *    所以連結帳號要在線上（Vercel）做；localhost 這一步會被 Meta 擋。
 */
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import { isSocialPlatform } from "@/lib/fb-factory";
import { socialAuthorizeUrl } from "@/lib/social-publish";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ ok: false, error: "權限不足" }, { status: 403 });
  }
  const { platform } = await ctx.params;
  if (!isSocialPlatform(platform)) {
    return NextResponse.json({ ok: false, error: "平台只能是 ig 或 threads" }, { status: 400 });
  }
  const state = randomBytes(16).toString("hex");
  let url: string;
  try {
    url = socialAuthorizeUrl(platform, state);
  } catch (e) {
    const origin = new URL(req.url).origin;
    const msg = encodeURIComponent(e instanceof Error ? e.message : "設定不完整");
    return NextResponse.redirect(`${origin}/admin/fb/social?error=${msg}`);
  }
  const res = NextResponse.redirect(url);
  res.cookies.set(`social_oauth_state_${platform}`, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
