/**
 * IG／Threads 帳號連結 —— 第二步：Meta 帶著 code 跳回來，換成 60 天長效 token 存進 social_account。
 *
 * 這條網址要一字不差地登記在 Meta 開發者後台：
 *   Instagram：「Instagram → API 設定（Instagram 登入）→ 商家登入設定 → OAuth 重新導向 URI」
 *   Threads  ：「Threads 使用案例 → 設定 → 重新導向回呼網址」
 * 值就是 socialRedirectUri(platform)，後台「IG／Threads 帳號」頁有印出來給你複製。
 *
 * 一樣要是登入中的管理員（帳號連結是要綁到我們系統的，不是任何人都能綁）。
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import { isOAuthPlatform, socialExchangeCode } from "@/lib/social-publish";

function label(p: string): string {
  return p === "ig" ? "Instagram" : p === "threads" ? "Threads" : "Facebook 粉專";
}

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const origin = new URL(req.url).origin;
  // 2026-10-09：帳號都整合進「發文身分」頁
  const back = (q: string) => NextResponse.redirect(`${origin}/admin/fb/identities?${q}`);

  if (!(await isCurrentUserAdmin())) {
    return NextResponse.redirect(`${origin}/api/auth/signin?callbackUrl=${encodeURIComponent("/admin/fb/identities")}`);
  }
  const { platform } = await ctx.params;
  if (!isOAuthPlatform(platform)) return back(`error=${encodeURIComponent("平台不對")}`);

  const u = new URL(req.url);
  // Meta 那邊按「取消」或沒授權
  const err = u.searchParams.get("error") || u.searchParams.get("error_reason");
  if (err) {
    const desc = u.searchParams.get("error_description") || err;
    return back(`error=${encodeURIComponent(`${label(platform)} 授權沒完成：${desc}`)}`);
  }
  const code = u.searchParams.get("code") || "";
  const state = u.searchParams.get("state") || "";
  if (!code) return back(`error=${encodeURIComponent("Meta 沒帶 code 回來")}`);

  const jar = await cookies();
  const expected = jar.get(`social_oauth_state_${platform}`)?.value || "";
  if (!expected || expected !== state) {
    return back(`error=${encodeURIComponent("state 對不上（可能是連結逾時 10 分鐘，或不是從本站按出去的），再按一次連結")}`);
  }

  try {
    const st = await socialExchangeCode(platform, code);
    const res = back(`ok=${platform}&user=${encodeURIComponent(st.names.join("、"))}`);
    res.cookies.set(`social_oauth_state_${platform}`, "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    return back(`error=${encodeURIComponent(`${label(platform)} 換 token 失敗：${e instanceof Error ? e.message : String(e)}`)}`);
  }
}
