/**
 * FB 貼文工廠 × 自動重新曝光（2026-10-05，上架／下架看板第三階段）。
 *
 * 本人看同業 EZup好上架：「物件貼出 7 天後會自動下架、再重新上架一次，讓它回到最前面」。
 * 這裡的做法是把兩個**既有、已驗證過**的零件串起來，不新寫任何 FB 操作：
 *
 *   ① 到期 → 對這則文案目前還掛在社團上的每一個社團，各排一筆「自動刪文」（fb_delete_task，限定該社團＋文案第一行比對）
 *   ② 那幾筆刪文全部做完 → 排一筆一般貼文（fb_task），目標＝同一批社團，立即、全自動發佈
 *   ③ 重貼做完 → 這輪結束，下一輪從這次重貼的時間再算 N 天
 *
 * 🔴 刻意的限制（本人 2026-10-05 拍板「先 3～5 筆測」）：
 *  - **每則預設關閉**，要在看板上逐則打開「自動重新曝光」
 *  - **一次只跑一則**：有一則在刪／在重貼，就不開新的一輪（FB 個人帳號大量刪文重貼最容易被盯）
 *  - **只在台灣時間 09:00～21:00 開新的一輪**（半夜刪文重貼不像真人）
 *  - **只處理社團貼文**：自己動態那篇刪文工具走不到（要手動刪），所以也不重貼到動態，免得動態上變兩篇
 *  - 社團自己設的冷卻天數比 N 天長、社團已停用／封存 → 那個社團這輪不刪也不重貼
 *  - 官網已下架（第二階段判定）／已封存的文案不跑
 *  - 任何一步失敗（刪文失敗／逾時、重貼失敗、被本人取消）→ 這則**自動關掉並標「需處理」**，不重試、不硬貼
 *    —— 最怕的是「舊的沒刪掉又貼一篇新的」變成洗版
 *  - 已經開始的一輪，本人中途把開關關掉也會把這輪做完（不然會停在「舊文刪了、新文沒貼」）
 *
 * 推進的是桌機 runner：主迴圈每輪呼叫 advanceRecycles()。網站本身不會自己跑。
 * 桌機 runner 用裸 node 直接 import 這個檔，所以內部 import 一律走 @/ 別名。
 */
import { db } from "@/lib/db";
import { ensureFbCoreTables, ensureFbDeleteTables, createDeleteTask, createFbTask, firstLineForMatch, setDraftStatus } from "@/lib/fb-factory";

export const RECYCLE_DAYS = Math.max(1, Number(process.env.FB_RECYCLE_DAYS || 7));
const WINDOW_START_HOUR = 9;
const WINDOW_END_HOUR = 21;

export type RecycleGroup = { id: string; name: string; url: string };
type RecycleJson = { groups: RecycleGroup[]; deleteTaskIds: string[]; postTaskId?: string };

type LiveGroup = RecycleGroup & { lastAt: Date; cooldownDays: number; usable: boolean };

function parseJson(raw: string | null | undefined): RecycleJson | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RecycleJson;
  } catch {
    return null;
  }
}

function taipeiHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Taipei" }).format(now)) % 24;
}

export function inRecycleWindow(now = new Date()): boolean {
  const h = taipeiHour(now);
  return h >= WINDOW_START_HOUR && h < WINDOW_END_HOUR;
}

/** 這則文案目前還掛在哪些社團（發成功、還沒被刪掉），附社團自己的設定。 */
export async function liveGroupsForDraft(draftId: string): Promise<LiveGroup[]> {
  const rows = await db.$queryRawUnsafe<
    Array<{
      group_id: string;
      name: string | null;
      url: string | null;
      last_at: Date | null;
      cooldown_days: number | null;
      is_active: number | null;
      hidden: number | null;
    }>
  >(
    `SELECT i.group_id, MAX(i.group_name) AS name, MAX(i.group_url) AS url, MAX(i.done_at) AS last_at,
            MAX(g.cooldown_days) AS cooldown_days, MAX(g.is_active) AS is_active, MAX(g.hidden) AS hidden
       FROM fb_task_item i
       JOIN fb_task t ON t.id = i.task_id
       LEFT JOIN fb_group g ON g.id = i.group_id
      WHERE t.draft_id = ? AND t.channel = 'post' AND i.channel = 'group' AND i.status = 'posted'
        AND i.deleted_at IS NULL AND i.group_id IS NOT NULL AND i.group_url IS NOT NULL AND i.group_url <> ''
      GROUP BY i.group_id`,
    draftId,
  );
  return rows
    .filter((r) => r.last_at)
    .map((r) => ({
      id: r.group_id,
      name: r.name || "",
      url: r.url || "",
      lastAt: new Date(r.last_at as Date),
      cooldownDays: Number(r.cooldown_days ?? 7),
      // 社團被停用／封存、或整個社團已經從清單刪掉（g 為 null）→ 不再碰
      usable: r.is_active != null && Number(r.is_active) === 1 && !Number(r.hidden ?? 0),
    }));
}

