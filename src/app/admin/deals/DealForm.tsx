"use client";
/**
 * 成交記帳 — 新增／編輯共用表單。
 *
 * 金額輸入的單位刻意分兩種，貼合房仲直覺：
 *   - 成交價、服務費、其他收入、已收金額 → 用「萬」輸入（可帶小數，如 75.2）
 *   - 成本明細、拆帳固定金額 → 用「元」輸入（如 8000）
 * 送出前一律換算成「元」的整數，資料庫只認元。
 *
 * 「我實拿」在畫面上即時算給你看，用的是跟後端 deal.ts 同一套公式。
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import {
  DEAL_SIDES,
  DEAL_PAYMENT_STATUSES,
  DEAL_EXPENSE_CATEGORIES,
  DEAL_SPLIT_KINDS,
  splitAmountFromRate,
  type DealDetail,
  type DealInput,
} from "@/lib/deal-shared";
import { createDealAction, updateDealAction, deleteDealAction } from "@/lib/actions/deal-actions";
import styles from "./deals.module.css";

const rid = () => Math.random().toString(36).slice(2);

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 「萬」字串 → 元整數 */
function wanToYuan(s: string): number {
  const n = Number(String(s).trim());
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000);
}

/** 元整數 → 「萬」字串（給表單欄位回填，去掉多餘小數） */
function yuanToWanInput(n: number | null | undefined): string {
  if (n == null || n === 0) return "";
  return String(n / 10000);
}

/** 元 → 「XXX 萬」顯示字串 */
function fmtWan(yuan: number): string {
  const wan = yuan / 10000;
  const rounded = Math.round(wan * 10) / 10;
  return `${rounded.toLocaleString("zh-TW")} 萬`;
}

function intOrZero(s: string): number {
  const n = Number(String(s).trim());
  return Number.isFinite(n) ? Math.round(n) : 0;
}

type ExpenseFormRow = { _key: string; spentOn: string; category: string; amountYuan: string; memo: string };
type SplitFormRow = { _key: string; party: string; kind: string; rate: string; amountYuan: string; memo: string };

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

const textareaStyle: React.CSSProperties = { ...inputStyle, minHeight: 70, resize: "vertical" };
const detailInputStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 42,
  fontSize: 14,
  padding: "8px 10px",
};

