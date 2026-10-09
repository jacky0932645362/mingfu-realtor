// 粉專／IG／Threads 官方 API（src/lib/social-publish.ts）的離線測試：把 fetch 換成假的，
// 檢查送出去的請求長得對不對。不連網、不碰資料庫、不會真的發文。
// 跑法：node test-social-api.mjs
import { registerAliasHooks } from "./_shared.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";

registerAliasHooks();
process.env.FB_APP_ID = "fbapp123";
process.env.FB_APP_SECRET = "fbsecret";
process.env.IG_APP_ID = "igapp";
process.env.IG_APP_SECRET = "igsecret";
process.env.SOCIAL_OAUTH_BASE_URL = "https://example-site.test";
const ROOT = path.resolve(import.meta.dirname, "../..");
const S = await import(`${pathToFileURL(ROOT).href}/src/lib/social-publish.ts`);

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${name}${extra ? `　→ ${extra}` : ""}`);
};

/* ── 假 fetch：記下每一個請求、照網址回固定答案 ── */
const calls = [];
let photoSeq = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.toString();
  const body = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : null;
  calls.push({ url, method: init.method || "GET", body });
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  // 要先比「會失敗的那個粉專」，不然會被下面一般的 /feed 先接走
  if (/\/fail\/feed$/.test(url)) return json({ error: { message: "Permissions error", code: 200 } }, 403);
  if (/\/photos$/.test(url)) return json({ id: `photo${++photoSeq}` });
  if (/\/feed$/.test(url)) return json({ id: "P1_post9" });
  if (/P1_post9/.test(url)) return json({ permalink_url: "https://www.facebook.com/P1/posts/9" });
  return json({});
};

/* ── ① 粉專動態：多張照片＝先傳未發佈照片，再一次 /feed 帶 attached_media ── */
{
  calls.length = 0;
  const r = await S.publishToPage({ userId: "P1", token: "PAGE_TOKEN" }, { message: "【覓蜜】768萬", photos: ["https://img/a.jpg", "https://img/b.jpg"] });
  const photoCalls = calls.filter((c) => /\/P1\/photos$/.test(c.url));
  const feed = calls.find((c) => /\/P1\/feed$/.test(c.url));
  ok("① 每張照片各傳一次", photoCalls.length === 2, String(photoCalls.length));
  ok("① 照片先不發佈（published=false）", photoCalls.every((c) => c.body.published === "false" && c.body.access_token === "PAGE_TOKEN"));
  ok("① 照片網址原樣帶過去", photoCalls.map((c) => c.body.url).join(",") === "https://img/a.jpg,https://img/b.jpg");
  ok("① /feed 帶內文", feed && feed.body.message === "【覓蜜】768萬");
  ok("① /feed 帶兩張 attached_media", feed && feed.body["attached_media[0]"] === JSON.stringify({ media_fbid: "photo1" }) && feed.body["attached_media[1]"] === JSON.stringify({ media_fbid: "photo2" }));
  ok("① 用粉專鑰匙", feed && feed.body.access_token === "PAGE_TOKEN");
  ok("① 打的是 Graph API 指定版本", feed && /^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/P1\/feed$/.test(feed.url), feed?.url);
  ok("① 回貼文連結", r.permalink === "https://www.facebook.com/P1/posts/9" && r.id === "P1_post9");
}

/* ── ② 粉專動態：沒照片＝只打 /feed ── */
{
  calls.length = 0;
  await S.publishToPage({ userId: "P1", token: "T" }, { message: "純文字", photos: [] });
  ok("② 沒照片不打 /photos", !calls.some((c) => /\/photos$/.test(c.url)));
  const feed = calls.find((c) => /\/feed$/.test(c.url));
  ok("② 沒有 attached_media", feed && !Object.keys(feed.body).some((k) => k.startsWith("attached_media")));
}

/* ── ③ 超過 10 張只帶 10 張；空內文擋下 ── */
{
  calls.length = 0;
  await S.publishToPage({ userId: "P1", token: "T" }, { message: "x", photos: Array.from({ length: 14 }, (_, i) => `https://img/${i}.jpg`) });
  ok("③ 最多 10 張", calls.filter((c) => /\/photos$/.test(c.url)).length === 10);
  let threw = false;
  try {
    await S.publishToPage({ userId: "P1", token: "T" }, { message: "   ", photos: [] });
  } catch {
    threw = true;
  }
  ok("③ 空內文不發", threw);
}

/* ── ④ API 回錯要講出原因（不吞） ── */
{
  let msg = "";
  try {
    await S.publishToPage({ userId: "fail", token: "T" }, { message: "x", photos: [] });
  } catch (e) {
    msg = e.message;
  }
  ok("④ 錯誤訊息帶 Meta 的原因", /Permissions error/.test(msg) && /200/.test(msg), msg);
}

/* ── ⑤ 授權網址 ── */
{
  const fb = new URL(S.socialAuthorizeUrl("fb", "STATE1"));
  ok("⑤ 粉專走 facebook.com 的 OAuth 對話框", fb.hostname === "www.facebook.com" && /\/dialog\/oauth$/.test(fb.pathname), fb.href);
  ok("⑤ 粉專用 FB_APP_ID", fb.searchParams.get("client_id") === "fbapp123");
  ok("⑤ 粉專權限含發文與列出粉專", ["pages_manage_posts", "pages_show_list"].every((p) => fb.searchParams.get("scope").split(",").includes(p)));
  ok("⑤ 回跳網址", fb.searchParams.get("redirect_uri") === "https://example-site.test/api/social/oauth/fb/callback");
  ok("⑤ state 帶著", fb.searchParams.get("state") === "STATE1");
  const ig = new URL(S.socialAuthorizeUrl("ig", "S2"));
  ok("⑤ IG 每次重選帳號（連第二組用）", ig.searchParams.get("force_reauth") === "true" && ig.searchParams.get("client_id") === "igapp");
  let threw = false;
  try {
    S.socialAuthorizeUrl("threads", "S3");
  } catch (e) {
    threw = /THREADS_APP_ID/.test(e.message);
  }
  ok("⑤ Threads 沒設定 → 講清楚缺哪個", threw);
  // 商家版應用程式（2026-10-10）：有設定組態編號就帶 config_id、不帶 scope
  process.env.FB_LOGIN_CONFIG_ID = "cfg999";
  const fbc = new URL(S.socialAuthorizeUrl("fb", "S4"));
  ok("⑤ 商家版：帶 config_id", fbc.searchParams.get("config_id") === "cfg999");
  ok("⑤ 商家版：不帶 scope", fbc.searchParams.get("scope") === null);
  delete process.env.FB_LOGIN_CONFIG_ID;
  ok("⑤ 粉專權限只要三個", fb.searchParams.get("scope").split(",").length === 3, fb.searchParams.get("scope"));
  ok("⑤ 平台判斷", S.isOAuthPlatform("fb") && S.isOAuthPlatform("ig") && !S.isOAuthPlatform("page"));
}

console.log(`\n${"─".repeat(60)}`);
if (fails.length === 0) {
  console.log(`✅ ${pass} 項全過`);
  process.exit(0);
}
console.log(`❌ ${pass} 過、${fails.length} 失敗：`);
for (const f of fails) console.log(`   ・${f}`);
process.exit(1);
