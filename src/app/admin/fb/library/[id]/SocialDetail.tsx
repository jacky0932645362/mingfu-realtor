"use client";
/**
 * 一則文案的 Instagram／Threads 版本（2026-09-21）。
 *
 * 內文預設從一般貼文推導（IG：拿掉網址行；Threads：壓到 500 字），本人改過就固定。
 * 「現在就發」是這個網站直接打官方 API 真的發出去 —— 不排程、不經過 runner。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateSocialTextAction, publishSocialNowAction, resetSocialStatusAction } from "@/lib/actions/fb-actions";
import { CIS, CHIP } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import { CopyButton } from "../../_ui/CopyButton";
import styles from "../../fb.module.css";

export type SocialTab = { key: string; label: string; href: string | null };

export type SocialDetailProps = {
  draftId: string;
  platform: "ig" | "threads";
  label: string;
  tabs: SocialTab[];
  text: string;
  derivedText: string;
  edited: boolean;
  status: "draft" | "posted";
  url: string | null;
  postedAtText: string | null;
  limit: number;
  account: { connected: boolean; username: string | null; appConfigured: boolean };
  photos: Array<{ url: string; ok: boolean; reason?: string }>;
};

export function SocialDetail(p: SocialDetailProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [body, setBody] = useState(p.text);
  const dirty = body !== p.text;
  const len = body.length;
  const over = len > p.limit;
  const okPhotos = p.photos.filter((x) => x.ok);
  const needPhoto = p.platform === "ig" && okPhotos.length === 0;

  const save = () =>
    start(async () => {
      const res = await updateSocialTextAction(p.draftId, p.platform, body);
      setMsg(res.ok ? { tone: "ok", text: res.message || "已儲存" } : { tone: "bad", text: res.error || "儲存失敗" });
      if (res.ok) router.refresh();
    });

  const resetToDerived = () =>
    start(async () => {
      const res = await updateSocialTextAction(p.draftId, p.platform, "");
      setMsg(res.ok ? { tone: "ok", text: res.message || "已回到自動版本" } : { tone: "bad", text: res.error || "失敗" });
      if (res.ok) {
        setBody(p.derivedText);
        router.refresh();
      }
    });

  const publishNow = () => {
    if (dirty) return setMsg({ tone: "bad", text: "內文改了還沒存 —— 先按「儲存」再發" });
    if (!confirm(`真的要現在發到 ${p.label}？這是公開發出去，會用 ${okPhotos.length} 張照片。`)) return;
    start(async () => {
      const res = await publishSocialNowAction(p.draftId, p.platform);
      setMsg(res.ok ? { tone: "ok", text: res.message || "已發" } : { tone: "bad", text: res.error || "發文失敗" });
      if (res.ok) router.refresh();
    });
  };

  const resetStatus = () =>
    start(async () => {
      const res = await resetSocialStatusAction(p.draftId, p.platform);
      setMsg(res.ok ? { tone: "ok", text: res.message || "OK" } : { tone: "bad", text: res.error || "失敗" });
      if (res.ok) router.refresh();
    });

  const chip = p.status === "posted" ? CHIP.success : CHIP.neutral;

  return (
    <>
      <div className={styles.tabs}>
        {p.tabs.map((t) => {
          const active = t.key === p.platform;
          if (!t.href) {
            return (
              <span key={t.key} className={styles.tab} style={{ background: "transparent", color: CIS.textMute, border: `1px dashed ${CIS.cardBorder}`, cursor: "not-allowed" }}>
                {t.label}（沒有）
              </span>
            );
          }
          return (
            <Link
              key={t.key}
              href={t.href}
              className={styles.tab}
              style={{
                background: active ? CIS.blue : "rgba(15,23,42,0.05)",
                color: active ? "#fff" : CIS.textSub,
                border: `1px solid ${active ? CIS.blue : CIS.cardBorder}`,
              }}
            >
              {t.label}
            </Link>
          );
        })}
        <span className={styles.chip} style={{ background: chip.bg, color: chip.color, borderColor: chip.border }}>
          {p.status === "posted" ? `已發到 ${p.label}` : "還沒發"}
        </span>
        {p.status === "posted" && p.url ? (
          <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ color: CIS.blueSoft, fontSize: 13 }}>
            看貼文 ↗
          </a>
        ) : null}
        {p.status === "posted" ? (
          <button
            type="button"
            className={styles.btn}
            disabled={pending}
            onClick={resetStatus}
            style={{ background: "transparent", color: CIS.textSub, borderColor: CIS.cardBorder, padding: "4px 10px", fontSize: 12.5 }}
          >
            退回「還沒發」
          </button>
        ) : null}
      </div>

      {!p.account.connected ? (
        <div className={styles.notice} style={{ background: "rgba(245,158,11,0.09)", border: "1px solid rgba(245,158,11,0.26)", color: CIS.textSub }}>
          <Icon name="warning" size={16} color="#b45309" className={styles.noticeIcon} />
          <div>
            {p.label} 還沒連結帳號，這裡可以先改文案，但發不出去。去{" "}
            <Link href="/admin/fb/social" style={{ color: CIS.blueSoft }}>
              IG／Threads 帳號
            </Link>{" "}
            連結{p.account.appConfigured ? "" : "（App ID／Secret 也還沒設）"}。
          </div>
        </div>
      ) : null}

      <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
        <h3 className={styles.cardTitle} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name={p.platform === "ig" ? "camera" : "threads"} size={16} color={CIS.blueSoft} />
          {p.label} 內文
          <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 600, color: over ? "#e11d48" : CIS.textMute }}>
            {len} / {p.limit} 字{over ? "　超過上限，存不了也發不了" : ""}
          </span>
        </h3>
        <div style={{ fontSize: 12.5, color: CIS.textMute, marginBottom: 8, lineHeight: 1.7 }}>
          {p.edited
            ? "這是你改過的版本，一般貼文再改也不會動到它。"
            : p.platform === "ig"
              ? "自動從一般貼文帶：拿掉帶網址的行（IG 說明裡連結不能點）、hashtag 最多 30 個。一般貼文改了這裡會跟著變；你在這裡存過就固定。"
              : "自動從一般貼文壓成 500 字內：鉤子＋規格＋亮點＋CTA＋經紀業名稱。一般貼文改了這裡會跟著變；你在這裡存過就固定。"}
        </div>
        <textarea
          className={styles.textarea}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={p.platform === "ig" ? 18 : 12}
          style={{ background: CIS.bgSoft, border: `1px solid ${over ? "rgba(244,63,94,0.5)" : CIS.cardBorder}`, color: CIS.text, width: "100%" }}
        />
        <div className={styles.btnRow} style={{ marginTop: 10 }}>
          <button type="button" className={styles.btn} disabled={pending || !dirty || over} onClick={save} style={{ background: CIS.blue, color: "#fff" }}>
            <Icon name="save" size={14} />
            儲存
          </button>
          {p.edited ? (
            <button type="button" className={styles.btn} disabled={pending} onClick={resetToDerived} style={{ background: "transparent", color: CIS.textSub, borderColor: CIS.cardBorder }}>
              <Icon name="undo" size={14} />
              回到自動版本
            </button>
          ) : null}
          <CopyButton text={body} label="複製整篇" />
        </div>
      </section>

      <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}`, marginTop: 14 }}>
        <h3 className={styles.cardTitle}>
          <Icon name="image" size={16} color={CIS.blueSoft} />
          照片（{okPhotos.length} 張會用）
        </h3>
        {p.photos.length === 0 ? (
          <div style={{ fontSize: 13, color: needPhoto ? "#b45309" : CIS.textMute }}>
            這則文案沒有照片。{p.platform === "ig" ? "IG 一定要有照片才能發。" : "Threads 會發純文字。"}
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {p.photos.map((ph, i) => (
              <div key={`${ph.url}-${i}`} style={{ width: 120 }}>
                <div style={{ width: 120, height: 90, borderRadius: 8, overflow: "hidden", background: CIS.bgSoft, border: `1px solid ${ph.ok ? CIS.cardBorder : "rgba(244,63,94,0.5)"}`, opacity: ph.ok ? 1 : 0.55 }}>
                  {/^https?:\/\//.test(ph.url) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ph.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <div style={{ padding: 8, fontSize: 11, color: CIS.textMute }}>📁 桌機路徑</div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: ph.ok ? CIS.textMute : "#e11d48", marginTop: 3, lineHeight: 1.4 }}>
                  {ph.ok ? (i === 0 ? "封面" : `第 ${i + 1} 張`) : ph.reason}
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 10, lineHeight: 1.7 }}>
          照片跟一般貼文同一份（物件庫的、或手動文案自己帶的）。{p.platform === "ig" ? "IG 只吃 JPEG、最多 10 張，Cloudinary 的網址會自動轉 JPEG、縮到 1440 寬。" : "Threads 吃 JPEG／PNG、最多 20 張（這裡跟 FB 一樣最多帶 10 張）。"}
          桌機資料夾路徑的照片 API 抓不到，要先上傳到 Cloudinary。
        </div>
      </section>

      <div className={styles.btnRow} style={{ marginTop: 20 }}>
        <button
          type="button"
          className={styles.btn}
          disabled={pending || !p.account.connected || over || needPhoto || !body.trim()}
          onClick={publishNow}
          style={{ background: p.account.connected && !over && !needPhoto ? "#e11d48" : "transparent", color: p.account.connected && !over && !needPhoto ? "#fff" : CIS.textMute, borderColor: "rgba(244,63,94,0.35)" }}
        >
          <Icon name="send" size={15} />
          現在就發到 {p.label}
        </button>
        <Link
          href={`/admin/fb/schedule?draft=${p.draftId}&channel=post`}
          className={styles.btn}
          style={{ background: "transparent", color: CIS.textSub, borderColor: CIS.cardBorder }}
        >
          <Icon name="calendar" size={15} />
          排程（在一般貼文那頁勾 {p.label}）
        </Link>
      </div>
      {msg ? (
        <div style={{ marginTop: 12, fontSize: 13, whiteSpace: "pre-wrap", color: msg.tone === "ok" ? "#16a34a" : "#e11d48" }}>{msg.text}</div>
      ) : null}
      {p.status === "posted" && p.postedAtText ? (
        <div style={{ marginTop: 8, fontSize: 12.5, color: CIS.textMute }}>發於 {p.postedAtText}</div>
      ) : null}
    </>
  );
}
