#!/usr/bin/env node
/**
 * FB 貼文工廠 — 桌機端 runner（2026-09-03）
 *
 * 官網後台只是遙控器（Vercel 上跑不了瀏覽器）。這支才是真的會發文的那隻手：
 *
 *   後台排程 → fb_task / fb_task_item（TiDB）→ 這支撈走 → post.mjs（Playwright）→ 真的發 → 回寫 status
 *
 * 用法：
 *   node runner.mjs             常駐輪詢（無人看管）
 *   node runner.mjs --once      撈一輪就結束（給 Windows 工作排程器叫）
 *   node runner.mjs --attended  🧑 有人看著：撈一份、開瀏覽器、**停住等你按發佈**
 *   node runner.mjs --dry       只印出「會發什麼」，不開瀏覽器、不回報
 *   node runner.mjs --ping      出發前檢查（密鑰、後台、FB 登入、有沒有到期工作）
 *
 * ⭐ 第一次接真 FB 一定要用 `--attended`：
 *    無人模式下 stdin 是關的，post.mjs 的草稿模式問「按了發布沒？」會立刻收到 EOF、
 *    自動答「沒有」，瀏覽器一閃就關、整份工作被標失敗 —— 白跑一趟還留下錯誤紀錄。
 *    `--attended` 把終端機接回去，你才有機會檢查內容、自己按那一下。
 *
 * 設定（card-booking/.env.local）：
 *   FB_RUNNER_URL     後台 API，預設 http://localhost:3000/api/fb/runner
 *   FB_RUNNER_TOKEN   跟後台同一把（≥16 字）。🔴 不要加 NEXT_PUBLIC_ 前綴
 *   FB_RUNNER_POLL_MINUTES  輪詢間隔，預設 5
 *
 * ⭐ 刻意不改 post.mjs 一個字。交換格式用既有的貼文檔（posts/*.md），
 *    白撿它所有已驗證過的行為（對答案、擋 Markdown、90 分鐘間隔、社團跳過）。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  POSTS_DIR,
  PROJECT_ROOT,
  ensureDir,
  loadEnv,
  registerAliasHooks,
  parsePostFile,
  serializePostFile,
  localTimestamp,
  authSessionStatus,
  authFileForIdentity,
  identityMatchesJob,
  登入問題說明,
} from "./_shared.mjs";
// 擬真模式：認領到工作後、開瀏覽器前先隨機等 0～N 秒，讓實際開跑時間不要永遠落在排程器的 5 分鐘格線上
// （分鐘級的抖動在後台排程時就決定好、存在 fb_task_run.jitter_sec，這裡只是補秒級的那一小段）
import { startJitterSec, sleep as 睡 } from "./humanize.mjs";

loadEnv();

// Marketplace 通路（Phase 4）走「直接讀資料庫」，不經過後台 API —— 所以不需要 dev server。
// 跟 post-marketplace.mjs 同一條路（registerAliasHooks 讓裸 node 認得 @/ 別名）。
// 一般貼文與刪文維持走 API 不動。
registerAliasHooks();
const _fbFactory = await import(`${pathToFileURL(PROJECT_ROOT).href}/src/lib/fb-factory.ts`);
const {
  claimNextMarketplaceTask,
  finishMarketplaceTask,
  releaseMarketplaceTask,
  failMarketplaceTask,
  claimHoldReason,
  dueFbTasks,
  getTaskRun,
  getFbDraft,
  getFbTask,
  getDeleteTask,
} = _fbFactory;
// 發文身分（2026-10-07）：Marketplace 這條路是直接讀資料庫，身分也直接從資料庫查
const _fbIdentity = await import(`${pathToFileURL(PROJECT_ROOT).href}/src/lib/fb-identity.ts`);
const { getIdentity, listIdentities } = _fbIdentity;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const ONCE = flag("once");
const DRY = flag("dry");
const PING = flag("ping");
const HEADLESS = flag("headless");
/** 🧑 有人坐在電腦前面看著。撈一份就停，而且把終端機接給 post.mjs。 */
const ATTENDED = flag("attended");

const API = process.env.FB_RUNNER_URL || "http://localhost:3000/api/fb/runner";
const TOKEN = process.env.FB_RUNNER_TOKEN || "";
const POLL_MS = Number(process.env.FB_RUNNER_POLL_MINUTES || 5) * 60_000;
const WORKER_ID = `${process.env.COMPUTERNAME || "desktop"}-${process.pid}`;

const 等一下再試 = ["還沒隔滿", "到上限了"];
const 要人處理 = ["找不到登入狀態", "FB 不支援的格式", "沒有內文"];

/**
 * 打後台的逾時（毫秒）。
 *
 * 🔴 2026-09-08 踩到：本機 dev server 卡在啟動階段（埠有在聽、但完全不回應），
 *    `fetch` 沒有逾時就**永遠掛著**。工作排程器設的是 `MultipleInstances IgnoreNew`
 *    ——上一輪沒結束，之後每一輪都被跳過，等於整個排程安靜地停擺，而且畫面上看不出來。
 *    後台只是查資料庫，正常一兩秒內就回；給 30 秒非常夠。寧可這輪失敗、下一輪再來，
 *    也不要一個掛住的行程把整條排程堵死。
 */
const CALL_TIMEOUT_MS = Number(process.env.FB_RUNNER_TIMEOUT_MS || 30_000);

/**
 * 一份工作最多跑多久（毫秒），超過就把子行程砍掉。
 *
 * 🔴 2026-09-19 從 25 分鐘拉到 3 小時：社團間隔改成 6～14 分之後，一篇發 4 個社團就會超過 25 分
 *    （其實原本固定 8 分、4 個社團也 28 分，本來就會撞）。被砍的最壞情況是「發布已經按下去、
 *    但還沒記進檔案」→ 下一輪把同一個社團再發一次。砍子行程只該是「瀏覽器真的掛住」的最後手段，
 *    不該是正常流程會碰到的天花板。Marketplace／刪文一份工作本來就短，給 1 小時夠。
 */
const POST_JOB_TIMEOUT_MS = Number(process.env.FB_RUNNER_JOB_TIMEOUT_MINUTES || 180) * 60_000;
const SHORT_JOB_TIMEOUT_MS = 60 * 60_000;

function log(...a) {
  console.log(`[${localTimestamp()}]`, ...a);
}

