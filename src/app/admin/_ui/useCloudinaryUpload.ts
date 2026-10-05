"use client";
/**
 * 共用的 Cloudinary 簽章上傳（2026-09-06 從 PropertyForm 抽出來，給 FB 貼文工廠也用）。
 *
 * 流程：跟後台換一張有時效的簽章 → 前端直接把檔案 POST 到 Cloudinary → 拿回 secure_url。
 * 檔案不經過這台伺服器（省 Vercel 函式傳輸量、避開 4.5MB 請求上限）。
 * 沒設 CLOUDINARY_* 三個環境變數時 `/api/admin/upload-signature` 會回 503，
 * 呼叫端應該用 `cloudinaryEnabled()`（Server Component）先決定要不要顯示上傳鈕。
 *
 * ⚠️ PropertyForm 目前還有自己的一份幾乎一樣的邏輯，暫時沒動它（改它要連著測物件表單）。
 */
import { useState } from "react";

export function useCloudinaryUpload() {
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  /**
   * resourceType 決定丟去 Cloudinary 哪個端點（`/image/upload` 或 `/video/upload`）。
   * 🔴 簽章本身不用分——`signUploadParams` 簽的是 folder/timestamp，Cloudinary 的規則是
   * resource_type 不算進簽名（由端點網址決定），所以圖片、影片共用同一張 `/api/admin/upload-signature`。
   */
  async function uploadFiles(
    input: FileList | File[] | null,
    resourceType: "image" | "video" = "image",
  ): Promise<string[]> {
    const files = input ? Array.from(input) : [];
    if (files.length === 0) return [];
    const sigRes = await fetch("/api/admin/upload-signature", { method: "POST" });
    if (!sigRes.ok) {
      const body = await sigRes.json().catch(() => ({}));
      throw new Error(body.error || `無法取得上傳授權（${sigRes.status}）`);
    }
    const sig = await sigRes.json();

    const urls: string[] = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      setUploadMsg(`上傳中 ${i + 1}/${files.length}：${file.name}`);
      const fd = new FormData();
      // 這幾個欄位必須跟伺服器簽章時用的參數完全一致，多送少送都會被 Cloudinary 擋成 401
      fd.append("file", file);
      fd.append("api_key", sig.apiKey);
      fd.append("timestamp", String(sig.timestamp));
      fd.append("folder", sig.folder);
      fd.append("signature", sig.signature);

      const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/${resourceType}/upload`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.secure_url) {
        throw new Error(json?.error?.message || `${file.name} 上傳失敗`);
      }
      urls.push(json.secure_url as string);
    }
    return urls;
  }

  /** 包一層共用的狀態處理，錯誤一律顯示給使用者不要吞掉。 */
  async function handleUpload(
    files: FileList | File[] | null,
    onDone: (urls: string[]) => void,
    opts?: { resourceType?: "image" | "video"; unitLabel?: string },
  ) {
    setUploading(true);
    setUploadMsg("");
    try {
      const urls = await uploadFiles(files, opts?.resourceType ?? "image");
      if (urls.length > 0) {
        onDone(urls);
        setUploadMsg(`✅ 已上傳 ${urls.length} ${opts?.unitLabel ?? "張"}`);
      }
    } catch (err) {
      setUploadMsg(`❌ ${err instanceof Error ? err.message : "上傳失敗"}`);
    } finally {
      setUploading(false);
    }
  }

  return { uploading, uploadMsg, handleUpload, setUploadMsg };
}
