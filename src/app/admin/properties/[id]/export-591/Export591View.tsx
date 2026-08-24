"use client";

/**
 * 591 上架包的畫面（2026-08-24）
 *
 * 這頁只做一件事：讓「把物件搬到 591」這件事從打字 30 分鐘變成複製貼上 5 分鐘。
 * 所以每一塊內容旁邊都有自己的複製鈕 —— 591 後台是一格一格填的，
 * 給一大坨文字讓人自己剪反而更慢。
 *
 * 刻意沒有做「自動幫你填進 591」：591 沒有給個人房仲的官方 API，
 * 自動填只能靠瀏覽器自動化模擬登入，違反 591 服務條款且有鎖帳號風險。
 * 最後貼上與送出那一下由本人自己按。
 */

import { useState } from "react";
import Link from "next/link";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import type { Export591Package } from "@/lib/export-591";
import { TITLE_LIMIT } from "@/lib/export-591";
import styles from "../../../customers/customers.module.css";

/* ────────────────── 複製鈕 ────────────────── */

function CopyButton({
  text,
  label = "複製",
  primary = false,
}: {
  text: string;
  label?: string;
  primary?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 非 https 或瀏覽器擋剪貼簿時：至少讓他能手動選取（對齊 ShareLinkBar 的做法）
      window.prompt("複製這段內容：", text);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      style={{
        minHeight: 36,
        padding: "6px 13px",
        borderRadius: 7,
        border: primary ? "none" : `1px solid ${CIS.cardBorder}`,
        background: copied ? "rgba(34,197,94,0.2)" : primary ? CIS.blue : "rgba(255,255,255,0.05)",
        color: copied ? "#4ade80" : primary ? "#fff" : CIS.textSub,
        fontSize: 14,
        fontWeight: 800,
        fontFamily: "inherit",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      <Icon name={copied ? "success" : "copy"} size={14} />
      {copied ? "已複製" : label}
    </button>
  );
}

/* ────────────────── 區塊外框 ────────────────── */

function Card({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: CIS.card,
        border: `1px solid ${CIS.cardBorder}`,
        borderRadius: CIS.radius,
        padding: "16px 18px",
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: note ? 4 : 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: CIS.text, flex: 1, minWidth: 0 }}>
          {title}
        </h2>
        {action}
      </div>
      {note ? (
        <p style={{ margin: "0 0 12px", fontSize: 13, color: CIS.textMute, lineHeight: 1.6 }}>{note}</p>
      ) : null}
      {children}
    </section>
  );
}

/* ────────────────── 主畫面 ────────────────── */

