/**
 * 端對端測試：runner 的認領／回報迴圈
 *
 * 跑法：node test-runner-e2e.mjs
 *
 * ⭐ 用一台**假的後台**（20 行的 http server），不用開 Next.js dev server。
 *    理由很實際：這台桌機只有 8GB RAM，跑 Next.js 要吃掉 1～2GB，
 *    而我們要驗的是「runner 收到工作之後做了什麼決定」，跟後台是誰無關。
 *
 * 🔴 這裡驗的是**決定**，不是真的發文。真的發文那段要人在旁邊，
 *    用 `node runner.mjs --attended`。
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const HERE = import.meta.dirname;

/* ══════════════════════════════════════════════════════════════
 * 🔴🔴 隔離：這支測試**絕對不能碰到真的 Facebook**
 *
 * 2026-09-04 血的教訓：第一版沒做隔離，測試裡有一份 autoPublish=true 的
 * 假工作，runner 就拿著**真的登入 cookie** 去跑 `post.mjs --publish`，
 * 真的把「第一行鉤子／第二行內容。」發到本人的 FB 個人主頁上。
 *
 * 所以每一次 spawn runner 都必須帶下面這組環境變數，把四樣東西全部改道：
 *   FB_HOME       → 本機的假 FB 頁（不是 facebook.com）
 *   FB_AUTH_FILE  → 空的假 cookie（不是真帳號鑰匙）
 *   FB_POSTS_DIR  → 沙盒（不要污染真的貼文佇列）
 *   FB_SHOTS_DIR  → 沙盒
 * ══════════════════════════════════════════════════════════════ */
const SANDBOX = path.join(HERE, "test-tmp-runner");
const FAKE_FB = pathToFileURL(path.join(HERE, "test-fake-fb.html")).href;

if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(path.join(SANDBOX, "posts"), { recursive: true });
// 假的「已登入」狀態：`authSessionStatus()` 只看 cookie 的**名字**有沒有 c_user 與 xs，
// 所以值隨便填。⚠️ 這些是假值，配上 FB_HOME 指向本機假頁，碰不到任何真的東西。
writeFileSync(
  path.join(SANDBOX, "fake-auth.json"),
  JSON.stringify({
    cookies: [
      { name: "c_user", value: "0000000000", domain: ".facebook.com", path: "/" },
      { name: "xs", value: "fake-session-for-test", domain: ".facebook.com", path: "/" },
    ],
    origins: [],
  }),
  "utf8",
);

