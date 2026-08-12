"use client";
/**
 * 後台「防灌爆限制」設定（2026-08-06 系統擁有者）。
 *
 * 系統擁有者：「我不要讓系統自動卡我，我要自己處理。幾次才算太頻繁、幾分鐘後自動解除，
 *        這個我要從後臺設定，例如說 2 分鐘、3 分鐘後就自動解除。」
 *
 * 原本三個數字寫死，他自己測試時一直用同一組 email，3 次就被鎖 1 小時。
 */
import { useState } from "react";
import {
  DEFAULT_RATE_LIMIT_SETTINGS,
  TESTING_RATE_LIMIT_SETTINGS,
  describeRateLimitSettings,
  normalizeRateLimitSettings,
  type AppointmentRateLimitSettings,
} from "@/lib/appointment-rate-limit-settings";

const numInput: React.CSSProperties = {
  width: "100%", background: "#141414", border: "1px solid #2a2a2a", borderRadius: 8,
  color: "#ededed", padding: "8px 10px", fontSize: 16,
};
const lbl: React.CSSProperties = { display: "block", color: "#9aa0a6", fontSize: 14, marginBottom: 5 };

export default function RateLimitPanel({
  initial,
  activeBuckets,
  blockedCreateBuckets,
  borderColor,
}: {
  initial: AppointmentRateLimitSettings;
  /** 尚未清理的原始計數桶；含 slots/track/manage 等正常流量。 */
  activeBuckets: number;
  /** 真正超過門檻、且目前仍阻擋送出的 create bucket。 */
  blockedCreateBuckets: number;
  borderColor: string;
}) {
  const [open, setOpen] = useState(blockedCreateBuckets > 0);
  const [liveActiveBuckets, setLiveActiveBuckets] = useState(activeBuckets);
  const [liveBlockedCreateBuckets, setLiveBlockedCreateBuckets] = useState(blockedCreateBuckets);
  const [s, setS] = useState<AppointmentRateLimitSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = (Object.keys(initial) as Array<keyof AppointmentRateLimitSettings>).some((k) => s[k] !== initial[k]);
  const preview = describeRateLimitSettings(normalizeRateLimitSettings(s));

  const set = (k: keyof AppointmentRateLimitSettings, v: string) =>
    setS((prev) => ({ ...prev, [k]: v === "" ? 0 : Math.max(0, Math.floor(Number(v) || 0)) }));

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const { saveRateLimitSettingsAction } = await import("@/lib/actions/appointment-rate-limit");
    const r = await saveRateLimitSettingsAction(s);
    setBusy(false);
    if (r.ok && r.settings) {
      setS(r.settings);
      setMsg({ ok: true, text: "✅ 已儲存，立刻生效（下一次有人送出預約就照新設定算）。" });
    } else {
      setMsg({ ok: false, text: "❌ " + (r.error || "儲存失敗") });
    }
  };

  const clear = async () => {
    if (clearing) return;
    if (!window.confirm("解除目前所有被卡住的限制？\n（會清計數並留下解除紀錄，不會動到任何預約資料）")) return;
    setClearing(true);
    setMsg(null);
    const { clearRateLimitsAction } = await import("@/lib/actions/appointment-rate-limit");
    const r = await clearRateLimitsAction();
    setClearing(false);
    setMsg(
      r.ok
        ? { ok: true, text: `✅ 已清掉 ${r.cleared} 筆計數桶並留下解除紀錄，現在可用新的送出識別碼與時段重新預約。` }
        : { ok: false, text: "❌ " + (r.error || "解除失敗") },
    );
    if (r.ok) {
      setLiveActiveBuckets(0);
      setLiveBlockedCreateBuckets(0);
    }
  };

  return (
    <section
      className="rounded-xl"
      style={{ background: "#0e0e0e", border: `1px solid ${borderColor}`, padding: open ? "14px 16px" : "10px 16px", marginBottom: 14 }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ background: "none", border: 0, color: "#7dd3fc", fontWeight: 800, fontSize: 16, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
      >
        🚦 送出頻率限制（防灌爆）
        {liveBlockedCreateBuckets > 0 && (
          <span style={{ background: "rgba(251,191,36,.14)", color: "#fbbf24", borderRadius: 999, padding: "2px 9px", fontSize: 13.5, fontWeight: 800 }}>
            現在有 {liveBlockedCreateBuckets} 個送出限制正在阻擋
          </span>
        )}
        <span style={{ color: "#5b6675", fontWeight: 400, fontSize: 14 }}>
          {s.contactLimit > 0 ? `同組資料 ${s.contactWindowMin} 分鐘 ${s.contactLimit} 次` : "同組資料不限"}
          {open ? "▲ 收起" : "▼ 展開設定"}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
          <div
            style={{ background: "rgba(125,211,252,.06)", border: "1px solid #23303f", borderRadius: 8, padding: "9px 11px", color: "#9fc7e8", fontSize: 14.5, lineHeight: 1.9 }}
          >
            {preview.map((line, i) => <div key={i}>・{line}</div>)}
            <div style={{ color: "#6b7684", marginTop: 4 }}>次數填 <b>0</b> = 這一道完全關掉。</div>
            <div style={{ color: "#6b7684" }}>
              目前另有 <b>{liveActiveBuckets}</b> 個未清理計數桶（含時段查詢、追蹤與管理 API；不代表有人被擋）。
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
            <div>
              <span style={lbl}>同一台裝置：幾次</span>
              <input style={numInput} inputMode="numeric" value={String(s.ipLimit)} onChange={(e) => set("ipLimit", e.target.value.replace(/\D/g, ""))} />
            </div>
            <div>
              <span style={lbl}>同一台裝置：幾分鐘後解除</span>
              <input style={numInput} inputMode="numeric" value={String(s.ipWindowMin)} onChange={(e) => set("ipWindowMin", e.target.value.replace(/\D/g, ""))} />
            </div>
            <div>
              <span style={lbl}>同組 Email＋電話：幾次</span>
              <input style={numInput} inputMode="numeric" value={String(s.contactLimit)} onChange={(e) => set("contactLimit", e.target.value.replace(/\D/g, ""))} />
            </div>
            <div>
              <span style={lbl}>同組 Email＋電話：幾分鐘後解除</span>
              <input style={numInput} inputMode="numeric" value={String(s.contactWindowMin)} onChange={(e) => set("contactWindowMin", e.target.value.replace(/\D/g, ""))} />
            </div>
            <div>
              <span style={lbl}>重複防呆：送出後幾分鐘內不能再送</span>
              <input style={numInput} inputMode="numeric" value={String(s.duplicateWindowMin)} onChange={(e) => set("duplicateWindowMin", e.target.value.replace(/\D/g, ""))} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setS(TESTING_RATE_LIMIT_SETTINGS)}
              style={{ background: "#15304d", border: "1px solid #2b5580", borderRadius: 7, color: "#7dd3fc", fontSize: 14.5, padding: "6px 12px", cursor: "pointer" }}
            >
              🧪 套用「我要自己測試」的寬鬆設定
            </button>
            <button
              type="button"
              onClick={() => setS(DEFAULT_RATE_LIMIT_SETTINGS)}
              style={{ background: "none", border: "1px solid #2a2a2a", borderRadius: 7, color: "#6b7684", fontSize: 14.5, padding: "6px 12px", cursor: "pointer" }}
            >
              回到預設（8/10 分・3/60 分・重複 10 分）
            </button>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              onClick={save}
              disabled={busy || !dirty}
              style={{
                background: dirty ? "#16a34a" : "#333", border: 0, borderRadius: 8, color: "#fff",
                padding: "9px 20px", fontSize: 15.5, fontWeight: 700,
                cursor: busy ? "wait" : dirty ? "pointer" : "not-allowed",
              }}
            >
              {busy ? "儲存中⋯" : dirty ? "儲存設定" : "沒有變更"}
            </button>
            <button
              type="button"
              onClick={clear}
              disabled={clearing}
              style={{
                background: "#4a3a12", border: "1px solid #6b5316", borderRadius: 8, color: "#fbbf24",
                padding: "9px 18px", fontSize: 15.5, fontWeight: 700, cursor: clearing ? "wait" : "pointer",
              }}
            >
              {clearing ? "解除中⋯" : "🔓 立刻解除目前所有限制"}
            </button>
            <span style={{ color: "#6b7684", fontSize: 14, lineHeight: 1.7 }}>
              被自己卡住時按右邊那顆，<b style={{ color: "#9aa0a6" }}>清計數、留稽核、不動預約資料</b>。
            </span>
          </div>

          {msg && <div style={{ color: msg.ok ? "#86efac" : "#f0705c", fontSize: 14.5, lineHeight: 1.8 }}>{msg.text}</div>}
        </div>
      )}
    </section>
  );
}
