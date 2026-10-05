import { pacificIdFromUrl } from "@/lib/fb-pacific";
import { listBoardRows, isChannel, fmtDateTime, type FbChannel, type BoardStage } from "@/lib/fb-factory";
import { BoardView, type BoardItem } from "./BoardView";

export const dynamic = "force-dynamic";
// 「立即檢查成交」一次要抓好幾則官網頁，給它多一點時間（Vercel 上限內）
export const maxDuration = 60;

const STAGES: BoardStage[] = ["ready", "waiting", "done", "attention", "archived"];

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const channel: FbChannel = isChannel(sp.channel) ? sp.channel : "post";
  const tab: BoardStage = STAGES.includes(sp.tab as BoardStage) ? (sp.tab as BoardStage) : "ready";

  const rows = await listBoardRows(channel);
  const now = Date.now();

  // 日期在伺服器端先排好字串（台灣時間），client 端不用再碰時區
  const items: BoardItem[] = rows.map((r) => ({
    draftId: r.draftId,
    title: r.title,
    stage: r.stage,
    priceWan: r.priceWan,
    // 標題常常本來就是「沙鹿區 麗豐藝品」，副標再寫一次就重複了——只留標題裡沒有的部分
    area: r.area
      .split("・")
      .filter((p) => !r.title.includes(p))
      .join("・"),
    createdAt: fmtDateTime(r.createdAt),
    createdTs: +new Date(r.createdAt),
    lastPostedAt: r.lastPostedAt ? fmtDateTime(r.lastPostedAt) : null,
    lastPostedTs: r.lastPostedAt ? +new Date(r.lastPostedAt) : 0,
    runAt: r.task ? fmtDateTime(r.task.runAt) : null,
    runTs: r.task ? +new Date(r.task.runAt) : 0,
    overdue: r.task ? +new Date(r.task.runAt) < now : false,
    taskId: r.task?.id ?? null,
    taskStatus: r.task?.status ?? null,
    groups: r.task?.groups ?? 0,
    targets: r.task?.targets ?? 0,
    taskFailed: r.task?.failed ?? 0,
    lastError: r.task?.lastError ?? null,
    postedTargets: r.postedTargets,
    failedTargets: r.failedTargets,
    fbUrl: r.fbUrl,
    pacificUrl: r.pacificUrl,
    pacificId: pacificIdFromUrl(r.pacificUrl),
    pacificStatus: r.pacificStatus,
    pacificNote: r.pacificNote,
    pacificCheckedAt: r.pacificCheckedAt ? fmtDateTime(r.pacificCheckedAt) : null,
    pacificCheckedTs: r.pacificCheckedAt ? +new Date(r.pacificCheckedAt) : 0,
    attentionKind: r.attentionKind,
    hasPendingTask: r.hasPendingTask,
  }));

  return <BoardView channel={channel} initialTab={tab} items={items} />;
}
