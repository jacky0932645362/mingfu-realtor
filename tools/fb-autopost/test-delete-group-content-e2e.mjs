/**
 * 端對端測試：自己蓋假的「你的內容」頁＋假的貼文頁，讓**真正的 delete-group-content.mjs** 去跑
 *
 * 跑法：node test-delete-group-content-e2e.mjs
 *
 * 照 test-delete-e2e.mjs 的做法。假頁面的結構是 2026-09-20 從真 FB 抄回來的
 * （卡片 ⋯ 沒有刪除、要進貼文 dialog、底下有別人貼文的同名 ⋯、確認框「永久刪除貼文？」）。
 * ⚠️ 這裡驗的是**程式邏輯**（找對卡片、用內文定位不拿第一顆、只刪對得上的、停在該停的地方），
 *    不是真 FB 的 selector。
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HERE = import.meta.dirname;
const SANDBOX = path.join(HERE, "test-tmp-gdel");
const AUTH = path.join(SANDBOX, "fake-auth.json");
const LOGS = path.join(SANDBOX, "deleted-log");
const SHOTS = path.join(SANDBOX, "shots");
const BROKEN = path.join(SANDBOX, "broken-selectors.json");
const CONTENT = pathToFileURL(path.join(HERE, "test-fake-my-content.html")).href;
const POST_TPL = `${pathToFileURL(path.join(HERE, "test-fake-post.html")).href}?id={postId}`;
const GROUP = "https://www.facebook.com/groups/633083157498896";

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${name}${extra ? `　→ ${extra}` : ""}`);
};

if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(SANDBOX, { recursive: true });
writeFileSync(AUTH, JSON.stringify({ cookies: [], origins: [] }), "utf8");

const realSel = JSON.parse(readFileSync(path.join(HERE, "config", "selectors.json"), "utf8"));
const brokenSel = structuredClone(realSel);
brokenSel.group_content_delete.steps["刪除選單項"].候選 = ['[role="menuitem"]:has-text("這個字不存在")'];
writeFileSync(BROKEN, JSON.stringify(brokenSel), "utf8");

function run(args, extraEnv = {}) {
  return spawnSync(process.execPath, ["delete-group-content.mjs", "--headless", ...args], {
    cwd: HERE,
    encoding: "utf8",
    env: {
      ...process.env,
      FB_FAST: "1",
      FB_SKIP_AUTH_CHECK: "1",
      FB_AUTH_FILE: AUTH,
      FB_DELETED_LOG_DIR: LOGS,
      FB_SHOTS_DIR: SHOTS,
      FB_GROUP_CONTENT_URL: CONTENT,
      FB_POST_URL_TEMPLATE: POST_TPL,
      ...extraEnv,
    },
  });
}
const out = (r) => `${r.stdout || ""}\n${r.stderr || ""}`;
const result = (r) => {
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT_JSON:"));
  try {
    return line ? JSON.parse(line.slice("RESULT_JSON:".length)) : null;
  } catch {
    return null;
  }
};
function logFiles() {
  if (!existsSync(LOGS)) return { real: [], dryrun: [] };
  const all = readdirSync(LOGS).filter((f) => f.endsWith(".md"));
  return { real: all.filter((f) => !f.startsWith("DRYRUN-")), dryrun: all.filter((f) => f.startsWith("DRYRUN-")) };
}
const clearLogs = () => existsSync(LOGS) && rmSync(LOGS, { recursive: true, force: true });
const realLog = () => {
  const f = logFiles().real;
  return f.length ? readFileSync(path.join(LOGS, f[0]), "utf8") : "";
};

/* ── ① 沒給 --group ── */
console.log("① 沒給 --group 要擋…");
let r = run(["--match=全新整理"]);
ok("① 被擋下來", r.status !== 0, "居然放行了");
ok("① 講得出要給 --group", out(r).includes("--group"));

/* ── ② dry-run ── */
console.log("② 只看不刪（--match=全新整理的漂亮透天）…");
clearLogs();
r = run([`--group=${GROUP}`, "--match=全新整理的漂亮透天", "--max=50"]);
ok("② 正常結束", r.status === 0, out(r).slice(0, 800));
ok("② 讀到 4 則", /讀到 4 則/.test(r.stdout), r.stdout.match(/讀到.*/)?.[0] || "");
ok("② 有提醒處理中 50+", r.stdout.includes("50+") && r.stdout.includes("處理中"), r.stdout.match(/讀到.*/)?.[0] || "");
ok("② 會刪 2 則（兩則同一篇文案）", /這次會刪這 2 則/.test(r.stdout), r.stdout.slice(-500));
ok("② 講明是只看不刪", r.stdout.includes("只看不刪"));
ok("② 沒有真的去刪", !r.stdout.includes("🗑️") && !r.stdout.includes("✅ 刪掉了"));
ok("② 有寫 DRYRUN 預覽", logFiles().dryrun.length === 1 && logFiles().real.length === 0);
{
  const j = result(r);
  ok("② RESULT_JSON previewCount=2", j?.previewCount === 2 && j?.deleted === 0 && j?.confirmed === false, JSON.stringify(j));
  ok("② items 是 1001 與 1003", j?.items?.map((i) => i.postId).sort().join(",") === "1001,1003", JSON.stringify(j?.items));
  ok("② 每一項都有 link 與 group", j?.items?.every((i) => i.link && i.group === GROUP), JSON.stringify(j?.items));
  ok("② scanned=4、pending=50+", j?.scanned === 4 && j?.pending === "50+", JSON.stringify(j));
}
ok("② 略過 2 則（內文不含）", /略過 2 則（內文不含指定字串）/.test(r.stdout), r.stdout.match(/略過.*/)?.[0] || "");