const 隔離環境 = {
  FB_HOME: FAKE_FB,
  FB_AUTH_FILE: path.join(SANDBOX, "fake-auth.json"),
  FB_POSTS_DIR: path.join(SANDBOX, "posts"),
  FB_SHOTS_DIR: path.join(SANDBOX, "shots"),
  FB_MIN_GAP_MINUTES: "0",
  FB_GROUP_GAP_MINUTES: "0",
  FB_MAX_PER_DAY: "999",
  // 🔴 Marketplace 通路（Phase 4）是**直接讀寫正式資料庫**的，假後台攔不到它。
  //    不關掉的話，跑測試會真的去認領正式排程（把 fb_task 改成 running）。
  //    這就是 2026-09-04「測試真的發了一篇廢文到 FB」的同一種形狀 ——
  //    只要測試會 spawn 真工具，每一條對外通路都要明確關掉，不能靠「剛好沒資料」。
  FB_SKIP_MARKETPLACE: "1",
  // 2026-10-05：每日官網成交檢查會寫正式 DB 的 fb_draft.pacific_*，測試一律關掉
  FB_SKIP_PACIFIC: "1",
  // 自動重新曝光會在正式 DB 排刪文＋重貼任務，測試一律關掉
  FB_SKIP_RECYCLE: "1",
  // IG／Threads（2026-09-21）也是直接讀資料庫、打官方 API 的通路，同一條規矩：測試裡明確關掉。
  //（假後台的 claim 不會回 socialTargets，理論上跑不到，但不靠「剛好沒資料」。）
  FB_SKIP_SOCIAL: "1",
  // 擬真模式的「開瀏覽器前先等 0～45 秒」在測試裡只是浪費時間（驗的是 runner 的決定，不是節奏）。
  // 其他擬真動作（滑鼠曲線、分段打字）維持開著，讓 post.mjs 在假頁面上真的走過那條路。
  FB_START_JITTER_MAX_SEC: "0",
  // 2026-10-07 發文身分：每一輪開頭回報各身分登入狀態（走後台 API，這裡是假後台，不會寫到正式資料庫）。
  // 預設關掉，免得多出一個 action 讓 ③「只有認領」那條斷言失準；⑧ 那段才明確打開來驗。
  FB_SKIP_IDENTITY_REPORT: "1",
  // 2026-10-07 發文身分：runner 認領後會拿資料庫核對「後台回的身分」（版本錯位保險）。假後台的任務 id 資料庫裡沒有，
  // 而且測試不該連到真的資料庫，所以測試一律關掉（那段邏輯的判斷式在 test-identity.mjs 用純函式驗）。
  FB_SKIP_IDENTITY_DB_CHECK: "1",
};
let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${name}${extra ? `　→ ${extra}` : ""}`);
};

/** 起一台假後台，把 runner 打過來的每個 action 都記下來。identities：問「有哪些身分」時回的清單（2026-10-07）。 */
function 假後台(job, deleteJob = null, identities = []) {
  const 收到 = [];
  const server = createServer((req, res) => {
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, pending: job ? 1 : 0 }));
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const p = JSON.parse(body || "{}");
      收到.push(p);
      res.writeHead(200, { "content-type": "application/json" });
      // claim 只給一次，第二次回空的，免得 runner 一直撈
      if (p.action === "claim") {
        const 給 = 收到.filter((x) => x.action === "claim").length === 1 ? job : null;
        res.end(JSON.stringify({ ok: true, task: 給?.task ?? null, ...(給 || {}), note: 給 ? "" : "沒有到期的工作" }));
      } else if (p.action === "claim-delete") {
        // 刪文工作也只給一次（有 identity 欄位時一起帶回去，跟真的後台一樣）
        const 給 = 收到.filter((x) => x.action === "claim-delete").length === 1 ? deleteJob : null;
        res.end(JSON.stringify({ ok: true, task: 給 ? 給.task ?? 給 : null, ...(給?.identity ? { identity: 給.identity } : {}) }));
      } else if (p.action === "identities") {
        res.end(JSON.stringify({ ok: true, identities }));
      } else {
        res.end(JSON.stringify({ ok: true }));
      }
    });
  });
  return { server, 收到 };
}

/**
 * 🔴 一定要用非同步的 spawn，不能用 spawnSync。
 *    spawnSync 會把這支測試的事件迴圈整個卡住 —— 那台假後台就永遠來不及回應，
 *    變成「runner 等後台、後台等 runner 結束」的死結。（第一版就是這樣掛住的。）
 */
function 跑runner(args, port, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, "runner.mjs"), ...args], {
      cwd: HERE,
      env: {
        ...process.env,
        ...隔離環境, // 🔴 一定要在 extraEnv 之前，但在 process.env 之後
        FB_RUNNER_URL: `http://127.0.0.1:${port}/api/fb/runner`,
        FB_RUNNER_TOKEN: "test-token-1234567890",
        ...extraEnv,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    // 只是防掛住的保險，不是效能斷言。⑥ 真的開瀏覽器走擬真打字，安靜時約 28 秒；機器忙（開著 dev server 編譯、
    // 剩不到 1GB 記憶體）時會超過 45 秒被砍，砍掉就只剩一筆 claim、其餘全沒有（2026-10-07 真的發生過兩次）。
    const kill = setTimeout(() => child.kill(), 150_000);
    child.on("close", (status) => {
      clearTimeout(kill);
      resolve({ status, stdout, stderr });
    });
  });
}

