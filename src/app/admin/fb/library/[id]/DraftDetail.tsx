"use client";
/**
 * 一則文案的完整內容。
 * 一般貼文＝一大塊 post_text（可直接改）；Marketplace＝一格一格欄位（各自有複製鈕）。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  updateDraftTextAction,
  updateMarketplacePriceAction,
  updateMarketplaceConditionAction,
  updateMarketplaceTitleAction,
  updateMarketplaceLocationAction,
  updateMarketplaceGroupsAction,
  updateDraftPhotosAction,
  updateDraftVideoAction,
  resetDraftStatusAction,
  deleteDraftAction,
} from "@/lib/actions/fb-actions";
import type { DraftFacts } from "@/lib/fb-factory";
import { CIS, CHIP } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import { CopyButton } from "../../_ui/CopyButton";
import { PhotoPicker } from "@/app/admin/_ui/PhotoPicker";
import { VideoPicker } from "@/app/admin/_ui/VideoPicker";
import styles from "../../fb.module.css";

type Draft = {
  id: string;
  title: string;
  postText: string;
  postStatus: string;
  marketplaceStatus: string;
  mpTitle: string | null;
  mpPrice: number | null;
  mpDescription: string | null;
  mpLocation: string | null;
  mpCondition: string | null;
  mpGroupIds: string[];
  hasMarketplace: boolean;
};

type MpGroupOption = { id: string; name: string; note: string; isActive: boolean };

function money(n: number): string {
  return n.toLocaleString("en-US");
}

export function DraftDetail({
  draft,
  channel,
  photos,
  editablePhotos,
  photosText,
  videoText,
  uploadEnabled,
  warnings,
  facts,
  mpGroups,
  mpConditions,
}: {
  draft: Draft;
  channel: "post" | "marketplace";
  photos: string[];
  /** 手動填的文案：照片可以直接在這頁改（存進 facts_json.photos）。 */
  editablePhotos: boolean;
  photosText: string;
  /** 這篇要附的影片（存進 facts_json.video）。不像照片，不管是不是物件庫產的都能改。 */
  videoText: string;
  uploadEnabled: boolean;
  warnings: string[];
  facts: DraftFacts;
  mpGroups: MpGroupOption[];
  mpConditions: readonly string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const original = channel === "post" ? draft.postText : draft.mpDescription || "";
  const [body, setBody] = useState(original);
  const dirty = body !== original;

  // Marketplace 價格是獨立欄位，跟上面 post_text／mpDescription 的 dirty 狀態分開追蹤 ——
  // 改這裡存的時候不會連動送出說明欄，兩個「儲存」互不影響。
  const originalPriceWan = draft.mpPrice != null ? String(draft.mpPrice / 10_000) : "";
  const [priceWan, setPriceWan] = useState(originalPriceWan);
  const priceDirty = priceWan !== originalPriceWan;
  const priceWanNum = priceWan.trim() === "" ? null : Number(priceWan);
  const mpPriceTwdPreview =
    priceWanNum != null && Number.isFinite(priceWanNum) && priceWanNum > 0 ? Math.round(priceWanNum * 10_000) : null;

  const savePrice = () =>
    start(async () => {
      const res = await updateMarketplacePriceAction(draft.id, priceWanNum);
      setMsg(res.ok ? { tone: "ok", text: "已儲存" } : { tone: "bad", text: res.error || "儲存失敗" });
      if (res.ok) router.refresh();
    });

  // 「狀況」跟價格同一個道理：獨立欄位、獨立 dirty 狀態。2026-09-06 本人要求改成寫文案
  // 當下就要選好，不要留到桌機跑 post-marketplace.mjs 那一刻才用暫定值頂著。
  const originalCondition = draft.mpCondition || "";
  const [condition, setCondition] = useState(originalCondition);
  const conditionDirty = condition !== originalCondition;

  const saveCondition = () =>
    start(async () => {
      const res = await updateMarketplaceConditionAction(draft.id, condition);
      setMsg(res.ok ? { tone: "ok", text: "已儲存" } : { tone: "bad", text: res.error || "儲存失敗" });
      if (res.ok) router.refresh();
    });

  // 標題／地點跟價格、狀況同一套：各自獨立的欄位、各自的 dirty 狀態，互不牽動。
  // （2026-09-08 補 —— 在這之前這兩格只有唯讀顯示＋複製鈕，想改沒地方改。）
  const originalMpTitle = draft.mpTitle || "";
  const [mpTitle, setMpTitle] = useState(originalMpTitle);
  const mpTitleDirty = mpTitle !== originalMpTitle;
  const saveMpTitle = () =>
    start(async () => {
      const res = await updateMarketplaceTitleAction(draft.id, mpTitle);
      setMsg(res.ok ? { tone: "ok", text: "已儲存" } : { tone: "bad", text: res.error || "儲存失敗" });
      if (res.ok) router.refresh();
    });

  const originalMpLocation = draft.mpLocation || "";
  const [mpLocation, setMpLocation] = useState(originalMpLocation);
  const mpLocationDirty = mpLocation !== originalMpLocation;
  const saveMpLocation = () =>
    start(async () => {
      const res = await updateMarketplaceLocationAction(draft.id, mpLocation);
      setMsg(res.ok ? { tone: "ok", text: "已儲存" } : { tone: "bad", text: res.error || "儲存失敗" });
      if (res.ok) router.refresh();
    });

  // 手動填的文案：照片自己帶，這頁可以直接改（存進 facts_json.photos）。
  const [photosDraft, setPhotosDraft] = useState(photosText);
  const photosDirty = photosDraft.trim() !== photosText.trim();
  const savePhotos = () =>
    start(async () => {
      const res = await updateDraftPhotosAction(draft.id, photosDraft);
      setMsg(res.ok ? { tone: "ok", text: res.message || "已儲存" } : { tone: "bad", text: res.error || "儲存失敗" });
      if (res.ok) router.refresh();
    });

  // 這篇要附的影片。跟照片不同：不管是不是從物件庫產的文案都能改（存進 facts_json.video）。
  const [videoDraft, setVideoDraft] = useState(videoText);
  const videoDirty = videoDraft.trim() !== videoText.trim();
  const saveVideo = () =>
    start(async () => {
      const res = await updateDraftVideoAction(draft.id, videoDraft);
      setMsg(res.ok ? { tone: "ok", text: res.message || "已儲存" } : { tone: "bad", text: res.error || "儲存失敗" });
      if (res.ok) router.refresh();
    });

  // 發過的文案要再推一次：把狀態退回「還沒貼」，排程頁的下拉才選得到它。
  // 不加這個的話，每次想重推都得重產一則新草稿，貼文庫會越積越多重複的。
  const reopen = () => {
    const 通路名 = channel === "post" ? "一般貼文" : "Marketplace";
    if (!window.confirm(`把這則的「${通路名}」退回「還沒貼」？\n\n只改狀態，FB 上已經發出去的那篇不會動。\n退回後就能到排程頁再排一次。`)) return;
    start(async () => {
      const res = await resetDraftStatusAction(draft.id, channel);
      setMsg(res.ok ? { tone: "ok", text: res.message || "已退回" } : { tone: "bad", text: res.error || "重設失敗" });
      if (res.ok) router.refresh();
    });
  };

  // 打算上架去哪些社團的參考清單 —— 純粹記起來給本人對照，不會替他去 FB 按任何東西。
  // 這篇還沒特別存過清單的話（groupIds 空），預設帶「社團清單」裡標記常用（會發文）的那組，
  // 不用每篇都從 0 開始勾（2026-09-05 本人要求）；已經幫這篇存過清單的話就照存過的來，不覆蓋。
  const defaultGroupIds = mpGroups.filter((g) => g.isActive).map((g) => g.id);
  const initialGroupIds = draft.mpGroupIds.length > 0 ? draft.mpGroupIds : defaultGroupIds;
  const originalGroupIds = [...initialGroupIds].sort().join(",");
  const [pickedGroups, setPickedGroups] = useState<Set<string>>(() => new Set(initialGroupIds));
  const groupsDirty = [...pickedGroups].sort().join(",") !== originalGroupIds;
  const usingDefault = draft.mpGroupIds.length === 0 && defaultGroupIds.length > 0;

  const toggleGroup = (id: string) =>
    setPickedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 一鍵選取 —— 20 個社團一個一個點太慢（2026-09-11 本人要求）。
  // 「常用社團」＝「社團清單」裡標記「會發文」(is_active) 的那組，跟新文案預帶的是同一組。
  const favoriteIds = mpGroups.filter((g) => g.isActive).map((g) => g.id);
  const pickFavorites = () => setPickedGroups(new Set(favoriteIds));
  const pickAll = () => setPickedGroups(new Set(mpGroups.map((g) => g.id)));
  const pickNone = () => setPickedGroups(new Set());

  const saveGroups = () =>
    start(async () => {
      const res = await updateMarketplaceGroupsAction(draft.id, [...pickedGroups]);
      setMsg(res.ok ? { tone: "ok", text: "已儲存" } : { tone: "bad", text: res.error || "儲存失敗" });
      if (res.ok) router.refresh();
    });

  const status = channel === "post" ? draft.postStatus : draft.marketplaceStatus;
  const blockers = warnings.filter((w) => w.startsWith("🔴"));
  const notes = warnings.filter((w) => !w.startsWith("🔴"));

  const save = () =>
    start(async () => {
      const res = await updateDraftTextAction(draft.id, channel, body);
      setMsg(res.ok ? { tone: "ok", text: "已儲存" } : { tone: "bad", text: res.error || "儲存失敗" });
      if (res.ok) router.refresh();
    });

  const remove = () => {
    if (!window.confirm(`確定刪除「${draft.title}」？\n\n排程會一起刪掉。`)) return;
    start(async () => {
      const res = await deleteDraftAction(draft.id);
      if (res.ok) router.push("/admin/fb/library");
      else setMsg({ tone: "bad", text: res.error || "刪除失敗" });
    });
  };

  return (
    <>
      <div className={styles.tabs}>
        {[
          { key: "post", label: "一般貼文", available: true },
          { key: "marketplace", label: "Marketplace", available: draft.hasMarketplace },
          // IG／Threads 版本（2026-09-21）：每則文案都有（從一般貼文推導），點過去是另一個元件 SocialDetail
          { key: "ig", label: "Instagram", available: true },
          { key: "threads", label: "Threads", available: true },
        ].map((c) => {
          const active = c.key === channel;
          if (!c.available) {
            return (
              <span
                key={c.key}
                className={styles.tab}
                style={{ background: "transparent", color: CIS.textMute, border: `1px dashed ${CIS.cardBorder}`, cursor: "not-allowed" }}
              >
                {c.label}（沒有）
              </span>
            );
          }
          return (
            <Link
              key={c.key}
              href={`/admin/fb/library/${draft.id}?channel=${c.key}`}
              className={styles.tab}
              style={{
                background: active ? CIS.blue : "rgba(15,23,42,0.05)",
                color: active ? "#fff" : CIS.textSub,
                border: `1px solid ${active ? CIS.blue : CIS.cardBorder}`,
              }}
            >
              {c.label}
            </Link>
          );
        })}
        <span
          className={styles.chip}
          style={
            status === "posted"
              ? { background: CHIP.success.bg, color: CHIP.success.color, borderColor: CHIP.success.border }
              : status === "scheduled"
                ? { background: CHIP.info.bg, color: CHIP.info.color, borderColor: CHIP.info.border }
                : { background: CHIP.neutral.bg, color: CHIP.neutral.color, borderColor: CHIP.neutral.border }
          }
        >
          {status === "posted" ? "已發" : status === "scheduled" ? "排程中" : "還沒貼"}
        </span>
        {status !== "draft" ? (
          <button
            type="button"
            className={styles.btn}
            style={{
              background: "transparent",
              color: CIS.textSub,
              borderColor: CIS.cardBorder,
              padding: "4px 10px",
              fontSize: 12.5,
            }}
            disabled={pending}
            onClick={reopen}
            title="把狀態退回「還沒貼」，就能到排程頁再排一次。FB 上已發的那篇不受影響。"
          >
            <Icon name="refresh" size={13} />
            再發一次
          </button>
        ) : null}
      </div>

      {msg ? (
        <div
          className={styles.notice}
          style={
            msg.tone === "ok"
              ? { background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#16a34a" }
              : { background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.3)", color: "#e11d48" }
          }
        >
          <Icon name={msg.tone === "ok" ? "success" : "error"} size={16} className={styles.noticeIcon} />
          <div>{msg.text}</div>
        </div>
      ) : null}

      {blockers.length > 0 ? (
        <div
          className={styles.notice}
          style={{ background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.3)", color: CIS.textSub }}
        >
          <Icon name="warning" size={16} color="#e11d48" className={styles.noticeIcon} />
          <div>
            <strong style={{ color: "#e11d48" }}>發出去之前先處理這幾件：</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {blockers.map((w) => (
                <li key={w} style={{ marginBottom: 3 }}>
                  {w.replace(/^🔴\s*/, "")}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <div
          className={styles.notice}
          style={{ background: "rgba(245,158,11,0.09)", border: "1px solid rgba(245,158,11,0.26)", color: CIS.textSub }}
        >
          <Icon name="tip" size={16} color="#b45309" className={styles.noticeIcon} />
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {notes.map((w) => (
              <li key={w} style={{ marginBottom: 3 }}>
                {w}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {channel === "marketplace" ? (
        <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
          <h3 className={styles.cardTitle}>
            <Icon name="cart" size={16} color={CIS.blueSoft} />
            Marketplace 欄位（桌機 FB-Marketplace.bat 發文會用這些；要的話也能自己複製）
          </h3>
          <div className={styles.kv} style={{ borderBottom: `1px solid ${CIS.divider}` }}>
            <div style={{ color: CIS.textMute, fontSize: 13, fontWeight: 700 }}>價格</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <input
                  type="number"
                  className={styles.input}
                  style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text, width: 110 }}
                  value={priceWan}
                  onChange={(e) => setPriceWan(e.target.value)}
                  placeholder="萬"
                />
                <span style={{ color: CIS.textMute, fontSize: 13 }}>萬</span>
                {priceDirty ? (
                  <>
                    <button
                      type="button"
                      className={styles.btn}
                      style={{ background: CIS.blue, color: "#fff", padding: "5px 12px" }}
                      disabled={pending}
                      onClick={savePrice}
                    >
                      儲存
                    </button>
                    <button
                      type="button"
                      className={styles.btn}
                      style={{ background: "transparent", color: CIS.textMute, borderColor: CIS.cardBorder, padding: "5px 12px" }}
                      onClick={() => setPriceWan(originalPriceWan)}
                    >
                      取消
                    </button>
                  </>
                ) : null}
              </div>
              <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 4 }}>
                {mpPriceTwdPreview != null
                  ? `FB 價格欄直接填「${priceWan}」就好（海線 Marketplace 房地產都貼簡化數字，不是真的 ${money(mpPriceTwdPreview)} 元）—— 跟一般貼文的價格分開存，改這裡不會動到一般貼文`
                  : "沒有價格，Marketplace 價格欄必填，刊不出去"}
              </div>
            </div>
            <CopyButton text={mpPriceTwdPreview != null ? priceWan : ""} />
          </div>
          {/* 標題：可編輯（FB Marketplace 標題上限 60 字） */}
          <div className={styles.kv} style={{ borderBottom: `1px solid ${CIS.divider}` }}>
            <div style={{ color: CIS.textMute, fontSize: 13, fontWeight: 700 }}>標題</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <input
                  className={styles.input}
                  style={{
                    background: CIS.bgSoft,
                    border: `1px solid ${mpTitle.length > 60 ? "rgba(244,63,94,0.5)" : CIS.cardBorder}`,
                    color: CIS.text,
                    flex: 1,
                    minWidth: 240,
                  }}
                  value={mpTitle}
                  onChange={(e) => setMpTitle(e.target.value)}
                  placeholder="區域 社區 格局 坪數"
                />
                {mpTitleDirty ? (
                  <>
                    <button
                      type="button"
                      className={styles.btn}
                      style={{ background: CIS.blue, color: "#fff", padding: "5px 12px" }}
                      disabled={pending}
                      onClick={saveMpTitle}
                    >
                      儲存
                    </button>
                    <button
                      type="button"
                      className={styles.btn}
                      style={{ background: "transparent", color: CIS.textMute, borderColor: CIS.cardBorder, padding: "5px 12px" }}
                      onClick={() => setMpTitle(originalMpTitle)}
                    >
                      取消
                    </button>
                  </>
                ) : null}
              </div>
              <div style={{ fontSize: 12, color: mpTitle.length > 60 ? "#e11d48" : CIS.textMute, marginTop: 4 }}>
                {mpTitle.length} / 60 字
                {mpTitle.length > 60 ? "　超過 FB 上限，存不了" : "　跟一般貼文分開存，改這裡不會動到一般貼文"}
              </div>
            </div>
            <CopyButton text={mpTitle} />
          </div>

          {/* 地點：可編輯，但要講清楚桌機實際填進 FB 的是哪個值 */}
          <div className={styles.kv} style={{ borderBottom: `1px solid ${CIS.divider}` }}>
            <div style={{ color: CIS.textMute, fontSize: 13, fontWeight: 700 }}>地點</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <input
                  className={styles.input}
                  style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text, flex: 1, minWidth: 240 }}
                  value={mpLocation}
                  onChange={(e) => setMpLocation(e.target.value)}
                  placeholder="台中市梧棲區"
                />
                {mpLocationDirty ? (
                  <>
                    <button
                      type="button"
                      className={styles.btn}
                      style={{ background: CIS.blue, color: "#fff", padding: "5px 12px" }}
                      disabled={pending}
                      onClick={saveMpLocation}
                    >
                      儲存
                    </button>
                    <button
                      type="button"
                      className={styles.btn}
                      style={{ background: "transparent", color: CIS.textMute, borderColor: CIS.cardBorder, padding: "5px 12px" }}
                      onClick={() => setMpLocation(originalMpLocation)}
                    >
                      取消
                    </button>
                  </>
                ) : null}
              </div>
              <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 4 }}>
                ⚠️ 桌機發文時實際打進 FB 地點欄的是物件的<strong>縣市＋區</strong>
                {facts.city || facts.district ? `（${facts.city ?? ""}${facts.district ?? ""}）` : ""}
                —— FB 那欄是地區級自動完成，填到路名會被判定無效。這格主要是給你自己看／複製用。
              </div>
            </div>
            <CopyButton text={mpLocation} />
          </div>

          {/* 類別：2026-08-25 拍板固定，不給改 */}
          <div className={styles.kv} style={{ borderBottom: `1px solid ${CIS.divider}` }}>
            <div style={{ color: CIS.textMute, fontSize: 13, fontWeight: 700 }}>類別</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ wordBreak: "break-word" }}>其他商品</div>
              <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 2 }}>
                台灣 Marketplace 沒有房地產類別，2026-08-25 拍板固定選這個，跟現有刊登一致
              </div>
            </div>
            <CopyButton text="其他商品" />
          </div>
          <div className={styles.kv}>
            <div style={{ color: CIS.textMute, fontSize: 13, fontWeight: 700 }}>狀況</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <select
                  className={styles.select}
                  style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text, width: 160 }}
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                >
                  <option value="">— 還沒選 —</option>
                  {mpConditions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {conditionDirty ? (
                  <>
                    <button
                      type="button"
                      className={styles.btn}
                      style={{ background: CIS.blue, color: "#fff", padding: "5px 12px" }}
                      disabled={pending}
                      onClick={saveCondition}
                    >
                      儲存
                    </button>
                    <button
                      type="button"
                      className={styles.btn}
                      style={{ background: "transparent", color: CIS.textMute, borderColor: CIS.cardBorder, padding: "5px 12px" }}
                      onClick={() => setCondition(originalCondition)}
                    >
                      取消
                    </button>
                  </>
                ) : null}
              </div>
              <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 4 }}>
                {condition
                  ? "跑 post-marketplace.mjs 時會直接選這個，不用再靠暫定值"
                  : "沒選的話，桌機腳本跑的時候會擋下來、不會自己亂猜——房子沒有一個選項是真正對的，要你自己判斷"}
              </div>
            </div>
            <CopyButton text={condition} />
          </div>
        </section>
      ) : null}

      {channel === "marketplace" ? (
        <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
          <h3 className={styles.cardTitle}>
            <Icon name="users" size={16} color={CIS.blueSoft} />
            打算上架去哪些社團（{pickedGroups.size} 個）
          </h3>
          <div style={{ fontSize: 12.5, color: CIS.textMute, marginBottom: 12, lineHeight: 1.7 }}>
            這份清單是桌機 <code>post-marketplace.mjs --publish --crosspost</code> 真的會去 FB
            勾選的依據（2026-09-06 起）。<strong style={{ color: CIS.textSub }}>這個網頁本身不會自動幫你勾</strong>
            ——要去桌機手動跑那支工具，這裡先勾好清單、存起來讓工具讀。
            {usingDefault ? (
              <>
                <br />
                目前預設帶的是「社團清單」裡你標記<strong style={{ color: CIS.textSub }}>會發文</strong>的那組。
                想固定改用另一組常用組合，去「社團清單」調整勾選，之後每篇新文案都會照那組預帶；
                這篇單獨調整不會影響其他篇。
              </>
            ) : null}
          </div>

          {mpGroups.length === 0 ? (
            <div style={{ fontSize: 13, color: CIS.textMute }}>
              還沒有能上架 Marketplace 的社團。去「社團清單」確認有沒有標記「能上架 Marketplace」的。
            </div>
          ) : (
            <>
              {/* 一鍵選取 —— 不用一個一個點（2026-09-11 本人要求） */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginBottom: 12,
                  paddingBottom: 12,
                  borderBottom: `1px solid ${CIS.divider}`,
                }}
              >
                <button
                  type="button"
                  className={styles.btn}
                  style={{
                    background: "rgba(90,145,225,0.14)",
                    color: CIS.blueSoft,
                    borderColor: "rgba(90,145,225,0.4)",
                    padding: "5px 12px",
                  }}
                  disabled={pending || favoriteIds.length === 0}
                  onClick={pickFavorites}
                  title="＝「社團清單」裡你標記「會發文」的那組"
                >
                  <Icon name="star" size={14} />
                  常用社團（{favoriteIds.length}）
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  style={{ background: "transparent", color: CIS.textSub, borderColor: CIS.cardBorder, padding: "5px 12px" }}
                  disabled={pending}
                  onClick={pickAll}
                >
                  全選（{mpGroups.length}）
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  style={{ background: "transparent", color: CIS.textMute, borderColor: CIS.cardBorder, padding: "5px 12px" }}
                  disabled={pending || pickedGroups.size === 0}
                  onClick={pickNone}
                >
                  全部清除
                </button>
                <span style={{ fontSize: 12, color: CIS.textMute, marginLeft: "auto" }}>
                  已選 {pickedGroups.size} / {mpGroups.length}
                </span>
              </div>
            <div className={styles.checkGrid}>
              {mpGroups.map((g) => {
                const on = pickedGroups.has(g.id);
                return (
                  <label
                    key={g.id}
                    className={styles.checkBox}
                    style={{
                      background: CIS.bgSoft,
                      border: `1px solid ${on ? "rgba(90,145,225,0.4)" : CIS.cardBorder}`,
                    }}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggleGroup(g.id)} />
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ color: CIS.text }}>{g.name}</strong>
                      {g.note ? <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 2 }}>{g.note}</div> : null}
                    </span>
                  </label>
                );
              })}
            </div>
            </>
          )}

          {groupsDirty ? (
            <div className={styles.btnRow} style={{ marginTop: 14 }}>
              <button
                type="button"
                className={styles.btn}
                style={{ background: CIS.blue, color: "#fff" }}
                disabled={pending}
                onClick={saveGroups}
              >
                <Icon name={pending ? "loading" : "save"} size={15} />
                儲存清單
              </button>
              <button
                type="button"
                className={styles.btn}
                style={{ background: "transparent", color: CIS.textMute, borderColor: CIS.cardBorder }}
                onClick={() => setPickedGroups(new Set(initialGroupIds))}
              >
                取消
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <h3 className={styles.cardTitle} style={{ margin: 0 }}>
            <Icon name="file" size={16} color={CIS.textMute} />
            {channel === "post" ? "貼文內文" : "商品說明"}
          </h3>
          <span style={{ fontSize: 12, color: CIS.textMute }}>{body.length} 字</span>
          <div style={{ marginLeft: "auto" }}>
            <CopyButton text={body} label="複製整篇" primary />
          </div>
        </div>

        <textarea
          className={styles.textarea}
          style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text, minHeight: 300 }}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />

        <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 8, lineHeight: 1.7 }}>
          折疊前看得到的是這一段（FB 會在這裡收成「查看更多」）：
          <div
            style={{
              marginTop: 5,
              padding: "8px 11px",
              borderRadius: 7,
              background: CIS.bgSoft,
              border: `1px dashed ${CIS.cardBorder}`,
              color: CIS.textSub,
              whiteSpace: "pre-wrap",
            }}
          >
            {body.slice(0, 120)}
            {body.length > 120 ? "…" : ""}
          </div>
        </div>

        {dirty ? (
          <div className={styles.btnRow} style={{ marginTop: 14 }}>
            <button
              type="button"
              className={styles.btn}
              style={{ background: CIS.blue, color: "#fff" }}
              disabled={pending}
              onClick={save}
            >
              <Icon name={pending ? "loading" : "save"} size={15} />
              儲存修改
            </button>
            <button
              type="button"
              className={styles.btn}
              style={{ background: "transparent", color: CIS.textMute, borderColor: CIS.cardBorder }}
              onClick={() => setBody(original)}
            >
              取消
            </button>
          </div>
        ) : null}
      </section>

      {editablePhotos ? (
        <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
          <h3 className={styles.cardTitle}>
            <Icon name="camera" size={16} color={CIS.textMute} />
            照片（{photos.length} 筆來源，第一行是封面 —— 資料夾會展開成多張）
          </h3>
          <PhotoPicker
            value={photosDraft}
            onChange={setPhotosDraft}
            uploadEnabled={uploadEnabled}
            max={10}
            allowLocalPaths
          />
          {photosDirty ? (
            <div className={styles.btnRow} style={{ marginTop: 12 }}>
              <button
                type="button"
                className={styles.btn}
                style={{ background: CIS.blue, color: "#fff" }}
                disabled={pending}
                onClick={savePhotos}
              >
                <Icon name={pending ? "loading" : "save"} size={15} />
                儲存照片
              </button>
              <button
                type="button"
                className={styles.btn}
                style={{ background: "transparent", color: CIS.textMute, borderColor: CIS.cardBorder }}
                onClick={() => setPhotosDraft(photosText)}
              >
                取消
              </button>
            </div>
          ) : null}
          <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 9 }}>
            桌機發文前會自己把這些抓成暫存檔再上傳。破圖的話 FB 那邊也會傳失敗。
          </div>
        </section>
      ) : photos.length > 0 ? (
        <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
          <h3 className={styles.cardTitle}>
            <Icon name="camera" size={16} color={CIS.textMute} />
            照片（{photos.length} 張，來自物件庫，第一張是封面）
          </h3>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            {photos.map((url, i) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={url}
                src={url}
                alt={`第 ${i + 1} 張`}
                style={{
                  width: 104,
                  height: 78,
                  objectFit: "cover",
                  borderRadius: 7,
                  border: `1px solid ${i === 0 ? CIS.blue : CIS.cardBorder}`,
                  background: CIS.bgSoft,
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 9 }}>
            破圖的話 FB 那邊也會傳失敗 —— 回物件庫換掉網址。桌機發文前會自己把這些抓成暫存檔再上傳。
          </div>
        </section>
      ) : (
        <div
          className={styles.notice}
          style={{ background: "rgba(245,158,11,0.09)", border: "1px solid rgba(245,158,11,0.26)", color: CIS.textSub }}
        >
          <Icon name="camera" size={16} color="#b45309" className={styles.noticeIcon} />
          <div>這筆物件在物件庫裡沒有照片。FB 純文字貼文觸及遠低於有圖的，先回物件庫補照片。</div>
        </div>
      )}

      <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
        <h3 className={styles.cardTitle}>
          <Icon name="video" size={16} color={CIS.textMute} />
          影片（選填，一支就好）
        </h3>
        <VideoPicker value={videoDraft} onChange={setVideoDraft} uploadEnabled={uploadEnabled} />
        {videoDirty ? (
          <div className={styles.btnRow} style={{ marginTop: 12 }}>
            <button
              type="button"
              className={styles.btn}
              style={{ background: CIS.blue, color: "#fff" }}
              disabled={pending}
              onClick={saveVideo}
            >
              <Icon name={pending ? "loading" : "save"} size={15} />
              儲存影片
            </button>
            <button
              type="button"
              className={styles.btn}
              style={{ background: "transparent", color: CIS.textMute, borderColor: CIS.cardBorder }}
              onClick={() => setVideoDraft(videoText)}
            >
              取消
            </button>
          </div>
        ) : null}
        <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 9 }}>
          跟照片同一顆上傳欄位一起附上去，只用在「一般貼文」——桌機 Marketplace 上架流程不會用到這裡的影片。
        </div>
      </section>

      <div className={styles.btnRow} style={{ marginTop: 20 }}>
        <Link
          href={`/admin/fb/schedule?draft=${draft.id}&channel=${channel}`}
          className={styles.btn}
          style={{ background: CIS.blue, color: "#fff" }}
        >
          <Icon name="calendar" size={15} />
          排程發文
        </Link>
        <button
          type="button"
          className={styles.btn}
          style={{ background: "transparent", color: "#e11d48", borderColor: "rgba(244,63,94,0.35)", marginLeft: "auto" }}
          disabled={pending}
          onClick={remove}
        >
          <Icon name="trash" size={15} />
          刪除
        </button>
      </div>
    </>
  );
}