/* ── ③ 真的刪（同一篇文案的 2 則；底下有別人貼文的同名 ⋯ 當干擾） ── */
console.log("③ --confirm --match=全新整理的漂亮透天（要刪 2 則，不能點到別人的 ⋯）…");
clearLogs();
r = run([`--group=${GROUP}`, "--match=全新整理的漂亮透天", "--max=50", "--confirm", "--gap-secs=0", "--pause-secs=0"]);
ok("③ 正常結束", r.status === 0, out(r).slice(-900));
ok("③ 說刪了 2 則", /這次刪了 2 則/.test(r.stdout), r.stdout.slice(-500));
ok("③ 真的走了兩次刪除", (r.stdout.match(/✅ 刪掉了/g) || []).length === 2);
{
  const body = realLog();
  ok("③ 有寫刪除紀錄", logFiles().real.length === 1);
  ok("③ 紀錄裡有兩筆", (body.match(/^## \d+\./gm) || []).length === 2, body.slice(0, 500));
  ok("③ 紀錄含 1001 與 1003 的貼文網址", body.includes("id=1001") && body.includes("id=1003"), body.slice(0, 500));
  ok("③ 沒碰 1002／1004", !body.includes("id=1002") && !body.includes("id=1004"), body.slice(0, 500));
  const j = result(r);
  ok("③ RESULT_JSON deleted=2", j?.deleted === 2 && j?.confirmed === true, JSON.stringify(j));
}

/* ── ④ --max=1 只刪一則 ── */
console.log("④ --confirm --match=夕陽真美 --max=1…");
clearLogs();
r = run([`--group=${GROUP}`, "--match=夕陽真美", "--max=1", "--confirm", "--gap-secs=0", "--pause-secs=0"]);
ok("④ 正常結束", r.status === 0, out(r).slice(-600));
ok("④ 只刪 1 則", /這次刪了 1 則/.test(r.stdout), r.stdout.slice(-400));
ok("④ 刪的是 1004", realLog().includes("id=1004"), realLog().slice(0, 300));

/* ── ⑤ 沒有對得上的 ── */
console.log("⑤ --match=根本沒有這篇…");
clearLogs();
r = run([`--group=${GROUP}`, "--match=根本沒有這篇文案", "--confirm", "--gap-secs=0", "--pause-secs=0"]);
ok("⑤ 正常結束", r.status === 0, out(r).slice(-400));
ok("⑤ 說什麼都不做", r.stdout.includes("什麼都不做"));
ok("⑤ 沒有寫紀錄檔", logFiles().real.length === 0);
ok("⑤ RESULT_JSON deleted=0", result(r)?.deleted === 0);

/* ── ⑥ 選單裡找不到「刪除貼文」→ 停下來 ── */
console.log("⑥ 「刪除選單項」selector 失效…");
clearLogs();
r = run([`--group=${GROUP}`, "--match=全新整理的漂亮透天", "--confirm", "--gap-secs=0", "--pause-secs=0"], { FB_SELECTORS_FILE: BROKEN });
ok("⑥ 沒有正常結束", r.status !== 0, "居然還跑完了");
ok("⑥ 講得出是找不到刪除貼文", out(r).includes("刪除貼文"), out(r).slice(-500));
ok("⑥ 一則都沒刪成", !r.stdout.includes("✅ 刪掉了"));
ok("⑥ RESULT_JSON 有 aborted", typeof result(r)?.aborted === "string" && result(r)?.deleted === 0, JSON.stringify(result(r)));

/* ── ⑦ --max 超上限 ── */
console.log("⑦ --max=80…");
r = run([`--group=${GROUP}`, "--max=80", "--confirm"]);
ok("⑦ 被擋下來", r.status !== 0);
ok("⑦ 擋在開瀏覽器之前", !r.stdout.includes("開啟你的內容"));

/* ── ⑧ 沒 --match 也 --confirm 要有警告 ── */
console.log("⑧ 沒 --match 直接 --confirm（只看警告，不真的跑完）…");
r = run([`--group=${GROUP}`, "--confirm", "--max=1", "--gap-secs=0", "--pause-secs=0"]);
ok("⑧ 有印「全部都會刪」警告", r.stdout.includes("全部"), r.stdout.slice(0, 500));

console.log(`\n${"─".repeat(60)}`);
if (fails.length === 0) {
  console.log(`✅ ${pass} 項全過`);
  rmSync(SANDBOX, { recursive: true, force: true });
  process.exitCode = 0;
} else {
  console.log(`❌ ${pass} 過、${fails.length} 失敗：`);
  for (const f of fails) console.log(`   ・${f}`);
  console.log(`\n（沙盒留在 ${SANDBOX} 方便你看，下次跑會自己清掉）`);
  process.exitCode = 1;
}
