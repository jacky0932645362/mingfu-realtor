/**
 * 客服系統 CIS 設計 token — 統一深色質感 (取代原本 6 種亂碼灰度 #0a0a0a~#4a4a4a)
 * 2026-06-11 系統擁有者拍板:後台要 CIS 高質感,不要國中生感
 *
 * 對標 /admin/members/[id] 深色卡 + 太平洋房屋 CIS 藍黃,精緻深色 (客服久盯不刺眼)
 */
export const CIS = {
  bg: "#14161e", // 深藍灰底 (非純黑)
  bgSoft: "#1a1d27", // 區塊次底
  card: "rgba(255,255,255,0.03)", // 卡片
  cardHover: "rgba(255,255,255,0.05)",
  cardBorder: "rgba(255,255,255,0.08)", // 卡片邊框
  divider: "rgba(255,255,255,0.06)",
  text: "#f3f5f8", // 主文字 (2026-06-19 提亮:系統擁有者反映深色字有模糊感)
  textSub: "#c0c6d0", // 次文字 (提亮解模糊 — 原 #9aa0a6 在深底對比太低)
  textMute: "#9298a6", // 弱文字 (提亮解模糊 — 原 #6b7280 幾乎看不清)
  blue: "#5A91E1", // 太平洋房屋藍
  blueDeep: "#3d77c9",
  blueSoft: "#7eb0ef",
  yellow: "#F3C640", // 太平洋房屋黃
  font: "'Noto Sans TC','PingFang TC','Microsoft JhengHei',-apple-system,sans-serif",
  radius: 14,
  radiusSm: 10,
} as const;

// 狀態 chip 4 色 (success/warn/danger/info/neutral)
export const CHIP = {
  success: { bg: "rgba(34,197,94,0.15)", color: "#4ade80", border: "rgba(34,197,94,0.35)" },
  warn: { bg: "rgba(245,158,11,0.15)", color: "#fbbf24", border: "rgba(245,158,11,0.35)" },
  danger: { bg: "rgba(244,63,94,0.15)", color: "#fb7185", border: "rgba(244,63,94,0.35)" },
  info: { bg: "rgba(90,145,225,0.16)", color: "#7eb0ef", border: "rgba(90,145,225,0.4)" },
  neutral: { bg: "rgba(255,255,255,0.06)", color: "#9aa0a6", border: "rgba(255,255,255,0.14)" },
} as const;

export type ChipTone = keyof typeof CHIP;

// 常用 inline style 片段 (給各頁複用,確保一致)
export const cisCard: React.CSSProperties = {
  background: CIS.card,
  border: `1px solid ${CIS.cardBorder}`,
  borderRadius: CIS.radius,
};

export const cisSectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: CIS.textMute,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  marginBottom: 10,
};