export default function DealForm({ detail }: { detail?: DealDetail }) {
  const router = useRouter();
  const isEdit = Boolean(detail);
  const d = detail?.deal;

  const [title, setTitle] = useState(d?.title ?? "");
  const [dealDate, setDealDate] = useState(d?.deal_date ?? todayStr());
  const [district, setDistrict] = useState(d?.district ?? "");
  const [side, setSide] = useState(d?.side ?? "seller");
  const [totalPriceWan, setTotalPriceWan] = useState(yuanToWanInput(d?.total_price));
  const [feeSellerWan, setFeeSellerWan] = useState(yuanToWanInput(d?.fee_seller));
  const [feeBuyerWan, setFeeBuyerWan] = useState(yuanToWanInput(d?.fee_buyer));
  const [incomeOtherWan, setIncomeOtherWan] = useState(yuanToWanInput(d?.income_other));
  const [paymentStatus, setPaymentStatus] = useState(d?.payment_status ?? "unpaid");
  const [receivedWan, setReceivedWan] = useState(yuanToWanInput(d?.received_amount));
  const [note, setNote] = useState(d?.note ?? "");

  const [expenses, setExpenses] = useState<ExpenseFormRow[]>(
    (detail?.expenses ?? []).map((e) => ({
      _key: rid(),
      spentOn: e.spent_on ?? "",
      category: e.category,
      amountYuan: e.amount ? String(e.amount) : "",
      memo: e.memo ?? "",
    })),
  );
  const [splits, setSplits] = useState<SplitFormRow[]>(
    (detail?.splits ?? []).map((s) => ({
      _key: rid(),
      party: s.party,
      kind: s.kind,
      rate: s.rate == null ? "" : String(s.rate),
      amountYuan: s.amount ? String(s.amount) : "",
      memo: s.memo ?? "",
    })),
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- 即時結算 ----
  const totals = useMemo(() => {
    const feeSeller = wanToYuan(feeSellerWan);
    const feeBuyer = wanToYuan(feeBuyerWan);
    const incomeOther = wanToYuan(incomeOtherWan);
    const incomeTotal = feeSeller + feeBuyer + incomeOther;
    const expenseTotal = expenses.reduce((sum, e) => sum + intOrZero(e.amountYuan), 0);
    const splitAmts = splits.map((s) =>
      s.kind === "percent" ? splitAmountFromRate(incomeTotal, Number(s.rate) || 0) : intOrZero(s.amountYuan),
    );
    const splitTotal = splitAmts.reduce((a, b) => a + b, 0);
    return {
      feeSeller,
      feeBuyer,
      incomeOther,
      incomeTotal,
      expenseTotal,
      splitTotal,
      splitAmts,
      takeHome: incomeTotal - expenseTotal - splitTotal,
    };
  }, [feeSellerWan, feeBuyerWan, incomeOtherWan, expenses, splits]);

  const addExpense = () =>
    setExpenses((prev) => [...prev, { _key: rid(), spentOn: dealDate, category: "ad", amountYuan: "", memo: "" }]);
  const addSplit = () =>
    setSplits((prev) => [...prev, { _key: rid(), party: "", kind: "percent", rate: "", amountYuan: "", memo: "" }]);

  const patchExpense = (key: string, patch: Partial<ExpenseFormRow>) =>
    setExpenses((prev) => prev.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  const patchSplit = (key: string, patch: Partial<SplitFormRow>) =>
    setSplits((prev) => prev.map((r) => (r._key === key ? { ...r, ...patch } : r)));

  const submit = async () => {
    if (!title.trim()) {
      setError("案名必填");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dealDate)) {
      setError("請選成交日");
      return;
    }
    setBusy(true);
    setError(null);

    const input: DealInput = {
      title: title.trim(),
      dealDate,
      district: district.trim() || null,
      side,
      totalPrice: totalPriceWan.trim() ? wanToYuan(totalPriceWan) : null,
      feeSeller: totals.feeSeller,
      feeBuyer: totals.feeBuyer,
      incomeOther: totals.incomeOther,
      paymentStatus,
      receivedAmount: wanToYuan(receivedWan),
      note: note.trim() || null,
      expenses: expenses
        .filter((e) => intOrZero(e.amountYuan) > 0 || e.memo.trim())
        .map((e) => ({
          spentOn: e.spentOn || null,
          category: e.category,
          amount: intOrZero(e.amountYuan),
          memo: e.memo.trim() || null,
        })),
      splits: splits
        .filter((s) => s.party.trim())
        .map((s, i) => ({
          party: s.party.trim(),
          kind: s.kind,
          rate: s.kind === "percent" ? Number(s.rate) || 0 : null,
          amount: totals.splitAmts[splits.indexOf(s)] ?? (s.kind === "fixed" ? intOrZero(s.amountYuan) : 0),
          memo: s.memo.trim() || null,
        })),
    };

    const result = isEdit ? await updateDealAction(detail!.deal.id, input) : await createDealAction(input);
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "儲存失敗，請再試一次");
      return;
    }
    router.push(`/admin/deals/${isEdit ? detail!.deal.id : result.id}`);
    router.refresh();
  };

  const del = async () => {
    if (!detail) return;
    if (!window.confirm(`確定刪除「${detail.deal.title}」這筆成交記帳？此動作無法復原。`)) return;
    setBusy(true);
    const result = await deleteDealAction(detail.deal.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "刪除失敗");
      return;
    }
    router.push("/admin/deals");
    router.refresh();
  };

  return (
    <div>
      {/* 基本資料 */}
      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>基本資料</h2>
        <p className={styles.sectionHint} style={{ color: CIS.textMute }}>
          哪個案子、哪天成交、你代表哪一方。
        </p>
        <div className={styles.formGrid}>
          <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
            案名 *
            <input
              style={inputStyle}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              placeholder="文心路二段 OO 大樓 12F"
            />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            成交日 *
            <input style={inputStyle} type="date" value={dealDate} onChange={(e) => setDealDate(e.target.value)} />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            區域
            <input
              style={inputStyle}
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              maxLength={20}
              placeholder="梧棲區"
            />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            我代表哪一方
            <select style={inputStyle} value={side} onChange={(e) => setSide(e.target.value)}>
              {DEAL_SIDES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            成交總價（萬）
            <input
              style={inputStyle}
              value={totalPriceWan}
              onChange={(e) => setTotalPriceWan(e.target.value)}
              inputMode="decimal"
              placeholder="1880"
            />
          </label>
        </div>
      </div>

      {/* 收入 */}
      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>收入</h2>
        <p className={styles.sectionHint} style={{ color: CIS.textMute }}>
          這筆成交你收到的服務費。單位是「萬」，可以有小數（例：75.2）。
        </p>
        <div className={styles.formGrid}>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            賣方服務費（萬）
            <input
              style={inputStyle}
              value={feeSellerWan}
              onChange={(e) => setFeeSellerWan(e.target.value)}
              inputMode="decimal"
              placeholder="75.2"
            />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            買方服務費（萬）
            <input
              style={inputStyle}
              value={feeBuyerWan}
              onChange={(e) => setFeeBuyerWan(e.target.value)}
              inputMode="decimal"
              placeholder="37.6"
            />
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            其他收入（萬）
            <input
              style={inputStyle}
              value={incomeOtherWan}
              onChange={(e) => setIncomeOtherWan(e.target.value)}
              inputMode="decimal"
              placeholder="履保回饋…"
            />
          </label>
        </div>
        <div style={{ marginTop: 10, fontSize: 15, color: CIS.textSub }}>
          收入合計：<strong style={{ color: CIS.text }}>{fmtWan(totals.incomeTotal)}</strong>
        </div>
      </div>

      {/* 成本 */}
      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>成本（這個案子花掉的錢）</h2>
        <p className={styles.sectionHint} style={{ color: CIS.textMute }}>
          一筆一筆記，單位是「元」。之後月報表會幫你把「廣告費」「帶看」分開加總。
        </p>
        <div className={styles.detailList}>
          {expenses.length === 0 ? (
            <div className={styles.empty} style={{ borderColor: CIS.cardBorder, color: CIS.textMute }}>
              還沒有成本紀錄。
            </div>
          ) : (
            expenses.map((e) => (
              <div
                key={e._key}
                className={`${styles.detailRow} ${styles.detailRowExpense}`}
                style={{ borderColor: CIS.cardBorder, background: CIS.bgSoft }}
              >
                <label className={styles.field} style={{ color: CIS.textMute }}>
                  日期
                  <input
                    style={detailInputStyle}
                    type="date"
                    value={e.spentOn}
                    onChange={(ev) => patchExpense(e._key, { spentOn: ev.target.value })}
                  />
                </label>
                <label className={styles.field} style={{ color: CIS.textMute }}>
                  分類
                  <select
                    style={detailInputStyle}
                    value={e.category}
                    onChange={(ev) => patchExpense(e._key, { category: ev.target.value })}
                  >
                    {DEAL_EXPENSE_CATEGORIES.map((c) => (
                      <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.field} style={{ color: CIS.textMute }}>
                  金額（元）
                  <input
                    style={detailInputStyle}
                    value={e.amountYuan}
                    onChange={(ev) => patchExpense(e._key, { amountYuan: ev.target.value })}
                    inputMode="numeric"
                    placeholder="8000"
                  />
                </label>
                <label className={styles.field} style={{ color: CIS.textMute }}>
                  說明
                  <input
                    style={detailInputStyle}
                    value={e.memo}
                    onChange={(ev) => patchExpense(e._key, { memo: ev.target.value })}
                    maxLength={200}
                    placeholder="591 精選 30 天"
                  />
                </label>
                <button
                  type="button"
                  className={styles.rowDeleteBtn}
                  style={{ borderColor: CIS.cardBorder, color: "#fb7185" }}
                  onClick={() => setExpenses((prev) => prev.filter((r) => r._key !== e._key))}
                >
                  刪除
                </button>
              </div>
            ))
          )}
        </div>
        <button
          type="button"
          className={styles.addRowBtn}
          style={{ borderColor: CIS.cardBorder, color: CIS.blueSoft }}
          onClick={addExpense}
        >
          <Icon name="add" size={14} /> 加一筆成本
        </button>
        <div style={{ marginTop: 10, fontSize: 15, color: CIS.textSub }}>
          成本合計：<strong style={{ color: CIS.text }}>{fmtWan(totals.expenseTotal)}</strong>
        </div>
      </div>

      {/* 拆帳 */}
      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>拆帳（要分給誰）</h2>
        <p className={styles.sectionHint} style={{ color: CIS.textMute }}>
          合作夥伴、店頭 / 加盟店抽成、助理…。「按比例」是抽<strong>收入合計</strong>的百分比，系統自動換算金額。
        </p>
        <div className={styles.detailList}>
          {splits.length === 0 ? (
            <div className={styles.empty} style={{ borderColor: CIS.cardBorder, color: CIS.textMute }}>
              還沒有拆帳紀錄。整筆都你自己的話就不用填。
            </div>
          ) : (
            splits.map((s) => {
              const autoAmt = s.kind === "percent" ? splitAmountFromRate(totals.incomeTotal, Number(s.rate) || 0) : null;
              return (
                <div
                  key={s._key}
                  className={`${styles.detailRow} ${styles.detailRowSplit}`}
                  style={{ borderColor: CIS.cardBorder, background: CIS.bgSoft }}
                >
                  <label className={styles.field} style={{ color: CIS.textMute }}>
                    分給誰
                    <input
                      style={detailInputStyle}
                      value={s.party}
                      onChange={(ev) => patchSplit(s._key, { party: ev.target.value })}
                      maxLength={80}
                      placeholder="合作夥伴 王先生 / 店頭"
                    />
                  </label>
                  <label className={styles.field} style={{ color: CIS.textMute }}>
                    方式
                    <select
                      style={detailInputStyle}
                      value={s.kind}
                      onChange={(ev) => patchSplit(s._key, { kind: ev.target.value })}
                    >
                      {DEAL_SPLIT_KINDS.map((k) => (
                        <option key={k.key} value={k.key}>{k.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field} style={{ color: CIS.textMute }}>
                    {s.kind === "percent" ? "比例（%）" : "金額（元）"}
                    {s.kind === "percent" ? (
                      <input
                        style={detailInputStyle}
                        value={s.rate}
                        onChange={(ev) => patchSplit(s._key, { rate: ev.target.value })}
                        inputMode="decimal"
                        placeholder="30"
                      />
                    ) : (
                      <input
                        style={detailInputStyle}
                        value={s.amountYuan}
                        onChange={(ev) => patchSplit(s._key, { amountYuan: ev.target.value })}
                        inputMode="numeric"
                        placeholder="50000"
                      />
                    )}
                  </label>
                  <div className={styles.field} style={{ color: CIS.textMute }}>
                    分出金額
                    <div style={{ ...detailInputStyle, display: "flex", alignItems: "center", color: CIS.text }}>
                      {autoAmt != null ? fmtWan(autoAmt) : fmtWan(intOrZero(s.amountYuan))}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.rowDeleteBtn}
                    style={{ borderColor: CIS.cardBorder, color: "#fb7185" }}
                    onClick={() => setSplits((prev) => prev.filter((r) => r._key !== s._key))}
                  >
                    刪除
                  </button>
                </div>
              );
            })
          )}
        </div>
        <button
          type="button"
          className={styles.addRowBtn}
          style={{ borderColor: CIS.cardBorder, color: CIS.blueSoft }}
          onClick={addSplit}
        >
          <Icon name="add" size={14} /> 加一筆拆帳
        </button>
        <div style={{ marginTop: 10, fontSize: 15, color: CIS.textSub }}>
          拆帳合計：<strong style={{ color: CIS.text }}>{fmtWan(totals.splitTotal)}</strong>
        </div>
      </div>

      {/* 收款 */}
      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>收款</h2>
        <p className={styles.sectionHint} style={{ color: CIS.textMute }}>
          服務費收到多少了。之後「尾款追蹤」清單會用這個。
        </p>
        <div className={styles.formGrid}>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            收款狀態
            <select
              style={inputStyle}
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value)}
            >
              {DEAL_PAYMENT_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field} style={{ color: CIS.textMute }}>
            已收金額（萬）
            <input
              style={inputStyle}
              value={receivedWan}
              onChange={(e) => setReceivedWan(e.target.value)}
              inputMode="decimal"
              placeholder="20"
            />
          </label>
        </div>
      </div>

      {/* 結算摘要 */}
      <div className={styles.summaryBox} style={{ background: CIS.card, borderColor: CIS.blue }}>
        <div className={styles.summaryLine} style={{ color: CIS.textSub }}>
          <span>收入合計</span>
          <span className={styles.moneyMuted} style={{ color: CIS.text }}>{fmtWan(totals.incomeTotal)}</span>
        </div>
        <div className={styles.summaryLine} style={{ color: CIS.textSub }}>
          <span>− 成本合計</span>
          <span className={styles.moneyNeg}>{fmtWan(totals.expenseTotal)}</span>
        </div>
        <div className={styles.summaryLine} style={{ color: CIS.textSub }}>
          <span>− 拆帳合計</span>
          <span className={styles.moneyNeg}>{fmtWan(totals.splitTotal)}</span>
        </div>
        <div className={styles.summaryDivider} style={{ background: CIS.cardBorder }} />
        <div className={styles.summaryTakeHome}>
          <span style={{ color: CIS.text }}>我實拿</span>
          <span className={totals.takeHome >= 0 ? styles.moneyPos : styles.moneyNeg}>
            {fmtWan(totals.takeHome)}
          </span>
        </div>
      </div>

      {/* 備註 */}
      <div className={styles.formSection} style={{ background: CIS.card, borderColor: CIS.cardBorder }}>
        <h2 className={styles.sectionTitle} style={{ color: CIS.text }}>備註</h2>
        <label className={`${styles.field} ${styles.fieldWide}`} style={{ color: CIS.textMute }}>
          <textarea
            style={textareaStyle}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={4000}
            placeholder="尾款預計 10 月底交屋時收；這案是同事介紹的…"
          />
        </label>
      </div>

      <div className={styles.formActions}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className={styles.button}
          style={{ background: CIS.blue, color: "#fff", minHeight: 46, fontSize: 16, opacity: busy ? 0.65 : 1 }}
        >
          <Icon name="save" size={16} />
          {busy ? "儲存中…" : isEdit ? "儲存變更" : "新增這筆成交"}
        </button>
        {error ? (
          <span role="status" style={{ color: "#fb7185", fontSize: 15, fontWeight: 700 }}>
            {error}
          </span>
        ) : null}
      </div>

      {isEdit ? (
        <div className={styles.dangerZone} style={{ borderColor: CIS.cardBorder }}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void del()}
            className={styles.rowDeleteBtn}
            style={{ borderColor: "rgba(244,63,94,0.4)", color: "#fb7185", minHeight: 44 }}
          >
            <Icon name="trash" size={14} /> 刪除這筆成交記帳
          </button>
        </div>
      ) : null}
    </div>
  );
}
