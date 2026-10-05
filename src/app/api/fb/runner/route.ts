/**
 * FB 貼文工廠 — 桌機 runner 的 API（2026-09-03）
 *
 * 桌機的 tools/fb-autopost/runner.mjs 透過這條路拿工作、回報結果。
 * 網站本身不發文（Vercel 跑不了 Playwright），只派工與記帳。
 *
 * 讀寫的是另一台建好的表：fb_task / fb_task_item / fb_draft / fb_group
 * ＋ 這邊自己的 fb_task_run（認領記帳）。
 *
 * 🔴 不走後台的 email 白名單（runner 是機器）。用一把共用密鑰。
 *    沒設 FB_RUNNER_TOKEN → 整條關閉（不是預設放行）。
 *    密鑰不要加 NEXT_PUBLIC_ 前綴。
 */
import { NextResponse } from "next/server";
import {
  claimNextTask,
  claimHoldReason,
  dueFbTasks,
  finishTask,
  failTask,
  releaseTask,
  getFbDraft,
  getTaskItems,
  getTaskRun,
  parseFacts,
  markItemResult,
  claimNextDeleteTask,
  getDeleteTaskRun,
  finishDeleteTask,
  releaseDeleteTask,
  failDeleteTask,
  getFbGroup,
  postedGroupsForDraft,
  isFbItem,
  isSocialPlatform,
} from "@/lib/fb-factory";
import { getProperty } from "@/lib/property";
import { directImageUrl, parseImageList } from "@/lib/media-url";

export const dynamic = "force-dynamic";

function checkAuth(req: Request): string | null {
  const token = process.env.FB_RUNNER_TOKEN;
  if (!token || token.length < 16) {
    return "伺服器沒有設定 FB_RUNNER_TOKEN（或太短），runner 通道是關閉的。";
  }
  const header = req.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (given.length !== token.length) return "密鑰不對";
  let diff = 0;
  for (let i = 0; i < token.length; i += 1) diff |= given.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0 ? null : "密鑰不對";
}

export async function GET(req: Request) {
  const err = checkAuth(req);
  if (err) return NextResponse.json({ ok: false, error: err }, { status: 401 });
  return NextResponse.json({ ok: true, service: "fb-runner", now: new Date().toISOString() });
}

