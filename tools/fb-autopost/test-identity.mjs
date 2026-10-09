/**
 * 發文身分（多帳號）的離線測試 —— 純函式，不連資料庫、不開瀏覽器、不碰任何登入檔。
 *
 * 跑法：node test-identity.mjs
 *
 * 驗的是 2026-10-07 加「用哪個身分發」之後最不能出錯的幾件事：
 *   ・主帳號永遠存 NULL、永遠用原本的 fb-state.json（沒新增身分時行為跟以前一模一樣）
 *   ・登入代號會被拼進檔名 → 一律先驗，不合法就丟錯，**絕不退回主帳號的檔**
 *   ・桌機端（_shared.mjs，純 JS）與網站端（fb-identity-core.ts）的規則一致
 *   ・「同一個 FB 帳號登入成兩個身分」要抓得到
 */
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SANDBOX = path.join(import.meta.dirname, "test-tmp-identity");
rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(SANDBOX, { recursive: true });

// 🔴 一定要在 import _shared.mjs 之前把登入檔指進沙盒：它在載入時就把 AUTH_FILE 算好了
process.env.FB_AUTH_FILE = path.join(SANDBOX, "fb-state.json");

const core = await import(`${pathToFileURL(ROOT).href}/src/lib/fb-identity-core.ts`);
const shared = await import(`${pathToFileURL(import.meta.dirname).href}/_shared.mjs`);

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${name}${extra ? `　→ ${extra}` : ""}`);
};
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

/* ── ① 主帳號＝NULL ── */
ok("① 空值是主帳號", core.normalizeIdentityId("") === null && core.normalizeIdentityId(null) === null && core.normalizeIdentityId(undefined) === null);
ok("① 'main' 是主帳號", core.normalizeIdentityId("main") === null && core.normalizeIdentityId(" main ") === null);
ok("① 其他 id 原樣（去頭尾空白）", core.normalizeIdentityId(" abc123 ") === "abc123");
ok("① 畫面用的 id：null → main", core.identityIdForDisplay(null) === "main" && core.identityIdForDisplay("abc") === "abc");
ok("① sameIdentity：null／空／main 都算同一個", core.sameIdentity(null, "main") && core.sameIdentity("", undefined) && core.sameIdentity("main", null));
ok("① sameIdentity：不同身分不相等", !core.sameIdentity("a", "b") && !core.sameIdentity("a", null) && !core.sameIdentity("main", "a"));

/* ── ② 登入代號 ── */
for (const good of ["acct-k7m2", "a", "0abc", "a-b-c", "x".repeat(24)]) ok(`② 合法代號 ${good}`, core.isValidAuthKey(good));
for (const bad of ["", "-abc", "ABC", "a b", "a/b", "../x", "a\\b", "a.json", "x".repeat(25), "中文", null, undefined, 5]) {
  ok(`② 不合法代號 ${JSON.stringify(bad)}`, !core.isValidAuthKey(bad));
}
{
  const keys = new Set();
  for (let i = 0; i < 300; i += 1) keys.add(core.makeAuthKey());
  ok("② makeAuthKey 每個都合法", [...keys].every((k) => core.isValidAuthKey(k) && /^acct-[a-z2-9]{4}$/.test(k)));
  ok("② makeAuthKey 不含容易看錯的字（0 o 1 l i）", [...keys].every((k) => !/[01oli]/.test(k.slice(5))));
  ok("② makeAuthKey 夠分散（300 次至少 250 種）", keys.size >= 250, String(keys.size));
  // 注入亂數：固定亂數產生固定結果，且不會超出字母表
  ok("② makeAuthKey 可注入亂數（全 0 → 全是第一個字母）", core.makeAuthKey(() => 0) === "acct-aaaa");
  ok("② makeAuthKey 亂數接近 1 不會越界", core.isValidAuthKey(core.makeAuthKey(() => 0.9999999)));
}

/* ── ③ 登入檔檔名：網站端（TS）──
 *     🔴 最重要：不合法絕對丟錯，不是默默退回主帳號的檔 */
ok("③ 主帳號用原本的檔名", core.authFileNameFor(null) === "fb-state.json" && core.authFileNameFor("") === "fb-state.json" && core.authFileNameFor(undefined) === "fb-state.json");
ok("③ 其他身分 fb-state-<代號>.json", core.authFileNameFor("acct-k7m2") === "fb-state-acct-k7m2.json");
ok("③ 路徑穿越丟錯", throws(() => core.authFileNameFor("../fb-state")));
ok("③ 大寫丟錯（不默默轉成別的檔）", throws(() => core.authFileNameFor("ACCT-1")));
ok("③ 含副檔名丟錯", throws(() => core.authFileNameFor("main.json")));

/* ── ④ 登入檔路徑：桌機端（_shared.mjs，純 JS）要跟網站端一致 ── */
{
  const dir = SANDBOX;
  ok("④ 主帳號＝AUTH_FILE，一個字沒變", shared.authFileForIdentity(null) === shared.AUTH_FILE && shared.authFileForIdentity("") === shared.AUTH_FILE);
  ok("④ AUTH_FILE 真的指進沙盒（測試沒碰真的 auth/）", shared.AUTH_FILE === path.join(dir, "fb-state.json"), shared.AUTH_FILE);
  for (const k of ["acct-k7m2", "a", "x".repeat(24), "a-b-c"]) {
    ok(`④ 兩邊一致：${k}`, shared.authFileForIdentity(k) === path.join(dir, core.authFileNameFor(k)), shared.authFileForIdentity(k));
  }
  for (const bad of ["../x", "ABC", "a/b", "a b", "-x", "x".repeat(25), "a.json"]) {
    ok(`④ 桌機端不合法也丟錯：${bad}`, throws(() => shared.authFileForIdentity(bad)));
    ok(`④ 兩邊對「不合法」的判斷一致：${bad}`, !core.isValidAuthKey(bad));
  }
  ok("④ 其他身分的登入檔跟主帳號同資料夾", path.dirname(shared.authFileForIdentity("acct-1")) === path.dirname(shared.AUTH_FILE));
  ok("④ 其他身分的登入檔不等於主帳號的", shared.authFileForIdentity("acct-1") !== shared.AUTH_FILE);
}

/* ── ④b 版本錯位保險：後台回的身分要跟資料庫裡那份工作指定的一致 ── */
{
  const m = shared.identityMatchesJob;
  ok("④b 主帳號對主帳號（資料庫 null、後台沒回身分）", m(null, undefined) && m(null, null) && m("", undefined) && m(undefined, undefined));
  ok("④b 主帳號對主帳號（後台回 main）", m(null, { id: "main", authKey: null }) && m("main", { id: "main" }));
  ok("④b 其他身分對得上", m("idn-1", { id: "idn-1", authKey: "acct-aaaa" }));
  ok("④b 🔴 資料庫指定了其他身分、後台卻沒回身分（舊版後台）→ 對不上，不能當主帳號發", !m("idn-1", undefined) && !m("idn-1", null) && !m("idn-1", { id: "main" }));
  ok("④b 🔴 後台回了身分、資料庫卻是主帳號 → 對不上", !m(null, { id: "idn-1" }) && !m("main", { id: "idn-1" }));
  ok("④b 兩邊是不同的其他身分 → 對不上", !m("idn-1", { id: "idn-2" }));
  ok("④b 🔴 id 帶空白不算相等（不要寬鬆比對）", !m("idn-1", { id: "idn-1 " }));
}

/* ── ⑤ 登入狀態 ── */
{
  const now = new Date("2026-10-07T12:00:00");
  const hAgo = (h) => new Date(now.getTime() - h * 3_600_000);
  ok("⑤ 還沒回報過 → unknown", core.loginStateOf({ login_ok: null, login_checked_at: null }, now) === "unknown");
  ok("⑤ 有效且剛回報 → ok", core.loginStateOf({ login_ok: 1, login_checked_at: hAgo(0.1) }, now) === "ok");
  ok("⑤ 失效且剛回報 → missing", core.loginStateOf({ login_ok: 0, login_checked_at: hAgo(0.1) }, now) === "missing");
  ok("⑤ 超過 24 小時沒回報 → stale（就算上次是有效）", core.loginStateOf({ login_ok: 1, login_checked_at: hAgo(25) }, now) === "stale");
  ok("⑤ 剛好 24 小時內仍算有效", core.loginStateOf({ login_ok: 1, login_checked_at: hAgo(23.9) }, now) === "ok");
  ok("⑤ 字串日期也吃（資料庫回的）", core.loginStateOf({ login_ok: 1, login_checked_at: hAgo(1).toISOString() }, now) === "ok");
  ok("⑤ 狀態文字不是空的", ["ok", "missing", "stale", "unknown"].every((s) => core.loginStateLabel(s).length > 0));
}

/* ── ⑥ 同一個 FB 帳號不能存成兩個身分（c_user 比對） ── */
{
  const state = (uid) => JSON.stringify({ cookies: [{ name: "c_user", value: uid, domain: ".facebook.com", path: "/" }, { name: "xs", value: "secret", domain: ".facebook.com", path: "/" }], origins: [] });
  writeFileSync(path.join(SANDBOX, "fb-state.json"), state("1111"), "utf8");
  writeFileSync(path.join(SANDBOX, "fb-state-acct-aaaa.json"), state("2222"), "utf8");
  writeFileSync(path.join(SANDBOX, "fb-state-acct-bbbb.json"), JSON.stringify({ cookies: [{ name: "datr", value: "x" }] }), "utf8");
  writeFileSync(path.join(SANDBOX, "unrelated.json"), state("1111"), "utf8");

  ok("⑥ 讀得到帳號編號", shared.authAccountId(path.join(SANDBOX, "fb-state.json")) === "1111");
  ok("⑥ 沒登入的檔（沒有 c_user）→ null", shared.authAccountId(path.join(SANDBOX, "fb-state-acct-bbbb.json")) === null);
  ok("⑥ 檔案不存在 → null", shared.authAccountId(path.join(SANDBOX, "nope.json")) === null);

  const others = shared.otherAuthFiles(path.join(SANDBOX, "fb-state-acct-aaaa.json")).map((f) => path.basename(f)).sort();
  ok("⑥ 只掃登入檔（不含 unrelated.json）、排除自己", JSON.stringify(others) === JSON.stringify(["fb-state-acct-bbbb.json", "fb-state.json"]), JSON.stringify(others));

  // 模擬「新登入的是帳號 1111（其實是主帳號）要存成 acct-aaaa」→ 要抓到跟主帳號撞
  const dupOfMain = shared.otherAuthFiles(path.join(SANDBOX, "fb-state-acct-aaaa.json")).find((f) => shared.authAccountId(f) === "1111");
  ok("⑥ 登入成主帳號的帳號 → 抓得到撞（不准存）", path.basename(dupOfMain || "") === "fb-state.json");
  const noDup = shared.otherAuthFiles(path.join(SANDBOX, "fb-state-acct-aaaa.json")).find((f) => shared.authAccountId(f) === "3333");
  ok("⑥ 登入成全新帳號 → 不撞", noDup === undefined);
}

rmSync(SANDBOX, { recursive: true, force: true });

console.log(`\n${"─".repeat(60)}`);
if (fails.length === 0) {
  console.log(`✅ ${pass} 項全過`);
  process.exit(0);
}
console.log(`❌ ${pass} 過、${fails.length} 失敗：`);
for (const f of fails) console.log(`   ・${f}`);
process.exit(1);
