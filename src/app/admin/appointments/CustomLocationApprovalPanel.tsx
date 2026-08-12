"use client";

import { useCallback, useEffect, useState } from "react";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";

type ApprovalResult = {
  id: string;
  url: string;
  expiresAt: string;
};

type ApprovalListItem = {
  id: string;
  customerHint: string | null;
  location: {
    name: string;
    address: string;
    placeId?: string | null;
    lat?: number | null;
    lng?: number | null;
  } | null;
  boundPhone: boolean;
  boundEmail: boolean;
  allowedStartAt: string | null;
  allowedEndAt: string | null;
  approvedDurationMin: number | null;
  expiresAt: string;
  usedAt: string | null;
  usedAppointmentId: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  createdBy: string | null;
  createdAt: string;
};

const fieldStyle = {
  width: "100%",
  minHeight: 41,
  padding: "9px 10px",
  borderRadius: 7,
  border: `1px solid ${CIS.cardBorder}`,
  background: CIS.bgSoft,
  color: CIS.text,
  fontSize: 15,
  fontFamily: "inherit",
} as const;

function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function approvalStatus(item: ApprovalListItem): { label: string; color: string } {
  if (item.revokedAt) return { label: "已撤銷", color: "#fb7185" };
  if (item.usedAt) return { label: "已使用", color: "#4ade80" };
  if (new Date(item.expiresAt).getTime() <= Date.now()) return { label: "已到期", color: CIS.textMute };
  return { label: "有效", color: "#7eb0ef" };
}

