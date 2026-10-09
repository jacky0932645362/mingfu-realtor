import Link from "next/link";
import {
  listFbDrafts,
  listDeleteTasks,
  getDeleteTaskRun,
  listDeletableGroups,
  listDeletableDrafts,
  getFbGroup,
  fmtDateTime,
  firstLineForMatch,
} from "@/lib/fb-factory";
import { listIdentities } from "@/lib/fb-identity";
import { CIS, CHIP } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import { DeleteForm } from "./DeleteForm";
import { DeleteTaskRow } from "./DeleteTaskRow";
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
  done: "處理完了",
  failed: "失敗",
  expired: "過期沒處理",
  cancelled: "取消了",
};

export default async function DeletePage() {
  const [allDrafts, tasks, deletableGroups, deletableDrafts, identityRows] = await Promise.all([
    listFbDrafts({ channel: "post", queue: "done" }),
    listDeleteTasks({ limit: 50 }),
    listDeletableGroups(),
    listDeletableDrafts(),
    listIdentities(),
  ]);
  // 只有真的貼出去的才有得刪 —— queue:"done" 連「排程中但還沒發」的也算進來，這裡再篩一次。
  const posted = allDrafts.filter((d) => d.post_status === "posted");

  const runnerReady = Boolean(process.env.FB_RUNNER_TOKEN && process.env.FB_RUNNER_TOKEN.length >= 16);

  const taskRows = await Promise.all(
    tasks.map(async (t) => {
      const run = await getDeleteTaskRun(t.id);
      const group = t.group_id ? await getFbGroup(t.group_id) : null;
      return {
        id: t.id,
        draftId: t.draft_id,
        title: t.title,
        matchText: t.match_text,
        maxItems: t.max_items,
        olderThanDays: t.older_than_days,
        scopeLabel: group ? `社團：${group.name}` : null,
        runAt: fmtDateTime(t.run_at),
        overdue: (t.status === "pending" || t.status === "running") && new Date(t.run_at) <= new Date(),
        status: t.status,
        statusLabel: STATUS_LABEL[t.status] || t.status,
        statusTone: STATUS_TONE[t.status] || "neutral",
        deletedCount: run?.deleted_count ?? null,
        skippedCount: run?.skipped_count ?? null,
        lastError: run?.last_error ?? null,
        attempts: run?.attempts ?? 0,
        autoConfirm: run?.auto_confirm === 1,
      };
    }),
  );

  return (
    <>
      <div className={styles.eyebrow} style={{ color: CIS.textMute }}>
        Cleanup
      </div>
      <h1 className={styles.pageTitle}>自動刪文</h1>
      <p className={styles.pageLead} style={{ color: CIS.textSub }}>
        文案發到社團一陣子之後，讓桌機自動去各社團的「你的內容」把那些貼文清掉
        （不是活動紀錄——帶照片的社團貼文在活動紀錄裡看不到，2026-09-20 查證過）。
        選擇你要用哪種方式挑目標，挑完再列清單——避免一進來就要撈全部資料卡頓。
      </p>

      <div
        className={styles.notice}
        style={{ background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.3)", color: CIS.textSub }}
      >
        <Icon name="warning" size={16} color="#e11d48" className={styles.noticeIcon} />
        <div>
          <strong style={{ color: "#e11d48" }}>刪除是不可逆的。</strong> FB
          貼文刪掉就救不回來（進垃圾桶留 30 天的是手動刪個人貼文；這條路線走的是永久刪除）。
          每次執行前後都會留一份清單在 <code>tools/fb-autopost/deleted-log/</code>，
          但刪錯了沒辦法復原 —— 下手前再看一眼比對的內容準不準。
        </div>
      </div>

      {identityRows.length > 1 ? (
        <div
          className={styles.notice}
          style={{ background: "rgba(245,158,11,0.09)", border: "1px solid rgba(245,158,11,0.26)", color: CIS.textSub }}
        >
          <Icon name="user" size={16} color="#b45309" className={styles.noticeIcon} />
          <div>
            <strong style={{ color: "#b45309" }}>自動刪文目前只處理「主帳號」發的貼文。</strong>
            用其他發文身分發的文不會出現在下面的清單裡——刪文一定要用當初發文的那個帳號登入才刪得到，
            怕用錯帳號，其他身分的自動刪文還沒開放（要刪請先到 FB 自己刪）。
          </div>
        </div>
      ) : null}

      {!runnerReady ? (
        <div
          className={styles.notice}
          style={{ background: "rgba(245,158,11,0.09)", border: "1px solid rgba(245,158,11,0.26)", color: CIS.textSub }}
        >
          <Icon name="warning" size={16} color="#b45309" className={styles.noticeIcon} />
          <div>
            <strong style={{ color: "#b45309" }}>桌機還沒接上。</strong> <code>FB_RUNNER_TOKEN</code> 還沒設，
            排進去的清單不會有人去執行。
          </div>
        </div>
      ) : (
        <div
          className={styles.notice}
          style={{ background: "rgba(90,145,225,0.09)", border: "1px solid rgba(90,145,225,0.26)", color: CIS.textSub }}
        >
          <Icon name="desktop" size={16} color={CIS.blueSoft} className={styles.noticeIcon} />
          <div>
            <strong style={{ color: CIS.blueSoft }}>到點是桌機在刪，不是這個網站。</strong> 桌機關機的話會停在
            「等時間到」，開機後只要還沒過失效時間（預設 72 小時）就會補跑。
          </div>
        </div>
      )}

      <h3 className={styles.cardTitle}>
        <Icon name="hand" size={16} color={CIS.textMute} />
        選擇你要進行的刪除方式
      </h3>

      <div className={styles.entryGrid}>
        <Link
          href="/admin/fb/delete/groups"
          className={styles.entryCard}
          style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}
        >
          <Icon name="users" size={20} color={CIS.blueSoft} />
          <div className={styles.entryCardTitle} style={{ color: CIS.text }}>
            按社團清空
          </div>
          <div className={styles.entryCardDesc} style={{ color: CIS.textMute }}>
            選一個社團，把這個社團裡自動發過的所有貼文一次清掉
            {deletableGroups.length > 0 ? `（目前 ${deletableGroups.length} 個社團有得清）` : ""}
          </div>
          <span className={styles.entryCardLink} style={{ color: CIS.blueSoft }}>
            進入 →
          </span>
        </Link>

        <Link
          href="/admin/fb/delete/drafts"
          className={styles.entryCard}
          style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}
        >
          <Icon name="megaphone" size={20} color={CIS.blueSoft} />
          <div className={styles.entryCardTitle} style={{ color: CIS.text }}>
            按工作流清空
          </div>
          <div className={styles.entryCardDesc} style={{ color: CIS.textMute }}>
            選一則發過的文案，把它發過的所有廣告貼文一次清掉
            {deletableDrafts.length > 0 ? `（目前 ${deletableDrafts.length} 則文案有得清）` : ""}
          </div>
          <span className={styles.entryCardLink} style={{ color: CIS.blueSoft }}>
            進入 →
          </span>
        </Link>
      </div>

      <h3 className={styles.cardTitle}>
        <Icon name="list" size={16} color={CIS.textMute} />
        刪除清單
      </h3>

      {taskRows.length === 0 ? (
        <div className={styles.empty} style={{ borderColor: CIS.cardBorder, color: CIS.textMute }}>
          目前沒有排程中的刪文任務。
        </div>
      ) : (
        taskRows.map((t) => <DeleteTaskRow key={t.id} task={t} />)
      )}

      <details style={{ marginTop: 26 }}>
        <summary
          style={{
            cursor: "pointer",
            listStyle: "none",
            color: CIS.textMute,
            fontSize: 13,
            fontWeight: 700,
            padding: "6px 2px",
          }}
        >
          進階：自訂條件排程（手動選文案、改比對字、指定時間、只刪 N 天前的）
        </summary>
        <div style={{ marginTop: 12 }}>
          <DeleteForm
            drafts={posted.map((d) => ({ id: d.id, title: d.title, matchPreview: firstLineForMatch(d.post_text) }))}
          />
        </div>
      </details>
    </>
  );
}