/**
 * 🔴 2026-10-09 抓到的坑：刪文／發文的子程式是同步跑的（spawnSync），一跑好幾分鐘，這段時間 runner 跟後台的
 *    連線閒著；後台（或中間的伺服器）早就把閒置連線關掉了，runner 這邊卻沒察覺，下一次回報沿用那條死掉的連線
 *    → 「fetch failed」，整份工作的「收尾」就這樣掉了（刪文其實刪完了，後台卻一直以為沒做完，重新曝光會卡在刪文中）。
 *    修法：連線層級的失敗（不是後台回錯）等一秒重送一次。
 *    只對「重送也不會出事」的動作做：回報結果、收尾、放回、標失敗、身分回報。認領（claim*）絕不重送——
 *    萬一第一次其實有送到，重送會多認領一份工作。
 */
const 可以重送 = (action) => !String(action).startsWith("claim");

async function call(action, body = {}) {
  const send = () =>
    fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ action, workerId: WORKER_ID, ...body }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  let res;
  try {
    res = await send();
  } catch (e) {
    const 連線斷了 = e instanceof TypeError && /fetch failed/i.test(String(e.message));
    if (!連線斷了 || !可以重送(action)) throw e;
    await new Promise((r) => setTimeout(r, 1000));
    res = await send();
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`後台回了不是 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

/* ── 發文身分（2026-10-07）──
 * 一份工作用哪個帳號發，由後台（claim 回傳的 identity）決定；登入檔路徑由這裡用登入代號自己組
 * （網站在 Vercel，不知道桌機上的檔案）。主帳號＝原本的 AUTH_FILE，沒新增其他身分時跟以前一模一樣。
 * 🔴 任何一步算不出這個身分的登入檔，就整份工作標失敗——絕不退回主帳號去發。 */
const 主帳號身分 = { id: "main", kind: "personal", name: "主帳號", authKey: null };

function 身分資訊(identity) {
  return identity && typeof identity === "object" ? identity : 主帳號身分;
}

/** 這個身分的登入檔路徑；代號不合法會丟錯（呼叫端要接住、標失敗）。 */
function 登入檔(identity) {
  return authFileForIdentity(身分資訊(identity).authKey);
}

function 是主帳號(identity) {
  return !身分資訊(identity).authKey;
}

/** 登入有問題時給本人看的話：主帳號沿用原本那套；其他身分要講是哪一個、怎麼登入。 */
function 身分登入說明(identity, file) {
  const id = 身分資訊(identity);
  if (是主帳號(id)) return 登入問題說明(file);
  const s = authSessionStatus(file);
  return [
    `發文身分「${id.name}」${!s.檔案存在 ? "還沒存過登入狀態" : "的登入檔裡沒有真正的登入資訊（或已過期）"}。`,
    `   👉 在桌機雙擊 FB其他帳號-1登入.bat，登入代號輸入 ${id.authKey}，登入那個帳號後回視窗按 Enter。`,
  ].join("\n");
}

/** 給後台的失敗原因（會顯示在排程任務那一列）。 */
function 身分登入失敗原因(identity) {
  const id = 身分資訊(identity);
  return 是主帳號(id)
    ? "FB 登入狀態失效，要本人重跑一次登入"
    : `發文身分「${id.name}」登入狀態失效或還沒登入，要本人重跑一次登入（登入代號 ${id.authKey}）`;
}

/**
 * 子行程的環境變數：指定這份工作用的登入檔。其他（FB_HOME 等測試用的覆寫）一律原樣帶過去。
 * 以粉專身分發社團（2026-10-09）：多帶粉專編號／網址，post.mjs 會切換成粉專、確認切換成功才發。
 * 🔴 不是粉專的工作一律把這兩個清成空字串——不能讓上一層環境殘留的值害個人帳號的工作被當成粉專。
 */
function 子行程環境(file, identity) {
  const page = identity && identity.actAsPage && identity.actAsPage.pageId ? identity.actAsPage : null;
  return {
    ...process.env,
    FB_AUTH_FILE: file,
    FB_ACT_AS_PAGE_ID: page ? String(page.pageId) : "",
    FB_ACT_AS_PAGE_URL: page ? String(page.pageUrl || "") : "",
  };
}

/** 給 log 用的身分說明：粉專會多講「透過哪個個人帳號」。 */
function 身分說明(identity) {
  const id = 身分資訊(identity);
  if (id.actAsPage) return `（以粉專「${id.name}」身分，用「${id.viaName || "?"}」的登入切換）`;
  return 是主帳號(id) ? "" : `（身分：${id.name}）`;
}

/* ── 把一份工作寫成 post.mjs 看得懂的貼文檔 ── */

function 寫成貼文檔(job) {
  ensureDir(POSTS_DIR);
  const file = `task-${job.task.id.slice(0, 8)}.md`;
  const full = path.join(POSTS_DIR, file);

  let 舊meta = {};
  if (existsSync(full)) {
    try {
      舊meta = parsePostFile(readFileSync(full, "utf8")).meta || {};
    } catch {
      /* 壞了當新的寫 */
    }
  }

  const meta = {
    status: "pending",
    publishAt: localTimestamp(), // 立刻可發：後台已判定時間到了才派下來
    task: job.task.id,
    draftId: job.draft.id,
    source: `fb-factory:${job.draft.id}`,
    targets: job.targets.map((t) => t.target),
    photos: job.photos || [],
    video: job.video || "",
  };
  if (Array.isArray(舊meta.發過了) && 舊meta.發過了.length) meta.發過了 = 舊meta.發過了;
  if (Array.isArray(舊meta.跳過了) && 舊meta.跳過了.length) meta.跳過了 = 舊meta.跳過了;

  writeFileSync(full, serializePostFile(meta, job.draft.postText), "utf8");
  return { file, full };
}

function 現況(full) {
  if (!existsSync(full)) return { 發過: new Set(), 跳過: new Set() };
  const { meta } = parsePostFile(readFileSync(full, "utf8"));
  const keys = (list) =>
    new Set((Array.isArray(list) ? list : []).map((l) => String(l).split(" @ ")[0].trim()));
  return { 發過: keys(meta.發過了), 跳過: keys(meta.跳過了) };
}

function 讀回結果(full, 之前) {
  const { meta } = parsePostFile(readFileSync(full, "utf8"));
  const 拆 = (list) =>
    (Array.isArray(list) ? list : []).map((line) => {
      const [目標, 其餘 = ""] = String(line).split(" @ ");
      return { 目標: 目標.trim(), 備註: 其餘.trim() };
    });
  const 發過 = 拆(meta.發過了);
  const 跳過 = 拆(meta.跳過了);
  return {
    新發過: 發過.filter((x) => !之前.發過.has(x.目標)),
    新跳過: 跳過.filter((x) => !之前.跳過.has(x.目標)),
    全部發過: 發過,
    全部跳過: 跳過,
    收完了: meta.status === "posted",
  };
}

/** 擬真：無人模式下開瀏覽器前先等一小段。有人看著（--attended）就不演，人在等。 */
async function 擬真抖動() {
  if (ATTENDED || DRY) return;
  const 秒 = startJitterSec();
  if (秒 <= 0) return;
  log(`   ⏳ 擬真抖動：先等 ${秒} 秒再開瀏覽器`);
  await 睡(秒 * 1000);
}

/* ── 跑一份工作 ── */

async function 跑一份(job) {
  const { task, draft, targets } = job;
  const identity = 身分資訊(job.identity);
  const socialTargets = Array.isArray(job.socialTargets) ? job.socialTargets : [];
  log(`📮 「${draft.title}」→ ${targets.length + socialTargets.length} 個地方${身分說明(identity)}`);
  for (const t of socialTargets) log(`   • ${t.platform === "ig" ? "Instagram" : t.platform === "threads" ? "Threads" : "粉專動態"}（官方 API）`);
  for (const t of targets) log(`   • ${t.groupName || t.target}`);

  // 🔴 版本錯位保險：後台沒回 identity（後台還是舊版）、但資料庫裡這份工作其實指定了別的身分 → 絕不當主帳號發。
  //    連 IG／Threads 都先不發（那是主帳號專屬的，其他身分的任務本來就不該有）。測試用假後台時關掉（不碰真資料庫）。
  if (process.env.FB_SKIP_IDENTITY_DB_CHECK !== "1") {
    const dbTask = await getFbTask(task.id).catch(() => null);
    if (dbTask && !identityMatchesJob(dbTask.identity_id, job.identity)) {
      const 原因 = "後台回的發文身分跟資料庫對不上（後台可能還是舊版沒更新），為了不用錯帳號發文，這份不發";
      await call("fail", { taskId: task.id, error: 原因 });
      log(`   ❌ ${原因}`);
      return;
    }
  }

  if (DRY) {
    log("   （--dry：不開瀏覽器、不發 IG／Threads，把工作放回去）");
    await call("release", { taskId: task.id, note: "--dry 試跑" });
    return;
  }

  // IG／Threads（2026-09-21）：不開瀏覽器，直接讀資料庫用官方 API 發。跟 Marketplace 同一條「直接讀 DB」的路，
  // 不經過後台 API（照片檢查＋建容器＋發佈可能要一分鐘，Vercel 的函式撐不了那麼久）。
  // 失敗只標那一個 item，不影響後面的 FB 社團。
  if (socialTargets.length) {
    await 發到社群(task, socialTargets);
    if (targets.length === 0) {
      await call("finish", { taskId: task.id, note: `IG／Threads 發完（${socialTargets.length} 個），沒有 FB 目標` });
      log("   🎉 完成（只有 IG／Threads）");
      return;
    }
  }

  // 🔴 無人模式 ＋ 草稿模式 ＝ 一定白跑。
  //    stdin 是關的，post.mjs 問「按了發布沒？」會立刻 EOF 自動答「沒有」，
  //    瀏覽器一閃就關、一個都沒發成功，最後整份工作被標失敗。
  //    與其跑完才失敗，不如現在就放回去講清楚。
  //    ⚠️ 這個判斷要排在「檢查 FB 登入」之前 —— 反正不會跑，不用先抱怨登入過期。
  if (!task.autoPublish && !ATTENDED) {
    const 說明 = "這份工作是「草稿模式」（發布那下要人按），但 runner 現在是無人模式。";
    log(`   ⏸ ${說明}`);
    log(`      要嘛在後台把它改成「自動發佈」，要嘛用 node runner.mjs --attended 在旁邊看著跑。`);
    await call("release", { taskId: task.id, note: `${說明}放回佇列，沒有動它` });
    return;
  }

  // 🔴 用哪個身分的登入檔，算不出來（代號不合法）或登入無效就整份標失敗，絕不退回主帳號去發
  let authFile;
  try {
    authFile = 登入檔(identity);
  } catch (e) {
    await call("fail", { taskId: task.id, error: `發文身分「${identity.name}」的登入代號有問題：${e.message}`.slice(0, 400) });
    log(`   ❌ ${e.message} → 標記失敗`);
    return;
  }
  if (!authSessionStatus(authFile).有登入) {
    console.error(身分登入說明(identity, authFile));
    await call("fail", { taskId: task.id, error: 身分登入失敗原因(identity) });
    return;
  }

  await 擬真抖動();

  const { file, full } = 寫成貼文檔(job);
  const 之前 = 現況(full);

  const args = [path.join(import.meta.dirname, "post.mjs"), file];
  if (task.autoPublish) args.push("--publish");
  if (HEADLESS && !ATTENDED) args.push("--headless");

  log(`   ▶ post.mjs ${file}${task.autoPublish ? " --publish" : "（草稿模式，最後那下你自己按）"}`);

  // stdin：無人模式給 "ignore"（排程器沒有終端機，waitForEnter 遇到 EOF 才會回、不會卡死）；
  //        --attended 則整個接給 post.mjs，人才按得到那一下。
  const run = ATTENDED
    ? spawnSync(process.execPath, args, {
        cwd: import.meta.dirname,
        stdio: "inherit",
        timeout: POST_JOB_TIMEOUT_MS,
        env: 子行程環境(authFile, identity),
      })
    : spawnSync(process.execPath, args, {
        cwd: import.meta.dirname,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: POST_JOB_TIMEOUT_MS,
        env: 子行程環境(authFile, identity),
      });

  // --attended 走 inherit，輸出已經直接印在畫面上，這裡拿不到字串。
  // 後面的判斷改成只看檔案裡真的寫了什麼（那才是事實）。
  const out = ATTENDED ? "" : `${run.stdout || ""}\n${run.stderr || ""}`;
  if (!ATTENDED) process.stdout.write(out);

  const 結果 = existsSync(full)
    ? 讀回結果(full, 之前)
    : { 新發過: [], 新跳過: [], 全部發過: [], 全部跳過: [], 收完了: false };

  // 先把真的發生的事回報到 fb_task_item（就算整份工作最後標失敗，
  // 已發出去的那幾個也必須留紀錄，否則下次會重複發）。
  const byTarget = new Map(targets.map((t) => [t.target, t]));
  for (const x of 結果.新發過) {
    const t = byTarget.get(x.目標);
    if (t) {
      await call("report", { itemId: t.itemId, result: "posted", note: x.備註 || null });
      log(`   ✅ ${t.groupName || x.目標}`);
    }
  }
  for (const x of 結果.新跳過) {
    const t = byTarget.get(x.目標);
    if (t) {
      await call("report", { itemId: t.itemId, result: "skipped", note: x.備註 || "沒有一般發文框" });
      log(`   ⏭ ${t.groupName || x.目標}`);
    }
  }

  if (結果.收完了) {
    await call("finish", {
      taskId: task.id,
      note: `發了 ${結果.全部發過.length} 個、跳過 ${結果.全部跳過.length} 個`,
    });
    try {
      unlinkSync(full);
    } catch {
      /* 刪不掉沒關係 */
    }
    log(`   🎉 完成`);
    return;
  }

  if (等一下再試.some((k) => out.includes(k))) {
    const 原因 = out.includes("還沒隔滿") ? "離上一篇還沒隔滿間隔" : "今天發文次數到上限";
    await call("release", { taskId: task.id, note: `${原因}，等下一輪` });
    log(`   ⏸ ${原因} → 放回佇列`);
    return;
  }

  if (要人處理.some((k) => out.includes(k))) {
    const 原因 = 要人處理.find((k) => out.includes(k));
    await call("fail", { taskId: task.id, error: `${原因}（要本人處理，不重試）` });
    log(`   ❌ ${原因} → 標記失敗`);
    return;
  }

  if (結果.新發過.length > 0) {
    await call("release", { taskId: task.id, note: `已發 ${結果.全部發過.length} 個，還沒收完` });
    log(`   ⏸ 部分完成，剩下的下一輪`);
    return;
  }

  // 🔴 有人看著的時候「一個都沒發」多半是**他自己決定不發**，不是壞掉。
  //    標成 failed 會害這份工作再也撈不到，所以放回去就好。
  if (ATTENDED) {
    await call("release", {
      taskId: task.id,
      note: "有人看著跑，但這次沒有發出去（可能是你決定先不發），放回佇列",
    });
    log(`   ⏸ 這次沒發出去 → 放回佇列，之後還撈得到`);
    return;
  }

  await call("fail", { taskId: task.id, error: (run.stderr || run.stdout || "post.mjs 沒有輸出").trim().slice(-400) });
  log(`   ❌ 一個都沒發成功 → 標記失敗`);
}

/* ── IG／Threads：直接 import src/lib/social-publish.ts（跟 fb-factory 同一招） ── */

let _socialPublish = null;
async function 發到社群(task, socialTargets) {
  if (process.env.FB_SKIP_SOCIAL === "1") {
    log("   （FB_SKIP_SOCIAL=1，跳過 IG／Threads，這些目標留著下一輪）");
    return;
  }
  try {
    _socialPublish ??= await import(`${pathToFileURL(PROJECT_ROOT).href}/src/lib/social-publish.ts`);
    const outcomes = await _socialPublish.publishSocialItemsForTask(task.id);
    for (const o of outcomes) {
      const name = `${o.platform === "ig" ? "Instagram" : o.platform === "threads" ? "Threads" : "粉專"}「${o.identityName}」`;
      if (o.ok) log(`   ✅ ${name}：${o.url || o.note}`);
      else log(`   ❌ ${name}：${o.note.split(/\r?\n/)[0]}（已標失敗，不重試；改好後在貼文庫那則的 ${name} 分頁按「現在就發」）`);
    }
    if (!outcomes.length) log(`   ⚠ IG／Threads 目標一個都沒處理到（${socialTargets.length} 個 pending？）`);
  } catch (e) {
    // 整段炸掉（例如資料庫連不上）：不動 item，下一輪再來
    log(`   ⚠ IG／Threads 這輪沒發成：${e.message.slice(0, 160)}`);
  }
}

/* ── 跑一份 Marketplace 工作（Phase 4；沿用 post-marketplace.mjs，一個字不改） ──
 *
 * 跟一般貼文不同：認領／回報直接讀寫資料庫（fb-factory），不經過後台 API。
 * post-marketplace.mjs --publish 成功時自己就把 fb_draft.marketplace_status 標 posted 了，
 * 這裡負責收 fb_task / fb_task_run。
 */
async function 跑一份Marketplace(task) {
  const run = await getTaskRun(task.id);
  const crosspost = run?.crosspost === 1;
  const draft = await getFbDraft(task.draft_id).catch(() => null);

  // 發文身分（2026-10-07）：身分被停用／刪掉／不是個人帳號 → 整份標失敗，不退回主帳號
  const idRow = await getIdentity(task.identity_id).catch(() => null);
  const identity = idRow ? { id: idRow.id, kind: idRow.kind, name: idRow.name, authKey: idRow.auth_key } : null;
  log(
    `🛒 Marketplace：「${draft?.title || task.draft_id}」${crosspost ? "（含勾社團）" : "（只上 Marketplace）"}` +
      `${identity && !是主帳號(identity) ? `（身分：${identity.name}）` : ""}`,
  );
  if (!identity || idRow.is_active !== 1 || idRow.kind !== "personal") {
    const 原因 = !identity
      ? `發文身分已經被刪掉了（${task.identity_id}），這筆沒發`
      : idRow.is_active !== 1
        ? `發文身分「${identity.name}」已停用，這筆沒發`
        : `發文身分「${identity.name}」不是個人帳號，Marketplace 發不了`;
    await failMarketplaceTask(task.id, 原因, 1);
    log(`   ❌ ${原因}`);
    return;
  }

  if (DRY) {
    log("   （--dry：不開瀏覽器，把工作放回去）");
    await releaseMarketplaceTask(task.id, "--dry 試跑");
    return;
  }

  let authFile;
  try {
    authFile = 登入檔(identity);
  } catch (e) {
    await failMarketplaceTask(task.id, `發文身分「${identity.name}」的登入代號有問題：${e.message}`, 1);
    log(`   ❌ ${e.message} → 標記失敗`);
    return;
  }
  if (!authSessionStatus(authFile).有登入) {
    console.error(身分登入說明(identity, authFile));
    await failMarketplaceTask(task.id, 身分登入失敗原因(identity), 1);
    return;
  }

  await 擬真抖動();

  const args = [
    path.join(import.meta.dirname, "post-marketplace.mjs"),
    `--draft=${task.draft_id}`,
    "--publish",
  ];
  if (crosspost) args.push("--crosspost");
  if (HEADLESS && !ATTENDED) args.push("--headless");

  log(`   ▶ post-marketplace.mjs --publish${crosspost ? " --crosspost" : ""}`);

  const r = ATTENDED
    ? spawnSync(process.execPath, args, {
        cwd: import.meta.dirname,
        stdio: "inherit",
        timeout: SHORT_JOB_TIMEOUT_MS,
        env: 子行程環境(authFile),
      })
    : spawnSync(process.execPath, args, {
        cwd: import.meta.dirname,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: SHORT_JOB_TIMEOUT_MS,
        env: 子行程環境(authFile),
      });

  const out = ATTENDED ? "" : `${r.stdout || ""}\n${r.stderr || ""}`;
  if (!ATTENDED) process.stdout.write(out);

  if (r.status === 0) {
    await finishMarketplaceTask(task.id, crosspost ? "已發佈（含社團）" : "已發佈到 Marketplace");
    log(`   🎉 完成`);
    return;
  }

  // post-marketplace.mjs 開瀏覽器前就會擋的那幾種（狀況沒選、門牌外洩、Markdown、登入、沒照片）——
  // 重試也是同樣結果，直接標失敗、不重試，要本人回貼文庫改。
  const 要人改 = ["沒有選「狀況」", "沒過合規檢查", "FB 不支援的語法", "登出畫面", "沒有照片可以上傳"];
  const 訊息 = (r.stderr || r.stdout || out || "post-marketplace.mjs 沒有輸出").trim().slice(-400);
  if (要人改.some((k) => 訊息.includes(k))) {
    await failMarketplaceTask(task.id, 訊息, 1);
    log(`   ❌ 要先回貼文庫改內容 → 標記失敗（不重試）`);
    return;
  }
  await failMarketplaceTask(task.id, 訊息);
  log(`   ❌ 發失敗 → 試 ${run?.attempts ?? 1}/3`);
}

/* ── 跑一份刪除工作（自動刪文） ──
 *
 * 2026-09-20 起分兩條路：
 *   ① 後台知道這篇發到哪些社團（task.groups 有東西）→ 一個社團開一次「你的內容」用 delete-group-content.mjs 刪。
 *      🔴 這是主路徑：帶照片的社團貼文**不會出現在活動紀錄**，舊路徑找不到（9/19 三次都 0 篇就是這樣）。
 *   ② 不知道發到哪（groups 空的，例如另一台發的、fb_task_item 沒紀錄）→ 退回舊的活動紀錄路徑 delete-groups.mjs。
 */

async function 跑一份刪除(task, identityRaw) {
  const identity = 身分資訊(identityRaw);
  // 🔴 版本錯位保險（同 跑一份）：後台回的身分要跟資料庫裡這份刪文工作的身分一致，對不上就不刪
  if (process.env.FB_SKIP_IDENTITY_DB_CHECK !== "1") {
    const dbTask = await getDeleteTask(task.id).catch(() => null);
    if (dbTask && !identityMatchesJob(dbTask.identity_id, identityRaw)) {
      const 原因 = "後台回的發文身分跟資料庫對不上（後台可能還是舊版沒更新），為了不用錯帳號刪文，這份不刪";
      await call("fail-delete", { taskId: task.id, error: 原因 });
      log(`   ❌ ${原因}`);
      return;
    }
  }
  const 指紋短版 = task.matchText.length > 24 ? `${task.matchText.slice(0, 24)}…` : task.matchText;
  const groups = Array.isArray(task.groups) ? task.groups.filter((g) => g && g.url) : [];
  log(
    `🗑️  「${task.title}」→ 比對「${指紋短版}」` +
      (groups.length ? `，到 ${groups.length} 個社團的「你的內容」找` : task.groupName ? `（只限社團：${task.groupName}，走活動紀錄）` : "（走活動紀錄）") +
      `，每個地方最多 ${task.maxItems} 篇${是主帳號(identity) ? "" : `（身分：${identity.name}）`}`,
  );

  if (DRY) {
    log("   （--dry：不開瀏覽器，把工作放回去）");
    await call("release-delete", { taskId: task.id, note: "--dry 試跑" });
    return;
  }

  // 🔴 刪文一定要用「當初發文的那個帳號」登入——活動紀錄／你的內容只看得到登入帳號自己發的
  let authFile;
  try {
    authFile = 登入檔(identity);
  } catch (e) {
    await call("fail-delete", { taskId: task.id, error: `發文身分「${identity.name}」的登入代號有問題：${e.message}`.slice(0, 400) });
    log(`   ❌ ${e.message} → 標記失敗`);
    return;
  }
  if (!authSessionStatus(authFile).有登入) {
    console.error(身分登入說明(identity, authFile));
    await call("fail-delete", { taskId: task.id, error: 身分登入失敗原因(identity) });
    return;
  }

  if (groups.length) return 跑社團你的內容路徑(task, groups, authFile);
  return 跑活動紀錄路徑(task, authFile);
}

/** 從子行程輸出裡撈 RESULT_JSON:{...}。解不出來回 null。 */
function 讀結果行(out) {
  const line = String(out || "")
    .split("\n")
    .find((l) => l.startsWith("RESULT_JSON:"));
  if (!line) return null;
  try {
    return JSON.parse(line.slice("RESULT_JSON:".length));
  } catch {
    return null;
  }
}

/* ── 主路徑：社團「你的內容」（delete-group-content.mjs），一個社團跑一次 ── */

async function 跑社團你的內容路徑(task, groups, authFile) {
  const 合計 = { deleted: 0, previewCount: 0, scanned: 0, pending: [], items: [], 失敗: [], 跑完幾個: 0 };

  for (const [i, g] of groups.entries()) {
    const args = [
      path.join(import.meta.dirname, "delete-group-content.mjs"),
      `--group=${g.url}`,
      `--match=${task.matchText}`,
      `--max=${task.maxItems}`,
    ];
    if (task.autoConfirm) args.push("--confirm");
    if (HEADLESS && !ATTENDED) args.push("--headless");
    log(`   ▶ [${i + 1}/${groups.length}] ${g.name || g.url}${task.autoConfirm ? " --confirm" : "（先看不刪，只產生預覽）"}`);

    const run = ATTENDED
      ? spawnSync(process.execPath, args, {
          cwd: import.meta.dirname,
          stdio: "inherit",
          timeout: SHORT_JOB_TIMEOUT_MS,
          env: 子行程環境(authFile),
        })
      : spawnSync(process.execPath, args, {
          cwd: import.meta.dirname,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: SHORT_JOB_TIMEOUT_MS,
          env: 子行程環境(authFile),
        });

    if (ATTENDED) {
      // inherit 拿不到字串，信任結束碼；實際刪了幾篇看 deleted-log
      if (run.status === 0) 合計.跑完幾個++;
      else 合計.失敗.push(`${g.name || g.url}：沒有跑完（離開碼 ${run.status}）`);
    } else {
      const out = `${run.stdout || ""}\n${run.stderr || ""}`;
      process.stdout.write(out);
      const result = 讀結果行(out);
      if (!result) {
        合計.失敗.push(`${g.name || g.url}：${(run.stderr || run.stdout || "沒有輸出").trim().slice(-160)}`);
      } else {
        合計.跑完幾個++;
        if (result.aborted) 合計.失敗.push(`${g.name || g.url}：${result.aborted}`);
        合計.deleted += result.deleted || 0;
        合計.previewCount += result.previewCount || 0;
        合計.scanned += result.scanned || 0;
        if (result.pending) 合計.pending.push(`${g.name || g.url} ${result.pending}`);
        for (const it of result.items || []) 合計.items.push({ ...it, groupName: g.name || null });
      }
    }

    // 不同社團之間也隔一下——同一顆帳號連續在好幾個社團刪文，一樣是機器的節奏
    if (i < groups.length - 1 && !process.env.FB_FAST) await 睡(3000 + Math.random() * 4000);
  }

  const 失敗摘要 = 合計.失敗.length ? `；${合計.失敗.length} 個社團沒跑完：${合計.失敗[0]}${合計.失敗.length > 1 ? "…" : ""}` : "";
  const 待審 = 合計.pending.length ? `；另有等審核中的（${合計.pending.slice(0, 3).join("、")}）這條路刪不到` : "";

  if (ATTENDED) {
    if (合計.跑完幾個 > 0) {
      await call("finish-delete", {
        taskId: task.id,
        deletedCount: 0,
        skippedCount: 0,
        resultJson: null,
        note: `有人看著跑完 ${合計.跑完幾個}/${groups.length} 個社團，實際刪了幾篇看 tools/fb-autopost/deleted-log/${失敗摘要}`,
      });
      log(`   🎉 完成（有人看著跑，數字看 deleted-log）`);
    } else {
      await call("release-delete", { taskId: task.id, note: "有人看著跑，這次沒有跑完（可能是你中止的），放回佇列" });
      log(`   ⏸ 沒有跑完 → 放回佇列`);
    }
    return;
  }

  // 每一個社團都沒跑出結果 → 整份標失敗（會重試到上限）
  if (合計.跑完幾個 === 0) {
    await call("fail-delete", { taskId: task.id, error: `全部 ${groups.length} 個社團都沒跑出結果：${合計.失敗[0] || "不明"}`.slice(0, 400) });
    log(`   ❌ 全部社團都沒跑出結果 → 標記失敗`);
    return;
  }

  await call("finish-delete", {
    taskId: task.id,
    deletedCount: 合計.deleted,
    skippedCount: task.autoConfirm ? 0 : 合計.previewCount,
    resultJson: JSON.stringify(合計.items),
    note:
      (task.autoConfirm
        ? `在 ${合計.跑完幾個} 個社團的「你的內容」刪了 ${合計.deleted} 篇`
        : `只做了預覽（${合計.previewCount} 篇待刪，在 ${合計.跑完幾個} 個社團），沒有真的刪 —— 自動確認沒開`) +
      失敗摘要 +
      待審,
  });
  log(`   🎉 完成（${task.autoConfirm ? `刪了 ${合計.deleted} 篇` : `預覽 ${合計.previewCount} 篇`}${失敗摘要}）`);
}

/* ── 舊路徑：活動紀錄（delete-groups.mjs）。只有「不知道發到哪個社團」時才走；帶照片的貼文這條看不到。 ── */

async function 跑活動紀錄路徑(task, authFile) {
  const args = [
    path.join(import.meta.dirname, "delete-groups.mjs"),
    `--match=${task.matchText}`,
    `--max=${task.maxItems}`,
  ];
  // 「按社團清空」排的任務（後台 quickDeleteGroupAction）：只清這一個社團的，
  // 跟 --match 是 AND 關係——不會因此放寬去刪別的社團或別篇內文不對的貼文。
  if (task.groupName) args.push(`--group=${task.groupName}`);
  if (task.olderThanDays != null) args.push(`--older-than=${task.olderThanDays}`);
  if (task.autoConfirm) args.push("--confirm");
  if (HEADLESS && !ATTENDED) args.push("--headless");

  log(`   ▶ delete-groups.mjs --max=${task.maxItems}${task.autoConfirm ? " --confirm" : "（先看不刪，只產生預覽）"}`);

  const run = ATTENDED
    ? spawnSync(process.execPath, args, {
        cwd: import.meta.dirname,
        stdio: "inherit",
        timeout: SHORT_JOB_TIMEOUT_MS,
        env: 子行程環境(authFile),
      })
    : spawnSync(process.execPath, args, {
        cwd: import.meta.dirname,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: SHORT_JOB_TIMEOUT_MS,
        env: 子行程環境(authFile),
      });

  // --attended 走 inherit，拿不到字串可解析 —— 信任結束碼就好，實際刪了幾篇看 deleted-log。
  if (ATTENDED) {
    if (run.status === 0) {
      await call("finish-delete", {
        taskId: task.id,
        deletedCount: 0,
        skippedCount: 0,
        resultJson: null,
        note: "有人看著跑完，實際刪了幾篇看 tools/fb-autopost/deleted-log/",
      });
      log(`   🎉 完成（有人看著跑，數字看 deleted-log）`);
    } else {
      await call("release-delete", { taskId: task.id, note: "有人看著跑，這次沒有跑完（可能是你中止的），放回佇列" });
      log(`   ⏸ 沒有跑完 → 放回佇列`);
    }
    return;
  }

  const out = `${run.stdout || ""}\n${run.stderr || ""}`;
  process.stdout.write(out);

  const result = 讀結果行(out);
  if (!result) {
    await call("fail-delete", {
      taskId: task.id,
      error: (run.stderr || run.stdout || "delete-groups.mjs 沒有輸出").trim().slice(-400),
    });
    log(`   ❌ 沒有讀到結果 → 標記失敗`);
    return;
  }

  await call("finish-delete", {
    taskId: task.id,
    deletedCount: result.deleted || 0,
    skippedCount: task.autoConfirm ? 0 : result.previewCount || 0,
    resultJson: JSON.stringify(result.items || []),
    note: task.autoConfirm
      ? `刪了 ${result.deleted || 0} 篇`
      : `只做了預覽（${result.previewCount || 0} 篇待刪），沒有真的刪 —— 自動確認沒開`,
  });
  log(`   🎉 完成（${task.autoConfirm ? `刪了 ${result.deleted || 0} 篇` : `預覽 ${result.previewCount || 0} 篇`}）`);
}

/* ── 發文身分：哪些身分現在登入有效、並回報給後台 ── */

/**
 * 登入檔有效的身分清單，給 Marketplace 認領用（直接讀資料庫那條路）。
 * 元素是 identity_id；主帳號放 null。查不到身分（資料庫連不上）就只看主帳號——跟加這個功能之前一樣。
 */
async function 登入有效的身分() {
  const ok = [];
  if (authSessionStatus(authFileForIdentity(null)).有登入) ok.push(null);
  try {
    const rows = await listIdentities({ onlyActive: true });
    for (const r of rows) {
      if (r.is_default === 1 || r.kind !== "personal") continue;
      try {
        if (authSessionStatus(authFileForIdentity(r.auth_key)).有登入) ok.push(r.id);
      } catch {
        /* 登入代號不合法＝不算有效 */
      }
    }
  } catch {
    /* 資料庫查不到身分：只剩主帳號 */
  }
  return ok;
}

/**
 * 每一輪先把各身分的登入檔有沒有效回報給後台（網站在 Vercel，讀不到桌機的檔案，只能靠這個）。
 * 走後台 API（跟一般貼文同一條路），所以測試用假後台時不會碰到真的資料庫。失敗只印一行，不影響發文。
 */
async function 回報身分登入狀態() {
  if (process.env.FB_SKIP_IDENTITY_REPORT === "1") return;
  try {
    const res = await call("identities");
    for (const idn of res.identities || []) {
      let ok = false;
      let note;
      try {
        const s = authSessionStatus(authFileForIdentity(idn.authKey));
        ok = s.有登入;
        note = ok
          ? `登入檔有效（${s.cookie數} 個 cookie）`
          : !s.檔案存在
            ? "桌機上還沒有這個身分的登入檔"
            : "登入檔裡沒有帳號身分 cookie（c_user／xs），要重新登入";
      } catch (e) {
        note = `登入代號有問題：${e.message}`;
      }
      await call("identity-login", { identityId: idn.id, ok, note });
    }
  } catch (e) {
    log(`⚠ 回報身分登入狀態失敗（不影響發文）：${String(e?.message || e).slice(0, 100)}`);
  }
}

/* ── 主迴圈 ── */

async function 撈一輪() {
  // 一般貼文 & 刪文走後台 API（要本機 dev server，或線上 Vercel）。連不上就跳過這一種，
  // 不要讓整輪掛掉 —— Marketplace 是直接讀資料庫的，API 不通不影響它。
  try {
    const res = await call("claim");
    if (res.task) {
      await 跑一份(res);
      return true;
    }
    if (res.note) log(res.note);
  } catch (e) {
    log(`⚠ 一般貼文排程查不到（${e.message.slice(0, 90)}）— 跳過`);
  }

  // Marketplace（Phase 4）：直接讀資料庫，不經過 API，不需要 dev server。
  //
  // 🔴 這條路會**直接動到正式資料庫**（認領＝把 fb_task 改成 running、attempts+1），
  //    不像一般貼文那樣可以用假後台攔下來。所以要在「認領之前」就把不該跑的情況擋掉：
  //    ① FB_SKIP_MARKETPLACE=1 → 完全不碰（端對端測試設這個）
  //    ② 沒有有效的 FB 登入 → 認領了也發不出去，不要白白把任務改成 running / 累加 attempts
  //       （2026-09-07 修：原本是「先認領、再檢查登入、失敗就 failMarketplaceTask」，
  //        測試時 FB_AUTH_FILE 指向假檔就會把真的排程標成失敗。順序反了。）
  //    （2026-10-07 發文身分：登入有沒有效改成「分身分」判斷——只認領登入檔有效的身分的任務，
  //      主帳號沒登入不再連累其他身分，其他身分沒登入也不會被認領成 running。）
  const 有效身分 = process.env.FB_SKIP_MARKETPLACE === "1" ? [] : await 登入有效的身分();
  if (process.env.FB_SKIP_MARKETPLACE === "1") {
    log("（FB_SKIP_MARKETPLACE=1，跳過 Marketplace 通路）");
  } else if (有效身分.length === 0) {
    log("（沒有任何一個發文身分的 FB 登入有效，跳過 Marketplace 通路 —— 不認領，免得把排程卡成 running）");
  } else {
    try {
      const mpTask = await claimNextMarketplaceTask(WORKER_ID, new Date(), 有效身分);
      if (mpTask) {
        await 跑一份Marketplace(mpTask);
        return true;
      }
      // 有到期的卻撈不到 → 節奏保護擋住（一般貼文剛發完／上一筆太近／今天到上限），印出來免得像沒在動
      if ((await dueFbTasks()).some((t) => t.channel === "marketplace")) {
        const 原因 = await claimHoldReason("marketplace");
        if (原因) log(`⏸ Marketplace 有到期的，但${原因}`);
      }
    } catch (e) {
      log(`⚠ Marketplace 排程查不到（${e.message.slice(0, 90)}）— 跳過`);
    }
  }

  try {
    const del = await call("claim-delete");
    if (del.task) {
      await 跑一份刪除(del.task, del.identity);
      return true;
    }
    if (del.note) log(del.note);
  } catch (e) {
    log(`⚠ 刪文排程查不到（${e.message.slice(0, 90)}）— 跳過`);
  }
  return false;
}

/* ── 太平洋官網成交檢查（2026-10-05，上架／下架看板第二階段） ──
 * 每天一次：只要有綁官網的文案超過 20 小時沒檢查，就整批檢查一次。只讀官網、只寫 fb_draft 的 pacific_* 欄位，
 * 不碰排程也不碰 FB——官網下架的只會出現在看板「需處理物件」，要不要取消排程由本人決定。
 * 任何錯誤都吞掉只印一行，絕不能讓發文主迴圈因為這個掛掉。 */
let _fbPacific = null;
async function 每日官網檢查() {
  if (process.env.FB_SKIP_PACIFIC === "1") return;
  try {
    _fbPacific ??= await import(`${pathToFileURL(PROJECT_ROOT).href}/src/lib/fb-pacific.ts`);
    if (!(await _fbPacific.pacificCheckDue(20))) return;
    log("🔎 每日太平洋官網成交檢查…");
    const list = await _fbPacific.checkAllDraftsOnPacific();
    const 下架 = list.filter((r) => r.status === "gone" || r.status === "changed");
    const 失敗 = list.filter((r) => r.status == null).length;
    log(`   檢查 ${list.length} 則：${下架.length ? `⚠ ${下架.length} 則官網已下架（${下架.map((r) => r.title).join("、").slice(0, 120)}）` : "都還在"}${失敗 ? `，${失敗} 則這次抓不到` : ""}`);
  } catch (e) {
    log(`⚠ 官網成交檢查失敗（不影響發文）：${String(e?.message || e).slice(0, 120)}`);
  }
}

/* ── 自動重新曝光（2026-10-05，上架／下架看板第三階段，見 src/lib/fb-recycle.ts） ──
 * 每輪推進一次：到期的文案先排「刪社團舊文」，刪完才排「重貼同一批社團」，一次只跑一則、白天才開新的一輪。
 * 它只是幫你「排任務」，真正刪／發的還是下面同一套刪文與發文流程（節奏保護一樣有效）。
 * FB 登入無效時不排（排了也只會逾時、然後把那則標成中斷）。錯誤全吞，不能害主迴圈掛掉。 */
let _fbRecycle = null;
async function 推進重新曝光() {
  if (process.env.FB_SKIP_RECYCLE === "1") return;
  if (!authSessionStatus().有登入) return;
  try {
    _fbRecycle ??= await import(`${pathToFileURL(PROJECT_ROOT).href}/src/lib/fb-recycle.ts`);
    for (const line of await _fbRecycle.advanceRecycles()) log(line);
  } catch (e) {
    log(`⚠ 自動重新曝光推進失敗（不影響發文）：${String(e?.message || e).slice(0, 120)}`);
  }
}

async function main() {
  if (!TOKEN || TOKEN.length < 16) {
    console.error("\n❌ 沒有設定 FB_RUNNER_TOKEN（或不到 16 字）。");
    console.error("   card-booking/.env.local 加一行，跟後台同一把：");
    console.error('   FB_RUNNER_TOKEN="<隨機一長串>"');
    console.error("   ⚠️ 不要加 NEXT_PUBLIC_ 前綴。\n");
    process.exit(1);
  }

  log(`runner 啟動：${API}`);
  log(`身分：${WORKER_ID}`);

  if (PING) {
    // 出發前檢查：一次把四件事講完，不要跑到一半才發現少東西。
    let 全過 = true;

    console.log(`\n① 密鑰　　 ✅ 有設定（${TOKEN.length} 字）`);

    let body = "";
    let res;
    try {
      res = await fetch(API, {
        headers: { authorization: `Bearer ${TOKEN}` },
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      body = await res.text();
      if (res.ok) {
        console.log(`② 後台　　 ✅ 連得上、密鑰對　${API}`);
      } else {
        全過 = false;
        console.log(`② 後台　　 ❌ HTTP ${res.status}　${API}`);
        console.log(`            ${body.slice(0, 160)}`);
        if (res.status === 401) {
          console.log(`            👉 後台那邊的 FB_RUNNER_TOKEN 跟這裡不一樣（或線上還沒設）。`);
        }
      }
    } catch (e) {
      全過 = false;
      console.log(`② 後台　　 ❌ 連不上　${API}`);
      console.log(`            ${e.message}`);
      console.log(`            👉 打本機的話要先開 npm run dev；打線上的話要先在 Vercel 設 token。`);
    }

    const s = authSessionStatus();
    if (s.有登入) {
      console.log(`③ FB 登入　✅ 還有效（${s.cookie數} 個 cookie）`);
    } else {
      全過 = false;
      console.log(`③ FB 登入　❌ ${登入問題說明().split("\n")[0]}`);
    }

    if (res?.ok) {
      try {
        const j = JSON.parse(body);
        const n = j.pending ?? j.due ?? j.count;
        console.log(`④ 待辦工作 ${n ? `📮 ${n} 份等著發` : "（目前沒有到期的）"}`);
      } catch {
        console.log(`④ 待辦工作 （後台回的格式看不懂，不影響發文）`);
      }
    } else {
      console.log(`④ 待辦工作 —（後台沒通，查不到）`);
    }

    console.log(
      全過
        ? `\n✅ 都就緒了。第一次接真 FB 請用：node runner.mjs --attended\n`
        : `\n❌ 上面有 ❌ 的先處理掉，再跑 runner。\n`,
    );
    process.exit(全過 ? 0 : 1);
  }

  // 🧑 有人看著：只撈一份就停。不做輪詢 —— 人不會坐在那裡等第二份。
  if (ATTENDED) {
    log("🧑 有人看著模式：撈一份、開瀏覽器、停住等你按發佈");
    const 有做事 = await 撈一輪();
    if (!有做事) log("目前沒有到期的工作。到後台排一份，或把時間改成現在。");
    return;
  }

  if (ONCE) {
    // 🔴 正式環境是 Windows 排程每 5 分鐘跑一次 --once（不是下面的無限迴圈），所以這兩件也要放在這裡
    await 回報身分登入狀態();
    await 每日官網檢查();
    await 推進重新曝光();
    for (let i = 0; i < 3; i += 1) {
      if (!(await 撈一輪())) break;
    }
    log("這一輪結束");
    return;
  }

  for (;;) {
    await 回報身分登入狀態();
    await 每日官網檢查();
    await 推進重新曝光();
    try {
      const 有做事 = await 撈一輪();
      if (!有做事) log(`沒有到期的工作，${POLL_MS / 60_000} 分鐘後再看`);
    } catch (e) {
      // 網路斷、後台重啟都會走到這 —— 不要結束程序（runner 掛掉沒人會發現）
      console.error(`⚠ 這輪出錯（不影響下一輪）：${e.message}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error(`\n❌ runner 掛了：${e.message}\n`);
  process.exit(1);
});