/** 到期日＝最近一次發到社團的時間＋N 天（沒有掛著的社團貼文就回 null）。 */
export function recycleDueAt(groups: LiveGroup[], days = RECYCLE_DAYS): Date | null {
  if (!groups.length) return null;
  const last = Math.max(...groups.map((g) => +g.lastAt));
  return new Date(last + days * 86_400_000);
}

/** 這輪要處理哪些社團：可用、而且距離上次已經超過 max(N 天, 社團冷卻天數)。 */
export function pickRecycleGroups(groups: LiveGroup[], now = new Date(), days = RECYCLE_DAYS): LiveGroup[] {
  return groups.filter((g) => g.usable && now.getTime() - +g.lastAt >= Math.max(days, g.cooldownDays) * 86_400_000);
}

async function setState(draftId: string, patch: { state?: string | null; json?: RecycleJson | null; note?: string; enabled?: boolean; started?: boolean }) {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.state !== undefined) {
    sets.push("recycle_state = ?");
    params.push(patch.state);
  }
  if (patch.json !== undefined) {
    sets.push("recycle_json = ?");
    params.push(patch.json ? JSON.stringify(patch.json) : null);
  }
  if (patch.note !== undefined) {
    sets.push("recycle_note = ?");
    params.push(patch.note.slice(0, 500));
  }
  if (patch.enabled !== undefined) {
    sets.push("recycle_enabled = ?");
    params.push(patch.enabled ? 1 : 0);
  }
  if (patch.started) sets.push("recycle_started_at = CURRENT_TIMESTAMP");
  if (!sets.length) return;
  await db.$executeRawUnsafe(`UPDATE fb_draft SET ${sets.join(", ")} WHERE id = ?`, ...params, draftId);
}

/** 失敗一律：關掉、標 paused（看板會放進「需處理物件」），不重試。 */
async function pause(draftId: string, note: string) {
  await setState(draftId, { state: "paused", json: null, note, enabled: false });
}

type DraftRow = {
  id: string;
  title: string;
  post_text: string | null;
  recycle_enabled: number | null;
  recycle_state: string | null;
  recycle_json: string | null;
  pacific_status: string | null;
  board_archived_at: Date | null;
};

