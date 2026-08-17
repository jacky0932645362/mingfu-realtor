"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import { TENANT_STAGES, TENANT_PROPERTY_TYPES, type TenantInput, type TenantRow } from "@/lib/tenant";
import { createTenantAction, updateTenantAction } from "@/lib/actions/tenant-actions";
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

export default function TenantForm({ tenant }: { tenant?: TenantRow }) {
  const router = useRouter();
  const isEdit = Boolean(tenant);

  const [name, setName] = useState(tenant?.name ?? "");
  const [phone, setPhone] = useState(tenant?.phone ?? "");
  const [lineId, setLineId] = useState(tenant?.line_id ?? "");
  const [email, setEmail] = useState(tenant?.email ?? "");
  const [source, setSource] = useState(tenant?.source ?? "");
  const [grade, setGrade] = useState(tenant?.grade ?? "B");
  const [stage, setStage] = useState(tenant?.stage ?? "new");
  const [rentMin, setRentMin] = useState(tenant?.rent_min?.toString() ?? "");
  const [rentMax, setRentMax] = useState(tenant?.rent_max?.toString() ?? "");
  const [area, setArea] = useState(tenant?.area ?? "");
  const [propertyTypes, setPropertyTypes] = useState<string[]>(
    (tenant?.property_types || "").split(",").filter(Boolean),
  );
  const [propertyTypeOther, setPropertyTypeOther] = useState(tenant?.property_type_other ?? "");
  const [note, setNote] = useState(tenant?.note ?? "");
  const [nextStep, setNextStep] = useState(tenant?.next_step ?? "");
  const [lastContactAt, setLastContactAt] = useState(toLocalInput(tenant?.last_contact_at));
  const [nextFollowUpAt, setNextFollowUpAt] = useState(toLocalInput(tenant?.next_follow_up_at));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numOrNull = (value: string): number | null => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const togglePropertyType = (key: string) => {
    setPropertyTypes((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const submit = async () => {
    if (!name.trim()) {
      setError("姓名必填");
      return;
    }
    setBusy(true);
    setError(null);

    const input: TenantInput = {
      name: name.trim(),
      phone: phone.trim(),
      lineId: lineId.trim() || null,
      email: email.trim() || null,
      source: source.trim() || null,
      grade,
      stage,
      rentMin: numOrNull(rentMin),
      rentMax: numOrNull(rentMax),
      area: area.trim() || null,
      propertyTypes,
      propertyTypeOther: propertyTypeOther.trim() || null,
      note: note.trim() || null,
      nextStep: nextStep.trim() || null,
      lastContactAt: toDate(lastContactAt),
      nextFollowUpAt: toDate(nextFollowUpAt),
    };

    const result = isEdit
      ? await updateTenantAction(tenant!.id, input)
      : await createTenantAction(input);

    setBusy(false);
    if (!result.ok) {
      setError(result.error || "儲存失敗，請再試一次");
      return;
    }
    router.push(`/admin/tenants/${isEdit ? tenant!.id : result.id}`);
    router.refresh();
  };

  return (
    <div>
      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>基本資料</h2>
        <div className={styles.formGrid}>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            姓名 *
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="王先生" />
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
            Email
            <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} type="email" />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            客戶來源
            <input style={inputStyle} value={source} onChange={(e) => setSource(e.target.value)} maxLength={40} placeholder="591／官網／朋友介紹" />
          </label>
        </div>
      </div>

      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>分類與階段</h2>
        <div className={styles.formGrid}>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            客戶等級
            <select style={inputStyle} value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="A">A｜高意願</option>
              <option value="B">B｜比較中</option>
              <option value="C">C｜長期追蹤</option>
            </select>
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            租屋階段
            <select style={inputStyle} value={stage} onChange={(e) => setStage(e.target.value)}>
              {TENANT_STAGES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>租屋需求</h2>
        <div className={styles.formGrid}>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            租金下限（元/月）
            <input style={inputStyle} value={rentMin} onChange={(e) => setRentMin(e.target.value)} inputMode="numeric" placeholder="8000" />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            租金上限（元/月）
            <input style={inputStyle} value={rentMax} onChange={(e) => setRentMax(e.target.value)} inputMode="numeric" placeholder="15000" />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            要找的區域
            <input style={inputStyle} value={area} onChange={(e) => setArea(e.target.value)} maxLength={200} placeholder="梧棲、清水" />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            找的物件類型
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 18px", marginTop: 4 }}>
              {TENANT_PROPERTY_TYPES.map((t) => (
                <label key={t.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: CIS.text, fontSize: 15, fontWeight: 400 }}>
                  <input
                    type="checkbox"
                    checked={propertyTypes.includes(t.key)}
                    onChange={() => togglePropertyType(t.key)}
                    style={{ accentColor: CIS.blue }}
                  />
                  {t.label}
                </label>
              ))}
            </div>
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            其他物件類型（不在上面選項內再填）
            <input style={inputStyle} value={propertyTypeOther} onChange={(e) => setPropertyTypeOther(e.target.value)} maxLength={80} placeholder="工作室、辦公室…" />
          </label>
        </div>
      </div>

      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>追蹤</h2>
        <div className={styles.formGrid}>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            最後聯絡時間
            <input style={inputStyle} type="datetime-local" value={lastContactAt} onChange={(e) => setLastContactAt(e.target.value)} />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            下次追蹤時間
            <input style={inputStyle} type="datetime-local" value={nextFollowUpAt} onChange={(e) => setNextFollowUpAt(e.target.value)} />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            下一步
            <input style={inputStyle} value={nextStep} onChange={(e) => setNextStep(e.target.value)} maxLength={300} placeholder="8/18 電話追蹤確認意願" />
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
          {busy ? "儲存中…" : isEdit ? "儲存變更" : "新增租客"}
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
