/**
 * 太平洋房屋 CIS — 前台亮色版（/card 名片頁 / 預約表單 / 成功頁，給客戶看）
 *
 * 2026-08-12：從原本的「天藍 + 橘」改成太平洋房屋品牌色，與個人官網同一套視覺：
 *   主紅 #E00000 / 深棕 #231815 / 亮粉 #EE828A / 淺粉 #F5C0C4 / 白 #FFFFFF
 *
 * ⚠️ key 的名字（sky / orange…）沿用原本的寫法，因為 Booking.module.css 與多個元件
 *    都靠這些名字取色，改名要動很多檔案。這裡的「語意」以註解為準，不要照字面理解顏色。
 */
export const RCIS = {
  sky: "#E00000", // 品牌主紅（原 sky，主色）
  skyDeep: "#A50000", // 深紅（漸層深端 / 連結字）
  skySoft: "#FDF2F3", // 極淺粉底（原 skySoft）
  orange: "#E00000", // CTA 主按鈕（原 orange）—— 配 ctaText 白字
  orangeDeep: "#B00000",
  orangeSoft: "#FDECEE", // 淺粉強調底
  ctaText: "#FFFFFF", // CTA 按鈕上的字色（紅底必須配白字）
  pink: "#EE828A", // 亮粉（次要強調）
  pinkSoft: "#F5C0C4", // 淺粉
  ink: "#231815", // 深棕（主文字）
  inkSoft: "#4A3B37", // 次深字
  muted: "#8A7A76", // 弱字
  bg: "#FFFFFF",
  bgSoft: "#FBF7F7",
  border: "#E8DEDD",
  line: "#F0E8E7",
  green: "#2BB673", // 成功 / 確認（保留綠色，成功狀態不用品牌紅，以免和錯誤訊息混淆）
  font: "'Noto Sans TC','PingFang TC','Microsoft JhengHei',-apple-system,BlinkMacSystemFont,sans-serif",
  radius: 16,
  radiusSm: 10,
  shadow: "0 4px 20px rgba(35,24,21,0.08)",
  shadowLg: "0 12px 44px rgba(35,24,21,0.14)",
} as const;

// 業績溫度色（後台 + 通知共用判讀）
export const HEAT_TONE: Record<string, { label: string; emoji: string; color: string }> = {
  high: { label: "高溫", emoji: "🔥", color: "#E00000" },
  mid: { label: "中溫", emoji: "🟡", color: "#EE828A" },
  low: { label: "低溫", emoji: "⚪", color: "#8A7A76" },
};