export default function CustomLocationApprovalPanel() {
  const [open, setOpen] = useState(false);
  const [customerHint, setCustomerHint] = useState("");
  const [locationName, setLocationName] = useState("");
  const [address, setAddress] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [allowedStartAt, setAllowedStartAt] = useState(() => toLocalInput(new Date(Date.now() + 24 * 60 * 60_000)));
  const [allowedEndAt, setAllowedEndAt] = useState(() => toLocalInput(new Date(Date.now() + 71 * 60 * 60_000)));
  const [approvedDurationMin, setApprovedDurationMin] = useState("60");
  const [result, setResult] = useState<ApprovalResult | null>(null);
  const [approvals, setApprovals] = useState<ApprovalListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [copied, setCopied] = useState<"link" | "message" | null>(null);
  const [error, setError] = useState("");

  const loadApprovals = useCallback(async () => {
    setLoadingList(true);
    try {
      const response = await fetch("/api/admin/appointment-location-approvals", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok && Array.isArray(data.approvals)) {
        setApprovals(data.approvals);
      }
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadApprovals();
  }, [loadApprovals]);

  const copyText = async (text: string, type: "link" | "message") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      window.prompt("請手動複製", text);
    }
  };

  const createApproval = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const start = new Date(allowedStartAt);
      const end = new Date(allowedEndAt);
      const response = await fetch("/api/admin/appointment-location-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerHint,
          location: {
            name: locationName,
            address,
            placeId: placeId || null,
            lat: lat.trim() ? Number(lat) : null,
            lng: lng.trim() ? Number(lng) : null,
          },
          customerPhone: customerPhone || null,
          customerEmail: customerEmail || null,
          allowedStartAt: Number.isNaN(start.getTime()) ? null : start.toISOString(),
          allowedEndAt: Number.isNaN(end.getTime()) ? null : end.toISOString(),
          approvedDurationMin: Number(approvedDurationMin),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !data.url) {
        setError(data.error || "建立核准失敗，請檢查欄位後重試。");
        return;
      }
      const nextResult = {
        id: String(data.id || ""),
        url: String(data.url),
        expiresAt: String(data.expiresAt || ""),
      };
      setResult(nextResult);
      await copyText(nextResult.url, "link");
      await loadApprovals();
    } catch {
      setError("網路連線失敗，這次核准尚未建立。");
    } finally {
      setBusy(false);
    }
  };

  const revokeApproval = async (id: string) => {
    const reason = window.prompt("撤銷原因【選填】", "地點或時段有變更");
    if (reason === null) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/appointment-location-approvals", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, reason }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        setError(data.error || "撤銷失敗，可能已使用或已撤銷。");
        return;
      }
      if (result?.id === id) setResult(null);
      await loadApprovals();
    } finally {
      setBusy(false);
    }
  };

  const approvalMessage = result
    ? `${customerHint.trim() ? `${customerHint.trim()}您好，` : ""}指定地點已由茗馥確認。請使用以下專屬連結完成預約；地點、可約時段與時長都以本次核准內容為準。\n${result.url}\n\n連結為一次性使用，並會在 ${new Date(result.expiresAt).toLocaleString("zh-TW")} 到期。`
    : "";

  return (
    <section
      style={{
        marginBottom: 16,
        padding: "15px 17px",
        borderRadius: 8,
        background: CIS.card,
        border: `1px solid ${CIS.cardBorder}`,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          border: 0,
          padding: 0,
          background: "transparent",
          color: CIS.text,
          font: "inherit",
          cursor: "pointer",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 17, fontWeight: 900 }}>
          <Icon name="lock" size={16} />
          指定地點核准管理
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: CIS.textMute, fontSize: 14 }}>
          近期待核准 {approvals.filter((item) => approvalStatus(item).label === "有效").length} 筆
          <Icon name={open ? "chevronUp" : "chevronDown"} size={16} />
        </span>
      </button>

      {!open ? null : (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${CIS.cardBorder}` }}>
          <p style={{ margin: "0 0 13px", color: CIS.textMute, fontSize: 15, lineHeight: 1.65 }}>
            每張連結綁定一個已同意的地點、可預約時間範圍與時長。客戶不能自行換地點；電話或 Email 可選擇性綁定，避免連結轉傳給別人。
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 9 }}>
            <label style={{ color: CIS.textMute, fontSize: 14 }}>
              客戶備註【選填】
              <input value={customerHint} onChange={(event) => setCustomerHint(event.target.value)} maxLength={120} placeholder="例如：王先生／豐原看屋" style={{ ...fieldStyle, marginTop: 5 }} />
            </label>
            <label style={{ color: CIS.textMute, fontSize: 14 }}>
              地點名稱【必填】
              <input value={locationName} onChange={(event) => setLocationName(event.target.value)} maxLength={120} placeholder="例如：豐原星巴克向陽門市" style={{ ...fieldStyle, marginTop: 5 }} />
            </label>
            <label style={{ color: CIS.textMute, fontSize: 14 }}>
              完整地址【必填】
              <input value={address} onChange={(event) => setAddress(event.target.value)} maxLength={240} placeholder="台中市豐原區向陽路..." style={{ ...fieldStyle, marginTop: 5 }} />
            </label>
            <label style={{ color: CIS.textMute, fontSize: 14 }}>
              綁定電話【選填】
              <input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} maxLength={40} placeholder="只允許此電話預約" style={{ ...fieldStyle, marginTop: 5 }} />
            </label>
            <label style={{ color: CIS.textMute, fontSize: 14 }}>
              綁定 Email【選填】
              <input type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} maxLength={160} placeholder="只允許此 Email 預約" style={{ ...fieldStyle, marginTop: 5 }} />
            </label>
            <label style={{ color: CIS.textMute, fontSize: 14 }}>
              可預約起始時間【必填】
              <input type="datetime-local" value={allowedStartAt} onChange={(event) => setAllowedStartAt(event.target.value)} step={900} style={{ ...fieldStyle, marginTop: 5 }} />
            </label>
            <label style={{ color: CIS.textMute, fontSize: 14 }}>
              可預約截止時間【必填】
              <input type="datetime-local" value={allowedEndAt} onChange={(event) => setAllowedEndAt(event.target.value)} step={900} style={{ ...fieldStyle, marginTop: 5 }} />
            </label>
            <label style={{ color: CIS.textMute, fontSize: 14 }}>
              核准時長【必填】
              <select value={approvedDurationMin} onChange={(event) => setApprovedDurationMin(event.target.value)} style={{ ...fieldStyle, marginTop: 5 }}>
                <option value="30">30 分鐘</option>
                <option value="60">60 分鐘</option>
                <option value="90">90 分鐘</option>
                <option value="120">120 分鐘</option>
                <option value="180">180 分鐘</option>
              </select>
            </label>
          </div>

          <details style={{ marginTop: 10, color: CIS.textMute, fontSize: 14 }}>
            <summary style={{ cursor: "pointer", fontWeight: 800 }}>Google 地點資訊【選填】</summary>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 9, marginTop: 9 }}>
              <label>
                Google Place ID
                <input value={placeId} onChange={(event) => setPlaceId(event.target.value)} maxLength={240} style={{ ...fieldStyle, marginTop: 5 }} />
              </label>
              <label>
                緯度【Latitude】
                <input inputMode="decimal" value={lat} onChange={(event) => setLat(event.target.value)} placeholder="24.252..." style={{ ...fieldStyle, marginTop: 5 }} />
              </label>
              <label>
                經度【Longitude】
                <input inputMode="decimal" value={lng} onChange={(event) => setLng(event.target.value)} placeholder="120.721..." style={{ ...fieldStyle, marginTop: 5 }} />
              </label>
            </div>
          </details>

          <button
            type="button"
            disabled={busy}
            onClick={() => void createApproval()}
            style={{
              minHeight: 42,
              marginTop: 12,
              padding: "9px 15px",
              borderRadius: 7,
              border: `1px solid ${CIS.blue}`,
              background: CIS.blue,
              color: "#fff",
              fontSize: 15,
              fontWeight: 900,
              fontFamily: "inherit",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.65 : 1,
            }}
          >
            <Icon name="link" size={14} style={{ marginRight: 6 }} />
            {busy ? "處理中" : "建立一次性核准連結"}
          </button>

          {error ? <div role="alert" style={{ marginTop: 10, color: "#fb7185", fontSize: 15, fontWeight: 800 }}>{error}</div> : null}

          {result ? (
            <div style={{ marginTop: 13, paddingTop: 12, borderTop: `1px solid ${CIS.cardBorder}` }}>
              <div style={{ color: "#4ade80", fontSize: 15, fontWeight: 900 }}>
                核准已建立{copied === "link" ? "，連結已複製" : ""}
              </div>
              <input readOnly value={result.url} onFocus={(event) => event.currentTarget.select()} style={{ ...fieldStyle, marginTop: 8 }} />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <button type="button" onClick={() => void copyText(result.url, "link")} style={{ ...fieldStyle, width: "auto", cursor: "pointer", fontWeight: 800 }}>
                  <Icon name="copy" size={14} style={{ marginRight: 5 }} />
                  {copied === "link" ? "已複製" : "複製連結"}
                </button>
                <button type="button" onClick={() => void copyText(approvalMessage, "message")} style={{ ...fieldStyle, width: "auto", cursor: "pointer", fontWeight: 800 }}>
                  <Icon name="copy" size={14} style={{ marginRight: 5 }} />
                  {copied === "message" ? "已複製" : "複製 LINE 說明"}
                </button>
              </div>
            </div>
          ) : null}

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${CIS.cardBorder}` }}>
            <div style={{ color: CIS.textSub, fontSize: 15, fontWeight: 900, marginBottom: 8 }}>
              最近核准紀錄
            </div>
            {loadingList ? (
              <div style={{ color: CIS.textMute, fontSize: 14 }}>讀取中...</div>
            ) : approvals.length === 0 ? (
              <div style={{ color: CIS.textMute, fontSize: 14 }}>尚無核准紀錄。</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {approvals.map((item) => {
                  const state = approvalStatus(item);
                  return (
                    <div
                      key={item.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0,1fr) auto",
                        gap: 10,
                        padding: "9px 0",
                        borderBottom: `1px solid ${CIS.cardBorder}`,
                      }}
                    >
                      <div style={{ minWidth: 0, color: CIS.textMute, fontSize: 14, lineHeight: 1.65 }}>
                        <div>
                          <b style={{ color: CIS.text }}>{item.location?.name || "缺少地點資料"}</b>
                          {" "}
                          <span style={{ color: state.color, fontWeight: 900 }}>{state.label}</span>
                        </div>
                        <div>{item.location?.address || "未記錄地址"}</div>
                        <div>
                          {item.allowedStartAt ? new Date(item.allowedStartAt).toLocaleString("zh-TW") : "未限制"}
                          {" 至 "}
                          {item.allowedEndAt ? new Date(item.allowedEndAt).toLocaleString("zh-TW") : "未限制"}
                          {"，"}{item.approvedDurationMin || "未限制"} 分鐘
                        </div>
                        <div>
                          {item.customerHint ? `備註：${item.customerHint}；` : ""}
                          綁定：{item.boundPhone ? "電話" : ""}{item.boundPhone && item.boundEmail ? "＋" : ""}{item.boundEmail ? "Email" : ""}{!item.boundPhone && !item.boundEmail ? "無" : ""}
                        </div>
                        {item.revokeReason ? <div style={{ color: "#fb7185" }}>撤銷原因：{item.revokeReason}</div> : null}
                      </div>
                      {state.label === "有效" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void revokeApproval(item.id)}
                          aria-label={`撤銷 ${item.location?.name || "指定地點"} 核准`}
                          style={{
                            alignSelf: "start",
                            minHeight: 38,
                            padding: "7px 10px",
                            borderRadius: 7,
                            border: "1px solid rgba(244,63,94,0.35)",
                            background: "rgba(244,63,94,0.1)",
                            color: "#fb7185",
                            font: "inherit",
                            fontSize: 14,
                            fontWeight: 900,
                            cursor: "pointer",
                          }}
                        >
                          撤銷
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
