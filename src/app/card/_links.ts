/**
 * 名片頁的資料來源 —— 實際內容請改 `src/config/owner.ts`，不要改這裡。
 *
 * 這一層只是把設定接給既有元件用（元件裡的變數名沿用 `ABIN`，
 * 是這套系統原本的寫法，改名要動十幾個檔案，留著不影響你使用）。
 */
import { OWNER, SOCIAL as OWNER_SOCIAL, LINE_QR as OWNER_LINE_QR } from "@/config/owner";

export const ABIN = {
  name: OWNER.name,
  alias: OWNER.alias,
  brandPersona: OWNER.brandPersona,
  title: OWNER.title,
  phone: OWNER.phone,
  phoneRaw: OWNER.phoneRaw,
  email: OWNER.email,
  address: OWNER.address,
  photoUrl: OWNER.photoUrl,
  slogan: OWNER.slogan,
  company: OWNER.company,
} as const;

export const SOCIAL = OWNER_SOCIAL;

/** LINE 加好友 QR 圖。null = 不顯示 QR 區 */
export const LINE_QR = OWNER_LINE_QR;