const 樣本工作 = (autoPublish) => ({
  task: { id: "task-test-0001", autoPublish },
  draft: { id: "draft-0001", title: "測試物件 768萬", postText: "第一行鉤子\n第二行內容。" },
  targets: [{ itemId: "item-1", target: "個人主頁", groupName: null }],
  photos: [],
});

async function 用假後台跑(job, args, extraEnv, deleteJob = null, identities = []) {
  const { server, 收到 } = 假後台(job, deleteJob, identities);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const run = await 跑runner(args, port, extraEnv);
  // keep-alive 的連線不主動砍掉，server.close() 會一直等下去
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  return { run, 收到, out: `${run.stdout || ""}\n${run.stderr || ""}` };
}

/* ── ① --dry：不開瀏覽器，把工作放回去 ── */
console.log("① --dry 只看不做…");
{
  const { 收到, out } = await 用假後台跑(樣本工作(true), ["--once", "--dry"]);
  const actions = 收到.map((x) => x.action);
  ok("① 有去認領", actions.includes("claim"), actions.join(","));
  ok("① 把工作放回去", actions.includes("release"), actions.join(","));
  ok("① 沒有標記失敗", !actions.includes("fail"), actions.join(","));
  ok("① 沒有回報發送結果", !actions.includes("report"), actions.join(","));
  ok("① 印出要發到哪", out.includes("個人主頁"), out.slice(0, 200));
}

/* ── ② 🔴 無人模式 ＋ 草稿模式 → 要擋下來，不能白跑 ── */
console.log("② 無人模式遇到草稿模式的工作…");
{
  const { 收到, out } = await 用假後台跑(樣本工作(false), ["--once"]);
  const actions = 收到.map((x) => x.action);
  ok("② 放回佇列而不是標失敗", actions.includes("release") && !actions.includes("fail"), actions.join(","));
  ok("② 訊息講得出原因", out.includes("草稿模式"), out.slice(0, 300));
  ok("② 有告訴人怎麼解", out.includes("--attended"), out.slice(0, 300));
  ok("② 沒有真的去跑 post.mjs", !out.includes("開啟 Facebook"), out.slice(0, 300));
  const rel = 收到.find((x) => x.action === "release");
  ok("② 放回去的備註寫得清楚", (rel?.note || "").includes("草稿模式"), rel?.note);
}

/* ── ③ 沒有工作時不要亂做事 ── */
console.log("③ 後台說沒有到期的工作…");
{
  const { 收到, out } = await 用假後台跑(null, ["--once"]);
  const actions = 收到.map((x) => x.action);
  // 只該有「問有沒有工作」這類動作，不該出現 release／fail／report／finish 這種副作用動作。
  // （2026-09-05 加了自動刪文之後，每一輪本來就會多問一次 claim-delete。）
  ok(
    "③ 只有認領、沒有其他動作",
    actions.every((a) => a === "claim" || a === "claim-delete"),
    actions.join(","),
  );
  ok("③ 有講「沒有到期的工作」", out.includes("沒有到期的工作"), out.slice(0, 200));
}

/* ── ④ 密鑰太短就不要出門 ── */
console.log("④ 密鑰太短…");
{
  // ⚠️ 這裡不能給空字串。`loadEnv()` 是「沒設過才補」，而空字串在 JS 是 falsy，
  //    會被 .env.local 裡**真正的 token** 蓋掉 —— 測試就變成拿真密鑰去跑。
  //    給一個短的（有值、但不到 16 字）才驗得到那道長度檢查。
  const { run, out } = await 用假後台跑(樣本工作(true), ["--once"], { FB_RUNNER_TOKEN: "太短了" });
  ok("④ 直接退出", run.status !== 0, `離開碼 ${run.status}`);
  ok("④ 講得出缺什麼", out.includes("FB_RUNNER_TOKEN"), out.slice(0, 200));
  ok("④ 提醒不要加 NEXT_PUBLIC_", out.includes("NEXT_PUBLIC_"), out.slice(0, 300));
}