export async function POST(req: Request) {
  const authError = checkAuth(req);
  if (authError) return NextResponse.json({ ok: false, error: authError }, { status: 401 });

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "壞掉的 JSON" }, { status: 400 });
  }
  const action = String(payload.action || "");

  /* ── 撈一份工作 ── */
  if (action === "claim") {
    const workerId = String(payload.workerId || "unknown");
    const task = await claimNextTask(workerId);
    if (!task) {
      // 有到期的卻撈不到 → 多半是節奏保護擋住（上一篇太近／今天到上限），把原因講給 runner 印
      const 有到期 = (await dueFbTasks()).some((t) => t.channel === "post");
      const 原因 = 有到期 ? await claimHoldReason("post") : null;
      return NextResponse.json({ ok: true, task: null, note: 原因 ? `⏸ 一般貼文有到期的，但${原因}` : undefined });
    }

    const draft = await getFbDraft(task.draft_id);
    if (!draft || !draft.post_text) {
      await failTask(task.id, "文案已被刪掉或沒有內文", 0);
      return NextResponse.json({ ok: true, task: null, note: "文案不存在，工作標記失敗" });
    }

    const run = await getTaskRun(task.id);
    const items = await getTaskItems(task.id);
    const pending = items.filter((i) => i.status === "pending");

    if (pending.length === 0) {
      await finishTask(task.id, "沒有還沒處理的目標");
      return NextResponse.json({ ok: true, task: null, note: "目標都處理過了，工作收掉" });
    }

    // fb_draft 沒有照片欄位。連到物件庫的：照片從物件帶（封面 + photo_urls）。
    // 手動填的：照片自己帶在 facts_json.photos（產文案那頁就編排好，2026-09-06）。上限 10。
    const facts = parseFacts(draft.facts_json);
    let photos: string[] = [];
    if (draft.source_property_id) {
      const prop = await getProperty(draft.source_property_id);
      if (prop) {
        photos = [
          ...(prop.cover_url ? [directImageUrl(prop.cover_url.trim())] : []),
          ...parseImageList(prop.photo_urls),
        ]
          .filter((u, i, a) => u && a.indexOf(u) === i)
          .slice(0, 10);
      }
    } else {
      photos = (facts.photos ?? []).slice(0, 10);
    }
    // 影片（2026-09-22）：跟照片不一樣，不管是不是物件庫產的文案都能有——
    // 物件庫本身的影片是 YouTube 連結，不是 FB 上傳得了的檔案本體，這裡一律讀 facts_json.video。
    const video = facts.video || null;

    return NextResponse.json({
      ok: true,
      task: {
        id: task.id,
        channel: task.channel,
        autoPublish: run?.auto_publish === 1,
        attempts: run?.attempts ?? 1,
      },
      draft: {
        id: draft.id,
        title: draft.title,
        postText: draft.post_text,
        sourcePropertyId: draft.source_property_id,
      },
      photos,
      video,
      // FB 的目標（自己的動態／社團）給 post.mjs 開瀏覽器發
      targets: pending
        .filter((i) => isFbItem(i.channel))
        .map((i) => ({
          itemId: i.id,
          type: i.channel, // 'self' | 'group'
          target: i.channel === "self" ? "個人主頁" : i.group_url || "",
          groupName: i.group_name,
        })),
      // IG／Threads 的目標（2026-09-21）：runner 不開瀏覽器，直接讀資料庫用官方 API 發
      // （tools/fb-autopost/runner.mjs → src/lib/social-publish.ts publishSocialItemsForTask）
      socialTargets: pending
        .filter((i) => isSocialPlatform(i.channel))
        .map((i) => ({ itemId: i.id, platform: i.channel })),
    });
  }

  /* ── 回報一個目標的結果 ── */
  if (action === "report") {
    const itemId = String(payload.itemId || "");
    const result = String(payload.result || "");
    if (!itemId) return NextResponse.json({ ok: false, error: "缺 itemId" }, { status: 400 });
    if (!["posted", "skipped", "failed"].includes(result)) {
      return NextResponse.json({ ok: false, error: "result 只能是 posted/skipped/failed" }, { status: 400 });
    }
    await markItemResult(
      itemId,
      result as "posted" | "skipped" | "failed",
      payload.note ? String(payload.note).slice(0, 300) : null,
    );
    return NextResponse.json({ ok: true });
  }

  /* ── 收尾 ── */
  if (action === "finish") {
    const id = String(payload.taskId || "");
    if (!id) return NextResponse.json({ ok: false, error: "缺 taskId" }, { status: 400 });
    await finishTask(id, payload.note ? String(payload.note) : undefined);
    return NextResponse.json({ ok: true });
  }

  /* ── 這輪不能發但不是壞掉（例：還沒隔滿 90 分鐘） ── */
  if (action === "release") {
    const id = String(payload.taskId || "");
    if (!id) return NextResponse.json({ ok: false, error: "缺 taskId" }, { status: 400 });
    await releaseTask(id, String(payload.note || "這輪沒發，等下一輪"));
    return NextResponse.json({ ok: true });
  }

  /* ── 炸了 ── */
  if (action === "fail") {
    const id = String(payload.taskId || "");
    if (!id) return NextResponse.json({ ok: false, error: "缺 taskId" }, { status: 400 });
    await failTask(id, String(payload.error || "沒說原因"));
    return NextResponse.json({ ok: true });
  }

  /* ══════════════ 自動刪文（fb_delete_task）══════════════
     目標不是排程時選好的，是桌機執行 delete-groups.mjs 時到 FB 活動紀錄現找的，
     所以沒有像貼文那樣一個一個 item 回報，一次批次結果整包回報。 */

  /* ── 撈一份刪除工作 ── */
  if (action === "claim-delete") {
    const workerId = String(payload.workerId || "unknown");
    const task = await claimNextDeleteTask(workerId);
    if (!task) return NextResponse.json({ ok: true, task: null });

    const run = await getDeleteTaskRun(task.id);
    // 桌機要知道「去哪幾個社團的『你的內容』找」（2026-09-20 起主要走這條，帶照片的貼文活動紀錄看不到）：
    //   「按社團清空」→ 就那一個社團；「按工作流清空」／進階排程 → 這則文案發過的全部社團。
    // groups 是空的（例如文案是另一台發的、fb_task_item 沒紀錄）runner 會退回舊的活動紀錄路徑。
    const group = task.group_id ? await getFbGroup(task.group_id) : null;
    const groups = group
      ? [{ id: group.id, name: group.name, url: group.url }]
      : await postedGroupsForDraft(task.draft_id);
    return NextResponse.json({
      ok: true,
      task: {
        id: task.id,
        title: task.title,
        matchText: task.match_text,
        maxItems: task.max_items,
        olderThanDays: task.older_than_days,
        groupName: group?.name || null,
        groups,
        autoConfirm: run?.auto_confirm === 1,
        attempts: run?.attempts ?? 1,
      },
    });
  }

  /* ── 刪除工作收尾 ── */
  if (action === "finish-delete") {
    const id = String(payload.taskId || "");
    if (!id) return NextResponse.json({ ok: false, error: "缺 taskId" }, { status: 400 });
    await finishDeleteTask(id, {
      deletedCount: Number(payload.deletedCount) || 0,
      skippedCount: Number(payload.skippedCount) || 0,
      resultJson: payload.resultJson ? String(payload.resultJson) : null,
      note: payload.note ? String(payload.note) : undefined,
    });
    return NextResponse.json({ ok: true });
  }

  /* ── 這輪不能刪但不是壞掉（例：登入沒接） ── */
  if (action === "release-delete") {
    const id = String(payload.taskId || "");
    if (!id) return NextResponse.json({ ok: false, error: "缺 taskId" }, { status: 400 });
    await releaseDeleteTask(id, String(payload.note || "這輪沒處理，等下一輪"));
    return NextResponse.json({ ok: true });
  }

  /* ── 刪除工作炸了 ── */
  if (action === "fail-delete") {
    const id = String(payload.taskId || "");
    if (!id) return NextResponse.json({ ok: false, error: "缺 taskId" }, { status: 400 });
    await failDeleteTask(id, String(payload.error || "沒說原因"));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: `不認得的 action：${action}` }, { status: 400 });
}
