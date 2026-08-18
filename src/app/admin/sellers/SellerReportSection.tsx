"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CIS, CHIP, type ChipTone } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import {
  SELLER_REPORT_TYPES,
  SELLER_REPORT_RESULTS,
  type SellerReportInput,
  type SellerReportRow,
} from "@/lib/seller-report";
import { createSellerReportAction } from "@/lib/actions/seller-report-actions";
import styles from "../customers/customers.module.css";

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

function typeTone(type: string): ChipTone {
  return type === "negotiation" ? "warn" : "info";
}

function resultTone(result: string | null): ChipTone {
  if (result === "agreed") return "success";
  if (result === "owner_rejected" || result === "buyer_dropped" || result === "broken") return "danger";
  return "neutral";
}

function formatDateTw(date: Date): string {
  // Node（SSR）對 zh-TW 《上午/下午》前面實測吐 U+2009（THIN SPACE），
  // 瀏覽器（hydrate）吐一般空格 U+0020——文字看起來一樣但 bytes 不同，會觸發 React
  // hydration mismatch。統一換成一般空格（順便涵蓋其他 ICU 版本可能出現的窄空格變體）。
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date)).replace(/[ -​  ]/g, " ");
}

function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  const color = CHIP[tone];
  return (
    <span className={styles.chip} style={{ background: color.bg, color: color.color, borderColor: color.border }}>
      {children}
    </span>
  );
}

const TYPE_LABELS: Record<string, string> = Object.fromEntries(SELLER_REPORT_TYPES.map((t) => [t.key, t.label]));
const RESULT_LABELS: Record<string, string> = Object.fromEntries(SELLER_REPORT_RESULTS.map((r) => [r.key, r.label]));

export default function SellerReportSection({ sellerId, reports }: { sellerId: string; reports: SellerReportRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reportDate, setReportDate] = useState("");
  const [type, setType] = useState("report");
  const [content, setContent] = useState("");
  const [offerPrice, setOfferPrice] = useState("");
  const [counterPrice, setCounterPrice] = useState("");
  const [result, setResult] = useState("");
  const [note, setNote] = useState("");
  const [followUpChoice, setFollowUpChoice] = useState<"none" | "tomorrow" | "3d" | "7d" | "custom">("none");
  const [customFollowUp, setCustomFollowUp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReportDate((prev) => prev || nowLocal());
  }, []);

  const resolveFollowUpAt = (): Date | null => {
    if (followUpChoice === "tomorrow") return new Date(daysFromNowLocal(1));
    if (followUpChoice === "3d") return new Date(daysFromNowLocal(3));
    if (followUpChoice === "7d") return new Date(daysFromNowLocal(7));
    if (followUpChoice === "custom" && customFollowUp) return new Date(customFollowUp);
    return null;
  };

  const numOrNull = (value: string): number | null => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const submit = async () => {
    if (type === "negotiation" && !content.trim()) {
      setError("議價內容必填");
      return;
    }
    setBusy(true);
    setError(null);

    const reported = new Date(reportDate);
    const input: SellerReportInput = {
      sellerId,
      reportDate: reported,
      type,
      content: content.trim() || null,
      offerPrice: type === "negotiation" ? numOrNull(offerPrice) : null,
      counterPrice: type === "negotiation" ? numOrNull(counterPrice) : null,
      result: type === "negotiation" ? result || null : null,
      note: note.trim() || null,
    };

    const nextReportAt = resolveFollowUpAt();
    const result_ = await createSellerReportAction(input, {
      lastReportAt: reported,
      nextReportAt: nextReportAt ?? undefined,
    });

    setBusy(false);
    if (!result_.ok) {
      setError(result_.error || "儲存失敗，請再試一次");
      return;
    }
    setOpen(false);
    setContent("");
    setOfferPrice("");
    setCounterPrice("");
    setResult("");
    setNote("");
    setFollowUpChoice("none");
    setType("report");
    setReportDate(nowLocal());
    router.refresh();
  };

  return (
    <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text, margin: 0 }}>回報／議價紀錄</h2>
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
          {open ? "取消" : "新增回報"}
        </button>
      </div>

      {open ? (
        <div style={{ borderTop: `1px solid ${CIS.cardBorder}`, paddingTop: 14, marginBottom: 16 }}>
          <div className={styles.formGrid}>
            <label className={styles.field} style={{ color: CIS.textMute }}>
              回報日期
              <input style={inputStyle} type="datetime-local" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
            </label>
            <label className={styles.field} style={{ color: CIS.textMute }}>
              類型
              <select style={inputStyle} value={type} onChange={(e) => setType(e.target.value)}>
                {SELLER_REPORT_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </label>
            {type === "negotiation" ? (
              <>
                <label className={styles.field} style={{ color: CIS.textMute }}>
                  買方出價（萬）
                  <input style={inputStyle} value={offerPrice} onChange={(e) => setOfferPrice(e.target.value)} inputMode="numeric" placeholder="650" />
                </label>
                <label className={styles.field} style={{ color: CIS.textMute }}>
                  屋主回應價（萬）
                  <input style={inputStyle} value={counterPrice} onChange={(e) => setCounterPrice(e.target.value)} inputMode="numeric" placeholder="680" />
                </label>
                <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
                  議價結果
                  <select style={inputStyle} value={result} onChange={(e) => setResult(e.target.value)}>
                    <option value="">未填</option>
                    {SELLER_REPORT_RESULTS.map((r) => (
                      <option key={r.key} value={r.key}>{r.label}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
              內容 {type === "negotiation" ? "*" : ""}
              <textarea
                style={textareaStyle}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={2000}
                placeholder={type === "negotiation" ? "買方出價650萬，屋主考慮中" : "本週帶看2組、591詢問8通"}
              />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
              備註
              <textarea style={textareaStyle} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
            </label>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ color: CIS.textMute, fontSize: 14, marginBottom: 7 }}>下次回報（會更新屋主的下次回報時間）</div>
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
              {busy ? "儲存中…" : "儲存紀錄"}
            </button>
            {error ? (
              <span role="status" style={{ color: "#fb7185", fontSize: 15, fontWeight: 700 }}>
                {error}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {reports.length === 0 ? (
        <div style={{ color: CIS.textMute, fontSize: 15 }}>還沒有回報紀錄。</div>
      ) : (
        <div className={styles.list}>
          {reports.map((r) => (
            <div key={r.id} style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, borderRadius: 10, padding: "13px 15px" }}>
              <div className={styles.cardHeader}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: CIS.text }}>{formatDateTw(r.report_date)}</div>
                </div>
                <div className={styles.chips}>
                  <Chip tone={typeTone(r.type)}>{TYPE_LABELS[r.type] || r.type}</Chip>
                  {r.result ? <Chip tone={resultTone(r.result)}>{RESULT_LABELS[r.result] || r.result}</Chip> : null}
                </div>
              </div>
              {r.type === "negotiation" && (r.offer_price || r.counter_price) ? (
                <div style={{ marginTop: 6, fontSize: 14, color: CIS.textSub }}>
                  {r.offer_price ? `買方出價 ${r.offer_price}萬` : ""}
                  {r.offer_price && r.counter_price ? "　" : ""}
                  {r.counter_price ? `屋主回應 ${r.counter_price}萬` : ""}
                </div>
              ) : null}
              {r.content ? <div style={{ marginTop: 8, fontSize: 14, color: CIS.text }}>{r.content}</div> : null}
              {r.note ? <div style={{ marginTop: 4, fontSize: 13, color: CIS.textMute }}>{r.note}</div> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