/* ── ⑤ 出發前檢查 ── */
console.log("⑤ --ping 出發前檢查…");
{
  const { run, out } = await 用假後台跑(null, ["--ping"]);
  ok("⑤ 四項都有列出來", ["① 密鑰", "② 後台", "③ FB 登入", "④ 待辦工作"].every((k) => out.includes(k)), out.slice(0, 400));
  ok("⑤ 後台通了要顯示 ✅", out.includes("② 後台　　 ✅"), out.slice(0, 400));
  ok("⑤ 全過就回 0", run.status === 0 || out.includes("❌"), `離開碼 ${run.status}`);
  ok("⑤ 有指路到 --attended", out.includes("--attended") || out.includes("❌"), out.slice(-200));
}

/* ── ⑥ 真的走完一輪（對假 FB，不是真 FB） ── */
console.log("⑥ 真的跑一份工作（打假 FB 頁）…");
{
  const { run, 收到, out } = await 用假後台跑(樣本工作(true), ["--once", "--headless"]);
  const actions = 收到.map((x) => x.action);
  // 失敗時多帶離開碼與輸出尾段：離開碼是 null ＝ 被測試的逾時計時器砍掉（機器太忙），不是 runner 自己壞了
  const 現場 = `${actions.join(",")}｜離開碼 ${run.status}｜輸出尾段：${out.slice(-500).replace(/\s+/g, " ")}`;
  ok("⑥ 有回報發送結果", actions.includes("report"), 現場);
  const rep = 收到.find((x) => x.action === "report");
  ok("⑥ 回報成 posted", rep?.result === "posted", JSON.stringify(rep));
  ok("⑥ 全部收完會 finish", actions.includes("finish"), 現場);
  ok("⑥ 沒有標記失敗", !actions.includes("fail"), actions.join(","));
  ok("⑥ 確實有跑 post.mjs", out.includes("post.mjs"), out.slice(0, 200));
  // 🔴 最重要的一條：整輪都不該碰到真的 facebook.com
  ok("⑥ 沒有連到真的 FB", !out.includes("https://www.facebook.com"), out.slice(0, 400));
}