export default function Export591View({
  pkg,
  propertyId,
  propertyTitle,
}: {
  pkg: Export591Package;
  propertyId: string;
  propertyTitle: string;
}) {
  return (
    <>
      <div className={styles.titleRow}>
        <div>
          <h1 className={styles.title}>
            <Icon name="upload" size={24} />
            591 上架包
          </h1>
          <p className={styles.subtitle} style={{ color: CIS.textSub }}>
            {propertyTitle}
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link
            href={`/admin/properties/${propertyId}`}
            className={styles.button}
            style={{
              background: "rgba(255,255,255,0.05)",
              color: CIS.textSub,
              border: `1px solid ${CIS.cardBorder}`,
            }}
          >
            回物件編輯
          </Link>
          <a
            href="https://www.591.com.tw/"
            target="_blank"
            rel="noreferrer"
            className={styles.button}
            style={{ background: CIS.blue, color: "#fff" }}
          >
            <Icon name="externalLink" size={15} />
            開啟 591
          </a>
        </div>
      </div>

      {/* ---- 上架前檢查 ---- */}
      {pkg.warnings.length > 0 ? (
        <div
          style={{
            background: "rgba(245,158,11,0.1)",
            border: "1px solid rgba(245,158,11,0.35)",
            borderRadius: CIS.radius,
            padding: "13px 16px",
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 900, color: "#fbbf24", marginBottom: 7 }}>
            上架前先補這些（{pkg.warnings.length}）
          </div>
          <ul style={{ margin: 0, paddingLeft: 20, color: CIS.textSub, fontSize: 14, lineHeight: 1.85 }}>
            {pkg.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <div style={{ marginTop: 9 }}>
            <Link
              href={`/admin/properties/${propertyId}`}
              style={{ fontSize: 13, color: CIS.blueSoft, fontWeight: 800 }}
            >
              去把資料補齊 →
            </Link>
          </div>
        </div>
      ) : (
        <div
          style={{
            background: "rgba(34,197,94,0.1)",
            border: "1px solid rgba(34,197,94,0.35)",
            borderRadius: CIS.radius,
            padding: "12px 16px",
            marginBottom: 14,
            fontSize: 14,
            fontWeight: 800,
            color: "#4ade80",
          }}
        >
          資料齊了，可以直接上架。
        </div>
      )}

      {/* ---- 標題 ---- */}
      <Card
        title="591 物件標題"
        note={`${pkg.titleLength} 字${
          pkg.titleOverflow
            ? `　⚠ 超過建議的 ${TITLE_LIMIT} 字，591 可能會截掉後面，建議自己再砍短`
            : `　建議 ${TITLE_LIMIT} 字以內`
        }`}
        action={<CopyButton text={pkg.titleFull} label="複製標題" primary />}
      >
        <div
          style={{
            background: CIS.bgSoft,
            border: `1px solid ${pkg.titleOverflow ? "rgba(245,158,11,0.5)" : CIS.cardBorder}`,
            borderRadius: CIS.radiusSm,
            padding: "12px 14px",
            fontSize: 17,
            fontWeight: 800,
            color: CIS.text,
            lineHeight: 1.5,
            wordBreak: "break-all",
          }}
        >
          {pkg.titleFull || <span style={{ color: CIS.textMute, fontWeight: 400 }}>（沒有標題）</span>}
        </div>
        {pkg.titleOverflow ? (
          <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: CIS.textMute }}>裁到 {TITLE_LIMIT} 字的版本：</span>
            <code style={{ fontSize: 14, color: CIS.text }}>{pkg.title}</code>
            <CopyButton text={pkg.title} label="複製裁短版" />
          </div>
        ) : null}
      </Card>

      {/* ---- 欄位對照表 ---- */}
      <Card
        title="591 欄位對照"
        note="左邊是 591 後台大概的欄位名（實際名稱以 591 為準），右邊是你資料庫的值。一格一格複製貼過去。"
      >
        <div style={{ display: "grid", gap: 7 }}>
          {pkg.fields.map((f) => {
            const missing = !f.value;
            return (
              <div
                key={f.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  background: CIS.bgSoft,
                  border: `1px solid ${missing && f.required ? "rgba(245,158,11,0.35)" : CIS.cardBorder}`,
                  borderRadius: CIS.radiusSm,
                  padding: "9px 12px",
                }}
              >
                <div style={{ width: 108, flexShrink: 0, fontSize: 13, color: CIS.textMute, fontWeight: 700 }}>
                  {f.label}
                  {f.required ? <span style={{ color: "#fb7185" }}> *</span> : null}
                </div>
                <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 800,
                      color: missing ? CIS.textMute : CIS.text,
                      wordBreak: "break-all",
                    }}
                  >
                    {f.value || "（未填）"}
                  </div>
                  {f.hint ? (
                    <div style={{ fontSize: 12.5, color: CIS.textMute, marginTop: 3, lineHeight: 1.55 }}>
                      {f.hint}
                    </div>
                  ) : null}
                </div>
                {f.value ? <CopyButton text={f.value} /> : null}
              </div>
            );
          })}
        </div>
      </Card>

      {/* ---- 物件描述 ---- */}
      <Card
        title="591 物件描述"
        note="已照「總價→格局→賣點→條件→生活機能→交通」的順序組好。⚠ 裡面刻意沒有放電話／LINE／網址 —— 刊登平台通常禁止在描述裡導流站外，被檢舉會下架，聯絡方式請填 591 自己的仲介資訊欄位。"
        action={<CopyButton text={pkg.description} label="複製全文" primary />}
      >
        <pre
          style={{
            margin: 0,
            background: CIS.bgSoft,
            border: `1px solid ${CIS.cardBorder}`,
            borderRadius: CIS.radiusSm,
            padding: "14px 16px",
            fontSize: 14.5,
            lineHeight: 1.85,
            color: CIS.text,
            fontFamily: "inherit",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 460,
            overflowY: "auto",
          }}
        >
          {pkg.description}
        </pre>
      </Card>

      {/* ---- 照片 ---- */}
      <Card
        title={`照片（${pkg.photos.length} 張）`}
        note="591 是「上傳檔案」不是貼網址，所以這裡給你的是依序排好的原圖連結：點開、右鍵存檔、再照這個順序上傳。第一張就是 591 的封面。"
        action={
          pkg.photos.length ? (
            <CopyButton
              text={pkg.photos.map((url, i) => `${String(i + 1).padStart(2, "0")}. ${url}`).join("\n")}
              label="複製全部網址"
            />
          ) : undefined
        }
      >
        {pkg.photos.length === 0 ? (
          <div
            style={{
              border: `1px dashed ${CIS.cardBorder}`,
              borderRadius: CIS.radiusSm,
              padding: "22px 16px",
              textAlign: "center",
              color: CIS.textMute,
              fontSize: 14,
            }}
          >
            這件物件還沒有照片
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {pkg.photos.map((url, i) => (
              <div
                key={`${url}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  background: CIS.bgSoft,
                  border: `1px solid ${CIS.cardBorder}`,
                  borderRadius: CIS.radiusSm,
                  padding: 9,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    width: 26,
                    flexShrink: 0,
                    textAlign: "center",
                    fontSize: 13,
                    fontWeight: 900,
                    color: i === 0 ? CIS.yellow : CIS.textMute,
                  }}
                >
                  {i + 1}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`照片 ${i + 1}`}
                  style={{
                    width: 76,
                    height: 56,
                    flexShrink: 0,
                    objectFit: "cover",
                    borderRadius: 6,
                    border: `1px solid ${CIS.cardBorder}`,
                    background: CIS.bg,
                  }}
                />
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    flex: "1 1 200px",
                    minWidth: 0,
                    fontSize: 13,
                    color: CIS.textSub,
                    wordBreak: "break-all",
                    textDecoration: "none",
                  }}
                >
                  {url}
                </a>
                <CopyButton text={url} label="複製網址" />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ---- 影片 ---- */}
      {pkg.videos.length > 0 ? (
        <Card
          title={`影片（${pkg.videos.length} 支）`}
          note="591 的影音欄位不一定吃 YouTube 連結，這裡主要是方便你同一批內容也貼到 FB／IG／官網。"
          action={<CopyButton text={pkg.videos.join("\n")} label="複製全部" />}
        >
          <div style={{ display: "grid", gap: 7 }}>
            {pkg.videos.map((url) => (
              <div
                key={url}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: CIS.bgSoft,
                  border: `1px solid ${CIS.cardBorder}`,
                  borderRadius: CIS.radiusSm,
                  padding: "9px 12px",
                  flexWrap: "wrap",
                }}
              >
                <Icon name="video" size={15} color={CIS.textMute} />
                <code style={{ flex: "1 1 200px", minWidth: 0, fontSize: 13, color: CIS.textSub, wordBreak: "break-all" }}>
                  {url}
                </code>
                <CopyButton text={url} label="複製" />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* ---- 整包 ---- */}
      <Card
        title="整包純文字"
        note="想先存成備忘錄、或貼給別的平台用的話，這裡是全部內容一次複製。"
        action={<CopyButton text={pkg.plainText} label="複製整包" primary />}
      >
        <pre
          style={{
            margin: 0,
            background: CIS.bgSoft,
            border: `1px solid ${CIS.cardBorder}`,
            borderRadius: CIS.radiusSm,
            padding: "13px 15px",
            fontSize: 13,
            lineHeight: 1.75,
            color: CIS.textSub,
            fontFamily: "inherit",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {pkg.plainText}
        </pre>
      </Card>

      <p style={{ fontSize: 13, color: CIS.textMute, lineHeight: 1.8, margin: "4px 2px 40px" }}>
        591 沒有開放給個人房仲的刊登 API（只有品牌總部等級的 B2B 合約才有），
        網路上教人「申請 591 API key」的文章查無官方依據。
        用程式自動登入代填雖然做得到，但違反 591 服務條款、批次連發會被判定異常鎖帳號，
        所以這頁只做到把字準備好，最後貼上與送出請自己按。
      </p>
    </>
  );
}
