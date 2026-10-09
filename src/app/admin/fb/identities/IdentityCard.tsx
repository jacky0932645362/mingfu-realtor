"use client";
/**
 * 一個發文身分的卡片：登入狀態、名下社團／排程數、改名／停用／刪除，
 * 還沒登入的個人帳號會展開「怎麼登入」的步驟（含這個身分的登入代號，可複製）。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  renameIdentityAction,
  setIdentityActiveAction,
  deleteIdentityAction,
} from "@/lib/actions/identity-actions";
import { CIS, CHIP, type ChipTone } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import styles from "../fb.module.css";

export type IdentityCardData = {
  id: string;
  name: string;
  kind: string;
  kindLabel: string;
  isDefault: boolean;
  isActive: boolean;
  authKey: string | null;
  loginState: "ok" | "missing" | "stale" | "unknown";
  loginLabel: string;
  loginCheckedText: string | null;
  loginNote: string | null;
  groups: number;
  activeGroups: number;
  pendingTasks: number;
  doneTasks: number;
  lastDoneText: string | null;
};

const TONE: Record<IdentityCardData["loginState"], ChipTone> = {
  ok: "success",
  missing: "danger",
  stale: "warn",
  unknown: "neutral",
};

const inputStyle = { background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text };

export function IdentityCard({ data }: { data: IdentityCardData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(data.name);
  const [copied, setCopied] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { tone: "ok", text: r.message || "好了" } : { tone: "bad", text: r.error || "失敗" });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  const tone = CHIP[TONE[data.loginState]];
  const needLoginSteps = !data.isDefault && data.authKey && data.loginState !== "ok";

  const copyKey = async () => {
    if (!data.authKey) return;
    try {
      await navigator.clipboard.writeText(data.authKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪貼簿被擋就算了，代號就印在旁邊，手抄也行 */
    }
  };

  return (
    <div
      className={styles.listItem}
      style={{
        background: CIS.card,
        border: `1px solid ${CIS.cardBorder}`,
        opacity: data.isActive ? 1 : 0.7,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          {renaming ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                className={styles.input}
                style={{ ...inputStyle, maxWidth: 320 }}
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
              <button
                type="button"
                className={styles.btn}
                style={{ background: CIS.blue, color: "#fff" }}
                disabled={pending || !name.trim()}
                onClick={() => run(() => renameIdentityAction(data.id, name), () => setRenaming(false))}
              >
                存
              </button>
              <button
                type="button"
                className={styles.btn}
                style={{ background: "transparent", color: CIS.textMute, borderColor: CIS.cardBorder }}
                disabled={pending}
                onClick={() => {
                  setRenaming(false);
                  setName(data.name);
                }}
              >
                取消
              </button>
            </div>
          ) : (
            <div className={styles.itemTitle} style={{ color: CIS.text, display: "flex", gap: 8, alignItems: "center" }}>
              <Icon name="user" size={16} color={CIS.blueSoft} />
              {data.name}
            </div>
          )}
          <div className={styles.meta} style={{ color: CIS.textMute, lineHeight: 1.8 }}>
            {data.kindLabel}
            {data.isDefault ? " · 原本的帳號（登入檔 fb-state.json）" : data.authKey ? ` · 登入代號 ${data.authKey}` : ""}
            <br />
            社團 {data.groups} 個（發文清單 {data.activeGroups}）· 排程中 {data.pendingTasks} 筆 · 已發完 {data.doneTasks} 筆
            {data.lastDoneText ? ` · 最近一次 ${data.lastDoneText}` : ""}
          </div>
        </div>

        <div className={styles.chipRow}>
          {data.isDefault ? (
            <span className={styles.chip} style={{ background: CHIP.info.bg, color: CHIP.info.color, borderColor: CHIP.info.border }}>
              主帳號
            </span>
          ) : null}
          {!data.isActive ? (
            <span className={styles.chip} style={{ background: CHIP.neutral.bg, color: CHIP.neutral.color, borderColor: CHIP.neutral.border }}>
              已停用
            </span>
          ) : null}
          <span className={styles.chip} style={{ background: tone.bg, color: tone.color, borderColor: tone.border }}>
            <Icon name={data.loginState === "ok" ? "check" : data.loginState === "missing" ? "warning" : "clock"} size={11} />
            {data.loginLabel}
          </span>
        </div>
      </div>

      {data.loginCheckedText || data.loginNote ? (
        <div style={{ marginTop: 6, fontSize: 12.5, color: CIS.textMute, lineHeight: 1.7 }}>
          {data.loginCheckedText ? `桌機 ${data.loginCheckedText} 回報` : ""}
          {data.loginNote ? `：${data.loginNote}` : ""}
        </div>
      ) : null}

      {needLoginSteps ? (
        <div
          style={{
            marginTop: 12,
            padding: "12px 14px",
            borderRadius: 10,
            background: "rgba(90,145,225,0.07)",
            border: `1px solid rgba(90,145,225,0.25)`,
            fontSize: 13,
            lineHeight: 1.9,
            color: CIS.textSub,
          }}
        >
          <strong style={{ color: CIS.text }}>怎麼登入這個帳號（桌機上做一次）：</strong>
          <ol style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            <li>
              在桌機雙擊桌面「批次檔案」裡的 <code>FB登入-其他帳號.bat</code>
            </li>
            <li>
              它問「登入代號」時輸入：
              <code style={{ margin: "0 6px", fontWeight: 800, color: CIS.text }}>{data.authKey}</code>
              <button
                type="button"
                className={styles.btn}
                style={{ minHeight: 26, padding: "2px 9px", fontSize: 12, background: "transparent", color: CIS.textSub, borderColor: CIS.cardBorder }}
                onClick={copyKey}
              >
                <Icon name="copy" size={11} />
                {copied ? "已複製" : "複製"}
              </button>
            </li>
            <li>在跳出的瀏覽器登入<strong>這個帳號</strong>（含二階段驗證），登入完回到黑色視窗按 Enter</li>
            <li>
              再雙擊 <code>FB抓社團-其他帳號.bat</code>、輸入同一個代號，把這個帳號加入的社團抓進清單（約 15～20 分鐘）
            </li>
            <li>桌機 runner 下一輪（最多 5 分鐘）會回報登入狀態，這張卡片就會變成「登入有效」</li>
          </ol>
        </div>
      ) : null}

      <div className={styles.btnRow} style={{ marginTop: 12 }}>
        <Link
          href={`/admin/fb/groups?identity=${encodeURIComponent(data.id)}`}
          className={styles.btn}
          style={{ background: "transparent", color: CIS.textSub, borderColor: CIS.cardBorder }}
        >
          <Icon name="users" size={14} />
          這個身分的社團清單
        </Link>
        <button
          type="button"
          className={styles.btn}
          style={{ background: "transparent", color: CIS.textSub, borderColor: CIS.cardBorder }}
          disabled={pending}
          onClick={() => setRenaming(true)}
        >
          <Icon name="edit" size={14} />
          改名
        </button>
        {!data.isDefault ? (
          <>
            <button
              type="button"
              className={styles.btn}
              style={{ background: "transparent", color: CIS.textSub, borderColor: CIS.cardBorder }}
              disabled={pending}
              onClick={() => run(() => setIdentityActiveAction(data.id, !data.isActive))}
            >
              <Icon name={data.isActive ? "pause" : "check"} size={14} />
              {data.isActive ? "停用" : "重新啟用"}
            </button>
            <button
              type="button"
              className={styles.btn}
              style={{ background: "transparent", color: CIS.textMute, borderColor: CIS.cardBorder }}
              disabled={pending}
              onClick={() => {
                if (!window.confirm(`刪掉發文身分「${data.name}」？\n\n只刪這個身分本身；名下還有社團或排程紀錄會被擋下來（那種請用「停用」）。`)) return;
                run(() => deleteIdentityAction(data.id));
              }}
            >
              <Icon name="trash" size={14} />
              刪除
            </button>
          </>
        ) : null}
        {msg ? <span style={{ fontSize: 12.5, color: msg.tone === "ok" ? "#16a34a" : "#e11d48" }}>{msg.text}</span> : null}
      </div>
    </div>
  );
}
