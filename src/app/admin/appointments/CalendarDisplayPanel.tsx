"use client";
/**
 * 後台「Google 日曆事件長相」設定（2026-08-06 系統擁有者）。
 *
 * 系統擁有者：「為什麼我的 Google 日曆會寫『太平洋房屋預約』？好奇怪的名詞。」「跟我預約的顏色我可以選擇嗎？」
 * → 標題可自訂樣板、顏色可從 Google 的 11 色挑一個。改完只影響**之後**建立的事件。
 */
import { useState } from "react";
import {
  CALENDAR_EVENT_COLORS,
  CALENDAR_TITLE_TOKENS,
  DEFAULT_CALENDAR_TITLE_TEMPLATE,
  renderCalendarTitle,
} from "@/lib/appointment-calendar-display";

export default function CalendarDisplayPanel({
  initialTitleTemplate,
  initialColorId,
  borderColor,
}: {
  initialTitleTemplate: string;
  initialColorId: string;
  borderColor: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitleTemplate);
  const [colorId, setColorId] = useState(initialColorId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = title !== initialTitleTemplate || colorId !== initialColorId;
  const activeColor = CALENDAR_EVENT_COLORS.find((c) => c.id === colorId) || CALENDAR_EVENT_COLORS[6];

  // 用假資料即時預覽，系統擁有者不用存了才知道長怎樣
  const preview = renderCalendarTitle(title, {
    name: "蕭茗馥",
    phone: "0912345678",
    meetTypeLabel: "公司面談",
    intent: "房仲服務",
    purpose: "賣房",
  });

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const { saveCalendarDisplayAction } = await import("@/lib/actions/appointment-calendar-display");
    const r = await saveCalendarDisplayAction({ titleTemplate: title, colorId });
    setBusy(false);
    setMsg(
      r.ok
        ? { ok: true, text: "✅ 已儲存。之後新建立的預約會用這個標題與顏色（已經在日曆上的舊事件不會變）。" }
        : { ok: false, text: "❌ " + (r.error || "儲存失敗") },
    );
  };

  return (
    <section
      className="rounded-xl"
      style={{ background: "#0e0e0e", border: `1px solid ${borderColor}`, padding: open ? "14px 16px" : "10px 16px", marginBottom: 14 }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ background: "none", border: 0, color: "#7dd3fc", fontWeight: 800, fontSize: 16, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 8 }}
      >
        🗓️ 日曆事件的標題與顏色
        <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: activeColor.hex }} />
        <span style={{ color: "#5b6675", fontWeight: 400, fontSize: 14 }}>
          目前「{preview}」· {activeColor.name}　{open ? "▲ 收起" : "▼ 展開設定"}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
          {/* 標題樣板 */}
          <div>
            <label style={{ display: "block", color: "#9aa0a6", fontSize: 14, marginBottom: 6 }}>
              事件標題（在 Google 日曆上看到的那一行字）
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={DEFAULT_CALENDAR_TITLE_TEMPLATE}
              style={{ width: "100%", background: "#141414", border: "1px solid #2a2a2a", borderRadius: 8, color: "#ededed", padding: "10px 12px", fontSize: 16 }}
            />
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ color: "#6b7684", fontSize: 14 }}>點一下插入：</span>
              {CALENDAR_TITLE_TOKENS.map((t) => (
                <button
                  key={t.token}
                  type="button"
                  onClick={() => setTitle((v) => v + t.token)}
                  title={`${t.desc}（例：${t.sample}）`}
                  style={{ background: "#15304d", border: "1px solid #2b5580", borderRadius: 6, color: "#7dd3fc", fontSize: 14, padding: "4px 9px", cursor: "pointer" }}
                >
                  {t.token}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setTitle(DEFAULT_CALENDAR_TITLE_TEMPLATE)}
                style={{ background: "none", border: "1px solid #2a2a2a", borderRadius: 6, color: "#6b7684", fontSize: 14, padding: "4px 9px", cursor: "pointer", marginLeft: "auto" }}
              >
                回到預設
              </button>
            </div>
          </div>

          {/* 顏色 */}
          <div>
            <label style={{ display: "block", color: "#9aa0a6", fontSize: 14, marginBottom: 6 }}>
              事件顏色（Google 日曆只有這 11 色可選）
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {CALENDAR_EVENT_COLORS.map((c) => {
                const on = c.id === colorId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setColorId(c.id)}
                    title={c.name}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      background: on ? "#1b2a3a" : "#141414",
                      border: `1.5px solid ${on ? c.hex : "#2a2a2a"}`,
                      borderRadius: 8, padding: "6px 10px", cursor: "pointer",
                      color: on ? "#ededed" : "#8b93a1", fontSize: 14.5, whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ width: 13, height: 13, borderRadius: 3, background: c.hex, flex: "none" }} />
                    {c.name}
                    {on && <span style={{ color: c.hex, fontWeight: 800 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 預覽：模擬日曆上那一格 */}
          <div>
            <label style={{ display: "block", color: "#9aa0a6", fontSize: 14, marginBottom: 6 }}>
              預覽（拿假資料「蕭茗馥·0912345678·公司面談·房仲服務·賣房」套進去）
            </label>
            <div
              style={{
                background: activeColor.hex, color: "#fff", borderRadius: 6,
                padding: "9px 12px", fontSize: 15.5, fontWeight: 600, maxWidth: 340,
                boxShadow: "0 2px 10px rgba(0,0,0,.35)",
              }}
            >
              {preview}
              <div style={{ fontSize: 13.5, fontWeight: 400, opacity: 0.9, marginTop: 2 }}>16:15，太平洋房屋 梧棲市鎮加盟店</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
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
            <span style={{ color: "#6b7684", fontSize: 14, lineHeight: 1.7 }}>
              只影響<b style={{ color: "#9aa0a6" }}>之後</b>建立的預約。已經在日曆上的舊事件不會跟著變（改期時會順手更新）。
            </span>
          </div>

          {msg && (
            <div style={{ color: msg.ok ? "#86efac" : "#f0705c", fontSize: 14.5, lineHeight: 1.8 }}>{msg.text}</div>
          )}
        </div>
      )}
    </section>
  );
}
