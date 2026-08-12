"use client";

import { useState } from "react";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";

type ActionResponse = {
  ok?: boolean;
  saved?: boolean;
  error?: string;
  notice?: string;
  status?: string;
  followupId?: string;
};

type Props = {
  id: string;
  status: string;
  customerName: string;
  phone: string;
  email: string;
  lineId?: string | null;
  slotLabel: string;
  intentLabel: string;
  meetUrl?: string | null;
  mapsUrl?: string | null;
  note?: string | null;
  aiSummary?: string | null;
  aiNextAction?: string | null;
  followupCreated?: boolean;
  attendanceStatus: string;
  outcomeStatus: string;
  outcomeNote: string;
  contactStatus: string;
  nextFollowupAt: string | null;
  estimatedCommission: string;
  actualCommission: string;
  caseReference: string;
};

const inputStyle = {
  minHeight: 40,
  width: "100%",
  padding: "8px 10px",
  borderRadius: 7,
  border: `1px solid ${CIS.cardBorder}`,
  background: CIS.bgSoft,
  color: CIS.text,
  fontSize: 15,
  fontFamily: "inherit",
} as const;

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIso(localValue: string): string | null {
  if (!localValue) return null;
  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function moneyValue(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export default function AppointmentActions(props: Props) {
  const [status, setStatus] = useState(props.status);
  const [attendanceStatus, setAttendanceStatus] = useState(props.attendanceStatus);
  const [outcomeStatus, setOutcomeStatus] = useState(props.outcomeStatus);
  const [outcomeNote, setOutcomeNote] = useState(props.outcomeNote);
  const [contactStatus, setContactStatus] = useState(props.contactStatus);
  const [nextFollowupAt, setNextFollowupAt] = useState(toLocalInput(props.nextFollowupAt));
  const [estimatedCommission, setEstimatedCommission] = useState(props.estimatedCommission);
  const [actualCommission, setActualCommission] = useState(props.actualCommission);
  const [caseReference, setCaseReference] = useState(props.caseReference);
  const [hasFollowup, setHasFollowup] = useState(Boolean(props.followupCreated));
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [showReschedule, setShowReschedule] = useState(false);
  const [newSlot, setNewSlot] = useState("");
  const [durationMin, setDurationMin] = useState("preserve");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(null);

  const post = async (body: Record<string, unknown>): Promise<ActionResponse | null> => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/appointments/${props.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as ActionResponse;
      if (response.ok && data.ok) {
        setNotice({ tone: "success", text: data.notice || "資料已儲存。" });
        return data;
      }
      if (data.saved) {
        setNotice({
          tone: "warning",
          text: data.notice || "資料已儲存，但背景同步沒有成功排入，請查看異常佇列。",
        });
        return data;
      }
      setNotice({ tone: "danger", text: data.error || "操作失敗，請稍後重試。" });
      return null;
    } catch {
      setNotice({ tone: "danger", text: "網路連線失敗，這次操作尚未確認成功。" });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const buttonStyle = (tone: "primary" | "success" | "warning" | "danger" | "neutral") => {
    const palette = {
      primary: { background: CIS.blue, color: "#fff" },
      success: { background: "rgba(34,197,94,0.13)", color: "#4ade80" },
      warning: { background: "rgba(245,169,29,0.13)", color: "#fbbf24" },
      danger: { background: "rgba(244,63,94,0.12)", color: "#fb7185" },
      neutral: { background: "rgba(255,255,255,0.05)", color: CIS.textSub },
    }[tone];
    return {
      minHeight: 40,
      padding: "8px 12px",
      borderRadius: 7,
      border: `1px solid ${CIS.cardBorder}`,
      background: palette.background,
      color: palette.color,
      fontSize: 15,
      fontWeight: 800,
      fontFamily: "inherit",
      cursor: busy ? "default" : "pointer",
      opacity: busy ? 0.62 : 1,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      textDecoration: "none",
    } as const;
  };

  const quickStatus = async (action: "confirm" | "complete" | "cancel") => {
    if (action === "cancel" && !window.confirm("確定取消這筆預約？取消後時段會釋出。")) return;
    if (action === "complete" && !window.confirm("確定標記為已完成？跟進與成交欄位仍會保留。")) return;
    const result = await post({
      action,
      notifyCustomer: action === "cancel" ? notifyCustomer : action === "confirm",
    });
    if (result?.saved || result?.ok) {
      setStatus(action === "confirm" ? "confirmed" : action === "complete" ? "completed" : "cancelled");
    }
  };

  const markContacted = async () => {
    const result = await post({ action: "mark_contacted" });
    if (result?.ok) setContactStatus("contacted");
  };

  const markAttendance = async (value: "arrived" | "no_show") => {
    const result = await post({ action: "set_attendance", attendanceStatus: value });
    if (result?.ok) setAttendanceStatus(value);
  };

  const saveOperations = async () => {
    const followupIso = toIso(nextFollowupAt);
    if (nextFollowupAt && !followupIso) {
      setNotice({ tone: "danger", text: "跟進日期格式不正確。" });
      return;
    }
    if (
      (estimatedCommission.trim() && moneyValue(estimatedCommission) == null) ||
      (actualCommission.trim() && moneyValue(actualCommission) == null)
    ) {
      setNotice({ tone: "danger", text: "佣金必須填 0 以上的數字。" });
      return;
    }
    const result = await post({
      action: "save_operations",
      attendanceStatus,
      outcomeStatus,
      outcomeNote,
      contactStatus,
      nextFollowupAt: followupIso,
      estimatedCommission: moneyValue(estimatedCommission),
      actualCommission: moneyValue(actualCommission),
      caseReference,
    });
    if (result?.ok && followupIso) setHasFollowup(true);
  };

  const createFollowup = async () => {
    const result = await post({ action: "create_followup" });
    if (result?.ok) setHasFollowup(true);
  };

  const resendConfirmation = async () => {
    if (!window.confirm("確定把客戶確認通知排入發送佇列？")) return;
    await post({ action: "resend_customer_confirmation" });
  };

  const reschedule = async () => {
    if (!newSlot) return;
    if (!window.confirm("確定改期？資料會先儲存，日曆與客戶通知由背景工作處理。")) return;
    const slotIso = toIso(newSlot);
    if (!slotIso) {
      setNotice({ tone: "danger", text: "改期時間格式不正確。" });
      return;
    }
    const result = await post({
      action: "reschedule",
      slotIso,
      notifyCustomer,
      durationMin: durationMin === "preserve" ? null : Number(durationMin),
    });
    if (result?.saved || result?.ok) setShowReschedule(false);
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ tone: "success", text: `${label}已複製。` });
    } catch {
      window.prompt(`請複製${label}`, text);
    }
  };

  const crmSummary = [
    `姓名：${props.customerName}`,
    `電話：${props.phone}`,
    `Email：${props.email}`,
    props.lineId ? `LINE：${props.lineId}` : "",
    `預約：${props.slotLabel}`,
    `需求：${props.intentLabel}`,
    caseReference ? `案件編號：${caseReference}` : "",
    props.aiSummary ? `AI 摘要：${props.aiSummary}` : "",
    props.aiNextAction ? `下一步：${props.aiNextAction}` : "",
    props.note ? `客戶備註：${props.note}` : "",
    outcomeNote ? `案件紀錄：${outcomeNote}` : "",
  ].filter(Boolean).join("\n");

  const inactive = status === "cancelled" || status === "expired";
  const confirmedOrCompleted = status === "confirmed" || status === "completed";

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {status === "pending_confirmation" ? (
          <button type="button" disabled={busy} onClick={() => void quickStatus("confirm")} style={buttonStyle("primary")}>
            <Icon name="check" size={14} />
            後台確認預約
          </button>
        ) : null}
        {!inactive && contactStatus !== "contacted" ? (
          <button type="button" disabled={busy} onClick={() => void markContacted()} style={buttonStyle("success")}>
            <Icon name="chat" size={14} />
            標記已聯絡
          </button>
        ) : null}
        {confirmedOrCompleted ? (
          <>
            <button type="button" disabled={busy} onClick={() => void markAttendance("arrived")} style={buttonStyle("success")}>
              <Icon name="success" size={14} />
              已到場
            </button>
            <button type="button" disabled={busy} onClick={() => void markAttendance("no_show")} style={buttonStyle("danger")}>
              <Icon name="frown" size={14} />
              未到場
            </button>
          </>
        ) : null}
        {status === "confirmed" ? (
          <button type="button" disabled={busy} onClick={() => void quickStatus("complete")} style={buttonStyle("success")}>
            <Icon name="check" size={14} />
            標記完成
          </button>
        ) : null}
        {status === "confirmed" ? (
          <button type="button" disabled={busy} onClick={() => setShowReschedule((value) => !value)} style={buttonStyle("neutral")}>
            <Icon name="calendar" size={14} />
            改期
          </button>
        ) : null}
        {!inactive ? (
          <button type="button" disabled={busy} onClick={() => void resendConfirmation()} style={buttonStyle("warning")}>
            <Icon name="send" size={14} />
            重排客戶確認通知
          </button>
        ) : null}
        {!inactive ? (
          <button type="button" disabled={busy} onClick={() => void quickStatus("cancel")} style={buttonStyle("danger")}>
            <Icon name="close" size={14} />
            取消預約
          </button>
        ) : null}
      </div>

      {!inactive ? (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 10, color: CIS.textMute, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={notifyCustomer}
            onChange={(event) => setNotifyCustomer(event.target.checked)}
            style={{ accentColor: CIS.blue }}
          />
          改期或取消時，把客戶通知排入背景佇列
        </label>
      ) : null}

      {showReschedule ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8, marginTop: 12 }}>
          <input
            type="datetime-local"
            value={newSlot}
            step={900}
            onChange={(event) => setNewSlot(event.target.value)}
            style={inputStyle}
            aria-label="新的預約時間"
          />
          <select value={durationMin} onChange={(event) => setDurationMin(event.target.value)} style={inputStyle} aria-label="新的預約時長">
            <option value="preserve">保留原時長</option>
            <option value="30">30 分鐘</option>
            <option value="60">60 分鐘</option>
            <option value="90">90 分鐘</option>
            <option value="120">120 分鐘</option>
            <option value="180">180 分鐘</option>
          </select>
          <button type="button" disabled={busy || !newSlot} onClick={() => void reschedule()} style={buttonStyle("primary")}>
            儲存改期
          </button>
        </div>
      ) : null}

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${CIS.cardBorder}` }}>
        <div style={{ color: CIS.textSub, fontSize: 15, fontWeight: 900, marginBottom: 9 }}>
          案件跟進與成交結果
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 9 }}>
          <label style={{ color: CIS.textMute, fontSize: 14 }}>
            聯絡狀態
            <select value={contactStatus} onChange={(event) => setContactStatus(event.target.value)} style={{ ...inputStyle, marginTop: 5 }}>
              <option value="uncontacted">尚未聯絡</option>
              <option value="contacted">已聯絡</option>
              <option value="waiting_customer">等待客戶</option>
              <option value="followup_due">待跟進</option>
              <option value="closed">已結案</option>
            </select>
          </label>
          <label style={{ color: CIS.textMute, fontSize: 14 }}>
            出席狀態
            <select value={attendanceStatus} onChange={(event) => setAttendanceStatus(event.target.value)} style={{ ...inputStyle, marginTop: 5 }}>
              <option value="pending">尚未確認</option>
              <option value="confirmed">客戶已確認</option>
              <option value="arrived">已到場</option>
              <option value="no_show">未到場</option>
            </select>
          </label>
          <label style={{ color: CIS.textMute, fontSize: 14 }}>
            案件結果
            <select value={outcomeStatus} onChange={(event) => setOutcomeStatus(event.target.value)} style={{ ...inputStyle, marginTop: 5 }}>
              <option value="none">尚未填結果</option>
              <option value="hot">高意願</option>
              <option value="nurture">持續培養</option>
              <option value="unqualified">不適合</option>
              <option value="closed_won">已成交</option>
              <option value="closed_lost">未成交</option>
            </select>
          </label>
          <label style={{ color: CIS.textMute, fontSize: 14 }}>
            下次跟進時間
            <input
              type="datetime-local"
              value={nextFollowupAt}
              onChange={(event) => setNextFollowupAt(event.target.value)}
              style={{ ...inputStyle, marginTop: 5 }}
            />
          </label>
          <label style={{ color: CIS.textMute, fontSize: 14 }}>
            預估佣金【NT$】
            <input
              inputMode="numeric"
              value={estimatedCommission}
              onChange={(event) => setEstimatedCommission(event.target.value)}
              placeholder="例如 120000"
              style={{ ...inputStyle, marginTop: 5 }}
            />
          </label>
          <label style={{ color: CIS.textMute, fontSize: 14 }}>
            實際佣金【NT$】
            <input
              inputMode="numeric"
              value={actualCommission}
              onChange={(event) => setActualCommission(event.target.value)}
              placeholder="成交後填寫"
              style={{ ...inputStyle, marginTop: 5 }}
            />
          </label>
          <label style={{ color: CIS.textMute, fontSize: 14 }}>
            案件編號／CRM 編號
            <input
              value={caseReference}
              onChange={(event) => setCaseReference(event.target.value)}
              maxLength={160}
              placeholder="例如 FY-2026-071"
              style={{ ...inputStyle, marginTop: 5 }}
            />
          </label>
        </div>
        <label style={{ display: "block", marginTop: 9, color: CIS.textMute, fontSize: 14 }}>
          跟進紀錄／結果備註
          <textarea
            value={outcomeNote}
            onChange={(event) => setOutcomeNote(event.target.value)}
            maxLength={4000}
            rows={3}
            placeholder="記錄客戶反應、下一步、未成交原因或成交條件"
            style={{ ...inputStyle, minHeight: 82, resize: "vertical", marginTop: 5 }}
          />
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <button type="button" disabled={busy} onClick={() => void saveOperations()} style={buttonStyle("primary")}>
            <Icon name="save" size={14} />
            儲存案件進度
          </button>
          <button type="button" disabled={busy || hasFollowup} onClick={() => void createFollowup()} style={buttonStyle(hasFollowup ? "success" : "warning")}>
            <Icon name="list" size={14} />
            {hasFollowup ? "已建立跟進任務" : "建立跟進任務"}
          </button>
          <button type="button" disabled={busy} onClick={() => void copyText(crmSummary, "CRM 摘要")} style={buttonStyle("neutral")}>
            <Icon name="copy" size={14} />
            複製 CRM 摘要
          </button>
          <a href={`tel:${props.phone}`} style={buttonStyle("neutral")}>
            <Icon name="mobile" size={14} />
            撥打電話
          </a>
          {props.meetUrl ? (
            <a href={props.meetUrl} target="_blank" rel="noopener noreferrer" style={buttonStyle("neutral")}>
              <Icon name="video" size={14} />
              開啟視訊
            </a>
          ) : null}
          {props.mapsUrl ? (
            <a href={props.mapsUrl} target="_blank" rel="noopener noreferrer" style={buttonStyle("neutral")}>
              <Icon name="map" size={14} />
              開啟地圖
            </a>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div
          role="status"
          style={{
            marginTop: 11,
            color: notice.tone === "success" ? "#4ade80" : notice.tone === "warning" ? "#fbbf24" : "#fb7185",
            fontSize: 15,
            fontWeight: 800,
          }}
        >
          {notice.text}
        </div>
      ) : null}
    </div>
  );
}