/* ── ⑦ 刪文工作：後台給了社團清單 → 走「你的內容」路徑（delete-group-content.mjs，對假頁面） ── */
console.log("⑦ 刪文工作走社團「你的內容」路徑（假頁面）…");
{
  // 🔴 一樣要隔離：你的內容頁、貼文頁全部指到本機假頁面，刪除紀錄寫進沙盒
  const 刪文隔離 = {
    FB_FAST: "1",
    FB_GROUP_CONTENT_URL: pathToFileURL(path.join(HERE, "test-fake-my-content.html")).href,
    FB_POST_URL_TEMPLATE: `${pathToFileURL(path.join(HERE, "test-fake-post.html")).href}?id={postId}`,
    FB_DELETED_LOG_DIR: path.join(SANDBOX, "deleted-log"),
  };
  const 刪文工作 = (autoConfirm) => ({
    id: "del-test-0001",
    title: "清水全新整理臨路美透天-698萬",
    matchText: "這間全新整理的漂亮透天，竟然只要 698 萬！",
    maxItems: 8,
    olderThanDays: null,
    groupName: null,
    groups: [{ id: "g1", name: "台中海線不動產專屬社團", url: "https://www.facebook.com/groups/633083157498896" }],
    autoConfirm,
    attempts: 1,
  });

  // 先預覽
  {
    const { 收到, out } = await 用假後台跑(null, ["--once", "--headless"], 刪文隔離, 刪文工作(false));
    const actions = 收到.map((x) => x.action);
    ok("⑦a 有去認領刪文", actions.includes("claim-delete"), actions.join(","));
    ok("⑦a 走的是你的內容路徑", out.includes("delete-group-content") || out.includes("你的內容"), out.slice(0, 600));
    ok("⑦a 真的開的是假頁面", out.includes("開啟你的內容：file:///"), out.match(/開啟你的內容.*/)?.[0] || "");
    ok("⑦a 沒有開真的 FB", !out.includes("開啟你的內容：https://www.facebook.com"), out.match(/開啟你的內容.*/)?.[0] || "");
    const fin = 收到.find((x) => x.action === "finish-delete");
    ok("⑦a 有收尾", !!fin, actions.join(","));
    ok("⑦a 預覽 2 篇、沒刪", fin?.skippedCount === 2 && fin?.deletedCount === 0, JSON.stringify(fin));
    ok("⑦a 備註講明是預覽", (fin?.note || "").includes("預覽"), fin?.note);
    ok("⑦a 沒有標記失敗", !actions.includes("fail-delete"), actions.join(","));
  }
  // 真的刪（對假頁面）
  {
    const { 收到, out } = await 用假後台跑(null, ["--once", "--headless"], 刪文隔離, 刪文工作(true));
    const actions = 收到.map((x) => x.action);
    const fin = 收到.find((x) => x.action === "finish-delete");
    // 沒收尾時把 runner 輸出尾段印出來（2026-10-09：不然只看得到 claim,claim-delete，不知道卡在哪）
    ok("⑦b 有收尾", !!fin, `${actions.join(",")} ｜ 輸出尾段：${out.slice(-900)}`);
    ok("⑦b 刪了 2 篇", fin?.deletedCount === 2, JSON.stringify(fin));
    ok("⑦b 回報的 items 有 2 筆、都帶社團", (() => { try { const it = JSON.parse(fin?.resultJson || "[]"); return it.length === 2 && it.every((i) => i.group); } catch { return false; } })(), fin?.resultJson);
    ok("⑦b 備註寫刪了幾篇", (fin?.note || "").includes("刪了 2 篇"), fin?.note);
    ok("⑦b 子工具真的走了兩次刪除", (out.match(/✅ 刪掉了/g) || []).length === 2, out.slice(-600));
    ok("⑦b 沒有開真的 FB", !out.includes("開啟你的內容：https://www.facebook.com"));
  }
}

/* ── ⑧ 發文身分（2026-10-07）：🔴 絕不拿錯帳號的登入檔去發 ──
 *
 * 每個身分有自己的登入檔（fb-state-<代號>.json，跟 FB_AUTH_FILE 同資料夾）。最不能出的事：
 *   ・第二個身分的登入檔不見了，runner 偷懶退回主帳號的檔去發 → 用 A 帳號發了 B 帳號的貼文
 *   ・代號被拼進檔名時被路徑穿越
 * 驗法：用「兩邊一邊有檔一邊沒檔」的對照，成功＝真的用了該身分自己的檔，失敗＝沒有偷用別人的。
 */
