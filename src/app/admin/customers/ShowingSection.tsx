"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CIS, CHIP, type ChipTone } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import { SHOWING_STATUSES, SHOWING_INTENT_LEVELS, type ShowingInput, type ShowingRow } from "@/lib/showing";
import { createShowingAction } from "@/lib/actions/showing-actions";
import styles from "./customers.module.css";

const inputStyle: React.CSSProperties = {
  minHeight: 44,
  width: "100%",
  padding: "9px 11px",
  borderRadius: 7,
  border: `1px solid ${CIS.cardBorder}`,
  background: CIS.bgSoft,
  color: CIS.text,
  fontSize: 15,
  fontFamily: "inherit",
};

const textareaStyle: React.CSSProperties = { ...inputStyle, minHeight: 64, resize: "vertical" };

function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function daysFromNowLocal(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
}

function statusTone(status: string): ChipTone {
  if (status === "completed") return "success";
  if (status === "scheduled") return "info";
  if (status === "no_show") return "danger";
  return "neutral";
}

function stars(rating: number | null): string {
  if (!rating) return "";
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}

function formatDateTw(date: Date): string {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  const color = CHIP[tone];
  return (
    <span className={styles.chip} style={{ background: color.bg, color: color.color, borderColor: color.border }}>
      {children}
    </span>
  );
}

const STATUS_LABELS: Record<string, string> = Object.fromEntries(SHOWING_STATUSES.map((s) => [s.key, s.label]));

