"use client";
/**
 * 照片編排欄位：一行一個（第一行＝封面）。三種放法：
 *   1. 貼圖片網址（Google 相簿／雲端硬碟分享連結會自動轉直連）
 *   2. `allowLocalPaths` 開的話 —— 貼「發文那台桌機上的資料夾/檔案路徑」（`D:\物件照\覓蜜`），
 *      發文時 preparePhotos() 自動展開。瀏覽器讀不到本機檔案，所以這種不會有預覽。
 *   3. 有設 Cloudinary 金鑰的話 —— 拖曳照片/資料夾進來、或按鈕選檔/選資料夾，
 *      自動傳到雲端圖床、把網址填進來。
 *
 * 🔴 拖曳 / 選資料夾一定要走雲端（Cloudinary）—— 瀏覽器拿不到檔案的完整路徑，
 *    只拿得到檔案內容，所以沒有雲端空間就收不下。沒設金鑰時會提示改用「桌機路徑」那行。
 */
import { useState } from "react";
import { useCloudinaryUpload } from "./useCloudinaryUpload";
import { Icon } from "./icons";
import { CIS_VAR as CIS } from "@/app/admin/_components/cis";
import { directImageUrl, isLocalPhotoPath } from "@/lib/media-url";

const IMG_RE = /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i;
const isImageFile = (f: File) => f.type.startsWith("image/") || IMG_RE.test(f.name);
const byName = (a: File, b: File) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true });

