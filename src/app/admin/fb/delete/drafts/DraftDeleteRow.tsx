"use client";
/**
 * 「按工作流清空」的一列。一則文案＝一個「工作流」，清空＝把它發過的所有地方
 * （自己的動態＋全部社團）一次排掉。跟 GroupDeleteRow 同一套安全模式，見那邊的說明。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { quickDeleteDraftAction } from "@/lib/actions/fb-actions";
import { CIS, CHIP } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import styles from "../../fb.module.css";

export type DeletableDraftView = {
  draftId: string;
  title: string;
  matchPreview: string;
  /** 發到社團的篇數＝一鍵清空真正會處理的數字。 */
  groupPostedCount: number;
  /** 發到自己動態的篇數（這條路刪不到，要手動）。 */
  selfCount: number;
  groupCount: number;
  lastPostedLabel: string;
  alreadyQueued: boolean;
};

export function DraftDeleteRow({ draft }: { draft: DeletableDraftView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const run = (autoConfirm: boolean) => {
    if (autoConfirm) {
      const sure = window.confirm(
        `確定要清空「${draft.title}」嗎？\n\n這篇發到 ${draft.groupCount} 個社團的 ${draft.groupPostedCount} 篇會排給桌機真的刪除，動作不可逆。${
          draft.selfCount ? `\n（自己動態上的 ${draft.selfCount} 篇不在這條路裡，要自己手動刪。）` : ""
        }\n\n不確定的話可以按「先預覽」，桌機只會列清單、不會真的刪。`,
      );
      if (!sure) return;
    }
    setMsg(null);
    start(async () => {
      const res = await quickDeleteDraftAction(draft.draftId, autoConfirm);
      setMsg(res.ok ? { tone: "ok", text: res.message || "已排入" } : { tone: "bad", text: res.error || "排程失敗" });
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className={styles.listItem} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <Link
            href={`/admin/fb/library/${draft.draftId}`}
            className={styles.itemTitle}
            style={{ color: CIS.text, textDecoration: "none" }}
          >
            {draft.title}
          </Link>
          <div className={styles.meta} style={{ color: CIS.textMute }}>
            社團 {draft.groupPostedCount} 篇（{draft.groupCount} 個社團）
            {draft.selfCount ? ` · 自己動態 ${draft.selfCount} 篇（要手動刪）` : ""} · 最後一次 {draft.lastPostedLabel}
          </div>
          <div style={{ fontSize: 12.5, color: CIS.textMute, marginTop: 5 }}>比對：「{draft.matchPreview}」</div>
          {msg ? (
            <div style={{ fontSize: 12.5, marginTop: 6, color: msg.tone === "ok" ? "#16a34a" : "#e11d48" }}>
              {msg.text}
            </div>
          ) : null}
        </div>

        {draft.alreadyQueued ? (
          <span
            className={styles.chip}
            style={{ background: CHIP.info.bg, color: CHIP.info.color, borderColor: CHIP.info.border, flexShrink: 0 }}
          >
            <Icon name="clock" size={11} />
            已經排進清單了
          </span>
        ) : (
          <div className={styles.btnRow} style={{ flexShrink: 0 }}>
            <button
              type="button"
              className={styles.btn}
              style={{ background: "transparent", color: CIS.textSub, borderColor: CIS.cardBorder }}
              disabled={pending}
              onClick={() => run(false)}
            >
              先預覽
            </button>
            <button
              type="button"
              className={styles.btn}
              style={{ background: "#e11d48", color: "#fff" }}
              disabled={pending}
              onClick={() => run(true)}
            >
              <Icon name={pending ? "loading" : "trash"} size={14} />
              清空{draft.groupPostedCount}篇
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
