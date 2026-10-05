"use client";
/**
 * 影片欄位：一支就好（FB 一篇貼文只掛一支影片，不像照片可以排到 10 張）。
 * 三種放法（跟照片同一套邏輯，仿 PhotoPicker）：
 *   1. 拖曳影片檔到這裡、或按「選影片」——上傳到 Cloudinary，拿回網址（要先設金鑰）。
 *   2. 貼影片直連網址（要是「檔案本體」的網址，不是 YouTube／Drive 那種網頁——貼了會被擋下來並講明原因）。
 *   3. 貼「發文那台桌機上」的影片檔路徑（`D:\影片\覓蜜開箱.mp4`），發文時
 *      tools/fb-autopost 的 prepareVideo() 自動讀取。瀏覽器讀不到本機檔案，這種不會有預覽。
 *
 * 🔴 瀏覽器結構性拿不到拖進來檔案的完整路徑（跟 PhotoPicker 同一個限制）——
 *    所以「拖曳」只能走雲端上傳這條路，不是把桌機路徑自動填進去。
 */
import { useState } from "react";
import { useCloudinaryUpload } from "./useCloudinaryUpload";
import { Icon } from "./icons";
import { CIS_VAR as CIS } from "@/app/admin/_components/cis";
import { isLocalPhotoPath } from "@/lib/media-url";

const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;
const isVideoFile = (f: File) => f.type.startsWith("video/") || VIDEO_EXT_RE.test(f.name);

/** Cloudinary 一般（非分段）上傳的實務上限，抓個保守值——超過就不要浪費時間上傳，直接請他改貼桌機路徑。 */
const MAX_UPLOAD_MB = 100;

/** YouTube／Google Drive 這類「網頁」網址，不是影片檔案本體，FB 抓不到——擋下來並講清楚原因，不要讓他自己猜。 */
function badUrlReason(raw: string): string | null {
  let host: string;
  try {
    host = new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname.replace(/^www\.|^m\./, "");
  } catch {
    return null;
  }
  if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    return (
      "這是 YouTube 的觀看頁，不是影片檔案本體——FB「相片/影片」那顆上傳欄位只吃真的檔案，貼網址進去會失敗。" +
      "只是想要像貼連結那樣秀縮圖預覽卡（點下去才跳轉去 YouTube，不是 FB 自己播）：" +
      "把這個連結直接貼進上面的「內文」就好，不用透過這裡——FB 自己會抓縮圖產生預覽卡。" +
      "要 FB 自己播放（原生影片）才需要真的檔案：改用下面「選影片」上傳，或貼桌機路徑。"
    );
  }
  if (host === "drive.google.com") {
    return "這是 Google Drive 的分享頁，不是影片檔案本體，FB 抓不到——改用下面「選影片」上傳，或貼桌機路徑。";
  }
  return null;
}

