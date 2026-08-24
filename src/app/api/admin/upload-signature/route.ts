/**
 * POST /api/admin/upload-signature
 *
 * 發一張有時效的 Cloudinary 上傳簽章給後台表單。檔案本身不經過這台伺服器 ——
 * 前端拿到簽章後直接把檔案 POST 到 Cloudinary，省掉 Vercel 函式的傳輸量與
 * 4.5MB 請求上限（房仲拍的照片很容易超過）。
 *
 * 🔴 這支一定要擋登入。沒擋的話等於把「往我的 Cloudinary 帳號丟檔案」的權限
 *    公開在網路上。用的是後台同一套白名單檢查（沒設白名單一律回 false）。
 */
import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin-check";
import { CLOUDINARY_FOLDER, cloudinaryConfig, signUploadParams } from "@/lib/cloudinary";

export async function POST() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "請先登入後台" }, { status: 401 });
  }

  const cfg = cloudinaryConfig();
  if (!cfg) {
    return NextResponse.json(
      { error: "這個網站還沒設定 Cloudinary，請先填 CLOUDINARY_* 三個環境變數" },
      { status: 503 },
    );
  }

  // Cloudinary 的簽章有效期是 1 小時（以 timestamp 為準），單位是「秒」不是毫秒。
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder: CLOUDINARY_FOLDER, timestamp };

  return NextResponse.json({
    cloudName: cfg.cloudName,
    apiKey: cfg.apiKey,
    folder: CLOUDINARY_FOLDER,
    timestamp,
    signature: signUploadParams(params, cfg.apiSecret),
  });
}