/** 推進一則正在跑的（deleting／reposting）。回傳一行給 runner 印的紀錄。 */
async function advanceOne(d: DraftRow): Promise<string> {
  const j = parseJson(d.recycle_json);
  if (!j) {
    await pause(d.id, "重新曝光的進度資料不見了，這輪中止");
    return `⚠ 「${d.title}」進度資料不見，已暫停`;
  }

  if (d.recycle_state === "deleting") {
    const del = await db.$queryRawUnsafe<Array<{ id: string; status: string; deleted_count: number | null }>>(
      `SELECT t.id, t.status, r.deleted_count FROM fb_delete_task t LEFT JOIN fb_delete_task_run r ON r.task_id = t.id
        WHERE t.id IN (${j.deleteTaskIds.map(() => "?").join(",")})`,
      ...j.deleteTaskIds,
    );
    const bad = del.find((t) => ["failed", "expired", "cancelled"].includes(t.status));
    if (bad || del.length < j.deleteTaskIds.length) {
      await pause(d.id, bad ? `刪社團舊文${bad.status === "cancelled" ? "被取消" : bad.status === "expired" ? "逾時沒跑" : "失敗"}，沒有重貼（避免舊文沒刪又多貼一篇）` : "刪文任務不見了，沒有重貼");
      return `⚠ 「${d.title}」刪舊文沒成功，已暫停、沒有重貼`;
    }
    if (del.some((t) => t.status !== "done")) return ""; // 還在刪，下一輪再看

    const deleted = del.reduce((n, t) => n + Number(t.deleted_count ?? 0), 0);
    const postTaskId = await createFbTask({
      draftId: d.id,
      title: d.title,
      channel: "post",
      runAt: new Date(),
      postToTimeline: false,
      groups: j.groups,
      autoPublish: true,
    });
    await setDraftStatus(d.id, "post", "scheduled");
    await setState(d.id, {
      state: "reposting",
      json: { ...j, postTaskId },
      note: `舊文刪了 ${deleted} 篇，重貼 ${j.groups.length} 個社團排隊中`,
    });
    return `♻ 「${d.title}」舊文刪完（${deleted} 篇），重貼 ${j.groups.length} 個社團已排入`;
  }

  if (d.recycle_state === "reposting") {
    const rows = await db.$queryRawUnsafe<Array<{ status: string; posted: unknown; failed: unknown }>>(
      `SELECT t.status,
              SUM(CASE WHEN i.status = 'posted' THEN 1 ELSE 0 END) AS posted,
              SUM(CASE WHEN i.status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM fb_task t LEFT JOIN fb_task_item i ON i.task_id = t.id
        WHERE t.id = ? GROUP BY t.status`,
      j.postTaskId || "",
    );
    const t = rows[0];
    if (!t) {
      await pause(d.id, "重貼的排程被取消了（舊文已經刪掉，需要的話自己重新排程）");
      return `⚠ 「${d.title}」重貼排程不見了，已暫停`;
    }
    if (t.status === "pending" || t.status === "running") return "";
    const posted = Number(String(t.posted ?? 0));
    const failed = Number(String(t.failed ?? 0));
    if (t.status === "done" && posted > 0) {
      await setState(d.id, { state: null, json: null, note: `上一輪完成：重貼 ${posted} 個社團${failed ? `、${failed} 個失敗` : ""}` });
      return `✅ 「${d.title}」重新曝光完成（${posted} 個社團${failed ? `，${failed} 個失敗` : ""}）`;
    }
    await pause(d.id, `重貼${t.status === "expired" ? "逾時沒發" : "失敗"}（舊文已經刪掉，需要的話自己重新排程）`);
    return `⚠ 「${d.title}」重貼沒成功，已暫停`;
  }
  return "";
}

/** 開新的一輪：先排刪文。 */
async function startOne(d: DraftRow, groups: LiveGroup[]): Promise<string> {
  const matchText = firstLineForMatch(d.post_text).trim();
  if (matchText.length < 8) {
    await pause(d.id, `文案第一行太短（「${matchText}」），刪文沒辦法安全比對，已關掉自動重新曝光`);
    return `⚠ 「${d.title}」第一行太短不能自動刪文，已暫停`;
  }
  await ensureFbDeleteTables();
  const deleteTaskIds: string[] = [];
  for (const g of groups) {
    deleteTaskIds.push(
      await createDeleteTask({
        draftId: d.id,
        title: d.title,
        matchText,
        // 同一則在同一社團發過兩次的話一起清掉（跟「按社團清空」一樣留一點餘裕）
        maxItems: 3,
        olderThanDays: null,
        runAt: new Date(),
        autoConfirm: true,
        groupId: g.id,
      }),
    );
  }
  await setState(d.id, {
    state: "deleting",
    json: { groups: groups.map((g) => ({ id: g.id, name: g.name, url: g.url })), deleteTaskIds },
    note: `第 ${RECYCLE_DAYS} 天到了，正在刪 ${groups.length} 個社團的舊文`,
    started: true,
  });
  return `♻ 「${d.title}」開始重新曝光：先刪 ${groups.length} 個社團的舊文`;
}

/**
 * runner 主迴圈每輪呼叫。回傳要印的紀錄（沒事就空陣列）。
 * 先推進正在跑的那一則；沒有在跑的才（在時間窗內）挑一則最久沒曝光的開始。
 */
