import Link from "next/link";
import {
  listFbDrafts,
  listFbGroups,
  listFbTasks,
  getFbDraft,
  getTaskItems,
  getTaskRun,
  lastPostedByGroup,
  daysSince,
  effectiveCooldownDays,
  JITTER_MAX_MINUTES,
  fmtDateTime,
  fmtMemberCount,
  channelLabel,
  isChannel,
  FB_CHANNELS,
  type FbChannel,
} from "@/lib/fb-factory";
import { clashNoteFor, CHANNEL_GAP_MINUTES, MIN_GAP_MINUTES, type ScheduledLite } from "@/lib/fb-rhythm";
import { CIS, CHIP } from "@/app/admin/fb/_ui/theme";
import { Icon, type IconName } from "@/app/admin/_ui/icons";
import { ScheduleForm } from "./ScheduleForm";
import { allSocialAccountStatus } from "@/lib/social-publish";
import { TaskRow } from "./TaskRow";
import styles from "../fb.module.css";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, keyof typeof CHIP> = {
  pending: "info",
  running: "info",
  done: "success",
  failed: "danger",
  expired: "warn",
  cancelled: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "等時間到",
  running: "桌機處理中",
  done: "發完了",
  failed: "失敗",
  expired: "過期沒發",
  cancelled: "取消了",
};

