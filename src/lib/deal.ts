/**
 * 成交記帳 — 資料層（2026-09-02）
 *
 * raw SQL 讀寫 deal / deal_expense / deal_split 三張表，對齊 customer.ts 的做法
 * （不依賴 prisma client 重生，首次呼叫自動 CREATE TABLE IF NOT EXISTS）。
 *
 * 全 additive：三張新表，不改任何既有表／邏輯。
 *
 * 常數、型別、純計算函數在 deal-shared.ts（那個檔案不碰資料庫，client 也能 import）；
 * 這個檔案只放會碰資料庫的讀寫，並 re-export deal-shared，讓 `@/lib/deal` 仍是單一入口。
 *
 * 金額一律以「元」為單位存整數（INT，上限 21 億元）。
 * 日期存 'YYYY-MM-DD' 字串（VARCHAR(10)），不碰時區。
 */
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  computeDealTotals,
  type DealRow,
  type DealExpenseRow,
  type DealSplitRow,
  type DealDetail,
  type DealInput,
} from "@/lib/deal-shared";

export * from "@/lib/deal-shared";

// ---- 建表 ----

let tablesEnsured = false;
export async function ensureDealTables(): Promise<void> {
  if (tablesEnsured) return;

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS deal (
      id              VARCHAR(64)   NOT NULL,
      title           VARCHAR(160)  NOT NULL,
      deal_date       VARCHAR(10)   NOT NULL,
      district        VARCHAR(20)   NULL,
      side            VARCHAR(16)   NOT NULL DEFAULT 'seller',
      total_price     INT           NULL,
      fee_seller      INT           NOT NULL DEFAULT 0,
      fee_buyer       INT           NOT NULL DEFAULT 0,
      income_other    INT           NOT NULL DEFAULT 0,
      payment_status  VARCHAR(16)   NOT NULL DEFAULT 'unpaid',
      received_amount INT           NOT NULL DEFAULT 0,
      note            LONGTEXT      NULL,
      created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP     NULL,
      PRIMARY KEY (id),
      KEY deal_date_idx (deal_date),
      KEY deal_payment_status_idx (payment_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS deal_expense (
      id         VARCHAR(64)  NOT NULL,
      deal_id    VARCHAR(64)  NOT NULL,
      spent_on   VARCHAR(10)  NULL,
      category   VARCHAR(20)  NOT NULL DEFAULT 'other',
      amount     INT          NOT NULL DEFAULT 0,
      memo       VARCHAR(200) NULL,
      created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY deal_expense_deal_idx (deal_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS deal_split (
      id         VARCHAR(64)  NOT NULL,
      deal_id    VARCHAR(64)  NOT NULL,
      party      VARCHAR(80)  NOT NULL,
      kind       VARCHAR(12)  NOT NULL DEFAULT 'percent',
      rate       DECIMAL(6,3) NULL,
      amount     INT          NOT NULL DEFAULT 0,
      memo       VARCHAR(200) NULL,
      created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY deal_split_deal_idx (deal_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  tablesEnsured = true;
}

// ---- 查詢 ----

export async function listDeals(opts?: {
  search?: string;
  paymentStatus?: string;
  month?: string; // 'YYYY-MM'
  limit?: number;
}): Promise<DealRow[]> {
  await ensureDealTables();
  const limit = Math.min(opts?.limit || 300, 500);
  const filters: string[] = ["1=1"];
  const params: unknown[] = [];

  if (opts?.paymentStatus && opts.paymentStatus !== "all") {
    filters.push("payment_status = ?");
    params.push(opts.paymentStatus);
  }

  const month = opts?.month?.trim();
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    filters.push("deal_date LIKE ?");
    params.push(`${month}-%`);
  }

  const search = opts?.search?.trim().slice(0, 120);
  if (search) {
    const pattern = `%${search.replace(/[%_]/g, "\\$&")}%`;
    filters.push("(title LIKE ? OR district LIKE ? OR note LIKE ?)");
    params.push(pattern, pattern, pattern);
  }

  return db.$queryRawUnsafe<DealRow[]>(
    `SELECT * FROM deal
      WHERE ${filters.join(" AND ")}
      ORDER BY deal_date DESC, created_at DESC
      LIMIT ?`,
    ...params,
    limit,
  );
}

/** 一次抓多筆 deal 的成本／拆帳合計，給列表頁算「實拿」用（避免 N+1）。 */
export async function sumChildrenByDeal(
  dealIds: string[],
): Promise<Record<string, { expenseTotal: number; splitTotal: number }>> {
  const out: Record<string, { expenseTotal: number; splitTotal: number }> = {};
  if (dealIds.length === 0) return out;
  await ensureDealTables();

  const placeholders = dealIds.map(() => "?").join(",");
  const expenseRows = await db.$queryRawUnsafe<Array<{ deal_id: string; total: bigint | number }>>(
    `SELECT deal_id, SUM(amount) AS total FROM deal_expense WHERE deal_id IN (${placeholders}) GROUP BY deal_id`,
    ...dealIds,
  );
  const splitRows = await db.$queryRawUnsafe<Array<{ deal_id: string; total: bigint | number }>>(
    `SELECT deal_id, SUM(amount) AS total FROM deal_split WHERE deal_id IN (${placeholders}) GROUP BY deal_id`,
    ...dealIds,
  );

  for (const id of dealIds) out[id] = { expenseTotal: 0, splitTotal: 0 };
  for (const r of expenseRows) out[r.deal_id].expenseTotal = Number(r.total || 0);
  for (const r of splitRows) out[r.deal_id].splitTotal = Number(r.total || 0);
  return out;
}

export async function getDealDetail(id: string): Promise<DealDetail | null> {
  await ensureDealTables();
  const rows = await db.$queryRaw<DealRow[]>`SELECT * FROM deal WHERE id = ${id} LIMIT 1`;
  const deal = rows[0];
  if (!deal) return null;

  const expenses = await db.$queryRaw<DealExpenseRow[]>`
    SELECT * FROM deal_expense WHERE deal_id = ${id} ORDER BY spent_on ASC, created_at ASC
  `;
  const splits = await db.$queryRaw<DealSplitRow[]>`
    SELECT * FROM deal_split WHERE deal_id = ${id} ORDER BY created_at ASC
  `;

  // DECIMAL 讀回來是 string，轉成 number
  const splitsNorm = splits.map((s) => ({ ...s, rate: s.rate == null ? null : Number(s.rate) }));

  return {
    deal,
    expenses,
    splits: splitsNorm,
    totals: computeDealTotals(deal, expenses, splitsNorm),
  };
}

export async function dealStats(opts?: { month?: string }): Promise<{
  count: number;
  incomeTotal: number;
  expenseTotal: number;
  splitTotal: number;
  takeHome: number;
  outstandingCount: number;
}> {
  await ensureDealTables();
  const month = opts?.month?.trim();
  const monthOk = month && /^\d{4}-\d{2}$/.test(month);
  const where = monthOk ? "WHERE deal_date LIKE ?" : "";
  const params = monthOk ? [`${month}-%`] : [];

  const dealRows = await db.$queryRawUnsafe<
    Array<{
      count: bigint;
      income: bigint | number | null;
      received: bigint | number | null;
      outstanding_count: bigint;
    }>
  >(
    `SELECT
       COUNT(*) AS count,
       SUM(fee_seller + fee_buyer + income_other) AS income,
       SUM(received_amount) AS received,
       SUM(CASE WHEN payment_status <> 'paid' THEN 1 ELSE 0 END) AS outstanding_count
     FROM deal ${where}`,
    ...params,
  );

  // 成本／拆帳要 join 回 deal 才能套用月份篩選
  const childWhere = monthOk ? "WHERE d.deal_date LIKE ?" : "";
  const expenseRows = await db.$queryRawUnsafe<Array<{ total: bigint | number | null }>>(
    `SELECT SUM(e.amount) AS total FROM deal_expense e JOIN deal d ON d.id = e.deal_id ${childWhere}`,
    ...params,
  );
  const splitRows = await db.$queryRawUnsafe<Array<{ total: bigint | number | null }>>(
    `SELECT SUM(s.amount) AS total FROM deal_split s JOIN deal d ON d.id = s.deal_id ${childWhere}`,
    ...params,
  );

  const incomeTotal = Number(dealRows[0]?.income || 0);
  const expenseTotal = Number(expenseRows[0]?.total || 0);
  const splitTotal = Number(splitRows[0]?.total || 0);

  return {
    count: Number(dealRows[0]?.count || 0),
    incomeTotal,
    expenseTotal,
    splitTotal,
    takeHome: incomeTotal - expenseTotal - splitTotal,
    outstandingCount: Number(dealRows[0]?.outstanding_count || 0),
  };
}

// ---- 寫入 ----

async function replaceChildren(dealId: string, data: DealInput): Promise<void> {
  await db.$executeRaw`DELETE FROM deal_expense WHERE deal_id = ${dealId}`;
  await db.$executeRaw`DELETE FROM deal_split WHERE deal_id = ${dealId}`;

  for (const e of data.expenses) {
    await db.$executeRaw`
      INSERT INTO deal_expense (id, deal_id, spent_on, category, amount, memo)
      VALUES (${randomUUID()}, ${dealId}, ${e.spentOn}, ${e.category}, ${Math.round(e.amount)}, ${e.memo})
    `;
  }
  for (const s of data.splits) {
    await db.$executeRaw`
      INSERT INTO deal_split (id, deal_id, party, kind, rate, amount, memo)
      VALUES (${randomUUID()}, ${dealId}, ${s.party}, ${s.kind}, ${s.rate}, ${Math.round(s.amount)}, ${s.memo})
    `;
  }
}

export async function createDeal(data: DealInput): Promise<string> {
  await ensureDealTables();
  const id = randomUUID();
  await db.$executeRaw`
    INSERT INTO deal (
      id, title, deal_date, district, side, total_price,
      fee_seller, fee_buyer, income_other, payment_status, received_amount, note
    ) VALUES (
      ${id}, ${data.title}, ${data.dealDate}, ${data.district}, ${data.side}, ${data.totalPrice},
      ${Math.round(data.feeSeller)}, ${Math.round(data.feeBuyer)}, ${Math.round(data.incomeOther)},
      ${data.paymentStatus}, ${Math.round(data.receivedAmount)}, ${data.note}
    )
  `;
  await replaceChildren(id, data);
  return id;
}

export async function updateDeal(id: string, data: DealInput): Promise<void> {
  await ensureDealTables();
  await db.$executeRaw`
    UPDATE deal SET
      title = ${data.title}, deal_date = ${data.dealDate}, district = ${data.district},
      side = ${data.side}, total_price = ${data.totalPrice},
      fee_seller = ${Math.round(data.feeSeller)}, fee_buyer = ${Math.round(data.feeBuyer)},
      income_other = ${Math.round(data.incomeOther)}, payment_status = ${data.paymentStatus},
      received_amount = ${Math.round(data.receivedAmount)}, note = ${data.note},
      updated_at = NOW()
    WHERE id = ${id}
  `;
  await replaceChildren(id, data);
}

export async function deleteDeal(id: string): Promise<void> {
  await ensureDealTables();
  await db.$executeRaw`DELETE FROM deal_expense WHERE deal_id = ${id}`;
  await db.$executeRaw`DELETE FROM deal_split WHERE deal_id = ${id}`;
  await db.$executeRaw`DELETE FROM deal WHERE id = ${id}`;
}
