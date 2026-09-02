/**
 * 成交記帳 — 前後台共用的常數、型別、純計算函數（2026-09-02）
 *
 * 這個檔案「乾淨」——不 import 資料庫、不用 node 內建模組，
 * 所以 client component（DealForm）跟 server（deal.ts / 頁面）都能安全 import。
 * 會碰資料庫的讀寫在 deal.ts。
 *
 * 金額一律以「元」為單位的整數。
 */

// ---- 常數 ----

/** 我方在這筆交易代表誰 */
export const DEAL_SIDES = [
  { key: "seller", label: "代表賣方" },
  { key: "buyer", label: "代表買方" },
  { key: "both", label: "買賣雙方" },
] as const;

/** 收款狀態 */
export const DEAL_PAYMENT_STATUSES = [
  { key: "unpaid", label: "尚未收款" },
  { key: "partial", label: "收了一部分" },
  { key: "paid", label: "已收齊" },
] as const;

/** 成本分類 */
export const DEAL_EXPENSE_CATEGORIES = [
  { key: "ad", label: "廣告（591／FB／看板）" },
  { key: "showing", label: "帶看（油錢／停車／餐費）" },
  { key: "gift", label: "成交禮／雜支" },
  { key: "other", label: "其他" },
] as const;

/** 拆帳方式 */
export const DEAL_SPLIT_KINDS = [
  { key: "percent", label: "按比例（抽收入合計的 %）" },
  { key: "fixed", label: "固定金額" },
] as const;

// ---- 型別 ----

export type DealRow = {
  id: string;
  title: string;
  deal_date: string;
  district: string | null;
  side: string;
  total_price: number | null;
  fee_seller: number;
  fee_buyer: number;
  income_other: number;
  payment_status: string;
  received_amount: number;
  note: string | null;
  created_at: Date;
  updated_at: Date | null;
};

export type DealExpenseRow = {
  id: string;
  deal_id: string;
  spent_on: string | null;
  category: string;
  amount: number;
  memo: string | null;
  created_at: Date;
};

export type DealSplitRow = {
  id: string;
  deal_id: string;
  party: string;
  kind: string;
  rate: number | null;
  amount: number;
  memo: string | null;
  created_at: Date;
};

export type DealTotals = {
  incomeTotal: number;
  expenseTotal: number;
  splitTotal: number;
  takeHome: number;
  outstanding: number;
};

export type DealDetail = {
  deal: DealRow;
  expenses: DealExpenseRow[];
  splits: DealSplitRow[];
  totals: DealTotals;
};

export type DealExpenseInput = {
  spentOn: string | null;
  category: string;
  amount: number;
  memo: string | null;
};

export type DealSplitInput = {
  party: string;
  kind: string;
  rate: number | null;
  amount: number;
  memo: string | null;
};

export type DealInput = {
  title: string;
  dealDate: string;
  district: string | null;
  side: string;
  totalPrice: number | null;
  feeSeller: number;
  feeBuyer: number;
  incomeOther: number;
  paymentStatus: string;
  receivedAmount: number;
  note: string | null;
  expenses: DealExpenseInput[];
  splits: DealSplitInput[];
};

// ---- 純計算（lib 與 UI 共用同一份，確保一致）----

export function computeIncomeTotal(
  d: Pick<DealRow, "fee_seller" | "fee_buyer" | "income_other">,
): number {
  return (d.fee_seller || 0) + (d.fee_buyer || 0) + (d.income_other || 0);
}

export function computeDealTotals(
  deal: Pick<DealRow, "fee_seller" | "fee_buyer" | "income_other" | "received_amount">,
  expenses: Array<Pick<DealExpenseRow, "amount">>,
  splits: Array<Pick<DealSplitRow, "amount">>,
): DealTotals {
  const incomeTotal = computeIncomeTotal(deal);
  const expenseTotal = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const splitTotal = splits.reduce((sum, s) => sum + (s.amount || 0), 0);
  const takeHome = incomeTotal - expenseTotal - splitTotal;
  const outstanding = incomeTotal - (deal.received_amount || 0);
  return { incomeTotal, expenseTotal, splitTotal, takeHome, outstanding };
}

/** 拆帳按比例時，金額 ＝ 收入合計 × rate%，四捨五入到元 */
export function splitAmountFromRate(incomeTotal: number, ratePercent: number): number {
  return Math.round((incomeTotal * ratePercent) / 100);
}
