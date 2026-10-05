/**
 * FB 貼文工廠專用的淺色色票（2026-10-05 本人：「底色不要黑色，想改白色系列」）。
 *
 * 跟 @/app/admin/_components/cis 的 CIS／CHIP **欄位名稱一模一樣**，所以 /admin/fb 底下各頁
 * 只換 import 路徑就換膚；後台其他模組照舊用深色，不受影響。
 * 藍色從 #5A91E1 壓深一階：白底上白字按鈕、藍字連結才看得清楚。
 */
export const CIS = {
  bg: "#f4f6fa", // 主內容區底（淡灰白，不是純白，卡片才浮得出來）
  bgSoft: "#ffffff", // 側邊欄、輸入框
  card: "#ffffff",
  cardHover: "#f8fafc",
  cardBorder: "#dfe4ec",
  divider: "#e9edf3",
  text: "#1e293b",
  textSub: "#475569",
  textMute: "#64748b",
  blue: "#3d77c9",
  blueDeep: "#2f62ab",
  blueSoft: "#2f6fd1",
  yellow: "#F3C640",
  font: "'Noto Sans TC','PingFang TC','Microsoft JhengHei',-apple-system,sans-serif",
  radius: 14,
  radiusSm: 10,
} as const;

export const CHIP = {
  success: { bg: "#e7f7ee", color: "#15803d", border: "#b5e3c6" },
  warn: { bg: "#fff5e0", color: "#b45309", border: "#f3d391" },
  danger: { bg: "#fdecef", color: "#be123c", border: "#f5c0ca" },
  info: { bg: "#e8f0fc", color: "#2f62ab", border: "#bcd1f1" },
  neutral: { bg: "#f1f4f8", color: "#475569", border: "#d9dfe8" },
} as const;

export type ChipTone = keyof typeof CHIP;
