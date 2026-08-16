"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import { CUSTOMER_STAGES, CUSTOMER_TYPES, type CustomerInput, type CustomerRow } from "@/lib/customer";
import { createCustomerAction, updateCustomerAction } from "@/lib/actions/customer-actions";
import styles from "./customers.module.css";

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

export default function CustomerForm({ customer }: { customer?: CustomerRow }) {
  const router = useRouter();
  const isEdit = Boolean(customer);

  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [lineId, setLineId] = useState(customer?.line_id ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [source, setSource] = useState(customer?.source ?? "");
  const [customerType, setCustomerType] = useState(customer?.customer_type ?? "");
  const [grade, setGrade] = useState(customer?.grade ?? "B");
  const [stage, setStage] = useState(customer?.stage ?? "new");
  const [budgetMin, setBudgetMin] = useState(customer?.budget_min?.toString() ?? "");
  const [budgetMax, setBudgetMax] = useState(customer?.budget_max?.toString() ?? "");
  const [area, setArea] = useState(customer?.area ?? "");
  const [houseType, setHouseType] = useState(customer?.house_type ?? "");
  const [minPing, setMinPing] = useState(customer?.min_ping?.toString() ?? "");
  const [parkingNeeded, setParkingNeeded] = useState(Boolean(customer?.parking_needed));
  const [mustHave, setMustHave] = useState(customer?.must_have ?? "");
  const [niceToHave, setNiceToHave] = useState(customer?.nice_to_have ?? "");
  const [purchaseTiming, setPurchaseTiming] = useState(customer?.purchase_timing ?? "");
  const [purchasePurpose, setPurchasePurpose] = useState(customer?.purchase_purpose ?? "");
  const [note, setNote] = useState(customer?.note ?? "");
  const [nextStep, setNextStep] = useState(customer?.next_step ?? "");
  const [lastContactAt, setLastContactAt] = useState(toLocalInput(customer?.last_contact_at));
  const [nextFollowUpAt, setNextFollowUpAt] = useState(toLocalInput(customer?.next_follow_up_at));

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

    const input: CustomerInput = {
      name: name.trim(),
      phone: phone.trim(),
      lineId: lineId.trim() || null,
      email: email.trim() || null,
      source: source.trim() || null,
      customerType: customerType || null,
      grade,
      stage,
      budgetMin: numOrNull(budgetMin),
      budgetMax: numOrNull(budgetMax),
      area: area.trim() || null,
      houseType: houseType.trim() || null,
      minPing: numOrNull(minPing),
      parkingNeeded,
      mustHave: mustHave.trim() || null,
      niceToHave: niceToHave.trim() || null,
      purchaseTiming: purchaseTiming.trim() || null,
      purchasePurpose: purchasePurpose.trim() || null,
      note: note.trim() || null,
      nextStep: nextStep.trim() || null,
      lastContactAt: toDate(lastContactAt),
      nextFollowUpAt: toDate(nextFollowUpAt),
    };

    const result = isEdit
      ? await updateCustomerAction(customer!.id, input)
      : await createCustomerAction(input);

    setBusy(false);
    if (!result.ok) {
      setError(result.error || "儲存失敗，請再試一次");
      return;
    }
    router.push(`/admin/customers/${isEdit ? customer!.id : result.id}`);
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
            購屋階段
            <select style={inputStyle} value={stage} onChange={(e) => setStage(e.target.value)}>
              {CUSTOMER_STAGES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            客戶類型
            <select style={inputStyle} value={customerType} onChange={(e) => setCustomerType(e.target.value)}>
              <option value="">未分類</option>
              {CUSTOMER_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>購屋需求</h2>
        <div className={styles.formGrid}>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            預算下限（萬）
            <input style={inputStyle} value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} inputMode="numeric" placeholder="600" />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            預算上限（萬）
            <input style={inputStyle} value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} inputMode="numeric" placeholder="800" />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            希望區域
            <input style={inputStyle} value={area} onChange={(e) => setArea(e.target.value)} maxLength={200} placeholder="梧棲、清水" />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            房型
            <input style={inputStyle} value={houseType} onChange={(e) => setHouseType(e.target.value)} maxLength={80} placeholder="2房2廳" />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            最低坪數
            <input style={inputStyle} value={minPing} onChange={(e) => setMinPing(e.target.value)} inputMode="decimal" placeholder="25" />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            購屋時程
            <input style={inputStyle} value={purchaseTiming} onChange={(e) => setPurchaseTiming(e.target.value)} maxLength={40} placeholder="1個月內／還在看" />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            購屋目的
            <input style={inputStyle} value={purchasePurpose} onChange={(e) => setPurchasePurpose(e.target.value)} maxLength={80} placeholder="自住／投資置產" />
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 7, color: CIS.textMute, fontSize: 14, marginTop: 6 }}>
            <input type="checkbox" checked={parkingNeeded} onChange={(e) => setParkingNeeded(e.target.checked)} style={{ accentColor: CIS.blue }} />
            需要車位
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            必要條件
            <textarea style={textareaStyle} value={mustHave} onChange={(e) => setMustHave(e.target.value)} maxLength={2000} placeholder="低樓層、近學區…" />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            可接受條件
            <textarea style={textareaStyle} value={niceToHave} onChange={(e) => setNiceToHave(e.target.value)} maxLength={2000} />
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
          {busy ? "儲存中…" : isEdit ? "儲存變更" : "新增客戶"}
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
