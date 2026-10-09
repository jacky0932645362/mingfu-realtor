/**
 * 檢查「以粉專身分發到社團」切換得過去嗎（2026-10-09）——只開瀏覽器看，什麼都不發。
 *
 * 跑法：node check-page-identity.mjs        （桌面「FB檢查粉專身分.bat」叫的就是這支）
 *
 * 對後台「發文身分」裡每一個有設定「用哪個個人帳號切換」的粉專：
 *   ① 用那個個人帳號的登入檔開瀏覽器（看得到畫面）
 *   ② 切換成粉專（cookie i_user＝粉專編號），打開 facebook.com/me
 *   ③ FB 把人轉到「現在是誰」的個人檔案——是那個粉專＝切換成功
 * 結果寫回資料庫（那個粉專身分的 login_ok／login_note，後台卡片會顯示），截圖放 shots/，
 * 也寫一份 config/page-identity-check-debug.json（不進版控）。
 *
 * 🔴 這支不發文、不點任何按鈕；排程到點真的發之前，post.mjs 每次都會再做同一個確認。
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadEnv,
  registerAliasHooks,
  authFileForIdentity,
  authSessionStatus,
  switchToPage,
  SHOTS_DIR,
  ensureDir,
  stamp,
} from "./_shared.mjs";

loadEnv();
registerAliasHooks();
const ROOT = path.resolve(import.meta.dirname, "../..");
const { listIdentities, reportIdentityLogin } = await import(`${pathToFileURL(ROOT).href}/src/lib/fb-identity.ts`);

const all = await listIdentities({ onlyActive: true });
const byId = new Map(all.map((r) => [r.id, r]));
const pages = all.filter((r) => r.kind === "page" && r.parent_identity_id);

if (!pages.length) {
  console.log("\n目前沒有任何粉專設定了「用哪個個人帳號切換發社團」。");
  console.log("到後台「FB 貼文工廠 → 發文身分」的粉專卡片選一個個人帳號，再跑這支。\n");
  process.exit(0);
}

ensureDir(SHOTS_DIR);
const results = [];
for (const pg of pages) {
  const parent = byId.get(pg.parent_identity_id);
  console.log(`\n${"─".repeat(60)}\n🔎 粉專「${pg.name}」（用「${parent?.name || "?"}」切換）`);
  let result;
  try {
    if (!parent || parent.kind !== "personal") throw new Error("設定的個人帳號不存在或不是個人帳號");
    if (!pg.page_id) throw new Error("粉專沒有編號，重新連結一次粉專");
    const file = authFileForIdentity(parent.auth_key);
    if (!authSessionStatus(file).有登入) throw new Error(`「${parent.name}」還沒登入或登入失效，先跑 FB登入 那支`);

    const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--start-maximized"] });
    try {
      const context = await browser.newContext({ storageState: file, viewport: null, locale: "zh-TW" });
      const page = await context.newPage();
      const sw = await switchToPage(context, page, { pageId: pg.page_id, pageUrl: pg.page_url });
      await page.screenshot({ path: path.join(SHOTS_DIR, `${stamp()}-粉專身分檢查-${sw.ok ? "成功" : "失敗"}.png`) }).catch(() => {});
      result = { ok: sw.ok, note: sw.ok ? `切換成功（${sw.finalUrl}）` : sw.reason };
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (e) {
    result = { ok: false, note: e instanceof Error ? e.message : String(e) };
  }
  console.log(result.ok ? `  ✅ ${result.note}` : `  ❌ ${result.note}`);
  await reportIdentityLogin(pg.id, result.ok, `粉專身分檢查：${result.note}`.slice(0, 200)).catch(() => {});
  results.push({ page: pg.name, via: parent?.name || null, ...result, at: new Date().toISOString() });
}

writeFileSync(path.join(import.meta.dirname, "config", "page-identity-check-debug.json"), JSON.stringify(results, null, 2));
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${"─".repeat(60)}\n${bad ? `❌ ${bad} 個粉專切換不過去（原因在上面），排到那些粉專的社團貼文到點會整份不發。` : "✅ 全部切換成功。"}\n`);
process.exit(0);
