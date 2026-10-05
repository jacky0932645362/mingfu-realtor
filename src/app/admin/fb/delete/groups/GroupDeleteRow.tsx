"use client";
/**
 * 「按社團清空」的一列。一鍵動作，不用像舊表單那樣手動挑文案、打比對字、選時間——
 * 比對字串跟篇數都是伺服器從 fb_task_item 反推好的（quickDeleteGroupAction）。
 *
 * 保留兩顆按鈕（先預覽 / 清空）不是畫蛇添足：刪除不可逆，「清空」那顆多一道
 * window.confirm() 提醒，跟舊表單「自動確認預設關」是同一個安全原則，
 * 只是把「先勾開關再送出」簡化成「按下去前多問一次」，一次到位但不是無防備地一次到位。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { quickDeleteGroupAction } from "@/lib/actions/fb-actions";
import { CIS, CHIP } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import styles from "../../fb.module.css";

export type DeletableGroupView = {
  groupId: string;
  groupName: string;
  groupUrl: string | null;
  postedCount: number;
  draftCount: number;
  lastPostedLabel: string;
  hidden: boolean;
  alreadyQueued: boolean;
};

export function GroupDeleteRow({ group }: { group: DeletableGroupView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const run = (autoConfirm: boolean) => {
    if (autoConfirm) {
      const sure = window.confirm(
        `確定要清空「${group.groupName}」嗎？\n\n這個社團裡我們發過的 ${group.postedCount} 篇會排給桌機真的刪除，動作不可逆。\n\n不確定的話可以按「先預覽」，桌機只會列清單、不會真的刪。`,
      );
      if (!sure) return;
    }
    setMsg(null);
    start(async () => {
      const res = await quickDeleteGroupAction(group.groupId, autoConfirm);
      setMsg(res.ok ? { tone: "ok", text: res.message || "已排入" } : { tone: "bad", text: res.error || "排程失敗" });
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className={styles.listItem} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {group.groupUrl ? (
              <a
                href={group.groupUrl}
                target="_blank"
                rel="noreferrer"
                className={styles.itemTitle}
                style={{ color: CIS.text, textDecoration: "none" }}
              >
                {group.groupName}
              </a>
            ) : (
              <span className={styles.itemTitle} style={{ color: CIS.text }}>
                {group.groupName}
              </span>
            )}
            {group.hidden ? (
              <span
                className={styles.chip}
                style={{ background: CHIP.neutral.bg, color: CHIP.neutral.color, borderColor: CHIP.neutral.border }}
              >
                已封存
              </span>
            ) : null}
          </div>
          <div className={styles.meta} style={{ color: CIS.textMute }}>
            {group.postedCount} 篇 · 來自 {group.draftCount} 則文案 · 最後一次 {group.lastPostedLabel}
          </div>
          {msg ? (
            <div style={{ fontSize: 12.5, marginTop: 6, color: msg.tone === "ok" ? "#16a34a" : "#e11d48" }}>
              {msg.text}
            </div>
          ) : null}
        </div>

        {group.alreadyQueued ? (
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
              清空{group.postedCount}篇
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