export function VideoPicker({
  value,
  onChange,
  uploadEnabled,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  /** 有沒有設 Cloudinary 金鑰——沒設就不顯示拖曳／選影片，只能貼路徑或網址。 */
  uploadEnabled: boolean;
  disabled?: boolean;
}) {
  const { uploading, uploadMsg, handleUpload, setUploadMsg } = useCloudinaryUpload();
  const [dragOver, setDragOver] = useState(false);

  const v = value.trim();
  const isLocal = v.length > 0 && isLocalPhotoPath(v);
  const urlProblem = v && !isLocal ? badUrlReason(v) : null;

  const takeFile = (file: File) => {
    if (!isVideoFile(file)) {
      setUploadMsg(`❌ 「${file.name}」看起來不是影片檔`);
      return;
    }
    const mb = file.size / (1024 * 1024);
    if (mb > MAX_UPLOAD_MB) {
      setUploadMsg(
        `❌ 「${file.name}」有 ${mb.toFixed(0)}MB，超過上傳上限（約 ${MAX_UPLOAD_MB}MB）——` +
          "改貼桌機路徑，發文時直接讀本機檔案，沒有大小限制。",
      );
      return;
    }
    handleUpload([file], (urls) => onChange(urls[0] || ""), { resourceType: "video", unitLabel: "支" });
  };

  const handleFiles = (files: File[]) => {
    if (files.length === 0) return;
    if (files.length > 1) setUploadMsg("一支就好，用了第一個");
    takeFile(files[0]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled || uploading) return;
    if (!uploadEnabled) {
      setUploadMsg("❌ 拖曳要先設定 Cloudinary（雲端圖床）—— 或直接在上面貼桌機路徑");
      return;
    }
    handleFiles(Array.from(e.dataTransfer.files || []));
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${dragOver ? CIS.blue : "transparent"}`,
        borderRadius: 10,
        margin: -4,
        padding: 4,
        transition: "border-color .12s",
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || uploading}
          placeholder={
            uploadEnabled
              ? "拖影片檔到這裡，或貼 D:\\影片\\覓蜜.mp4 ／ https://…/xxx.mp4"
              : "D:\\影片\\覓蜜開箱.mp4　或　https://…/xxx.mp4"
          }
          style={{
            flex: 1,
            minWidth: 0,
            boxSizing: "border-box",
            background: CIS.bgSoft,
            border: `1px solid ${CIS.cardBorder}`,
            color: CIS.text,
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 13,
            fontFamily: "inherit",
          }}
        />
        {v ? (
          <button
            type="button"
            onClick={() => onChange("")}
            disabled={disabled || uploading}
            title="移除影片"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              cursor: disabled ? "default" : "pointer",
              fontSize: 12.5,
              padding: "7px 10px",
              borderRadius: 7,
              border: `1px solid ${CIS.cardBorder}`,
              background: CIS.bgSoft,
              color: CIS.textSub,
              whiteSpace: "nowrap",
            }}
          >
            <Icon name="close" size={13} />
            移除
          </button>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        {uploadEnabled ? (
          <label style={btn(uploading || disabled)}>
            <input
              type="file"
              accept="video/*"
              hidden
              disabled={uploading || disabled}
              onChange={(e) => {
                const fs = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = "";
                handleFiles(fs);
              }}
            />
            <Icon name="video" size={14} />
            {uploading ? "上傳中…" : "選影片"}
          </label>
        ) : null}
        <span style={{ fontSize: 12, color: uploadMsg.startsWith("❌") ? "var(--cis-danger, #fb7185)" : CIS.textMute }}>
          {uploadMsg ||
            (v
              ? isLocal
                ? "📁 桌機路徑"
                : "影片網址"
              : `一支就好，跟照片放同一顆上傳欄位、會一起附上去。${uploadEnabled ? `影片檔上傳上限約 ${MAX_UPLOAD_MB}MB，太大請改貼桌機路徑。` : ""}`)}
        </span>
      </div>

      {!uploadEnabled ? (
        <div style={{ fontSize: 11.5, color: CIS.textMute, marginTop: 7, lineHeight: 1.6 }}>
          💡 想拖曳／選影片自動上傳，要先填 Cloudinary 金鑰（雲端圖床，免費）。在那之前貼桌機路徑最實際
          （發文那台電腦上，例：D:\影片\覓蜜.mp4），或貼影片直連網址。
        </div>
      ) : null}

      {urlProblem ? (
        <div
          style={{
            display: "flex",
            gap: 7,
            alignItems: "flex-start",
            marginTop: 8,
            padding: "8px 10px",
            borderRadius: 8,
            background: "rgba(244,63,94,0.1)",
            border: "1px solid rgba(244,63,94,0.3)",
            color: "var(--cis-danger, #fb7185)",
            fontSize: 12.5,
            lineHeight: 1.6,
          }}
        >
          <Icon name="warning" size={14} style={{ marginTop: 1, flexShrink: 0 }} />
          <div>{urlProblem}</div>
        </div>
      ) : null}

      {v && !isLocal && !urlProblem ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          src={v}
          controls
          style={{ marginTop: 8, maxWidth: 260, maxHeight: 170, borderRadius: 8, background: "#000", display: "block" }}
        />
      ) : null}

      {isLocal ? (
        <div style={{ fontSize: 11.5, color: CIS.textMute, marginTop: 7, lineHeight: 1.6 }}>
          發文那台桌機上要真的存在這個檔案，這裡不會有預覽。
          {!VIDEO_EXT_RE.test(v) ? (
            <span style={{ display: "block", color: "var(--cis-warn, #fbbf24)", marginTop: 3 }}>
              ⚠️ 路徑看起來沒有副檔名（.mp4／.mov 等）——Windows 預設會把已知副檔名隱藏起來，直接照畫面上看到的打字容易漏掉。
              {uploadEnabled ? "改用上面「選影片」或直接拖曳最保險，副檔名不會打錯。" : "檔案總管的「內容」或詳細清單可以看到完整檔名。"}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function btn(off: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    cursor: off ? "default" : "pointer",
    fontSize: 13,
    padding: "5px 11px",
    borderRadius: 7,
    border: `1px solid ${CIS.cardBorder}`,
    background: CIS.bgSoft,
    color: CIS.textSub,
    opacity: off ? 0.55 : 1,
  };
}
