"use client";
/**
 * 排一個自動刪文任務。
 * 預設值：時間＝3 天後早上 10:00（給貼文一點曝光時間，也不用真的等本人想起來要刪）；
 *          比對文字＝該篇文案第一行（鉤子），可以自己改；
 *          自動確認預設開（本人 2026-09-05 拍板要全自動）。
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDeleteTaskAction } from "@/lib/actions/fb-actions";
import { CIS } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import { WhenPicker } from "@/app/admin/_ui/WhenPicker";
import styles from "../fb.module.css";

type DraftOption = { id: string; title: string; matchPreview: string };

const inputStyle = { background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text };

function defaultRunAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  d.setHours(10, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function DeleteForm({ drafts }: { drafts: DraftOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const [draftId, setDraftId] = useState(drafts[0]?.id || "");
  const [matchText, setMatchText] = useState(drafts[0]?.matchPreview || "");
  const [runAt, setRunAt] = useState(defaultRunAt);
  const [maxItems, setMaxItems] = useState(15);
  const [olderThanDays, setOlderThanDays] = useState("");
  // 預設關：第一次用務必先跑預覽模式，看過清單抓得準再自己勾開全自動（2026-09-05 本人交代）。
  const [autoConfirm, setAutoConfirm] = useState(false);

  const matchTooShort = useMemo(() => matchText.trim().length < 8, [matchText]);

  const pickDraft = (id: string) => {
    setDraftId(id);
    setMatchText(drafts.find((d) => d.id === id)?.matchPreview || "");
  };

  const submit = () => {
    setMsg(null);
    if (!draftId) return setMsg({ tone: "bad", text: "先挑一則已經發過的文案" });
    if (matchTooShort) return setMsg({ tone: "bad", text: "比對文字至少要 8 個字，太短容易連別篇貼文一起刪掉" });
    start(async () => {
      const res = await createDeleteTaskAction({
        draftId,
        matchText: matchText.trim(),
        runAt,
        maxItems,
        olderThanDays: olderThanDays === "" ? null : Number(olderThanDays),
        autoConfirm,
      });
      setMsg(res.ok ? { tone: "ok", text: res.message || "排好了" } : { tone: "bad", text: res.error || "排程失敗" });
      if (res.ok) router.refresh();
    });
  };

  if (drafts.length === 0) {
    return (
      <div className={styles.empty} style={{ borderColor: CIS.cardBorder, color: CIS.textMute }}>
        還沒有「已經發過」的文案可以排刪除。文案要先在排程任務發出去，這裡才排得到。
      </div>
    );
  }

  return (
    <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
      <h3 className={styles.cardTitle}>
        <Icon name="trash" size={16} color="#e11d48" />
        排一個自動刪文任務
      </h3>

      {msg ? (
        <div
          className={styles.notice}
          style={
            msg.tone === "ok"
              ? { background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#16a34a" }
              : { background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.3)", color: "#e11d48" }
          }
        >
          <Icon name={msg.tone === "ok" ? "success" : "error"} size={16} className={styles.noticeIcon} />
          <div>{msg.text}</div>
        </div>
      ) : null}

      <div className={styles.grid2}>
        <div className={styles.field}>
          <label className={styles.label} style={{ color: CIS.textSub }}>
            哪一則文案發出去的
          </label>
          <select className={styles.select} style={inputStyle} value={draftId} onChange={(e) => pickDraft(e.target.value)}>
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} style={{ color: CIS.textSub }}>
            什麼時候刪
          </label>
          <WhenPicker value={runAt} onChange={setRunAt} />
        </div>
      </div>

      <div className={styles.field} style={{ marginTop: 14 }}>
        <label className={styles.label} style={{ color: CIS.textSub }}>
          比對文字（貼文內文要含這段才會被刪，可以自己改）
        </label>
        <input
          className={styles.input}
          style={{ ...inputStyle, borderColor: matchTooShort ? "rgba(244,63,94,0.5)" : CIS.cardBorder }}
          value={matchText}
          onChange={(e) => setMatchText(e.target.value)}
          placeholder="例：698萬買得到海景平車？"
        />
        <div style={{ fontSize: 12, color: matchTooShort ? "#e11d48" : CIS.textMute, marginTop: 4 }}>
          {matchTooShort
            ? "太短了，至少要 8 個字，不然可能連別篇貼文一起刪掉"
            : "預設抓文案第一行（鉤子）——發到幾個社團，內文都一樣，會一起找到"}
        </div>
      </div>

      <div className={styles.grid2} style={{ marginTop: 14 }}>
        <div className={styles.field}>
          <label className={styles.label} style={{ color: CIS.textSub }}>
            最多刪幾篇
          </label>
          <input
            className={styles.input}
            style={inputStyle}
            type="number"
            min={1}
            max={50}
            value={maxItems}
            onChange={(e) => setMaxItems(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
          />
          <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 4 }}>
            抓「發到的社團數＋幾個」保險，例如發了 10 個社團就填 13～15
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} style={{ color: CIS.textSub }}>
            只刪幾天前的（選填）
          </label>
          <input
            className={styles.input}
            style={inputStyle}
            type="number"
            min={0}
            placeholder="不限制"
            value={olderThanDays}
            onChange={(e) => setOlderThanDays(e.target.value)}
          />
          <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 4 }}>
            留空＝不看日期，只要內文對得上就刪
          </div>
        </div>
      </div>

      <label
        className={styles.checkBox}
        style={{
          marginTop: 16,
          background: autoConfirm ? "rgba(244,63,94,0.08)" : CIS.bgSoft,
          border: `1px solid ${autoConfirm ? "rgba(244,63,94,0.3)" : CIS.cardBorder}`,
        }}
      >
        <input type="checkbox" checked={autoConfirm} onChange={(e) => setAutoConfirm(e.target.checked)} />
        <span>
          <strong style={{ color: autoConfirm ? "#e11d48" : CIS.text }}>
            {autoConfirm ? "🔴 時間到桌機自動真的刪（全自動）" : "時間到只先看、產生預覽清單，不會真的刪"}
          </strong>
          <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 3, lineHeight: 1.65 }}>
            {autoConfirm
              ? "跟批次刪社團貼文那支工具的節奏一樣：每篇之間隔 6～8 秒、每 20 篇停 15 秒，不會一次噴光。"
              : "適合第一次跑、或不確定比對文字準不準的時候 —— 桌機會把「符合條件的清單」寫出來，你看過沒問題再手動加 --confirm 重跑。"}
          </div>
        </span>
      </label>

      <div className={styles.btnRow} style={{ marginTop: 18 }}>
        <button
          type="button"
          className={styles.btn}
          style={{ background: "#e11d48", color: "#fff" }}
          disabled={pending || matchTooShort}
          onClick={submit}
        >
          <Icon name={pending ? "loading" : "trash"} size={15} />
          {pending ? "排程中…" : "排進刪除清單"}
        </button>
      </div>
    </section>
  );
}