console.log("⑧ 發文身分：各用各的登入檔、絕不退回主帳號…");
{
  const 身分 = { id: "idn-test-1", kind: "personal", name: "測試第二帳號", authKey: "acct-t3st" };
  const 身分檔 = path.join(SANDBOX, "fb-state-acct-t3st.json");
  const 假登入 = (uid) =>
    JSON.stringify({
      cookies: [
        { name: "c_user", value: uid, domain: ".facebook.com", path: "/" },
        { name: "xs", value: "fake-session-for-test", domain: ".facebook.com", path: "/" },
      ],
      origins: [],
    });
  const 工作 = (identity) => ({ ...樣本工作(true), ...(identity ? { identity } : {}) });
  const 主不存在 = { FB_AUTH_FILE: path.join(SANDBOX, "no-main-auth.json") };

  // 8a：第二個身分沒有登入檔，但主帳號的檔好好的 → 一定要失敗，不能退回主帳號去發
  rmSync(身分檔, { force: true });
  {
    const { 收到, out } = await 用假後台跑(工作(身分), ["--once", "--headless"]);
    const actions = 收到.map((x) => x.action);
    const fail = 收到.find((x) => x.action === "fail");
    ok("⑧a 標記失敗", !!fail, actions.join(","));
    ok("⑧a 失敗原因點名是哪個身分", (fail?.error || "").includes("測試第二帳號"), fail?.error);
    ok("⑧a 失敗原因給出登入代號", (fail?.error || "").includes("acct-t3st"), fail?.error);
    ok("⑧a 🔴 沒有退回主帳號去發（沒回報任何發送）", !actions.includes("report") && !actions.includes("finish"), actions.join(","));
    ok("⑧a 🔴 沒有去跑 post.mjs", !out.includes("▶ post.mjs"), out.slice(0, 300));
    ok("⑧a 指路到 FB其他帳號-1登入.bat", out.includes("FB其他帳號-1登入.bat"), out.slice(0, 300));
  }

  // 8b：第二個身分有登入檔、主帳號的檔不存在 → 成功才代表真的用了第二個身分自己的檔
  writeFileSync(身分檔, 假登入("9999"), "utf8");
  {
    const { 收到, out } = await 用假後台跑(工作(身分), ["--once", "--headless"], 主不存在);
    const actions = 收到.map((x) => x.action);
    const rep = 收到.find((x) => x.action === "report");
    ok("⑧b 回報成 posted（用了該身分自己的登入檔才發得出去）", rep?.result === "posted", `${actions.join(",")} ${JSON.stringify(rep)}`);
    ok("⑧b 收尾", actions.includes("finish") && !actions.includes("fail"), actions.join(","));
    ok("⑧b 印出是哪個身分", out.includes("身分：測試第二帳號"), out.slice(0, 300));
    ok("⑧b 沒有連到真的 FB", !out.includes("https://www.facebook.com"), out.slice(0, 300));
  }

  // 8c：同樣是主帳號的檔不存在，但這份工作**沒有身分**（＝主帳號）→ 要失敗（證明 8b 不是因為「什麼檔都能過」）
  {
    const { 收到, out } = await 用假後台跑(工作(null), ["--once", "--headless"], 主不存在);
    const actions = 收到.map((x) => x.action);
    ok("⑧c 沒有身分＝主帳號，主帳號沒登入檔 → 失敗", actions.includes("fail") && !actions.includes("report"), actions.join(","));
    ok("⑧c 失敗講的是主帳號那套（不是其他身分的）", !out.includes("FB其他帳號-1登入.bat"), out.slice(0, 300));
  }

  // 8d：登入代號不合法（路徑穿越）→ 失敗，不去拼檔名
  {
    const { 收到, out } = await 用假後台跑(工作({ ...身分, authKey: "../evil" }), ["--once", "--headless"]);
    const actions = 收到.map((x) => x.action);
    const fail = 收到.find((x) => x.action === "fail");
    ok("⑧d 不合法代號 → 失敗", !!fail && !actions.includes("report"), actions.join(","));
    ok("⑧d 失敗原因講「登入代號」", (fail?.error || "").includes("登入代號"), fail?.error);
    ok("⑧d 沒有去跑 post.mjs", !out.includes("▶ post.mjs"), out.slice(0, 300));
  }

  // 8e：每一輪開頭回報各身分的登入狀態（打開 FB_SKIP_IDENTITY_REPORT 才會做）
  {
    const 清單 = [
      { id: "main", kind: "personal", name: "主帳號", authKey: null },
      { id: "idn-test-1", kind: "personal", name: "測試第二帳號", authKey: "acct-t3st" },
      { id: "idn-test-2", kind: "personal", name: "沒登入的", authKey: "acct-nolg" },
    ];
    const { 收到 } = await 用假後台跑(null, ["--once"], { FB_SKIP_IDENTITY_REPORT: "0" }, null, 清單);
    const 回報 = 收到.filter((x) => x.action === "identity-login");
    const 找 = (id) => 回報.find((x) => x.identityId === id);
    ok("⑧e 每個身分都回報一次", 回報.length === 3, JSON.stringify(回報.map((x) => x.identityId)));
    ok("⑧e 主帳號有登入 → ok:true", 找("main")?.ok === true, JSON.stringify(找("main")));
    ok("⑧e 第二帳號有登入檔 → ok:true", 找("idn-test-1")?.ok === true, JSON.stringify(找("idn-test-1")));
    ok("⑧e 沒登入檔的 → ok:false，備註講桌機上沒有", 找("idn-test-2")?.ok === false && (找("idn-test-2")?.note || "").includes("還沒有"), JSON.stringify(找("idn-test-2")));
    ok("⑧e 回報裡不含任何 cookie 值（只有數量與狀態）", !JSON.stringify(回報).includes("fake-session-for-test") && !JSON.stringify(回報).includes("9999"));
  }

  // 8f：刪文工作也要用「發文那個身分」的登入檔——刪文只刪得到登入帳號自己發的
  {
    const 刪文隔離 = {
      FB_FAST: "1",
      FB_GROUP_CONTENT_URL: pathToFileURL(path.join(HERE, "test-fake-my-content.html")).href,
      FB_POST_URL_TEMPLATE: `${pathToFileURL(path.join(HERE, "test-fake-post.html")).href}?id={postId}`,
      FB_DELETED_LOG_DIR: path.join(SANDBOX, "deleted-log"),
    };
    const 刪文 = {
      task: {
        id: "del-test-id-0001",
        title: "身分測試",
        matchText: "這間全新整理的漂亮透天，竟然只要 698 萬！",
        maxItems: 8,
        olderThanDays: null,
        groupName: null,
        groups: [{ id: "g1", name: "台中海線不動產專屬社團", url: "https://www.facebook.com/groups/633083157498896" }],
        autoConfirm: true,
        attempts: 1,
      },
      identity: 身分,
    };
    // 沒登入檔 → 不能退回主帳號
    rmSync(身分檔, { force: true });
    {
      const { 收到, out } = await 用假後台跑(null, ["--once", "--headless"], 刪文隔離, 刪文);
      const actions = 收到.map((x) => x.action);
      const fail = 收到.find((x) => x.action === "fail-delete");
      ok("⑧f 刪文：沒有該身分的登入檔 → 標記失敗", !!fail && !actions.includes("finish-delete"), actions.join(","));
      ok("⑧f 刪文：失敗原因點名身分", (fail?.error || "").includes("測試第二帳號"), fail?.error);
      ok("⑧f 🔴 刪文：沒有退回主帳號去刪", !out.includes("delete-group-content"), out.slice(0, 300));
    }
    // 有登入檔、主帳號的檔不存在 → 成功才代表用了該身分的檔
    writeFileSync(身分檔, 假登入("9999"), "utf8");
    {
      const { 收到 } = await 用假後台跑(null, ["--once", "--headless"], { ...刪文隔離, ...主不存在 }, 刪文);
      const fin = 收到.find((x) => x.action === "finish-delete");
      ok("⑧f 刪文：用該身分自己的登入檔刪成功", fin?.deletedCount === 2, JSON.stringify(fin));
    }
  }
}

/* ── 結果 ── */
console.log(`\n${"─".repeat(60)}`);
if (fails.length === 0) {
  console.log(`✅ ${pass} 項全過`);
  rmSync(SANDBOX, { recursive: true, force: true });
  process.exit(0);
}
console.log(`❌ ${pass} 過、${fails.length} 失敗：`);
for (const f of fails) console.log(`   ・${f}`);
process.exit(1);
