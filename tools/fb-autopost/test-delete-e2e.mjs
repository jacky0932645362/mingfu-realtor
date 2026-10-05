/**
 * 端對端測試：自己蓋一張假的「活動紀錄 → 社團貼文和留言」頁，讓**真正的 delete-groups.mjs** 去跑
 *
 * 跑法：node test-delete-e2e.mjs
 *
 * ⭐ 為什麼要這樣測（照 test-post-e2e.mjs 的做法）：
 *    批次刪文比發文更不能出錯 —— 刪錯一批救不回來。所以「找 ⋯ 鈃 → 讀那一則 →
 *    篩內文／日期 → 點 ⋯ → 刪除 → 確認 → 確認少一則」這條主迴圈一定要先驗過，
 *    不能等接上真 FB 那天才發現邏輯有洞。
 *
 *    test-fake-activity-log.html 的結構跟 2026-09-02 本人抄回的真實 DOM 一樣：
 *    沒有乾淨的「列」role，程式以那顆 ⋯ 鈕（aria-label 含「社團發佈了貼文」）為錨。
 *
 * ⚠️ 這裡驗的是**程式邏輯**，不是真的 FB 的 selector。
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseFbActivityDate } from "./_shared.mjs";

const HERE = import.meta.dirname;
const SANDBOX = path.join(HERE, "test-tmp-delete");
const AUTH = path.join(SANDBOX, "fake-auth.json");
const LOGS = path.join(SANDBOX, "deleted-log");
const SHOTS = path.join(SANDBOX, "shots");
const POSTS = path.join(SANDBOX, "posts");
const FAKE_PAGE = pathToFileURL(path.join(HERE, "test-fake-activity-log.html")).href;
const BROKEN = path.join(SANDBOX, "broken-selectors.json");

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${name}${extra ? `　→ ${extra}` : ""}`);
};

if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(POSTS, { recursive: true });

writeFileSync(AUTH, JSON.stringify({ cookies: [], origins: [] }), "utf8");

// --from-post 測試用：第一行鉤子跟假頁面裡那 3 則「禾盛晶綻」對得上
writeFileSync(
  path.join(POSTS, "2026-09-02-禾盛晶綻.md"),
  ["---", "status: posted", "---", "", "🔥【禾盛晶綻電梯華廈｜關連工業區旁｜輕屋齡2房+平車】🔥", "", "💰 總價 598 萬"].join("\n"),
  "utf8",
);

// selector 壞掉測試：把「貼文更多動作」（整個流程的錨）指到不存在的東西
const realSel = JSON.parse(readFileSync(path.join(HERE, "config", "selectors.json"), "utf8"));
const brokenSel = structuredClone(realSel);
brokenSel.activity_delete.steps["貼文更多動作"].候選 = ["div.no-such-more-button"];
writeFileSync(BROKEN, JSON.stringify(brokenSel), "utf8");

function run(args, extraEnv = {}) {
  return spawnSync(process.execPath, ["delete-groups.mjs", "--headless", ...args], {
    cwd: HERE,
    encoding: "utf8",
    env: {
      ...process.env,
      FB_FAST: "1",
      FB_SKIP_AUTH_CHECK: "1",
      FB_ACTIVITY_URL: FAKE_PAGE,
      FB_AUTH_FILE: AUTH,
      FB_DELETED_LOG_DIR: LOGS,
      FB_SHOTS_DIR: SHOTS,
      FB_POSTS_DIR: POSTS,
      ...extraEnv,
    },
  });
}

function logFiles() {
  if (!existsSync(LOGS)) return { real: [], dryrun: [] };
  const all = readdirSync(LOGS).filter((f) => f.endsWith(".md"));
  return {
    real: all.filter((f) => !f.startsWith("DRYRUN-")),
    dryrun: all.filter((f) => f.startsWith("DRYRUN-")),
  };
}
const clearLogs = () => existsSync(LOGS) && rmSync(LOGS, { recursive: true, force: true });
const realLog = () => {
  const f = logFiles().real;
  return f.length ? readFileSync(path.join(LOGS, f[0]), "utf8") : "";
};
const out = (r) => `${r.stdout || ""}\n${r.stderr || ""}`;
const result = (r) => {
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT_JSON:"));
  try {
    return line ? JSON.parse(line.slice("RESULT_JSON:".length)) : null;
  } catch {
    return null;
  }
};

/* ────────────────── 0. 日期解析（純函式） ────────────────── */