export async function advanceRecycles(now = new Date()): Promise<string[]> {
  await ensureFbCoreTables();
  const logs: string[] = [];
  const drafts = await db.$queryRawUnsafe<DraftRow[]>(
    `SELECT id, title, post_text, recycle_enabled, recycle_state, recycle_json, pacific_status, board_archived_at
       FROM fb_draft WHERE recycle_enabled = 1 OR recycle_state IN ('deleting','reposting')`,
  );

  const running = drafts.filter((d) => d.recycle_state === "deleting" || d.recycle_state === "reposting");
  for (const d of running) {
    const line = await advanceOne(d);
    if (line) logs.push(line);
  }
  // 推進完還有在跑的 → 一次只跑一則，這輪不開新的
  const stillRunning = await db.$queryRawUnsafe<Array<{ n: unknown }>>(
    "SELECT COUNT(*) AS n FROM fb_draft WHERE recycle_state IN ('deleting','reposting')",
  );
  if (Number(String(stillRunning[0]?.n ?? 0)) > 0) return logs;
  if (!inRecycleWindow(now)) return logs;

  // 這則還有一般貼文排程沒發完的不碰（避免跟本人自己排的撞在一起）
  const busy = new Set(
    (
      await db.$queryRawUnsafe<Array<{ draft_id: string }>>(
        "SELECT DISTINCT draft_id FROM fb_task WHERE channel = 'post' AND status IN ('pending','running')",
      )
    ).map((r) => r.draft_id),
  );

  let best: { d: DraftRow; groups: LiveGroup[]; due: number } | null = null;
  for (const d of drafts) {
    if (d.recycle_enabled !== 1 || d.recycle_state || d.board_archived_at) continue;
    if (d.pacific_status === "gone" || d.pacific_status === "changed") continue;
    if (busy.has(d.id)) continue;
    const live = await liveGroupsForDraft(d.id);
    const due = recycleDueAt(live);
    if (!due || +due > +now) continue;
    const pick = pickRecycleGroups(live, now);
    if (!pick.length) continue;
    if (!best || +due < best.due) best = { d, groups: pick, due: +due };
  }
  if (best) logs.push(await startOne(best.d, best.groups));
  return logs;
}

/**
 * 看板上的開關。打開時先檢查做得到：要有掛在社團上的貼文、第一行夠長。
 * 關掉時：已經開始的一輪還是會做完（advanceRecycles 不看開關推進 deleting／reposting）。
 */
export async function setRecycleEnabled(draftId: string, on: boolean): Promise<{ ok: boolean; error?: string; message?: string }> {
  await ensureFbCoreTables();
  const rows = await db.$queryRawUnsafe<Array<{ title: string; post_text: string | null; recycle_state: string | null }>>(
    "SELECT title, post_text, recycle_state FROM fb_draft WHERE id = ? LIMIT 1",
    draftId,
  );
  const d = rows[0];
  if (!d) return { ok: false, error: "找不到這則文案" };
  if (!on) {
    await db.$executeRawUnsafe(
      "UPDATE fb_draft SET recycle_enabled = 0, recycle_state = CASE WHEN recycle_state = 'paused' THEN NULL ELSE recycle_state END WHERE id = ?",
      draftId,
    );
    const mid = d.recycle_state === "deleting" || d.recycle_state === "reposting";
    return { ok: true, message: mid ? "已關閉；正在進行的這一輪會做完（不然會停在舊文刪了、新文沒貼）" : "已關閉" };
  }
  const matchText = firstLineForMatch(d.post_text).trim();
  if (matchText.length < 8) return { ok: false, error: `文案第一行太短（「${matchText}」），自動刪文沒辦法安全比對，先把第一行改長一點` };
  const live = await liveGroupsForDraft(draftId);
  if (!live.length) return { ok: false, error: "這則目前沒有掛在任何社團上（自己動態那篇不在自動重新曝光範圍），先發到社團才能打開" };
  await db.$executeRawUnsafe(
    "UPDATE fb_draft SET recycle_enabled = 1, recycle_state = CASE WHEN recycle_state = 'paused' THEN NULL ELSE recycle_state END, recycle_note = NULL WHERE id = ?",
    draftId,
  );
  const due = recycleDueAt(live);
  return { ok: true, message: `已打開。${due && +due > Date.now() ? "到期後" : "已經到期，"}桌機會在白天（9～21 點）自動先刪 ${live.filter((g) => g.usable).length} 個社團的舊文再重貼` };
}

/** 看板用：每則文案的到期日（最近一次發到社團＋N 天）。一次查完，不要每列各查一次。 */
export async function recycleDueMap(draftIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (!draftIds.length) return out;
  const rows = await db.$queryRawUnsafe<Array<{ draft_id: string; last_at: Date | null }>>(
    `SELECT t.draft_id, MAX(i.done_at) AS last_at
       FROM fb_task_item i JOIN fb_task t ON t.id = i.task_id
      WHERE t.channel = 'post' AND i.channel = 'group' AND i.status = 'posted' AND i.deleted_at IS NULL
        AND t.draft_id IN (${draftIds.map(() => "?").join(",")})
      GROUP BY t.draft_id`,
    ...draftIds,
  );
  for (const r of rows) if (r.last_at) out.set(r.draft_id, new Date(+new Date(r.last_at) + RECYCLE_DAYS * 86_400_000));
  return out;
}
