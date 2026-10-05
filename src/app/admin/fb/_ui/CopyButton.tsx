"use client";
/**
 * 複製鈕。做法沿用 Export591View 那顆（同一套後台，行為要一致）。
 *
 * ⚠️ `navigator.clipboard` 在非 https 或使用者擋掉權限時會直接 throw ——
 *    那時退回 `window.prompt` 讓他至少能手動選取，不要靜靜什麼都沒發生
 *    （按了沒反應是最糟的，他會以為複製到了然後貼出空白）。
 */
import { useState } from "react";
import { CIS } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";

export function CopyButton({
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
      window.prompt("複製這段內容：", text);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      disabled={!text}
      style={{
        minHeight: 38,
        padding: "8px 15px",
        borderRadius: 8,
        border: primary ? "none" : `1px solid ${CIS.cardBorder}`,
        background: copied ? "rgba(34,197,94,0.2)" : primary ? CIS.blue : "rgba(15,23,42,0.05)",
        color: copied ? "#16a34a" : primary ? "#fff" : CIS.textSub,
        fontSize: 14,
        fontWeight: 800,
        fontFamily: "inherit",
        cursor: text ? "pointer" : "not-allowed",
        opacity: text ? 1 : 0.45,
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