console.log("⓪ 活動紀錄的日期字串解析…");
{
  const now = new Date(2026, 8, 2);
  const days = (d) => Math.round((now - d) / 86400000);
  ok("⓪ 「2026年1月5日」", days(parseFbActivityDate("2026年1月5日", now)) === 240);
  ok("⓪ 省年份的「8月15日」當今年", parseFbActivityDate("8月15日", now)?.getFullYear() === 2026);
  ok("⓪ 「3 天前」≈ 3 天", days(parseFbActivityDate("3 天前", now)) === 3);
  ok("⓪ 「昨天」≈ 1 天", days(parseFbActivityDate("昨天", now)) === 1);
  ok("⓪ 看不懂的回 null", parseFbActivityDate("社團發佈了貼文", now) === null);
  ok("⓪ 空字串回 null", parseFbActivityDate("", now) === null);
}

/* ────────────────── 1. dry-run：只看不刪 ────────────────── */

console.log("① 預設 dry-run（沒 --confirm）…");
clearLogs();
let r = run([]);
ok("① 正常結束", r.status === 0, `離開碼 ${r.status}\n${r.stdout}\n${r.stderr}`.slice(0, 700));
ok("① 讀到 19 則社團貼文（10 篇文字＋2 篇相片＋3 篇光溜溜＋4 篇第四種；留言、心情、Messenger、工具列那顆「更多選項」都不算）", /讀到 19 則/.test(r.stdout), r.stdout.match(/讀到.*/)?.[0] || "");
ok("① 講明是只看不刪", (r.stdout + r.stderr).includes("只看不刪"));
ok("① 沒有真的去刪（沒有 🗑️）", !r.stdout.includes("🗑️"));
ok("① 沒有寫『刪掉了』的紀錄檔", logFiles().real.length === 0);
ok("① 有寫一份 DRYRUN 預覽", logFiles().dryrun.length === 1);

/* ────────────────── 2. --confirm --max=2 ────────────────── */

