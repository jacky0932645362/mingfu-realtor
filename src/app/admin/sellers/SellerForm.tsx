"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import {
  SELLER_STAGES,
  SELLER_PROPERTY_TYPES,
  SELLER_LISTING_TYPES,
  type SellerInput,
  type SellerRow,
} from "@/lib/seller";
import { createSellerAction, updateSellerAction } from "@/lib/actions/seller-actions";
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
  minHeight: 76,
  resize: "vertical",
};

function toLocalInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toDate(local: string): Date | null {
  if (!local) return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toDateOnly(local: string): Date | null {
  if (!local) return null;
  const date = new Date(`${local}T00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default function SellerForm({ seller }: { seller?: SellerRow }) {
  const router = useRouter();
  const isEdit = Boolean(seller);

  const [name, setName] = useState(seller?.name ?? "");
  const [phone, setPhone] = useState(seller?.phone ?? "");
  const [lineId, setLineId] = useState(seller?.line_id ?? "");
  const [birthday, setBirthday] = useState(toDateInput(seller?.birthday));
  const [residentialAddress, setResidentialAddress] = useState(seller?.residential_address ?? "");
  const [propertyAddress, setPropertyAddress] = useState(seller?.property_address ?? "");
  const [source, setSource] = useState(seller?.source ?? "");

  const [grade, setGrade] = useState(seller?.grade ?? "B");
  const [stage, setStage] = useState(seller?.stage ?? "pending");

  const [propertyType, setPropertyType] = useState(seller?.property_type ?? "");
  const [propertyTypeOther, setPropertyTypeOther] = useState(seller?.property_type_other ?? "");
  const [sizePing, setSizePing] = useState(seller?.size_ping?.toString() ?? "");
  const [floorInfo, setFloorInfo] = useState(seller?.floor_info ?? "");
  const [ageYears, setAgeYears] = useState(seller?.age_years?.toString() ?? "");
  const [layout, setLayout] = useState(seller?.layout ?? "");
  const [parking, setParking] = useState(seller?.parking ?? "");
  const [hasMortgage, setHasMortgage] = useState<string>(
    seller?.has_mortgage === 1 ? "yes" : seller?.has_mortgage === 0 ? "no" : "unknown",
  );
  const [mortgageNote, setMortgageNote] = useState(seller?.mortgage_note ?? "");

  const [listingPrice, setListingPrice] = useState(seller?.listing_price?.toString() ?? "");
  const [floorPrice, setFloorPrice] = useState(seller?.floor_price?.toString() ?? "");
  const [listingType, setListingType] = useState(seller?.listing_type ?? "");
  const [listingStartDate, setListingStartDate] = useState(toDateInput(seller?.listing_start_date));
  const [listingEndDate, setListingEndDate] = useState(toDateInput(seller?.listing_end_date));
  const [sellReason, setSellReason] = useState(seller?.sell_reason ?? "");
  const [keyAccess, setKeyAccess] = useState(seller?.key_access ?? "");

  const [note, setNote] = useState(seller?.note ?? "");
  const [nextStep, setNextStep] = useState(seller?.next_step ?? "");
  const [lastReportAt, setLastReportAt] = useState(toLocalInput(seller?.last_report_at));
  const [nextReportAt, setNextReportAt] = useState(toLocalInput(seller?.next_report_at));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numOrNull = (value: string): number | null => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const submit = async () => {
    if (!name.trim()) {
      setError("姓名必填");
      return;
    }
    setBusy(true);
    setError(null);

    const input: SellerInput = {
      name: name.trim(),
      phone: phone.trim(),
      lineId: lineId.trim() || null,
      birthday: toDateOnly(birthday),
      residentialAddress: residentialAddress.trim() || null,
      propertyAddress: propertyAddress.trim() || null,
      source: source.trim() || null,
      grade,
      stage,
      propertyType: propertyType || null,
      propertyTypeOther: propertyTypeOther.trim() || null,
      sizePing: numOrNull(sizePing),
      floorInfo: floorInfo.trim() || null,
      ageYears: ageYears.trim() ? Math.trunc(numOrNull(ageYears) ?? 0) : null,
      layout: layout.trim() || null,
      parking: parking.trim() || null,
      hasMortgage: hasMortgage === "unknown" ? null : hasMortgage === "yes",
      mortgageNote: mortgageNote.trim() || null,
      listingPrice: numOrNull(listingPrice),
      floorPrice: numOrNull(floorPrice),
      listingType: listingType || null,
      listingStartDate: toDateOnly(listingStartDate),
      listingEndDate: toDateOnly(listingEndDate),
      sellReason: sellReason.trim() || null,
      keyAccess: keyAccess.trim() || null,
      note: note.trim() || null,
      nextStep: nextStep.trim() || null,
      lastReportAt: toDate(lastReportAt),
      nextReportAt: toDate(nextReportAt),
    };

    const result = isEdit
      ? await updateSellerAction(seller!.id, input)
      : await createSellerAction(input);

    setBusy(false);
    if (!result.ok) {
      setError(result.error || "儲存失敗，請再試一次");
      return;
    }
    router.push(`/admin/sellers/${isEdit ? seller!.id : result.id}`);
    router.refresh();
  };

  return (
    <div>
      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>基本資料</h2>
        <div className={styles.formGrid}>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            姓名 *
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="陳先生" />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            電話
            <input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} inputMode="tel" placeholder="0912345678" />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            LINE
            <input style={inputStyle} value={lineId} onChange={(e) => setLineId(e.target.value)} maxLength={120} />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            生日
            <input style={inputStyle} type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            客戶來源
            <input style={inputStyle} value={source} onChange={(e) => setSource(e.target.value)} maxLength={40} placeholder="自售屋主主動找／委託轉介／陌生開發" />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            居住地址（屋主本人現在住哪）
            <input style={inputStyle} value={residentialAddress} onChange={(e) => setResidentialAddress(e.target.value)} maxLength={240} />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            售屋地址（要賣的物件）
            <input style={inputStyle} value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} maxLength={240} />
          </label>
        </div>
      </div>

      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>分級與階段</h2>
        <div className={styles.formGrid}>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            售屋急迫度
            <select style={inputStyle} value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="A">A｜急售</option>
              <option value="B">B｜一般</option>
              <option value="C">C｜不急賣</option>
            </select>
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            委託階段
            <select style={inputStyle} value={stage} onChange={(e) => setStage(e.target.value)}>
              {SELLER_STAGES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>物件資料</h2>
        <div className={styles.formGrid}>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            物件類型
            <select style={inputStyle} value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
              <option value="">未選擇</option>
              {SELLER_PROPERTY_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            其他物件類型（不在選項內再填）
            <input style={inputStyle} value={propertyTypeOther} onChange={(e) => setPropertyTypeOther(e.target.value)} maxLength={80} />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            坪數
            <input style={inputStyle} value={sizePing} onChange={(e) => setSizePing(e.target.value)} inputMode="decimal" placeholder="32.5" />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            樓層
            <input style={inputStyle} value={floorInfo} onChange={(e) => setFloorInfo(e.target.value)} maxLength={40} placeholder="5F/12F" />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            屋齡（年）
            <input style={inputStyle} value={ageYears} onChange={(e) => setAgeYears(e.target.value)} inputMode="numeric" placeholder="15" />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            格局
            <input style={inputStyle} value={layout} onChange={(e) => setLayout(e.target.value)} maxLength={40} placeholder="3房2廳2衛" />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            車位
            <input style={inputStyle} value={parking} onChange={(e) => setParking(e.target.value)} maxLength={20} placeholder="平面／機械／坡道／無" />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            貸款狀況
            <select style={inputStyle} value={hasMortgage} onChange={(e) => setHasMortgage(e.target.value)}>
              <option value="unknown">未填</option>
              <option value="yes">有貸款未清</option>
              <option value="no">無貸款</option>
            </select>
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            貸款備註（銀行／餘額）
            <input style={inputStyle} value={mortgageNote} onChange={(e) => setMortgageNote(e.target.value)} maxLength={200} />
          </label>
        </div>
      </div>

      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>委託管理</h2>
        <div className={styles.formGrid}>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            開價／委託價（萬）
            <input style={inputStyle} value={listingPrice} onChange={(e) => setListingPrice(e.target.value)} inputMode="numeric" placeholder="698" />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            屋主底價（萬，只有你看得到）
            <input style={inputStyle} value={floorPrice} onChange={(e) => setFloorPrice(e.target.value)} inputMode="numeric" placeholder="650" />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            委託類型
            <select style={inputStyle} value={listingType} onChange={(e) => setListingType(e.target.value)}>
              <option value="">未選擇</option>
              {SELLER_LISTING_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            鑰匙保管方式
            <input style={inputStyle} value={keyAccess} onChange={(e) => setKeyAccess(e.target.value)} maxLength={100} placeholder="自留／管理員／保全／需約屋主" />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            委託起日
            <input style={inputStyle} type="date" value={listingStartDate} onChange={(e) => setListingStartDate(e.target.value)} />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            委託迄日
            <input style={inputStyle} type="date" value={listingEndDate} onChange={(e) => setListingEndDate(e.target.value)} />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            售屋原因（換屋／繼承／資金週轉／搬遷／投資出場…）
            <input style={inputStyle} value={sellReason} onChange={(e) => setSellReason(e.target.value)} maxLength={100} />
          </label>
        </div>
      </div>

      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>追蹤</h2>
        <div className={styles.formGrid}>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            最後回報時間
            <input style={inputStyle} type="datetime-local" value={lastReportAt} onChange={(e) => setLastReportAt(e.target.value)} />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            下次回報時間
            <input style={inputStyle} type="datetime-local" value={nextReportAt} onChange={(e) => setNextReportAt(e.target.value)} />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            下一步
            <input style={inputStyle} value={nextStep} onChange={(e) => setNextStep(e.target.value)} maxLength={300} placeholder="8/20 回報這週帶看狀況" />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            備註
            <textarea style={textareaStyle} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} />
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
          {busy ? "儲存中…" : isEdit ? "儲存變更" : "新增屋主"}
        </button>
        {error ? (
          <span role="status" style={{ color: "#fb7185", fontSize: 15, fontWeight: 700 }}>
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
