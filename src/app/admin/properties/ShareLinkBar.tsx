"use client";

/**
 * 物件公開連結列 —— 這頁最常用的動作就是「把連結複製起來貼到 LINE 給客戶」，
 * 所以放在詳細頁最上面，不用捲到下面找。
 */

import { useState } from "react";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";

export default function ShareLinkBar({
  url,
  isPublic,
}: {
  url: string;
  isPublic: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // 非 https 或瀏覽器擋剪貼簿時：至少讓他能手動選取
      window.prompt("複製這段連結：", url);
    }
  };

  return (
    <div
      style={{
        background: CIS.card,
        border: `1px solid ${CIS.cardBorder}`,
        borderRadius: CIS.radius,
        padding: "13px 16px",
        marginBottom: 14,
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <Icon name="link" size={16} color={CIS.blueSoft} />
      <code
        style={{
          flex: "1 1 260px",
          minWidth: 0,
          fontSize: 14,
          color: isPublic ? CIS.text : CIS.textMute,
          wordBreak: "break-all",
        }}
      >
        {url}
      </code>

      <button
        type="button"
        onClick={() => void copy()}
        style={{
          minHeight: 40,
          padding: "8px 16px",
          borderRadius: 7,
          border: "none",
          background: copied ? "rgba(34,197,94,0.2)" : CIS.blue,
          color: copied ? "#4ade80" : "#fff",
          fontSize: 14,
          fontWeight: 800,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Icon name={copied ? "success" : "copy"} size={15} />
        {copied ? "已複製" : "複製連結"}
      </button>

      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        style={{
          minHeight: 40,
          padding: "8px 14px",
          borderRadius: 7,
          border: `1px solid ${CIS.cardBorder}`,
          color: CIS.textSub,
          fontSize: 14,
          fontWeight: 800,
          textDecoration: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Icon name="externalLink" size={15} />
        預覽
      </a>

      {!isPublic ? (
        <span style={{ width: "100%", fontSize: 13, color: "#fbbf24", fontWeight: 700 }}>
          ⚠ 目前是草稿／已下架，這個連結客戶打開會是 404。要給客戶看請先改成「上架中」。
        </span>
      ) : null}
    </div>
  );
}