/** 把拖進來的東西攤平成 File[]（資料夾會遞迴展開）。拿不到 entry API 就退回 dataTransfer.files。 */
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const items = dt.items ? Array.from(dt.items) : [];
  const entries = items
    .map((it) => (it.kind === "file" && it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter(Boolean) as FileSystemEntry[];

  if (entries.length === 0) return dt.files ? Array.from(dt.files) : [];

  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const f = await new Promise<File>((res, rej) =>
        (entry as FileSystemFileEntry).file(res, rej),
      );
      out.push(f);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const kids = await new Promise<FileSystemEntry[]>((res) => {
        const acc: FileSystemEntry[] = [];
        const read = () =>
          reader.readEntries((batch) => {
            if (!batch.length) return res(acc);
            acc.push(...batch);
            read();
          }, () => res(acc));
        read();
      });
      for (const k of kids) await walk(k);
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

export function PhotoPicker({
  value,
  onChange,
  uploadEnabled,
  max = 10,
  disabled = false,
  allowLocalPaths = false,
}: {
  value: string;
  onChange: (next: string) => void;
  uploadEnabled: boolean;
  max?: number;
  disabled?: boolean;
  allowLocalPaths?: boolean;
}) {
  const { uploading, uploadMsg, handleUpload, setUploadMsg } = useCloudinaryUpload();
  const [dragOver, setDragOver] = useState(false);
  // 縮圖拖曳排序用：dragIdx = 正在拖第幾張、overIdx = 現在懸在第幾張上面
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const lines = value
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const over = lines.length > max;
  const localCount = allowLocalPaths ? lines.filter(isLocalPhotoPath).length : 0;

  const appendUrls = (urls: string[]) => onChange([value.trim(), ...urls].filter(Boolean).join("\n"));

  /** 把第 from 張搬到第 to 張的位置（拖曳排序）。 */
  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    const next = [...lines];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next.join("\n"));
  };

  const takeFiles = (files: File[]) => {
    const imgs = files.filter(isImageFile).sort(byName);
    if (imgs.length === 0) {
      setUploadMsg("❌ 沒有圖片檔");
      return;
    }
    handleUpload(imgs.slice(0, 40), appendUrls);
  };

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled || uploading) return;
    if (!uploadEnabled) {
      setUploadMsg(
        allowLocalPaths
          ? "❌ 拖曳要先設定 Cloudinary（雲端圖床）—— 或直接在上面打桌機資料夾路徑那行"
          : "❌ 拖曳要先設定 Cloudinary（雲端圖床）",
      );
      return;
    }
    takeFiles(await filesFromDrop(e.dataTransfer));
  };

  return (
    <div
      onDragOver={(e) => {
        if (dragIdx !== null) return; // 內部縮圖排序中，不是拖檔案進來
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (dragIdx !== null) {
          setDragIdx(null);
          setOverIdx(null);
          return;
        }
        handleFileDrop(e);
      }}
      style={{
        border: `2px dashed ${dragOver ? CIS.blue : "transparent"}`,
        borderRadius: 10,
        margin: -4,
        padding: 4,
        transition: "border-color .12s",
      }}
    >
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || uploading}
        rows={5}
        placeholder={
          allowLocalPaths
            ? "一行一個，第一行是封面\nD:\\物件照\\覓蜜          ← 整個資料夾，桌機發文時自動展開\nhttps://…/01.jpg\n\n（照片拖曳進來、或用下面的按鈕，會傳到雲端）"
            : "一行一張，第一行是封面\nhttps://…/01.jpg\nhttps://…/02.jpg"
        }
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: CIS.bgSoft,
          border: `1px solid ${CIS.cardBorder}`,
          color: CIS.text,
          borderRadius: 8,
          padding: "8px 10px",
          fontSize: 13,
          fontFamily: "inherit",
          lineHeight: 1.6,
          resize: "vertical",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        {uploadEnabled ? (
          <>
            <label style={btn(uploading || disabled)}>
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                disabled={uploading || disabled}
                onChange={(e) => {
                  const fs = e.target.files ? Array.from(e.target.files) : [];
                  e.target.value = "";
                  takeFiles(fs);
                }}
              />
              <Icon name="image" size={14} />
              {uploading ? "上傳中…" : "選照片"}
            </label>
            <label style={btn(uploading || disabled)}>
              <input
                type="file"
                hidden
                multiple
                disabled={uploading || disabled}
                // webkitdirectory / directory 是非標準屬性（Chrome/Edge 支援：選整個資料夾），
                // 用 spread 塞進去，避開 React 型別沒有這欄的問題
                {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                onChange={(e) => {
                  const fs = e.target.files ? Array.from(e.target.files) : [];
                  e.target.value = "";
                  takeFiles(fs);
                }}
              />
              <Icon name="folder" size={14} />
              選整個資料夾
            </label>
          </>
        ) : null}
        <span style={{ fontSize: 12, color: over ? "var(--cis-warn, #fbbf24)" : CIS.textMute }}>
          {uploadMsg ||
            (over
              ? `列了 ${lines.length} 行，只會用前 ${max}`
              : uploadEnabled
                ? `第一行是封面，最多 ${max}。照片可以拖曳進來，或用上面的按鈕`
                : allowLocalPaths
                  ? `第一行是封面，最多 ${max}。貼圖片網址、或桌機上的資料夾/檔案路徑（發文時才讀）`
                  : `貼圖片直接網址，第一行是封面，最多 ${max} 張（Google 相簿要開公開分享）`)}
        </span>
      </div>

      {!uploadEnabled ? (
        <div style={{ fontSize: 11.5, color: CIS.textMute, marginTop: 7, lineHeight: 1.6 }}>
          💡 想「拖資料夾進來」或「選整個資料夾」自動上傳，要先填 Cloudinary 金鑰（雲端圖床，免費）。
          在那之前
          {allowLocalPaths ? "就打桌機資料夾路徑那行，或" : ""}貼圖片網址。
        </div>
      ) : null}

      {lines.length > 0 ? (
        <>
          <div style={{ fontSize: 11.5, color: CIS.textMute, marginTop: 10, marginBottom: 5 }}>
            拖曳縮圖換順序　·　第一張＝封面
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
            {lines.slice(0, max).map((u, i) => {
              const isLocal = allowLocalPaths && isLocalPhotoPath(u);
              const canDrag = !disabled && !uploading;
              const isDropTarget = overIdx === i && dragIdx !== null && dragIdx !== i;
              return (
                <span
                  key={`${u}-${i}`}
                  draggable={canDrag}
                  onDragStart={(e) => {
                    setDragIdx(i);
                    e.dataTransfer.effectAllowed = "move";
                    try {
                      e.dataTransfer.setData("text/plain", String(i));
                    } catch {}
                  }}
                  onDragEnd={() => {
                    setDragIdx(null);
                    setOverIdx(null);
                  }}
                  onDragOver={(e) => {
                    if (dragIdx === null) return; // 拖檔案進來 → 交給外層
                    e.preventDefault();
                    e.stopPropagation();
                    if (overIdx !== i) setOverIdx(i);
                  }}
                  onDrop={(e) => {
                    if (dragIdx === null) return;
                    e.preventDefault();
                    e.stopPropagation();
                    reorder(dragIdx, i);
                    setDragIdx(null);
                    setOverIdx(null);
                  }}
                  title={
                    isLocal
                      ? u
                      : `第 ${i + 1} 張${i === 0 ? "（封面）" : ""}${canDrag ? " —— 拖曳換順序" : ""}`
                  }
                  style={{
                    position: "relative",
                    display: "inline-flex",
                    borderRadius: 6,
                    cursor: canDrag ? "grab" : "default",
                    opacity: dragIdx === i ? 0.35 : 1,
                    outline: isDropTarget ? `2px solid ${CIS.blue}` : "none",
                    outlineOffset: 1,
                    transition: "opacity .1s",
                  }}
                >
                  {isLocal ? (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        maxWidth: 220,
                        height: 72,
                        padding: "0 10px",
                        borderRadius: 6,
                        border: `1px dashed ${i === 0 ? CIS.blue : CIS.cardBorder}`,
                        background: CIS.bgSoft,
                        color: CIS.textMute,
                        fontSize: 11.5,
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                      }}
                    >
                      <Icon name="folder" size={13} />
                      桌機路徑
                    </span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={directImageUrl(u)}
                      alt={`第 ${i + 1} 張`}
                      draggable={false}
                      style={{
                        width: 96,
                        height: 72,
                        objectFit: "cover",
                        borderRadius: 6,
                        border: `1px solid ${i === 0 ? CIS.blue : CIS.cardBorder}`,
                        background: CIS.bgSoft,
                        pointerEvents: "none",
                      }}
                    />
                  )}
                  {i === 0 ? (
                    <span
                      style={{
                        position: "absolute",
                        left: 3,
                        top: 3,
                        fontSize: 10,
                        fontWeight: 700,
                        background: CIS.blue,
                        color: "#fff",
                        padding: "1px 5px",
                        borderRadius: 4,
                        pointerEvents: "none",
                      }}
                    >
                      封面
                    </span>
                  ) : null}
                </span>
              );
            })}
          </div>
        </>
      ) : null}

      {localCount > 0 ? (
        <div style={{ fontSize: 11.5, color: CIS.textMute, marginTop: 7, lineHeight: 1.6 }}>
          📁 有 {localCount} 行是桌機路徑 —— 這裡不會預覽，發文時桌機才去讀（資料夾會展開成裡面所有圖，
          第一張＝檔名排最前的）。路徑要是<strong>發文那台桌機</strong>上真的存在的位置。
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
