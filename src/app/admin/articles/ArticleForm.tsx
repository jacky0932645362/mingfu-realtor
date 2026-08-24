"use client";

/**
 * 文章新增／編輯表單。
 * 對齊 properties/PropertyForm.tsx 的做法（樣式、上傳流程、儲存流程全部沿用）。
 *
 * 內文用 Markdown 純文字框，不做「所見即所得」編輯器 ——
 * 一個只有一個人在用、一次寫沒幾篇的功能，做富文本編輯器的成本遠高於好處。
 * 支援的語法列在下面的說明區塊。
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import {
  ARTICLE_CATEGORIES,
  ARTICLE_STATUSES,
  type ArticleInput,
  type ArticleRow,
} from "@/lib/article";
import { renderMarkdown, readMinutes } from "@/lib/markdown";
import { directImageUrl } from "@/lib/media-url";
import {
  createArticleAction,
  updateArticleAction,
  deleteArticleAction,
} from "@/lib/actions/article-actions";
import styles from "../customers/customers.module.css";

const inputStyle: React.CSSProperties = {
  minHeight: 44,
  width: "100%",
  padding: "9px 11px",
  borderRadius: 7,
  border: `1px solid ${CIS.cardBorder}`,
  background: CIS.bgSoft,
  color: CIS.text,
  fontSize: 15,
  fontFamily: "inherit",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 96,
  resize: "vertical",
  lineHeight: 1.6,
};

const hintStyle: React.CSSProperties = {
  fontSize: 13,
  color: CIS.textMute,
  lineHeight: 1.6,
  marginTop: -2,
};

const uploadBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 40,
  padding: "0 14px",
  borderRadius: 7,
  border: `1px solid ${CIS.cardBorder}`,
  background: "rgba(90,145,225,0.14)",
  color: CIS.text,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

export default function ArticleForm({
  article,
  uploadEnabled = false,
}: {
  article?: ArticleRow;
  uploadEnabled?: boolean;
}) {
  const router = useRouter();
  const isEdit = Boolean(article);

  const [title, setTitle] = useState(article?.title ?? "");
  const [slug, setSlug] = useState(article?.slug ?? "");
  const [status, setStatus] = useState(article?.status ?? "draft");
  const [category, setCategory] = useState(article?.category ?? "");
  const [excerpt, setExcerpt] = useState(article?.excerpt ?? "");
  const [coverUrl, setCoverUrl] = useState(article?.cover_url ?? "");
  const [content, setContent] = useState(article?.content ?? "");
  const [sortOrder, setSortOrder] = useState((article?.sort_order ?? 0).toString());

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const coverPreview = coverUrl.trim() ? directImageUrl(coverUrl.trim()) : "";
  const previewHtml = useMemo(() => renderMarkdown(content), [content]);
  const minutes = useMemo(() => readMinutes(content), [content]);
  const charCount = content.length;

  /* ── 封面上傳（Cloudinary signed upload，跟 PropertyForm 同一套後端） ── */
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadMsg("");
    try {
      const sigRes = await fetch("/api/admin/upload-signature", { method: "POST" });
      if (!sigRes.ok) {
        const body = await sigRes.json().catch(() => ({}));
        throw new Error(body.error || `無法取得上傳授權（${sigRes.status}）`);
      }
      const sig = await sigRes.json();
      const file = files[0];
      const fd = new FormData();
      fd.append("file", file);
      fd.append("api_key", sig.apiKey);
      fd.append("timestamp", String(sig.timestamp));
      fd.append("folder", sig.folder);
      fd.append("signature", sig.signature);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.secure_url) throw new Error(json?.error?.message || `${file.name} 上傳失敗`);
      setCoverUrl(json.secure_url as string);
      setUploadMsg("✅ 已上傳");
    } catch (err) {
      setUploadMsg(`❌ ${err instanceof Error ? err.message : "上傳失敗"}`);
    } finally {
      setUploading(false);
    }
  }

  function numOrNull(s: string): number | null {
    const n = Number(s);
    return s.trim() === "" || Number.isNaN(n) ? null : n;
  }

  const buildInput = (): ArticleInput => ({
    slug: slug.trim(),
    title: title.trim(),
    excerpt: excerpt.trim() || null,
    category: category || null,
    content,
    coverUrl: coverUrl.trim() || null,
    status,
    sortOrder: Math.trunc(numOrNull(sortOrder) ?? 0),
  });

  const submit = async () => {
    if (!title.trim()) {
      setError("文章標題必填");
      return;
    }
    if (!content.trim()) {
      setError("內文不能空白");
      return;
    }
    setBusy(true);
    setError(null);

    const input = buildInput();
    const result = isEdit
      ? await updateArticleAction(article!.id, input)
      : await createArticleAction(input);

    setBusy(false);
    if (!result.ok) {
      setError(result.error || "儲存失敗，請再試一次");
      return;
    }
    router.push(`/admin/articles/${isEdit ? article!.id : result.id}`);
    router.refresh();
  };

  const remove = async () => {
    if (!article) return;
    setBusy(true);
    const result = await deleteArticleAction(article.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "刪除失敗");
      return;
    }
    router.push("/admin/articles");
    router.refresh();
  };

  return (
    <div>
      {/* ── 基本 ── */}
      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>基本</h2>
        <div className={styles.formGrid}>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            文章標題 *
            <input
              style={inputStyle}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              placeholder="房地合一稅怎麼算？賣房前一定要知道的稅率表"
            />
          </label>

          <label className={styles.field} style={{ color: CIS.textMute }}>
            網址短碼（留空自動產生）
            <input
              style={inputStyle}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              maxLength={80}
              placeholder="land-value-tax-guide"
            />
            <span style={hintStyle}>
              只能英文小寫／數字／連字號。發佈後會被 Google 收錄，之後改網址等於斷連結，請三思。
            </span>
          </label>

          <label className={styles.field} style={{ color: CIS.textMute }}>
            分類
            <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">未分類</option>
              {ARTICLE_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </label>

          <label className={styles.field} style={{ color: CIS.textMute }}>
            狀態
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
              {ARTICLE_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            <span style={hintStyle}>只有「已發佈」會出現在文章列表，草稿與下架客戶看不到</span>
          </label>

          <label className={styles.field} style={{ color: CIS.textMute }}>
            排序（數字大的排前面）
            <input
              style={inputStyle}
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </label>

          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            摘要（留空會自動從內文擷取前一段）
            <textarea
              style={{ ...textareaStyle, minHeight: 64 }}
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              maxLength={300}
              placeholder="用一兩句話回答：讀者讀完這篇能得到什麼？"
            />
          </label>
        </div>
      </div>

      {/* ── 封面 ── */}
      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>封面圖（選填）</h2>
        <div className={styles.formGrid}>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            封面圖網址
            <input
              style={inputStyle}
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              maxLength={600}
              placeholder="https://…/cover.jpg"
            />
          </label>
        </div>

        {uploadEnabled ? (
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label style={{ ...uploadBtnStyle, opacity: uploading ? 0.55 : 1 }}>
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={uploading}
                onChange={(e) => {
                  const files = e.target.files;
                  e.target.value = "";
                  void handleUpload(files);
                }}
              />
              <Icon name="image" size={15} />
              {uploading ? "上傳中…" : "上傳封面圖"}
            </label>
            {uploadMsg ? <span style={{ fontSize: 13, color: CIS.textSub }}>{uploadMsg}</span> : null}
          </div>
        ) : null}

        {coverPreview ? (
          <div style={{ marginTop: 10 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverPreview}
              alt="封面預覽"
              style={{
                width: 320,
                height: 180,
                objectFit: "cover",
                borderRadius: 10,
                border: `1px solid ${CIS.cardBorder}`,
                background: CIS.bgSoft,
              }}
            />
          </div>
        ) : null}
      </div>

      {/* ── 內文 ── */}
      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 className={styles.sectionTitle} style={{ color: CIS.text, margin: 0 }}>內文 *</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, color: CIS.textMute }}>
              {charCount} 字・約 {minutes} 分鐘讀完
            </span>
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              style={{
                minHeight: 34,
                padding: "0 12px",
                borderRadius: 7,
                border: `1px solid ${CIS.cardBorder}`,
                background: showPreview ? CIS.blue : "transparent",
                color: showPreview ? "#fff" : CIS.textSub,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {showPreview ? "回編輯" : "預覽"}
            </button>
          </div>
        </div>

        <div
          style={{
            marginTop: 10,
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(90,145,225,0.10)",
            border: `1px solid ${CIS.cardBorder}`,
            fontSize: 13,
            lineHeight: 1.7,
            color: CIS.textSub,
          }}
        >
          支援：<code>## 標題</code>／<code>### 小標</code>／<code>**粗體**</code>／
          <code>- 清單</code>／<code>1. 有序清單</code>／<code>&gt; 引言</code>／
          <code>| 表格 |</code>／<code>[文字](網址)</code>／<code>---</code> 分隔線。
          空行才會分段，單一換行不會。
        </div>

        {showPreview ? (
          <div
            style={{
              padding: "18px 20px",
              borderRadius: 8,
              background: CIS.bgSoft,
              border: `1px solid ${CIS.cardBorder}`,
              color: CIS.text,
              lineHeight: 1.9,
              maxWidth: "42em",
            }}
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        ) : (
          <textarea
            style={{ ...textareaStyle, minHeight: 420, fontFamily: "ui-monospace, monospace", fontSize: 14 }}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={"## 小標題\n\n內文段落，空行才會分段。\n\n- 清單項目一\n- 清單項目二"}
          />
        )}
      </div>

      <div className={styles.formActions}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          style={{
            minHeight: 46,
            padding: "10px 20px",
            borderRadius: 8,
            border: "none",
            background: CIS.blue,
            color: "#fff",
            fontSize: 16,
            fontWeight: 800,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.65 : 1,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="save" size={16} />
          {busy ? "儲存中…" : isEdit ? "儲存變更" : "新增文章"}
        </button>

        {isEdit ? (
          confirmDelete ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove()}
                style={{
                  minHeight: 46,
                  padding: "10px 18px",
                  borderRadius: 8,
                  border: "1px solid rgba(244,63,94,0.45)",
                  background: "rgba(244,63,94,0.16)",
                  color: "#fb7185",
                  fontSize: 15,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                確定刪除，無法復原
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                style={{
                  minHeight: 46,
                  padding: "10px 18px",
                  borderRadius: 8,
                  border: `1px solid ${CIS.cardBorder}`,
                  background: "transparent",
                  color: CIS.textSub,
                  fontSize: 15,
                  cursor: "pointer",
                }}
              >
                取消
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              style={{
                minHeight: 46,
                padding: "10px 18px",
                borderRadius: 8,
                border: `1px solid ${CIS.cardBorder}`,
                background: "transparent",
                color: CIS.textMute,
                fontSize: 15,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon name="trash" size={15} />
              刪除文章
            </button>
          )
        ) : null}

        {error ? (
          <span role="status" style={{ color: "#fb7185", fontSize: 15, fontWeight: 700 }}>
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
