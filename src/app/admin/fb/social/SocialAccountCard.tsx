"use client";
/**
 * 一個平台的帳號卡：連結／解除／續 token。
 * 「連結」是一般連結（<a>）不是 action —— OAuth 要整頁跳去 Meta 再跳回來。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { disconnectSocialAction, refreshSocialTokenAction } from "@/lib/actions/fb-actions";
import { CIS, CHIP } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import { CopyButton } from "../_ui/CopyButton";
import styles from "../fb.module.css";

export type SocialCardData = {
  platform: "ig" | "threads";
  label: string;
  appConfigured: boolean;
  connected: boolean;
  username: string | null;
  userId: string | null;
  expiresAtText: string | null;
  daysLeft: number | null;
  connectedAtText: string | null;
  refreshedAtText: string | null;
  redirectUri: string;
  scopes: string[];
  envKeys: [string, string];
};

export function SocialAccountCard({ data }: { data: SocialCardData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const tone = !data.appConfigured
    ? CHIP.neutral
    : !data.connected
      ? CHIP.warn
      : data.daysLeft != null && data.daysLeft <= 7
        ? CHIP.danger
        : CHIP.success;
  const statusText = !data.appConfigured
    ? "還沒設定 App ID／Secret"
    : !data.connected
      ? "還沒連結帳號"
      : data.daysLeft != null && data.daysLeft <= 7
        ? `token 剩 ${Math.max(0, data.daysLeft)} 天，快到期`
        : "已連結";

  const disconnect = () => {
    if (!confirm(`確定要解除 ${data.label} 的連結？之後排程裡勾了 ${data.label} 的都會發不出去，要重連。`)) return;
    start(async () => {
      const res = await disconnectSocialAction(data.platform);
      setMsg(res.ok ? { tone: "ok", text: res.message || "已解除" } : { tone: "bad", text: res.error || "失敗" });
      if (res.ok) router.refresh();
    });
  };

  const refresh = () =>
    start(async () => {
      const res = await refreshSocialTokenAction(data.platform);
      setMsg(res.ok ? { tone: "ok", text: res.message || "OK" } : { tone: "bad", text: res.error || "失敗" });
      if (res.ok) router.refresh();
    });

  return (
    <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
      <h3 className={styles.cardTitle} style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Icon name={data.platform === "ig" ? "camera" : "threads"} size={16} color={CIS.blueSoft} />
        {data.label}
        <span className={styles.chip} style={{ background: tone.bg, color: tone.color, borderColor: tone.border, marginLeft: "auto" }}>
          {statusText}
        </span>
      </h3>

      {data.connected ? (
        <div style={{ fontSize: 13.5, lineHeight: 1.9, color: CIS.textSub }}>
          帳號：<strong style={{ color: CIS.text }}>{data.username ? `@${data.username}` : "（沒拿到名稱）"}</strong>
          <span style={{ color: CIS.textMute }}>{data.userId ? `　ID ${data.userId}` : ""}</span>
          <br />
          token 到期：{data.expiresAtText || "—"}
          {data.daysLeft != null ? <span style={{ color: CIS.textMute }}>（剩 {data.daysLeft} 天；發文前會自動續，剩 20 天內才續）</span> : null}
          <br />
          連結於 {data.connectedAtText || "—"}
          {data.refreshedAtText ? `　上次續 ${data.refreshedAtText}` : ""}
        </div>
      ) : (
        <div style={{ fontSize: 13.5, lineHeight: 1.9, color: CIS.textSub }}>
          {data.appConfigured
            ? `按「連結」會跳去 Meta 授權畫面，用你的 ${data.label} 帳號登入、同意這兩個權限：${data.scopes.join("、")}。`
            : `先把 ${data.envKeys[0]}／${data.envKeys[1]} 填進環境變數（Vercel 跟桌機 .env.local 都要），這頁重新整理後「連結」才會亮。`}
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 12.5, color: CIS.textMute, lineHeight: 1.8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>Meta 後台要登記的重新導向網址：</span>
          <code style={{ background: CIS.bgSoft, padding: "2px 8px", borderRadius: 6, color: CIS.text, fontSize: 12 }}>{data.redirectUri}</code>
          <CopyButton text={data.redirectUri} label="複製" />
        </div>
      </div>

      <div className={styles.btnRow} style={{ marginTop: 14 }}>
        {data.appConfigured ? (
          <a
            href={`/api/social/oauth/${data.platform}/start`}
            className={styles.btn}
            style={{ background: CIS.blue, color: "#fff", textDecoration: "none" }}
          >
            <Icon name="link" size={15} />
            {data.connected ? "重新連結" : "連結帳號"}
          </a>
        ) : null}
        {data.connected ? (
          <>
            <button type="button" className={styles.btn} disabled={pending} onClick={refresh} style={{ background: "transparent", color: CIS.textSub, borderColor: CIS.cardBorder }}>
              <Icon name="refresh" size={14} />
              續 token
            </button>
            <button
              type="button"
              className={styles.btn}
              disabled={pending}
              onClick={disconnect}
              style={{ background: "transparent", color: "#e11d48", borderColor: "rgba(244,63,94,0.35)", marginLeft: "auto" }}
            >
              解除連結
            </button>
          </>
        ) : null}
      </div>

      {msg ? (
        <div style={{ marginTop: 10, fontSize: 13, color: msg.tone === "ok" ? "#16a34a" : "#e11d48" }}>{msg.text}</div>
      ) : null}
    </section>
  );
}
