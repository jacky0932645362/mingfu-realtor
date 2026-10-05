"use client";
/**
 * 排程列表的一列。可以改時間、取消排程；Marketplace 那列還有「發完了」——
 * 自己在桌機手動發過、或 runner 沒設起來時，用它把這筆收掉。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cancelTaskAction, completeTaskAction, rescheduleTaskAction } from "@/lib/actions/fb-actions";
import { CIS, CHIP, type ChipTone } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import { WhenPicker } from "@/app/admin/_ui/WhenPicker";
import styles from "../fb.module.css";

type Task = {
  id: string;
  draftId: string;
  channel: string;
  title: string;
  runAt: string;
  runAtInput: string;
  /** 擬真抖動（分）；0 ＝ 沒抖（立即發佈、或關掉了） */
  jitterMin: number;
  /** run_at ＋ 抖動 的時:分，「約幾點開始」 */
  startAbout: string;
  /** 跟別的任務排太近時的說明（會排隊、不會同時發）；沒有就 null */
  clash: string | null;
  overdue: boolean;
  timeline: boolean;
  groupCount: number;
  shareIg?: boolean;
  shareThreads?: boolean;
  progress: string;
  autoPublish: boolean;
  status: string;
  statusLabel: string;
  statusTone: string;
  attempts: number;
  lastError: string | null;
};

export function TaskRow({ task }: { task: Task }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(task.runAtInput);
  const [msg, setMsg] = useState<string | null>(null);

  const cancel = () => {
    if (!window.confirm(`取消這個排程？\n\n「${task.title}」${task.runAt}`)) return;
    start(async () => {
      await cancelTaskAction(task.id);
      router.refresh();
    });
  };

  const saveTime = () =>
    start(async () => {
      const res = await rescheduleTaskAction(task.id, when);
      if (res.ok) {
        setEditing(false);
        setMsg(null);
        router.refresh();
      } else {
        setMsg(res.error || "改時間失敗");
      }
    });

  const complete = () =>
    start(async () => {
      await completeTaskAction(task.id);
      router.refresh();
    });

  const tone = CHIP[task.statusTone as ChipTone] || CHIP.neutral;
  const where = [
    task.timeline ? "自己的動態" : "",
    task.shareIg ? "Instagram" : "",
    task.shareThreads ? "Threads" : "",
    task.groupCount > 0 ? `${task.groupCount} 個社團` : "",
  ]
    .filter(Boolean)
    .join(" + ");

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
            href={`/admin/fb/library/${task.draftId}?channel=${task.channel}`}
            className={styles.itemTitle}
            style={{ color: CIS.text, textDecoration: "none" }}
          >
            {task.title}
          </Link>
          <div className={styles.meta} style={{ color: task.overdue ? "#b45309" : CIS.textMute }}>
            {task.overdue ? "⏰ 時間到了 · " : ""}
            {task.runAt}
            {task.jitterMin > 0 && (task.status === "pending" || task.status === "running")
              ? ` · 擬真 +${task.jitterMin} 分（約 ${task.startAbout} 開始）`
              : ""}
            {where ? ` · ${where}` : ""}
            {task.progress && task.progress !== "0/0" ? ` · 已發 ${task.progress}` : ""}
          </div>
          {task.lastError ? (
            <div style={{ fontSize: 12.5, color: "#e11d48", marginTop: 5, lineHeight: 1.6 }}>
              {task.lastError}
              {task.attempts > 1 ? `（試了 ${task.attempts} 次）` : ""}
            </div>
          ) : null}
          {task.clash ? (
            <div style={{ fontSize: 12.5, color: "#b45309", marginTop: 5, lineHeight: 1.6 }}>⏳ {task.clash}</div>
          ) : null}
        </div>

        <div className={styles.chipRow}>
          {task.channel === "post" ? (
            <span
              className={styles.chip}
              style={{
                background: task.autoPublish ? CHIP.danger.bg : CHIP.info.bg,
                color: task.autoPublish ? CHIP.danger.color : CHIP.info.color,
                borderColor: task.autoPublish ? CHIP.danger.border : CHIP.info.border,
              }}
            >
              <Icon name="desktop" size={11} />
              {task.autoPublish ? "桌機全自動" : "桌機備好、你按發佈"}
            </span>
          ) : (
            <span
              className={styles.chip}
              style={{ background: CHIP.danger.bg, color: CHIP.danger.color, borderColor: CHIP.danger.border }}
            >
              <Icon name="desktop" size={11} />
              桌機 runner 自動發
            </span>
          )}
          <span className={styles.chip} style={{ background: tone.bg, color: tone.color, borderColor: tone.border }}>
            {task.statusLabel}
          </span>
        </div>
      </div>

      {editing ? (
        <div style={{ marginTop: 11, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <WhenPicker value={when} onChange={setWhen} disabled={pending} />
          <button
            type="button"
            className={styles.btn}
            style={{ background: CIS.blue, color: "#fff" }}
            disabled={pending}
            onClick={saveTime}
          >
            <Icon name={pending ? "loading" : "save"} size={14} />
            存新時間
          </button>
          <button
            type="button"
            className={styles.btn}
            style={{ background: "transparent", color: CIS.textMute, borderColor: CIS.cardBorder }}
            disabled={pending}
            onClick={() => {
              setEditing(false);
              setWhen(task.runAtInput);
              setMsg(null);
            }}
          >
            取消
          </button>
          {msg ? <span style={{ fontSize: 12.5, color: "#e11d48" }}>{msg}</span> : null}
        </div>
      ) : task.status === "pending" || task.status === "running" ? (
        <div className={styles.btnRow} style={{ marginTop: 11 }}>
          {task.channel === "marketplace" ? (
            <button
              type="button"
              className={styles.btn}
              style={{ background: "rgba(34,197,94,0.14)", color: "#16a34a", borderColor: "rgba(34,197,94,0.3)" }}
              disabled={pending}
              onClick={complete}
            >
              <Icon name="check" size={14} />
              發完了
            </button>
          ) : null}
          <button
            type="button"
            className={styles.btn}
            style={{ background: "transparent", color: CIS.textSub, borderColor: CIS.cardBorder }}
            disabled={pending}
            onClick={() => setEditing(true)}
          >
            <Icon name="clock" size={14} />
            改時間
          </button>
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
      ) : task.status === "failed" || task.status === "expired" ? (
        <div className={styles.btnRow} style={{ marginTop: 11 }}>
          <button
            type="button"
            className={styles.btn}
            style={{ background: "transparent", color: CIS.textSub, borderColor: CIS.cardBorder }}
            disabled={pending}
            onClick={() => setEditing(true)}
          >
            <Icon name="refresh" size={14} />
            改時間重排
          </button>
          <button
            type="button"
            className={styles.btn}
            style={{ background: "transparent", color: CIS.textMute, borderColor: CIS.cardBorder }}
            disabled={pending}
            onClick={cancel}
          >
            <Icon name="trash" size={14} />
            刪掉
          </button>
        </div>
      ) : null}
    </div>
  );
}