console.log("② --confirm --max=2…");
clearLogs();
r = run(["--confirm", "--max=2", "--gap-secs=0", "--pause-secs=0"]);
ok("② 正常結束", r.status === 0, `離開碼 ${r.status}\n${r.stdout}\n${r.stderr}`.slice(0, 700));
ok("② 說刪了 2 則", /這次刪了 2 則/.test(r.stdout), r.stdout.slice(-300));
ok("② 真的點了兩次刪除", (r.stdout.match(/✅ 刪掉了/g) || []).length === 2);
{
  const body = realLog();
  ok("② 有寫一份刪除紀錄", logFiles().real.length === 1);
  ok("② 紀錄裡有兩筆", (body.match(/^## \d+\./gm) || []).length === 2, body.slice(0, 400));
  ok("② 紀錄裡有社團貼文連結", body.includes("facebook.com/groups/"), body.slice(0, 400));
}

/* ────────────────── 3. --from-post：精準到同一篇文案的所有分身 ────────────────── */

console.log("③ --from-post=2026-09-02-禾盛晶綻（3 個社團同一篇）…");
clearLogs();
r = run(["--confirm", "--from-post=2026-09-02-禾盛晶綻", "--max=50", "--gap-secs=0", "--pause-secs=0"]);
ok("③ 正常結束", r.status === 0, `離開碼 ${r.status}\n${r.stderr}`.slice(0, 500));
ok("③ 有印出比對指紋", /比對指紋.*禾盛晶綻電梯華廈/.test(r.stdout), r.stdout.slice(0, 500));
ok("③ 剛好刪 3 則（禾盛晶綻發到 3 個社團）", /這次刪了 3 則/.test(r.stdout), r.stdout.slice(-400));
{
  const body = realLog();
  ok("③ 3 筆都是禾盛晶綻", (body.match(/禾盛晶綻/g) || []).length >= 3, body.slice(0, 600));
  ok("③ 沒掃到梧棲文化路那則（內文不一樣）", !body.includes("梧棲文化路"), body.slice(0, 600));
}
ok("③ 略過的用「內文不含指定字串」", r.stdout.includes("內文不含指定字串"), r.stdout.match(/略過.*/)?.[0] || "");

/* ────────────────── 4. --match：手動比對字串 ────────────────── */

console.log("④ --match=梧棲文化路高樓（只有 1 則）…");
clearLogs();
r = run(["--confirm", "--match=梧棲文化路高樓", "--max=50", "--gap-secs=0", "--pause-secs=0"]);
ok("④ 正常結束", r.status === 0, `離開碼 ${r.status}\n${r.stderr}`.slice(0, 500));
ok("④ 只刪 1 則", /這次刪了 1 則/.test(r.stdout), r.stdout.slice(-400));
ok("④ 刪的是梧棲文化路那則", realLog().includes("梧棲文化路"), realLog().slice(0, 400));

/* ────────────────── 4b. --group：只清一個社團（2026-09-19「按社團清空」）────────────────── */

console.log("④b --group=「台中海線大小事(沙鹿 龍井 梧棲 清水 大肚)」（這個社團裡有 2 則：禾盛晶綻＋梧棲文化路）…");
clearLogs();
r = run(["--confirm", '--group=台中海線大小事(沙鹿 龍井 梧棲 清水 大肚)', "--max=50", "--gap-secs=0", "--pause-secs=0"]);
ok("④b 正常結束", r.status === 0, `離開碼 ${r.status}\n${r.stderr}`.slice(0, 500));
ok("④b 有印出社團條件", r.stdout.includes("社團＝「台中海線大小事"), r.stdout.match(/條件.*/)?.[0] || "");
ok("④b 剛好刪 2 則（這個社團收到的兩篇不同文案）", /這次刪了 2 則/.test(r.stdout), r.stdout.slice(-400));
{
  const body = realLog();
  ok("④b 有禾盛晶綻", body.includes("禾盛晶綻"), body.slice(0, 600));
  ok("④b 有梧棲文化路", body.includes("梧棲文化路"), body.slice(0, 600));
  ok("④b 沒有沙鹿店面（那則在別的社團）", !body.includes("沙鹿鎮南路"), body.slice(0, 600));
}
ok("④b 略過的用「不是指定的社團」", r.stdout.includes("不是指定的社團"), r.stdout.match(/略過.*/)?.[0] || "");

console.log("④c --group 疊 --match（AND 關係：同一個社團、同一篇內文，只剩 1 則）…");
clearLogs();
r = run([
  "--confirm",
  '--group=台中海線大小事(沙鹿 龍井 梧棲 清水 大肚)',
  "--match=禾盛晶綻電梯華廈",
  "--max=50",
  "--gap-secs=0",
  "--pause-secs=0",
]);
ok("④c 正常結束", r.status === 0, `離開碼 ${r.status}\n${r.stderr}`.slice(0, 500));
ok("④c 只刪 1 則（不是禾盛晶綻在別社團的另外 2 篇、也不是同社團的梧棲文化路）", /這次刪了 1 則/.test(r.stdout), r.stdout.slice(-400));
ok("④c 刪的是那一則", realLog().includes("禾盛晶綻"), realLog().slice(0, 400));

/* ────────────────── 5. --older-than=30：跳過近期 ────────────────── */

console.log("⑤ --older-than=30（3 則 9/2 的要跳過）…");
clearLogs();
r = run(["--confirm", "--older-than=30", "--max=50", "--gap-secs=0", "--pause-secs=0"]);
ok("⑤ 正常結束", r.status === 0, `離開碼 ${r.status}\n${r.stderr}`.slice(0, 500));
// 禾盛晶綻 3 則是「今天」(2026年9月2日) → 跳過；梧棲文化路(1月)＋店面(去年12月)＋2025 年那 5 則 → 刪
// （日期是靠「前面最近的標頭」認的——假頁面的列裡沒有日期，這條過了就代表標日期() 有效）
ok("⑤ 刪 16 則舊的", /這次刪了 16 則/.test(r.stdout), r.stdout.slice(-400));
ok("⑤ 略過 3 則近期的", /略過 3 則/.test(r.stdout), r.stdout.match(/略過.*/)?.[0] || "");

/* ────────────────── 5b. --from/--to 日期區間（2026-09-20，本人要刪 2025/5/31～7/22） ────────────────── */

console.log("⑤b --from=2025-05-31 --to=2025-07-22 預覽（同社團兩則相片貼文 aria 一樣、只有 7/20 那則在區間內）…");
clearLogs();
r = run(["--from=2025-05-31", "--to=2025-07-22", "--max=50"]);
ok("⑤b 正常結束", r.status === 0, out(r).slice(-600));
ok("⑤b 會刪 4 則（7/20 相片、7/15、6/14、5/31）", /這次會刪這 4 則/.test(r.stdout), r.stdout.slice(-700));
ok("⑤b 略過的有「不在日期區間」", r.stdout.includes("不在日期區間"), r.stdout.match(/略過.*/)?.[0] || "");
{
  const j = result(r);
  ok("⑤b RESULT_JSON previewCount=4", j?.previewCount === 4, JSON.stringify(j).slice(0, 300));
  const dates = (j?.items || []).map((i) => i.date);
  ok("⑤b 含 7/20 不含 7/30", dates.includes("2025年7月20日") && !dates.includes("2025年7月30日"), dates.join(","));
  ok("⑤b 相片貼文有帶社團名", (j?.items || []).some((i) => i.group === "台中房地產廣告專區"), JSON.stringify(j?.items?.map((i) => i.group)));
}

console.log("⑤c --from/--to --confirm（真的刪 4 則，7/30 那則同 aria 的不能被誤刪）…");
clearLogs();
r = run(["--from=2025-05-31", "--to=2025-07-22", "--max=50", "--confirm", "--gap-secs=0", "--pause-secs=0"]);
ok("⑤c 正常結束", r.status === 0, out(r).slice(-800));
ok("⑤c 刪了 4 則", /這次刪了 4 則/.test(r.stdout), r.stdout.slice(-500));
{
  const body = realLog();
  ok("⑤c 紀錄有 7/20 的相片貼文", body.includes("2025年7月20日") && body.includes("台中房地產廣告專區"), body.slice(0, 900));
  ok("⑤c 紀錄沒有 7/30 那則", !body.includes("2025年7月30日"), body.slice(0, 900));
  ok("⑤c 紀錄有 5/31、6/14、7/15", body.includes("2025年5月31日") && body.includes("2025年6月14日") && body.includes("2025年7月15日"), body.slice(0, 900));
  ok("⑤c 沒碰 2026 年的", !body.includes("2026年"), body.slice(0, 900));
}

console.log("⑤d --months=2025-07,2025-06 跳月份（假頁面照 ?year&month 只顯示那個月）…");
clearLogs();
r = run(["--months=2025-07,2025-06", "--from=2025-05-31", "--to=2025-07-22", "--max=50"]);
ok("⑤d 正常結束", r.status === 0, out(r).slice(-600));
ok("⑤d 開了兩次、網址帶月份", (r.stdout.match(/開啟活動紀錄：.*year=2025&month=7/g) || []).length === 1 && (r.stdout.match(/year=2025&month=6/g) || []).length === 1, r.stdout.match(/開啟活動紀錄.*/g)?.join(" | ") || "");
// 假頁面模擬真 FB 跳月份的怪毛病：一頁只給 2 則（7 月給 7/30、7/20 → 只有 7/20 在區間內）＋ 6 月 1 則
ok("⑤d 合計預覽 2 則（7 月頁只浮出 1 則在區間內＋6 月 1 則；5/31 不在指定月份）", result(r)?.previewCount === 2, JSON.stringify(result(r)).slice(0, 300));
ok("⑤d 有寫一份 DRYRUN", logFiles().dryrun.length === 1);

console.log("⑤e --months 給了不存在的格式要擋…");
r = run(["--months=2025/07", "--confirm"]);
ok("⑤e 被擋", r.status !== 0 && out(r).includes("YYYY-MM"), out(r).slice(0, 200));

/* ────────────────── 5f. --kinds：留言／回應也能刪（2026-09-20 本人要「貼文及留言」） ────────────────── */

console.log("⑤f --kinds=comments 只算留言（預設 posts 不能碰到留言）…");
clearLogs();
r = run(["--kinds=comments", "--from=2025-07-01", "--to=2025-07-31", "--max=50"]);
ok("⑤f 正常結束", r.status === 0, out(r).slice(-500));
ok("⑤f 只讀到 2 則留言（兩則留言／回應；心情那則不算）", /讀到 2 則/.test(r.stdout), r.stdout.match(/讀到.*/)?.[0] || "");
ok("⑤f 7 月區間內 1 則、標成〔留言〕", result(r)?.previewCount === 1 && result(r)?.items?.[0]?.date === "2025年7月26日" && /^〔留言〕/.test(result(r)?.items?.[0]?.snippet || ""), JSON.stringify(result(r)?.items));
ok("⑤f 條件列印出「留言／回應」", r.stdout.includes("留言／回應"), r.stdout.match(/條件.*/)?.[0] || "");

console.log("⑤g 預設（posts）完全不碰留言…");
clearLogs();
r = run(["--from=2025-07-01", "--to=2025-07-31", "--max=50"]);
ok("⑤g 讀到 19 則貼文（沒把 2 則留言算進來）", /讀到 19 則/.test(r.stdout), r.stdout.match(/讀到.*/)?.[0] || "");
ok("⑤g 區間外的沒細讀（標頭日期就不在 7 月的，直接當殼列）", /則標頭日期不在區間內，沒細讀/.test(r.stdout), r.stdout.match(/沒細讀.*/)?.[0] || "");
ok("⑤g 7 月區間內 3 篇貼文", /這次會刪這 3 則/.test(r.stdout), r.stdout.slice(-700));
ok("⑤g 清單裡沒有留言", !(r.stdout.includes("〔留言〕")), r.stdout.slice(-600));

console.log("⑤h --kinds=all --confirm 真的刪留言（走同一條 ⋯ → 刪除 → 確認）…");
clearLogs();
r = run(["--kinds=all", "--from=2025-07-01", "--to=2025-07-31", "--max=50", "--confirm", "--gap-secs=0", "--pause-secs=0"]);
ok("⑤h 正常結束", r.status === 0, out(r).slice(-700));
ok("⑤h 刪了 4 則（3 篇貼文＋1 則留言）", /這次刪了 4 則/.test(r.stdout), r.stdout.slice(-500));
{
  const body = realLog();
  ok("⑤h 紀錄裡有那則留言", body.includes("回應了陳葶臻的貼文"), body.slice(0, 900));
  ok("⑤h 沒碰 9 月那則回覆（不在區間）", !body.includes("王正凱"), body.slice(0, 900));
}
ok("⑤h 清單有標〔留言〕", r.stdout.includes("〔留言〕"), r.stdout.slice(-900));

console.log("⑤i --kinds=xxx 要擋…");
r = run(["--kinds=everything", "--confirm"]);
ok("⑤i 被擋", r.status !== 0 && out(r).includes("--kinds"), out(r).slice(0, 200));

/* ────────────────── 5j. --sweep：跳月份一頁只浮 2 則，要一直掃到乾淨 ────────────────── */

console.log("⑤j --months=2025-07 --sweep --confirm --kinds=all（假頁面一頁只給 2 則，要多輪才清完）…");
clearLogs();
r = run(["--months=2025-07", "--from=2025-07-01", "--to=2025-07-31", "--kinds=all", "--max=50", "--confirm", "--sweep", "--gap-secs=0", "--pause-secs=0"]);
ok("⑤j 正常結束", r.status === 0, out(r).slice(-800));
ok("⑤j 有跑第 2 輪", r.stdout.includes("第 2 輪"), r.stdout.slice(-900));
ok("⑤j 總共刪了 4 則（7/30、7/20 相片、7/15 貼文、7/26 留言）", /總共刪了 4 則|這次刪了 4 則/.test(r.stdout), r.stdout.slice(-600));
ok("⑤j 最後一輪說掃乾淨了", r.stdout.includes("掃乾淨了"), r.stdout.slice(-600));
{
  const body = realLog();
  ok("⑤j 紀錄 4 筆、序號連續到 4", (body.match(/^## \d+\./gm) || []).length === 4 && body.includes("## 4."), body.slice(0, 900));
  ok("⑤j 沒碰 6 月的", !body.includes("2025年6月"), body.slice(0, 900));
}
ok("⑤j RESULT_JSON deleted=4", result(r)?.deleted === 4, JSON.stringify(result(r)).slice(0, 200));

console.log("⑤k 沒 --sweep 時跳月份只刪浮出來的那一頁…");
clearLogs();
r = run(["--months=2025-07", "--from=2025-07-01", "--to=2025-07-31", "--kinds=all", "--max=50", "--confirm", "--gap-secs=0", "--pause-secs=0"]);
ok("⑤k 只刪 1 則（那一頁 2 則裡只有 7/20 在… 不對，kinds=all 頁上 7/30、7/20 都在區間內 → 2 則）", /這次刪了 2 則/.test(r.stdout), r.stdout.slice(-500));

console.log("⑤l 跳月份那幾個月已經空了 → 友善結束、不算錯…");
clearLogs();
r = run(["--months=2025-04", "--from=2025-04-01", "--to=2025-04-30", "--confirm", "--gap-secs=0", "--pause-secs=0"]);
ok("⑤l 離開碼 0", r.status === 0, out(r).slice(-400));
ok("⑤l 講的是「已經沒有」不是 ❌", r.stdout.includes("已經沒有") && !out(r).includes("❌"), out(r).slice(-400));
ok("⑤l RESULT_JSON deleted=0", result(r)?.deleted === 0, JSON.stringify(result(r)));

/* ────────────────── 5m. 第三種貼文：aria 只有名字（2026-09-20 8/16 那批） ────────────────── */

console.log("⑤m 光溜溜的貼文（aria 只有「更多關於蕭茗馥的選項」、同一篇發 3 個社團內文一樣）…");
clearLogs();
r = run(["--from=2025-08-16", "--to=2025-08-16", "--max=50"]);
ok("⑤m 正常結束", r.status === 0, out(r).slice(-500));
ok("⑤m 3 篇都認出來（連結不同就不是重複）", result(r)?.previewCount === 3, JSON.stringify(result(r)).slice(0, 400));
ok("⑤m 顯示時名字砍掉、社團用連結標示", (result(r)?.items || []).every((i) => /^\[groups\/\d+\] ✨超級售/.test(i.snippet)), JSON.stringify(result(r)?.items?.map((i) => i.snippet)));
ok("⑤m Messenger 那顆同名 ⋯ 沒被算進來（main 外面）", result(r)?.scanned === 19, JSON.stringify(result(r)).slice(0, 200));

console.log("⑤m2 --confirm 真的刪那 3 篇（每篇靠日期＋內文開頭重新找，三篇一樣也要刪滿 3 篇）…");
clearLogs();
r = run(["--from=2025-08-16", "--to=2025-08-16", "--max=50", "--confirm", "--gap-secs=0", "--pause-secs=0"]);
ok("⑤m2 刪了 3 則", /這次刪了 3 則/.test(r.stdout), r.stdout.slice(-500));
{
  const body = realLog();
  const links = [...new Set((body.match(/permalink\/\d+/g) || []))];
  ok("⑤m2 紀錄裡 3 個不同的 permalink", links.length === 3, body.slice(0, 900));
}

console.log("⑤n 同一社團兩篇貼文、查看連結都只是社團網址 → 不能被去重成一篇…");
clearLogs();
r = run(["--from=2025-08-13", "--to=2025-08-13", "--max=50", "--confirm", "--gap-secs=0", "--pause-secs=0"]);
ok("⑤n 刪了 2 則", /這次刪了 2 則/.test(r.stdout), r.stdout.slice(-500));
ok("⑤n 兩篇都在紀錄裡", realLog().includes("第一篇") && realLog().includes("第二篇"), realLog().slice(0, 600));

console.log("⑤o --max 超過 50 要 --force 才放行（小程式會帶）…");
clearLogs();
r = run(["--from=2025-08-16", "--to=2025-08-16", "--max=999", "--force"]);
ok("⑤o --force 放行", r.status === 0 && result(r)?.previewCount === 3, out(r).slice(-300));

/* ────────────────── 5p. 第四種貼文：aria 只有「更多選項」（2026-09-20 8/14～8/15 那 59 篇） ────────────────── */

console.log("⑤p 第四種（aria 只有「更多選項」、列裡沒有名字那行）8/14～8/15 預覽…");
clearLogs();
r = run(["--from=2025-08-14", "--to=2025-08-15", "--max=50"]);
ok("⑤p 正常結束", r.status === 0, out(r).slice(-500));
ok("⑤p 4 篇都認出來（3 篇同文案不同 permalink＋1 篇 8/14）", result(r)?.previewCount === 4, JSON.stringify(result(r)).slice(0, 500));
ok("⑤p 內文直接是貼文、社團用連結標示", (result(r)?.items || []).every((i) => /^\[groups\/\d+\] (📣 龍井|꧁ 近捷運)/.test(i.snippet)), JSON.stringify(result(r)?.items?.map((i) => i.snippet)));
ok("⑤p 4 個不同的 permalink", new Set((result(r)?.items || []).map((i) => i.link)).size === 4, JSON.stringify(result(r)?.items?.map((i) => i.link)));
ok("⑤p 工具列那顆「更多選項」沒被當成貼文（沒有連結）", !(result(r)?.items || []).some((i) => !/permalink/.test(i.link)) && result(r)?.scanned === 19, JSON.stringify(result(r)).slice(0, 300));

console.log("⑤p2 --confirm 真的刪那 4 篇（走同一條 ⋯ → 刪除 → 刪除？ 確認框）…");
clearLogs();
r = run(["--from=2025-08-14", "--to=2025-08-15", "--max=50", "--confirm", "--gap-secs=0", "--pause-secs=0"]);
ok("⑤p2 刪了 4 則", /這次刪了 4 則/.test(r.stdout), r.stdout.slice(-600));
{
  const body = realLog();
  const links = [...new Set((body.match(/permalink\/\d+/g) || []))];
  ok("⑤p2 紀錄裡 4 個不同的 permalink", links.length === 4, body.slice(0, 1200));
  ok("⑤p2 紀錄有 8/14 跟 8/15", body.includes("2025年8月14日") && body.includes("2025年8月15日"), body.slice(0, 600));
  ok("⑤p2 沒碰 8/16 光溜溜那批、也沒碰 8/13", !body.includes("2025年8月16日") && !body.includes("2025年8月13日"), body.slice(0, 900));
}

console.log("⑤p3 --kinds=comments 不會把第四種算進來…");
clearLogs();
r = run(["--kinds=comments", "--from=2025-08-14", "--to=2025-08-15", "--max=50"]);
ok("⑤p3 正常結束、0 則", r.status === 0 && (result(r)?.previewCount ?? 0) === 0, out(r).slice(-400));

/* ────────────────── 6. selector 壞掉 → 停住不亂刪 ────────────────── */

console.log("⑥ 「貼文更多動作」selector 失效…");
clearLogs();
r = run(["--confirm", "--max=50", "--gap-secs=0", "--pause-secs=0"], { FB_SELECTORS_FILE: BROKEN, FB_OWNER_NAME: "沒有這個人" });
ok("⑥ 沒有正常結束", r.status !== 0, "居然還跑完了");
ok("⑥ 有講重跑 inspect", (r.stdout + r.stderr).includes("inspect:activity"), (r.stdout + r.stderr).slice(-400));
ok("⑥ 一則都沒刪", (r.stdout.match(/✅ 刪掉了/g) || []).length === 0);
ok("⑥ 沒有寫刪除紀錄", logFiles().real.length === 0);

/* ────────────────── 7. --max 超上限 ────────────────── */

console.log("⑦ --max=80…");
clearLogs();
r = run(["--confirm", "--max=80"]);
ok("⑦ 被擋下來", r.status !== 0, "居然放行了");
ok("⑦ 講得出是上限問題", (r.stdout + r.stderr).includes("上限") && (r.stdout + r.stderr).includes("--force"));
ok("⑦ 擋在開瀏覽器之前", !r.stdout.includes("開啟活動紀錄"));

/* ────────────────── 8. 沒東西可刪時不硬做 ────────────────── */

console.log("⑧ --older-than=99999…");
clearLogs();
r = run(["--confirm", "--older-than=99999", "--gap-secs=0", "--pause-secs=0"]);
ok("⑧ 正常結束", r.status === 0, `離開碼 ${r.status}\n${r.stderr}`.slice(0, 400));
ok("⑧ 說什麼都不做", r.stdout.includes("什麼都不做"), r.stdout.slice(-300));
ok("⑧ 沒有寫紀錄檔", logFiles().real.length === 0);

/* ────────────────── 9. --from-post 邊界情況 ────────────────── */

console.log("⑨ --from-post 純 emoji 開頭要擋…");
writeFileSync(path.join(POSTS, "純emoji.md"), ["---", "status: posted", "---", "", "🔥🔥🔥", "", "內文"].join("\n"), "utf8");
r = run(["--confirm", "--from-post=純emoji", "--gap-secs=0", "--pause-secs=0"]);
ok("⑨ 被擋（去符號後太短）", r.status !== 0, "居然放行了");
ok("⑨ 講得出要改用 --match", (r.stdout + r.stderr).includes("--match"), (r.stdout + r.stderr).slice(0, 300));

console.log("⑨b --from-post 檔名不存在要報錯…");
r = run(["--confirm", "--from-post=不存在的檔", "--gap-secs=0", "--pause-secs=0"]);
ok("⑨b 被擋下來", r.status !== 0, "居然放行了");
ok("⑨b 講得出找不到檔", (r.stdout + r.stderr).includes("找不到"), (r.stdout + r.stderr).slice(0, 300));

/* ────────────────── 結果 ────────────────── */

console.log(`\n${"─".repeat(60)}`);
if (fails.length === 0) {
  console.log(`✅ ${pass} 項全過`);
  rmSync(SANDBOX, { recursive: true, force: true });
  process.exit(0);
}
console.log(`❌ ${pass} 過、${fails.length} 失敗：`);
for (const f of fails) console.log(`   ・${f}`);
console.log(`\n（沙盒留在 ${SANDBOX} 方便你看，下次跑會自己清掉）`);
process.exit(1);