export default function ShowingSection({ customerId, showings }: { customerId: string; showings: ShowingRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [propertyName, setPropertyName] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  // 空字串起手，避免 SSR 當下的時間跟 hydrate 當下的時間差幾秒/幾分鐘造成 hydration mismatch，
  // mount 後才用 effect 補上「現在時間」。
  const [visitedAt, setVisitedAt] = useState("");
  const [status, setStatus] = useState("completed");
  const [rating, setRating] = useState("0");
  const [liked, setLiked] = useState("");
  const [disliked, setDisliked] = useState("");
  const [intentLevel, setIntentLevel] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [note, setNote] = useState("");
  const [followUpChoice, setFollowUpChoice] = useState<"none" | "tomorrow" | "3d" | "7d" | "custom">("none");
  const [customFollowUp, setCustomFollowUp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setVisitedAt((prev) => prev || nowLocal());
  }, []);

  const resolveFollowUpAt = (): Date | null => {
    if (followUpChoice === "tomorrow") return new Date(daysFromNowLocal(1));
    if (followUpChoice === "3d") return new Date(daysFromNowLocal(3));
    if (followUpChoice === "7d") return new Date(daysFromNowLocal(7));
    if (followUpChoice === "custom" && customFollowUp) return new Date(customFollowUp);
    return null;
  };

  const submit = async () => {
    if (!propertyName.trim()) {
      setError("物件名稱必填");
      return;
    }
    setBusy(true);
    setError(null);

    const visited = new Date(visitedAt);
    const input: ShowingInput = {
      customerId,
      propertyName: propertyName.trim(),
      propertyAddress: propertyAddress.trim() || null,
      visitedAt: visited,
      status,
      rating: rating === "0" ? null : Number(rating),
      liked: liked.trim() || null,
      disliked: disliked.trim() || null,
      intentLevel: intentLevel || null,
      nextStep: nextStep.trim() || null,
      note: note.trim() || null,
    };

    const nextFollowUpAt = resolveFollowUpAt();
    const result = await createShowingAction(
      input,
      status === "completed"
        ? { lastContactAt: visited, nextFollowUpAt: nextFollowUpAt ?? undefined }
        : undefined,
    );

    setBusy(false);
    if (!result.ok) {
      setError(result.error || "儲存失敗，請再試一次");
      return;
    }
    setOpen(false);
    setPropertyName("");
    setPropertyAddress("");
    setLiked("");
    setDisliked("");
    setNextStep("");
    setNote("");
    setFollowUpChoice("none");
    setRating("0");
    setIntentLevel("");
    setVisitedAt(nowLocal());
    router.refresh();
  };

  return (
    <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text, margin: 0 }}>帶看紀錄</h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            minHeight: 38,
            padding: "7px 14px",
            borderRadius: 7,
            border: "none",
            background: open ? "rgba(255,255,255,0.08)" : CIS.blue,
            color: "#fff",
            fontSize: 14,
            fontWeight: 800,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Icon name={open ? "close" : "add"} size={14} />
          {open ? "取消" : "新增帶看"}
        </button>
      </div>

      {open ? (
        <div style={{ borderTop: `1px solid ${CIS.cardBorder}`, paddingTop: 14, marginBottom: 16 }}>
          <div className={styles.formGrid}>
            <label className={styles.field} style={{ color: CIS.textMute }}>
              物件名稱 *
              <input style={inputStyle} value={propertyName} onChange={(e) => setPropertyName(e.target.value)} maxLength={160} placeholder="聯悅臻 2房" />
            </label>
            <label className={styles.field} style={{ color: CIS.textMute }}>
              物件地址
              <input style={inputStyle} value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} maxLength={240} />
            </label>
            <label className={styles.field} style={{ color: CIS.textMute }}>
              帶看時間
              <input style={inputStyle} type="datetime-local" value={visitedAt} onChange={(e) => setVisitedAt(e.target.value)} />
            </label>
            <label className={styles.field} style={{ color: CIS.textMute }}>
              狀態
              <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
                {SHOWING_STATUSES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </label>
            <label className={styles.field} style={{ color: CIS.textMute }}>
              客戶評價
              <select style={inputStyle} value={rating} onChange={(e) => setRating(e.target.value)}>
                <option value="0">未評分</option>
                <option value="1">★☆☆☆☆</option>
                <option value="2">★★☆☆☆</option>
                <option value="3">★★★☆☆</option>
                <option value="4">★★★★☆</option>
                <option value="5">★★★★★</option>
              </select>
            </label>
            <label className={styles.field} style={{ color: CIS.textMute }}>
              成交意願
              <select style={inputStyle} value={intentLevel} onChange={(e) => setIntentLevel(e.target.value)}>
                <option value="">未填</option>
                {SHOWING_INTENT_LEVELS.map((l) => (
                  <option key={l.key} value={l.key}>{l.label}</option>
                ))}
              </select>
            </label>
            <label className={styles.field} style={{ color: CIS.textMute }}>
              喜歡的地方
              <textarea style={textareaStyle} value={liked} onChange={(e) => setLiked(e.target.value)} maxLength={1000} placeholder="採光、景觀" />
            </label>
            <label className={styles.field} style={{ color: CIS.textMute }}>
              不喜歡的地方
              <textarea style={textareaStyle} value={disliked} onChange={(e) => setDisliked(e.target.value)} maxLength={1000} placeholder="客廳偏小" />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
              下一步
              <input style={inputStyle} value={nextStep} onChange={(e) => setNextStep(e.target.value)} maxLength={300} placeholder="再約另一間比較" />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
              備註
              <textarea style={textareaStyle} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
            </label>
          </div>

          {status === "completed" ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ color: CIS.textMute, fontSize: 14, marginBottom: 7 }}>下次追蹤（會更新客戶的下次追蹤時間）</div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
                {(["none", "tomorrow", "3d", "7d", "custom"] as const).map((choice) => {
                  const labels: Record<typeof choice, string> = {
                    none: "不設定",
                    tomorrow: "明天",
                    "3d": "3天後",
                    "7d": "7天後",
                    custom: "自訂日期",
                  };
                  const active = followUpChoice === choice;
                  return (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => setFollowUpChoice(choice)}
                      style={{
                        minHeight: 38,
                        padding: "7px 13px",
                        borderRadius: 999,
                        border: `1px solid ${active ? CIS.blue : CIS.cardBorder}`,
                        background: active ? CIS.blue : "rgba(255,255,255,0.05)",
                        color: active ? "#fff" : CIS.textSub,
                        fontSize: 14,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      {labels[choice]}
                    </button>
                  );
                })}
                {followUpChoice === "custom" ? (
                  <input
                    type="datetime-local"
                    value={customFollowUp}
                    onChange={(e) => setCustomFollowUp(e.target.value)}
                    style={{ ...inputStyle, width: "auto", minWidth: 200 }}
                  />
                ) : null}
              </div>
            </div>
          ) : null}

          <div className={styles.formActions}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit()}
              style={{
                minHeight: 44,
                padding: "9px 18px",
                borderRadius: 8,
                border: "none",
                background: CIS.blue,
                color: "#fff",
                fontSize: 15,
                fontWeight: 800,
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.65 : 1,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon name="save" size={15} />
              {busy ? "儲存中…" : "儲存帶看紀錄"}
            </button>
            {error ? (
              <span role="status" style={{ color: "#fb7185", fontSize: 15, fontWeight: 700 }}>
                {error}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {showings.length === 0 ? (
        <div style={{ color: CIS.textMute, fontSize: 15 }}>還沒有帶看紀錄。</div>
      ) : (
        <div className={styles.list}>
          {showings.map((s) => (
            <div key={s.id} style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, borderRadius: 10, padding: "13px 15px" }}>
              <div className={styles.cardHeader}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: CIS.text }}>
                    {s.property_name}
                    {s.rating ? <span style={{ color: "#fbbf24", marginLeft: 8, fontSize: 14 }}>{stars(s.rating)}</span> : null}
                  </div>
                  <div style={{ color: CIS.textMute, fontSize: 14, marginTop: 3 }}>{formatDateTw(s.visited_at)}</div>
                </div>
                <div className={styles.chips}>
                  <Chip tone={statusTone(s.status)}>{STATUS_LABELS[s.status] || s.status}</Chip>
                  {s.intent_level ? (
                    <Chip tone={s.intent_level === "high" ? "warn" : s.intent_level === "low" ? "neutral" : "info"}>
                      意願{SHOWING_INTENT_LEVELS.find((l) => l.key === s.intent_level)?.label || s.intent_level}
                    </Chip>
                  ) : null}
                </div>
              </div>
              {s.liked || s.disliked ? (
                <div style={{ marginTop: 8, fontSize: 14, color: CIS.textSub }}>
                  {s.liked ? <div>👍 {s.liked}</div> : null}
                  {s.disliked ? <div>👎 {s.disliked}</div> : null}
                </div>
              ) : null}
              {s.next_step ? (
                <div style={{ marginTop: 6, fontSize: 14, color: CIS.text, fontWeight: 700 }}>下一步：{s.next_step}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
