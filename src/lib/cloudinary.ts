/**
 * Cloudinary 圖片上傳 —— 簽章模式（signed upload），2026-08-24。
 *
 * 為什麼是 Cloudinary 而不是 Vercel Blob：
 *   Blob 要升 Vercel Pro（US$20/月）才有額度，本人 2026-08-23 決定先不升。
 *   Cloudinary 免費方案允許商業使用，房仲物件照片的量遠遠用不完。
 *
 * 為什麼是 signed 而不是 unsigned upload preset：
 *   unsigned preset 一旦寫進前端就是公開的，任何人抓到都能往這個帳號丟檔案，
 *   額度被灌爆或被拿去放不該放的東西都無從擋起。signed 模式把 api_secret
 *   留在伺服器，每次上傳都要先跟後台換一張有時效的簽章，而換簽章要通過
 *   後台的管理員白名單檢查。
 *
 * ⚠️ api_secret 只能待在伺服器端。這個檔案不要被 "use client" 的元件 import。
 *
 * 環境變數（三個都要設，缺一個就當作沒設定）：
 *   CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
 * 設定方式見 [[reference_網站託管與檔案儲存]]。
 */
import { createHash } from "node:crypto";

export type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

/** 上傳到哪個資料夾。Cloudinary 後台會照這個分類，之後要清理比較好找。 */
export const CLOUDINARY_FOLDER = "properties";

/**
 * 讀設定。三個環境變數只要缺一個就回 null ——
 * 半套設定會在「按下上傳才失敗」的地方爆掉，不如一開始就當作沒有這個功能，
 * 讓畫面退回原本的貼網址流程。
 */
export function cloudinaryConfig(): CloudinaryConfig | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret };
}

/** 這台機器有沒有設定 Cloudinary（給 Server Component 決定要不要顯示上傳鈕）。 */
export function cloudinaryEnabled(): boolean {
  return cloudinaryConfig() !== null;
}

/**
 * 產生上傳簽章。
 *
 * Cloudinary 的規則：把「除了 file / api_key / resource_type 以外」要送的參數
 * 依 key 的字母序排成 `k=v&k=v`，接上 api_secret，取 SHA-1 hex。
 * 參數只要有一個對不上（多送、少送、值不同）Cloudinary 就會回 401，
 * 所以前端送出的欄位必須跟這裡簽的完全一致。
 */
export function signUploadParams(
  params: Record<string, string | number>,
  apiSecret: string,
): string {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(toSign + apiSecret).digest("hex");
}
