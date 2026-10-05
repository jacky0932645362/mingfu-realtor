"use client";
/**
 * 刪除清單的一列。可以取消還沒執行的；執行完的顯示刪了幾篇。
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cancelDeleteTaskAction } from "@/lib/actions/fb-actions";
import { CIS, CHIP, type ChipTone } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import styles from "../fb.module.css";

type Task = {
  id: string;
  draftId: string;
  title: string;
  matchText: string;
  maxItems: number;
  olderThanDays: number | null;
  /** 有值＝這筆是「按社團清空」排的，只限這一個社團；null＝「按工作流清空」／進階排程，不限社團。 */
  scopeLabel: string | null;
  runAt: string;
  overdue: boolean;
  status: string;
  statusLabel: string;
  statusTone: string;
  deletedCount: number | null;
  skippedCount: number | null;
  lastError: string | null;
  attempts: number;
  autoConfirm: boolean;
};

export function DeleteTaskRow({ task }: { task: Task }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const cancel = () => {
    if (!window.confirm(`取消這個刪除排程？\n\n「${task.title}」${task.runAt}`)) return;
    start(async () => {
      await cancelDeleteTaskAction(task.id);
      router.refresh();
    });
  };

  const tone = CHIP[task.statusTone as ChipTone] || CHIP.neutral;

  return (
    <div
      className={styles.listItem}
      style={{
        background: CIS.card,
        border: `1px solid ${task.overdue ? "rgba(245,158,11,0.35)" : CIS.cardBorder}`,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <Link
            href={`/admin/fb/library/${task.draftId}`}
            className={styles.itemTitle}
            style={{ color: CIS.text, textDecoration: "none" }}
          >
            {task.title}
          </Link>
          <div className={styles.meta} style={{ color: task.overdue ? "#b45309" : CIS.textMute }}>
            {task.overdue ? "⏰ 時間到了 · " : ""}
            {task.runAt} · 最多 {task.maxItems} 篇
            {task.olderThanDays != null ? ` · ${task.olderThanDays} 天前的` : ""}
          </div>
          <div style={{ fontSize: 12.5, color: CIS.textMute, marginTop: 5 }}>
            {task.scopeLabel ? `${task.scopeLabel} · ` : ""}
            比對：「{task.matchText}」
          </div>
          {task.status === "done" ? (
            <div style={{ fontSize: 12.5, color: "#16a34a", marginTop: 5 }}>
              {task.autoConfirm
                ? `刪了 ${task.deletedCount ?? 0} 篇`
                : `只做了預覽（${task.skippedCount ?? 0} 篇待刪，沒有真的刪）`}
            </div>
          ) : null}
          {task.lastError ? (
            <div style={{ fontSize: 12.5, color: "#e11d48", marginTop: 5, lineHeight: 1.6 }}>
              {task.lastError}
              {task.attempts > 1 ? `（試了 ${task.attempts} 次）` : ""}
            </div>
          ) : null}
        </div>

        <div className={styles.chipRow}>
          <span
            className={styles.chip}
            style={{
              background: task.autoConfirm ? CHIP.danger.bg : CHIP.info.bg,
              color: task.autoConfirm ? CHIP.danger.color : CHIP.info.color,
              borderColor: task.autoConfirm ? CHIP.danger.border : CHIP.info.border,
            }}
          >
            <Icon name="desktop" size={11} />
            {task.autoConfirm ? "桌機全自動刪" : "桌機只預覽"}
          </span>
          <span className={styles.chip} style={{ background: tone.bg, color: tone.color, borderColor: tone.border }}>
            {task.statusLabel}
          </span>
        </div>
      </div>

      {task.status === "pending" || task.status === "running" ? (
        <div className={styles.btnRow} style={{ marginTop: 11 }}>
          <button
            type="button"
            className={styles.btn}
            style={{ background: "transparent", color: CIS.textMute, borderColor: CIS.cardBorder }}
            disabled={pending}
            onClick={cancel}
          >
            <Icon name="close" size={14} />
            取消排程
          </button>
        </div>
      ) : null}
    </div>
  );
}
