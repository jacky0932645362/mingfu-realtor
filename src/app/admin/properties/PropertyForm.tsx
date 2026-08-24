"use client";

/**
 * 物件新增／編輯表單。
 *
 * 跟其他後台表單最大的差別：這裡填的東西「客戶會直接看到」，所以照片與影片欄位
 * 一律做即時預覽 —— 貼網址版本最常見的失敗是「網址看起來很正常但瀏覽器載不出來」
 * （Google Drive 分享連結、需要登入的相簿、防盜連的圖床），
 * 那種錯誤如果等到上線才發現，客戶已經看到破圖了。這裡當場就讓它破給自己看。
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import {
  PROPERTY_STATUSES,
  PROPERTY_TYPES,
  DISTRICTS,
  type PropertyInput,
  type PropertyRow,
} from "@/lib/property";
import { directImageUrl, parseImageList, parseVideoList } from "@/lib/media-url";
import {
  createPropertyAction,
  updatePropertyAction,
  deletePropertyAction,
} from "@/lib/actions/property-actions";
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

/** 上傳鈕。實際的 <input type="file"> 藏在 label 裡（原生檔案輸入框長得很醜且無法統一樣式）。 */
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

export default function PropertyForm({
  property,
  siteUrl,
  uploadEnabled = false,
}: {
  property?: PropertyRow;
  siteUrl: string;
  /** 這台機器有沒有設定 Cloudinary。false 就完全不顯示上傳鈕，退回原本的貼網址流程。 */
  uploadEnabled?: boolean;
}) {
  const router = useRouter();
  const isEdit = Boolean(property);

  /* ── 照片上傳（Cloudinary signed upload）──
     檔案不經過我們的伺服器：跟後台換一張簽章，然後瀏覽器直接 POST 給 Cloudinary。
     成功後把回傳的 secure_url 填進對應欄位，剩下的流程跟手貼網址完全一樣，
     所以下面的預覽、驗證、存檔都不用改。 */
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  async function uploadFiles(files: FileList | null): Promise<string[]> {
    if (!files || files.length === 0) return [];
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

      const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, {
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

  /** 包一層共用的狀態處理，兩個上傳鈕都走這裡，錯誤一律顯示給使用者不要吞掉。 */
  async function handleUpload(files: FileList | null, onDone: (urls: string[]) => void) {
    setUploading(true);
    setUploadMsg("");
    try {
      const urls = await uploadFiles(files);
      if (urls.length > 0) {
        onDone(urls);
        setUploadMsg(`✅ 已上傳 ${urls.length} 張`);
      }
    } catch (err) {
      setUploadMsg(`❌ ${err instanceof Error ? err.message : "上傳失敗"}`);
    } finally {
      setUploading(false);
    }
  }

  const [title, setTitle] = useState(property?.title ?? "");
  const [headline, setHeadline] = useState(property?.headline ?? "");
  const [slug, setSlug] = useState(property?.slug ?? "");
  const [status, setStatus] = useState(property?.status ?? "draft");
  const [sortOrder, setSortOrder] = useState(property?.sort_order?.toString() ?? "0");

  const [price, setPrice] = useState(property?.price?.toString() ?? "");
  const [priceNote, setPriceNote] = useState(property?.price_note ?? "");

  const [propertyType, setPropertyType] = useState(property?.property_type ?? "");
  const [propertyTypeOther, setPropertyTypeOther] = useState(property?.property_type_other ?? "");
  const [layout, setLayout] = useState(property?.layout ?? "");
  const [sizePing, setSizePing] = useState(property?.size_ping?.toString() ?? "");
  const [mainBuildingPing, setMainBuildingPing] = useState(
    property?.main_building_ping?.toString() ?? "",
  );
  const [landPing, setLandPing] = useState(property?.land_ping?.toString() ?? "");
  const [floorInfo, setFloorInfo] = useState(property?.floor_info ?? "");
  const [ageYears, setAgeYears] = useState(property?.age_years?.toString() ?? "");
  const [parking, setParking] = useState(property?.parking ?? "");
  const [direction, setDirection] = useState(property?.direction ?? "");

  const [district, setDistrict] = useState(property?.district ?? "");
  const [address, setAddress] = useState(property?.address ?? "");
  const [addressPublic, setAddressPublic] = useState(property?.address_public ?? "");
  const [community, setCommunity] = useState(property?.community ?? "");
  const [builder, setBuilder] = useState(property?.builder ?? "");

  const [highlights, setHighlights] = useState(property?.highlights ?? "");
  const [description, setDescription] = useState(property?.description ?? "");
  const [suitableFor, setSuitableFor] = useState(property?.suitable_for ?? "");
  const [lifeInfo, setLifeInfo] = useState(property?.life_info ?? "");
  const [transportInfo, setTransportInfo] = useState(property?.transport_info ?? "");

  const [coverUrl, setCoverUrl] = useState(property?.cover_url ?? "");
  const [photoUrls, setPhotoUrls] = useState(property?.photo_urls ?? "");
  const [videoUrls, setVideoUrls] = useState(property?.video_urls ?? "");

  const [internalNote, setInternalNote] = useState(property?.internal_note ?? "");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 預覽：跟公開頁走同一組轉換函式，這裡看得到什麼，客戶就看得到什麼。
  const coverPreview = useMemo(() => directImageUrl(coverUrl), [coverUrl]);
  const photoPreviews = useMemo(() => parseImageList(photoUrls), [photoUrls]);
  const videoPreviews = useMemo(() => parseVideoList(videoUrls), [videoUrls]);
  const badVideoLines = useMemo(
    () =>
      videoUrls
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !parseVideoList(line).length),
    [videoUrls],
  );

  const publicUrl = `${siteUrl.replace(/\/$/, "")}/property/${slug || "（存檔後自動產生）"}`;

  const numOrNull = (value: string): number | null => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const buildInput = (): PropertyInput => ({
    slug: slug.trim(),
    title: title.trim(),
    headline: headline.trim() || null,
    status,
    price: numOrNull(price) == null ? null : Math.trunc(numOrNull(price) as number),
    priceNote: priceNote.trim() || null,
    propertyType: propertyType || null,
    propertyTypeOther: propertyTypeOther.trim() || null,
    layout: layout.trim() || null,
    sizePing: numOrNull(sizePing),
    mainBuildingPing: numOrNull(mainBuildingPing),
    landPing: numOrNull(landPing),
    floorInfo: floorInfo.trim() || null,
    ageYears: ageYears.trim() ? Math.trunc(numOrNull(ageYears) ?? 0) : null,
    parking: parking.trim() || null,
    direction: direction.trim() || null,
    district: district || null,
    address: address.trim() || null,
    addressPublic: addressPublic.trim() || null,
    community: community.trim() || null,
    builder: builder.trim() || null,
    highlights: highlights.trim() || null,
    description: description.trim() || null,
    suitableFor: suitableFor.trim() || null,
    lifeInfo: lifeInfo.trim() || null,
    transportInfo: transportInfo.trim() || null,
    coverUrl: coverUrl.trim() || null,
    photoUrls: photoUrls.trim() || null,
    videoUrls: videoUrls.trim() || null,
    sellerId: property?.seller_id ?? null,
    internalNote: internalNote.trim() || null,
    sortOrder: Math.trunc(numOrNull(sortOrder) ?? 0),
  });

  const submit = async () => {
    if (!title.trim()) {
      setError("物件標題必填");
      return;
    }
    setBusy(true);
    setError(null);

    const input = buildInput();
    const result = isEdit
      ? await updatePropertyAction(property!.id, input)
      : await createPropertyAction(input);

    setBusy(false);
    if (!result.ok) {
      setError(result.error || "儲存失敗，請再試一次");
      return;
    }
    router.push(`/admin/properties/${isEdit ? property!.id : result.id}`);
    router.refresh();
  };

  const remove = async () => {
    if (!property) return;
    setBusy(true);
    const result = await deletePropertyAction(property.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "刪除失敗");
      return;
    }
    router.push("/admin/properties");
    router.refresh();
  };

  return (
    <div>
      {/* ── 基本 ── */}
      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>基本</h2>
        <div className={styles.formGrid}>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            物件標題 *（後台辨識用，也會當網頁標題）
            <input
              style={inputStyle}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="梧棲 文化路 高樓海景2房平車"
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            鉤子標題（客戶第一眼看到的那句，只回答「為什麼不能滑走」）
            <input
              style={inputStyle}
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              maxLength={160}
              placeholder="698萬買得到高樓海景＋平面車位？"
            />
            <span style={hintStyle}>
              挑最強的一個鉤子當主軸就好，不要全塞：價格／稀有性／視野／平車／高樓／新屋／海景／邊間／低總價
            </span>
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            狀態
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
              {PROPERTY_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            <span style={hintStyle}>只有「上架中／已預訂」會出現在物件列表，草稿與下架客戶看不到</span>
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            排序（數字大的排前面）
            <input
              style={inputStyle}
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            自訂網址（留空自動給一組短碼）
            <input
              style={inputStyle}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              maxLength={60}
              placeholder="留空就好"
            />
            <span style={{ ...hintStyle, color: CIS.blueSoft, wordBreak: "break-all" }}>
              客戶收到的連結：{publicUrl}
            </span>
          </label>
        </div>
      </div>

      {/* ── 價格 ── */}
      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>價格</h2>
        <div className={styles.formGrid}>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            總價（萬）
            <input
              style={inputStyle}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="numeric"
              placeholder="698"
            />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            價格備註
            <input
              style={inputStyle}
              value={priceNote}
              onChange={(e) => setPriceNote(e.target.value)}
              maxLength={60}
              placeholder="含車位／可議／實登參考價"
            />
          </label>
        </div>
      </div>

      {/* ── 規格 ── */}
      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>物件規格</h2>
        <div className={styles.formGrid}>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            物件類型
            <select style={inputStyle} value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
              <option value="">未選擇</option>
              {PROPERTY_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            其他類型（不在選項內再填）
            <input
              style={inputStyle}
              value={propertyTypeOther}
              onChange={(e) => setPropertyTypeOther(e.target.value)}
              maxLength={80}
            />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            格局
            <input
              style={inputStyle}
              value={layout}
              onChange={(e) => setLayout(e.target.value)}
              maxLength={40}
              placeholder="2房2廳1衛"
            />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            建物登記坪數
            <input
              style={inputStyle}
              value={sizePing}
              onChange={(e) => setSizePing(e.target.value)}
              inputMode="decimal"
              placeholder="32.55"
            />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            主建物坪數
            <input
              style={inputStyle}
              value={mainBuildingPing}
              onChange={(e) => setMainBuildingPing(e.target.value)}
              inputMode="decimal"
              placeholder="22.10"
            />
            <span style={hintStyle}>有填的話公開頁會自動幫客戶換算「實際室內大約幾坪」</span>
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            土地坪數
            <input
              style={inputStyle}
              value={landPing}
              onChange={(e) => setLandPing(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            樓層
            <input
              style={inputStyle}
              value={floorInfo}
              onChange={(e) => setFloorInfo(e.target.value)}
              maxLength={40}
              placeholder="12F/15F"
            />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            屋齡（年）
            <input
              style={inputStyle}
              value={ageYears}
              onChange={(e) => setAgeYears(e.target.value)}
              inputMode="numeric"
              placeholder="8"
            />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            車位
            <input
              style={inputStyle}
              value={parking}
              onChange={(e) => setParking(e.target.value)}
              maxLength={40}
              placeholder="平面車位／機械／坡道平面／無"
            />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            朝向
            <input
              style={inputStyle}
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              maxLength={20}
              placeholder="坐北朝南"
            />
          </label>
        </div>
      </div>

      {/* ── 位置 ── */}
      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>位置</h2>
        <div className={styles.formGrid}>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            區域
            <select style={inputStyle} value={district} onChange={(e) => setDistrict(e.target.value)}>
              <option value="">未選擇</option>
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            社區名稱
            <input
              style={inputStyle}
              value={community}
              onChange={(e) => setCommunity(e.target.value)}
              maxLength={80}
            />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            建設公司
            <input
              style={inputStyle}
              value={builder}
              onChange={(e) => setBuilder(e.target.value)}
              maxLength={80}
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            完整地址（🔒 只有你看得到，不會出現在公開頁）
            <input
              style={inputStyle}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={240}
              placeholder="台中市梧棲區文化路一段123號12樓"
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            公開顯示位置（客戶看到的，建議只寫到路名）
            <input
              style={inputStyle}
              value={addressPublic}
              onChange={(e) => setAddressPublic(e.target.value)}
              maxLength={240}
              placeholder="梧棲區 文化路一段"
            />
            <span style={hintStyle}>留空的話公開頁只顯示區域，不會漏出門牌</span>
          </label>
        </div>
      </div>

      {/* ── 文案 ── */}
      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>文案</h2>
        <div className={styles.formGrid}>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            核心賣點（一行一個，公開頁會排成一顆一顆的標籤）
            <textarea
              style={textareaStyle}
              value={highlights}
              onChange={(e) => setHighlights(e.target.value)}
              maxLength={2000}
              placeholder={"高樓層無遮蔽海景\n平面車位一次到位\n屋齡8年電梯大樓\n低總價首購可入手"}
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            完整文案（空一行分段）
            <textarea
              style={{ ...textareaStyle, minHeight: 180 }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={8000}
              placeholder="不要只寫「主建物22坪、公設比33%」就結束，替客戶回答：室內夠不夠用？適合小家庭嗎？收納夠嗎？這個價格值得嗎？"
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            適合誰
            <input
              style={inputStyle}
              value={suitableFor}
              onChange={(e) => setSuitableFor(e.target.value)}
              maxLength={240}
              placeholder="首購小家庭、想換高樓層視野、預算 700 萬內要車位的買方"
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            生活機能
            <textarea
              style={textareaStyle}
              value={lifeInfo}
              onChange={(e) => setLifeInfo(e.target.value)}
              maxLength={2000}
              placeholder="步行 5 分鐘全聯、頂魚寮公園、梧棲國小學區…"
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            交通與重大建設
            <textarea
              style={textareaStyle}
              value={transportInfo}
              onChange={(e) => setTransportInfo(e.target.value)}
              maxLength={2000}
              placeholder="三井 Outlet 車程 5 分鐘、台61線快速道路、台中港新市鎮重劃區…"
            />
            <span style={hintStyle}>⚠️ 只寫確定的事實。沒定案的建設不要寫，講錯要負責。</span>
          </label>
        </div>
      </div>

      {/* ── 照片與影片 ── */}
      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>照片與影片</h2>

        <div
          style={{
            background: "rgba(90,145,225,0.10)",
            border: `1px solid ${CIS.cardBorder}`,
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 13,
            lineHeight: 1.7,
            color: CIS.textSub,
            marginBottom: 12,
          }}
        >
          照片跟影片都<strong>不存在這個網站</strong>，這裡只存網址。
          <br />
          📷 <strong>照片</strong>：
          {uploadEnabled ? (
            <>
              直接按下面的<strong>上傳</strong>選檔案，會自動傳好並把網址填進來（手機拍的也可以）。
              已經有網址的話照樣可以自己貼。
            </>
          ) : (
            <>
              貼圖片的直接網址（結尾通常是 .jpg／.png）。 Google Drive
              與 Dropbox 的分享連結會自動換成直連，但檔案必須設成「知道連結的人都可以檢視」。
            </>
          )}
          <br />
          🎬 <strong>影片</strong>：貼 YouTube 連結就好，Shorts 也可以。
          影片本身建議設成「<strong>不公開</strong>」——有連結的人看得到，但不會出現在你的頻道列表。
          <br />
          下面的預覽 = 客戶會看到的。<strong>預覽破圖就是客戶也會破圖</strong>，不要存檔。
        </div>

        <div className={styles.formGrid}>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            封面照片網址（列表跟分享預覽用這張）
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
          <div style={{ marginTop: 8 }}>
            <label style={{ ...uploadBtnStyle, opacity: uploading ? 0.55 : 1 }}>
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={uploading}
                onChange={(e) => {
                  const files = e.target.files;
                  // 先清空 value，否則選同一個檔案第二次不會觸發 onChange
                  e.target.value = "";
                  handleUpload(files, (urls) => setCoverUrl(urls[0]));
                }}
              />
              <Icon name="image" size={15} />
              {uploading ? "上傳中…" : "上傳封面照片"}
            </label>
          </div>
        ) : null}
        {coverPreview ? (
          <div style={{ marginTop: 10 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverPreview}
              alt="封面預覽"
              style={{
                width: 260,
                height: 176,
                objectFit: "cover",
                borderRadius: 10,
                border: `1px solid ${CIS.cardBorder}`,
                background: CIS.bgSoft,
              }}
            />
          </div>
        ) : null}

        <div className={styles.formGrid} style={{ marginTop: 14 }}>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            照片網址（一行一張，最多 40 張）
            <textarea
              style={{ ...textareaStyle, minHeight: 130, fontSize: 13 }}
              value={photoUrls}
              onChange={(e) => setPhotoUrls(e.target.value)}
              maxLength={20000}
              placeholder={"https://…/01.jpg\nhttps://…/02.jpg\nhttps://…/03.jpg"}
            />
          </label>
        </div>

        {uploadEnabled ? (
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label style={{ ...uploadBtnStyle, opacity: uploading ? 0.55 : 1 }}>
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                disabled={uploading}
                onChange={(e) => {
                  const files = e.target.files;
                  e.target.value = "";
                  // 接在既有清單後面，不要蓋掉已經填好的網址
                  handleUpload(files, (urls) =>
                    setPhotoUrls((prev) => [prev.trim(), ...urls].filter(Boolean).join("\n")),
                  );
                }}
              />
              <Icon name="image" size={15} />
              {uploading ? "上傳中…" : "上傳多張照片"}
            </label>
            {uploadMsg ? (
              <span style={{ fontSize: 13, color: CIS.textSub }}>{uploadMsg}</span>
            ) : (
              <span style={{ fontSize: 13, color: CIS.textMute }}>
                可一次選多張，上傳完會自動接在上面的清單後面
              </span>
            )}
          </div>
        ) : null}
        {photoPreviews.length > 0 ? (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 13, color: CIS.textMute, marginBottom: 6 }}>
              預覽 {photoPreviews.length} 張
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {photoPreviews.map((url, i) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={`${url}-${i}`}
                  src={url}
                  alt={`照片 ${i + 1}`}
                  style={{
                    width: 108,
                    height: 76,
                    objectFit: "cover",
                    borderRadius: 7,
                    border: `1px solid ${CIS.cardBorder}`,
                    background: CIS.bgSoft,
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div className={styles.formGrid} style={{ marginTop: 14 }}>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            影片網址（一行一支 YouTube 連結，最多 6 支）
            <textarea
              style={{ ...textareaStyle, minHeight: 90, fontSize: 13 }}
              value={videoUrls}
              onChange={(e) => setVideoUrls(e.target.value)}
              maxLength={3000}
              placeholder={"https://youtu.be/xxxxxxxxxxx\nhttps://www.youtube.com/shorts/xxxxxxxxxxx"}
            />
          </label>
        </div>
        {videoPreviews.length > 0 ? (
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {videoPreviews.map((v) => (
              <div key={v.src} style={{ position: "relative" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={v.thumbUrl}
                  alt="影片預覽"
                  style={{
                    width: 168,
                    height: 94,
                    objectFit: "cover",
                    borderRadius: 7,
                    border: `1px solid ${CIS.cardBorder}`,
                    background: CIS.bgSoft,
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    textShadow: "0 2px 8px rgba(0,0,0,0.6)",
                  }}
                >
                  <Icon name="play" size={30} />
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {badVideoLines.length > 0 ? (
          <div style={{ marginTop: 8, fontSize: 13, color: "#fb7185", fontWeight: 700 }}>
            ⚠ 這 {badVideoLines.length} 行看不出是 YouTube 連結，存了也不會顯示：
            {badVideoLines.slice(0, 3).map((line) => (
              <div key={line} style={{ fontWeight: 400, wordBreak: "break-all" }}>{line}</div>
            ))}
          </div>
        ) : null}
      </div>

      {/* ── 內部備註 ── */}
      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>內部備註</h2>
        <div className={styles.formGrid}>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            🔒 只有你看得到（屋主底價、鑰匙、議價空間都寫這裡，不會出現在公開頁）
            <textarea
              style={textareaStyle}
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
              maxLength={4000}
            />
          </label>
        </div>
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
          {busy ? "儲存中…" : isEdit ? "儲存變更" : "新增物件"}
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
              刪除物件
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