/** Date → datetime-local 輸入框吃的 `YYYY-MM-DDTHH:mm`（本機時區；dev server 跑在桌機＝台北）。 */
function toDatetimeLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; draft?: string }>;
}) {
  const sp = await searchParams;
  const channel: FbChannel = isChannel(sp.channel) ? sp.channel : "post";

  const [drafts, groups, tasks, postPending, mpPending, lastPosted, social] = await Promise.all([
    listFbDrafts({ channel, queue: "todo" }),
    listFbGroups({ channel, onlyActive: true }),
    listFbTasks({ channel, limit: 50 }),
    listFbTasks({ channel: "post", status: "pending" }),
    listFbTasks({ channel: "marketplace", status: "pending" }),
    lastPostedByGroup(),
    allSocialAccountStatus(),
  ]);

  const counts: Record<FbChannel, number> = { post: postPending.length, marketplace: mpPending.length };

  // 排程的社團選單也照人數排（大的先看到）
  const groupOptions = [...groups]
    .sort((a, b) => (b.member_count ?? -1) - (a.member_count ?? -1))
    .map((g) => {
      const last = lastPosted.get(g.id);
      const gap = daysSince(last);
      // 擬真：冷卻天數不是剛好設定值，是設定值＋這一輪的隨機加碼（同一個社團永遠剛好每 7 天一篇太像排程器）
      const eff = effectiveCooldownDays(g.id, g.cooldown_days, last);
      const cooling = gap != null && eff > 0 && gap < eff;
      const members = fmtMemberCount(g.member_count);
      return {
        id: g.id,
        name: g.name,
        cooling,
        note:
          `${members !== "—" ? `${members} 人` : ""}` +
          `${g.needs_approval === 1 ? " · 要審核" : ""}` +
          `${
            gap == null
              ? " · 還沒貼過"
              : cooling
                ? ` · ${gap} 天前才貼過（這輪要滿 ${eff} 天）`
                : ` · ${gap} 天前貼過`
          }`.replace(/^ · /, ""),
      };
    });

  const runnerReady = Boolean(process.env.FB_RUNNER_TOKEN && process.env.FB_RUNNER_TOKEN.length >= 16);

  // 撞時段提示：兩個通路所有「等時間到」的任務放一起看，排太近的那筆標出來（桌機一次只發一件，會排隊）
  const queue: ScheduledLite[] = [...postPending, ...mpPending].map((t) => ({
    id: t.id,
    title: t.title,
    channel: t.channel,
    runAt: new Date(t.run_at),
  }));

  const taskRows = await Promise.all(
    tasks.map(async (t) => {
      const [draft, items, run] = await Promise.all([
        getFbDraft(t.draft_id),
        getTaskItems(t.id),
        getTaskRun(t.id),
      ]);
      const posted = items.filter((i) => i.status === "posted").length;
      const total = items.length;
      const jitterSec = run?.jitter_sec ?? 0;
      const startAt = new Date(new Date(t.run_at).getTime() + jitterSec * 1000);
      const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      return {
        jitterMin: Math.round(jitterSec / 60),
        startAbout: hm(startAt),
        clash:
          t.status === "pending"
            ? clashNoteFor({ id: t.id, title: draft?.title || t.title, channel: t.channel, runAt: new Date(t.run_at) }, queue)
            : null,
        id: t.id,
        draftId: t.draft_id,
        channel: t.channel,
        title: draft?.title || t.title || "（文案已刪）",
        runAt: fmtDateTime(t.run_at),
        runAtInput: toDatetimeLocal(new Date(t.run_at)),
        overdue: (t.status === "pending" || t.status === "running") && startAt <= new Date(),
        timeline: items.some((i) => i.channel === "self"),
        groupCount: items.filter((i) => i.channel === "group").length,
        shareIg: items.some((i) => i.channel === "ig"),
        shareThreads: items.some((i) => i.channel === "threads"),
        progress: total > 0 ? `${posted}/${total}` : "",
        autoPublish: run?.auto_publish === 1,
        status: t.status,
        statusLabel: STATUS_LABEL[t.status] || t.status,
        statusTone: STATUS_TONE[t.status] || "neutral",
        attempts: run?.attempts ?? 0,
        lastError: run?.last_error ?? null,
      };
    }),
  );

  return (
    <>
      <div className={styles.eyebrow} style={{ color: CIS.textMute }}>
        Scheduling
      </div>
      <h1 className={styles.pageTitle}>排程任務</h1>
      <p className={styles.pageLead} style={{ color: CIS.textSub }}>
        排好時間，到點桌機自己開瀏覽器去發 —— 一個社團約 1 分鐘，社團之間隨機隔 3～5 分鐘（你拍板的節奏）。
        {JITTER_MAX_MINUTES > 0
          ? ` 擬真模式：排定的時間會再隨機延後 0～${JITTER_MAX_MINUTES} 分鐘才開始，不會每次都準點。`
          : ""}
        {" "}
        排到同一時段也不會同時發：桌機一次只開一個瀏覽器，一般貼文先、Marketplace 後，後面那筆會自己排隊；
        兩篇不同文案至少隔 {MIN_GAP_MINUTES} 分
        {CHANNEL_GAP_MINUTES > 0 ? `、一般貼文與 Marketplace 之間至少隔 ${CHANNEL_GAP_MINUTES} 分` : "，Marketplace 一次上架不等間隔"}。
      </p>

      <div className={styles.tabs}>
        {FB_CHANNELS.map((c) => {
          const active = c.key === channel;
          return (
            <Link
              key={c.key}
              href={`/admin/fb/schedule?channel=${c.key}`}
              className={styles.tab}
              style={{
                background: active ? CIS.blue : "rgba(15,23,42,0.05)",
                color: active ? "#fff" : CIS.textSub,
                border: `1px solid ${active ? CIS.blue : CIS.cardBorder}`,
              }}
            >
              <Icon name={c.icon as IconName} size={14} />
              {c.label}
              <span className={styles.tabCount}>{counts[c.key as FbChannel]}</span>
            </Link>
          );
        })}
      </div>

      {channel === "marketplace" ? (
        <div
          className={styles.notice}
          style={{ background: "rgba(245,158,11,0.09)", border: "1px solid rgba(245,158,11,0.26)", color: CIS.textSub }}
        >
          <Icon name="warning" size={16} color="#b45309" className={styles.noticeIcon} />
          <div>
            <strong style={{ color: "#b45309" }}>到點是桌機 runner 自動發 Marketplace，不是這個網站。</strong>{" "}
            排定時間或按「立即發佈」，桌機 runner 會開瀏覽器填表單、上傳照片、（選擇性）勾社團、按發佈。
            前提：那台桌機要開著、runner 要在跑。發佈前貼文庫的「狀況」沒選會被擋下來。
          </div>
        </div>
      ) : !runnerReady ? (
        <div
          className={styles.notice}
          style={{ background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.3)", color: CIS.textSub }}
        >
          <Icon name="warning" size={16} color="#e11d48" className={styles.noticeIcon} />
          <div>
            <strong style={{ color: "#e11d48" }}>桌機還沒接上。</strong> <code>FB_RUNNER_TOKEN</code> 還沒設，
            排進去的任務不會有人去執行。
          </div>
        </div>
      ) : (
        <div
          className={styles.notice}
          style={{ background: "rgba(90,145,225,0.09)", border: "1px solid rgba(90,145,225,0.26)", color: CIS.textSub }}
        >
          <Icon name="desktop" size={16} color={CIS.blueSoft} className={styles.noticeIcon} />
          <div>
            <strong style={{ color: CIS.blueSoft }}>到點是桌機在發，不是這個網站。</strong> 桌機關機的話任務會停在
            「等時間到」，開機後只要還沒過失效時間就會補發（預設 6 小時）—— 隔天才開機不會把昨天的貼文突然噴出去。
          </div>
        </div>
      )}

      {/* key={channel}：換通路分頁時整個重建表單。不加的話 React 會沿用同一份 state，
          「選了哪則文案」會停在上一個通路的值（那則在新通路的清單裡根本不存在）。 */}
      <ScheduleForm
        key={channel}
        drafts={drafts.map((d) => ({ id: d.id, title: d.title }))}
        groups={groupOptions}
        channel={channel}
        preselectDraft={sp.draft || ""}
        marketplaceOnly={channel === "marketplace"}
        social={{
          ig: { connected: social.ig.connected, username: social.ig.username, appConfigured: social.ig.appConfigured },
          threads: { connected: social.threads.connected, username: social.threads.username, appConfigured: social.threads.appConfigured },
        }}
      />

      <h3 className={styles.cardTitle} style={{ marginTop: 26 }}>
        <Icon name="list" size={16} color={CIS.textMute} />
        排程中的任務
      </h3>

      {taskRows.length === 0 ? (
        <div className={styles.empty} style={{ borderColor: CIS.cardBorder, color: CIS.textMute }}>
          「{channelLabel(channel)}」還沒有排程。
        </div>
      ) : (
        taskRows.map((t) => <TaskRow key={t.id} task={t} />)
      )}
    </>
  );
}
