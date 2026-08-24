/**
 * 房屋物件資料庫 — 資料層（2026-08-23）
 * raw SQL 讀寫 property 表，對齊 seller.ts / tenant.ts 的做法（不依賴 prisma client 重生）。
 *
 * 全 additive：新表，不改任何既有表／邏輯。
 *
 * 跟 seller（屋主）的差別：seller 記的是「人」（誰委託你賣、底價多少、幾號要回報），
 * 是內部資料永不公開；property 記的是「要給客戶看的東西」（文案、照片、影片），
 * 有一份會出現在公開網址上。兩者可用 seller_id 對起來，但不共用一張表 ——
 * 屋主底價跟對外文案放同一張表遲早會外洩。
 *
 * 照片與影片一律只存「網址」，不存檔案（2026-08-23 本人決定先不升 Vercel Pro）。
 * 網址的轉換在 @/lib/media-url。
 */
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";

export type PropertyRow = {
  id: string;
  slug: string;
  title: string;
  headline: string | null;
  status: string;
  price: number | null;
  price_note: string | null;
  property_type: string | null;
  property_type_other: string | null;
  layout: string | null;
  size_ping: string | null;
  main_building_ping: string | null;
  land_ping: string | null;
  floor_info: string | null;
  age_years: number | null;
  parking: string | null;
  direction: string | null;
  district: string | null;
  address: string | null;
  address_public: string | null;
  community: string | null;
  builder: string | null;
  highlights: string | null;
  description: string | null;
  suitable_for: string | null;
  life_info: string | null;
  transport_info: string | null;
  cover_url: string | null;
  photo_urls: string | null;
  video_urls: string | null;
  seller_id: string | null;
  internal_note: string | null;
  sort_order: number;
  view_count: number;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date | null;
};

export type PropertyQueue = "all" | "published" | "draft" | "closed";

/**
 * DECIMAL 欄位 Prisma raw query 讀回來是 Prisma.Decimal 實例，不是純字串 ——
 * 直接把 PropertyRow 從 Server Component 傳進 "use client" 元件會被 RSC 序列化擋下
 * （"Only plain objects can be passed to Client Components"）。跟 seller.ts 同一個坑，
 * 統一在資料層轉成字串。
 */
function normalize(row: PropertyRow): PropertyRow {
  return {
    ...row,
    size_ping: row.size_ping == null ? null : String(row.size_ping),
    main_building_ping: row.main_building_ping == null ? null : String(row.main_building_ping),
    land_ping: row.land_ping == null ? null : String(row.land_ping),
  };
}

export const PROPERTY_STATUSES = [
  { key: "draft", label: "草稿（不公開）" },
  { key: "published", label: "上架中" },
  { key: "reserved", label: "已預訂／斡旋中" },
  { key: "sold", label: "已成交" },
  { key: "hidden", label: "已下架" },
] as const;

export const PROPERTY_TYPES = [
  { key: "building", label: "電梯大樓" },
  { key: "house", label: "透天厝" },
  { key: "villa", label: "別墅" },
  { key: "apartment", label: "公寓" },
  { key: "studio", label: "套房" },
  { key: "shop", label: "店面" },
  { key: "office", label: "辦公室" },
  { key: "factory", label: "廠房" },
  { key: "land", label: "土地" },
] as const;

/** 海線為主，其餘台中行政區排後面。 */
export const DISTRICTS = [
  "梧棲",
  "清水",
  "沙鹿",
  "龍井",
  "大甲",
  "大安",
  "外埔",
  "后里",
  "神岡",
  "大雅",
  "西屯",
  "南屯",
  "北屯",
  "其他",
] as const;

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  PROPERTY_STATUSES.map((s) => [s.key, s.label]),
);
const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  PROPERTY_TYPES.map((t) => [t.key, t.label]),
);

export function statusLabel(key: string): string {
  return STATUS_LABELS[key] || key;
}

export function propertyTypeLabel(
  row: Pick<PropertyRow, "property_type" | "property_type_other">,
): string {
  if (!row.property_type) return row.property_type_other || "";
  return TYPE_LABELS[row.property_type] || row.property_type;
}

/**
 * 網址用短碼。
 *
 * 刻意不用 uuid（網址落落長，貼 LINE 很醜），也不用中文標題
 * （中文會被 percent-encoding 成一長串 %E5%… 比 uuid 還醜）。
 * 字母表去掉 0/o/1/l/i 這些看起來一樣的字，用嘴巴唸給客戶聽也不會唸錯。
 */
const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function randomSlug(len = 6): string {
  let out = "";
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i += 1) out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  return out;
}

export function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

// ---- 建表（首次呼叫自動建，對齊 seller.ts pattern）----
let tableEnsured = false;

export async function ensurePropertyTable(): Promise<void> {
  if (tableEnsured) return;
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS property (
      id                  VARCHAR(64)   NOT NULL,
      slug                VARCHAR(64)   NOT NULL,
      title               VARCHAR(120)  NOT NULL,
      headline            VARCHAR(160)  NULL,
      status              VARCHAR(20)   NOT NULL DEFAULT 'draft',
      price               INT           NULL,
      price_note          VARCHAR(60)   NULL,
      property_type       VARCHAR(20)   NULL,
      property_type_other VARCHAR(80)   NULL,
      layout              VARCHAR(40)   NULL,
      size_ping           DECIMAL(7,2)  NULL,
      main_building_ping  DECIMAL(7,2)  NULL,
      land_ping           DECIMAL(7,2)  NULL,
      floor_info          VARCHAR(40)   NULL,
      age_years           INT           NULL,
      parking             VARCHAR(40)   NULL,
      direction           VARCHAR(20)   NULL,
      district            VARCHAR(20)   NULL,
      address             VARCHAR(240)  NULL,
      address_public      VARCHAR(240)  NULL,
      community           VARCHAR(80)   NULL,
      builder             VARCHAR(80)   NULL,
      highlights          LONGTEXT      NULL,
      description         LONGTEXT      NULL,
      suitable_for        VARCHAR(240)  NULL,
      life_info           LONGTEXT      NULL,
      transport_info      LONGTEXT      NULL,
      cover_url           VARCHAR(600)  NULL,
      photo_urls          LONGTEXT      NULL,
      video_urls          LONGTEXT      NULL,
      seller_id           VARCHAR(64)   NULL,
      internal_note       LONGTEXT      NULL,
      sort_order          INT           NOT NULL DEFAULT 0,
      view_count          INT           NOT NULL DEFAULT 0,
      published_at        DATETIME      NULL,
      created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP     NULL,
      PRIMARY KEY (id),
      UNIQUE KEY property_slug_uniq (slug),
      KEY property_status_idx (status),
      KEY property_district_idx (district),
      KEY property_sort_idx (sort_order, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tableEnsured = true;
}

/* ────────────────── 後台查詢 ────────────────── */

export async function listProperties(opts?: {
  queue?: PropertyQueue;
  status?: string;
  district?: string;
  search?: string;
  limit?: number;
}): Promise<PropertyRow[]> {
  await ensurePropertyTable();
  const limit = Math.min(opts?.limit || 300, 500);
  const filters: string[] = ["1=1"];
  const params: unknown[] = [];

  const queue = opts?.queue || "all";
  if (queue === "published") {
    filters.push("status IN ('published','reserved')");
  } else if (queue === "draft") {
    filters.push("status IN ('draft','hidden')");
  } else if (queue === "closed") {
    filters.push("status = 'sold'");
  }

  if (opts?.status && opts.status !== "all") {
    filters.push("status = ?");
    params.push(opts.status);
  }
  if (opts?.district && opts.district !== "all") {
    filters.push("district = ?");
    params.push(opts.district);
  }

  const search = opts?.search?.trim().slice(0, 120);
  if (search) {
    const pattern = `%${search.replace(/[%_]/g, "\\$&")}%`;
    filters.push(
      "(title LIKE ? OR headline LIKE ? OR address LIKE ? OR community LIKE ? OR slug LIKE ?)",
    );
    params.push(pattern, pattern, pattern, pattern, pattern);
  }

  const rows = await db.$queryRawUnsafe<PropertyRow[]>(
    `SELECT * FROM property
      WHERE ${filters.join(" AND ")}
      ORDER BY sort_order DESC, created_at DESC
      LIMIT ?`,
    ...params,
    limit,
  );
  return rows.map(normalize);
}

export async function getProperty(id: string): Promise<PropertyRow | null> {
  await ensurePropertyTable();
  const rows = await db.$queryRaw<PropertyRow[]>`SELECT * FROM property WHERE id = ${id} LIMIT 1`;
  return rows[0] ? normalize(rows[0]) : null;
}

export async function propertyStats(): Promise<{
  total: number;
  published: number;
  draft: number;
  sold: number;
  views: number;
}> {
  await ensurePropertyTable();
  const rows = await db.$queryRaw<
    Array<{ total: bigint; published: bigint; draft: bigint; sold: bigint; views: bigint | null }>
  >`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status IN ('published','reserved') THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN status IN ('draft','hidden') THEN 1 ELSE 0 END) AS draft,
      SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) AS sold,
      SUM(view_count) AS views
    FROM property
  `;
  const row = rows[0];
  return {
    total: Number(row?.total || 0),
    published: Number(row?.published || 0),
    draft: Number(row?.draft || 0),
    sold: Number(row?.sold || 0),
    views: Number(row?.views || 0),
  };
}

/* ────────────────── 公開頁查詢 ────────────────── */

/** 公開物件列表。只回上架中／已預訂，成交的不進列表（但舊連結還打得開）。 */
export async function listPublicProperties(opts?: {
  district?: string;
  type?: string;
  limit?: number;
}): Promise<PropertyRow[]> {
  await ensurePropertyTable();
  const filters: string[] = ["status IN ('published','reserved')"];
  const params: unknown[] = [];
  if (opts?.district && opts.district !== "all") {
    filters.push("district = ?");
    params.push(opts.district);
  }
  if (opts?.type && opts.type !== "all") {
    filters.push("property_type = ?");
    params.push(opts.type);
  }
  const rows = await db.$queryRawUnsafe<PropertyRow[]>(
    `SELECT * FROM property
      WHERE ${filters.join(" AND ")}
      ORDER BY sort_order DESC, COALESCE(published_at, created_at) DESC
      LIMIT ?`,
    ...params,
    Math.min(opts?.limit || 60, 200),
  );
  return rows.map(normalize);
}

/**
 * 用短碼取公開物件。
 * 成交的也回（連結可能已經發給客戶了，直接 404 比顯示「已成交」更差），
 * 草稿與下架的一律當作不存在。
 */
export async function getPublicPropertyBySlug(slug: string): Promise<PropertyRow | null> {
  await ensurePropertyTable();
  const rows = await db.$queryRaw<PropertyRow[]>`
    SELECT * FROM property
     WHERE slug = ${slug} AND status IN ('published','reserved','sold')
     LIMIT 1
  `;
  return rows[0] ? normalize(rows[0]) : null;
}

/** 公開頁瀏覽次數 +1。失敗不要影響頁面顯示。 */
export async function incrementPropertyView(id: string): Promise<void> {
  try {
    await db.$executeRaw`UPDATE property SET view_count = view_count + 1 WHERE id = ${id}`;
  } catch {
    /* 統計失敗不值得讓客戶看不到房子 */
  }
}

/* ────────────────── 寫入 ────────────────── */

export type PropertyInput = {
  slug: string;
  title: string;
  headline: string | null;
  status: string;
  price: number | null;
  priceNote: string | null;
  propertyType: string | null;
  propertyTypeOther: string | null;
  layout: string | null;
  sizePing: number | null;
  mainBuildingPing: number | null;
  landPing: number | null;
  floorInfo: string | null;
  ageYears: number | null;
  parking: string | null;
  direction: string | null;
  district: string | null;
  address: string | null;
  addressPublic: string | null;
  community: string | null;
  builder: string | null;
  highlights: string | null;
  description: string | null;
  suitableFor: string | null;
  lifeInfo: string | null;
  transportInfo: string | null;
  coverUrl: string | null;
  photoUrls: string | null;
  videoUrls: string | null;
  sellerId: string | null;
  internalNote: string | null;
  sortOrder: number;
};

/** 產生一個資料庫裡還沒有人用的短碼。 */
export async function generateUniqueSlug(): Promise<string> {
  await ensurePropertyTable();
  for (let i = 0; i < 8; i += 1) {
    const candidate = randomSlug(i < 5 ? 6 : 8);
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM property WHERE slug = ${candidate} LIMIT 1
    `;
    if (rows.length === 0) return candidate;
  }
  return randomSlug(12);
}

/** 短碼有沒有被別人用走（編輯時要排除自己）。 */
export async function slugTaken(slug: string, exceptId?: string): Promise<boolean> {
  await ensurePropertyTable();
  const rows = exceptId
    ? await db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM property WHERE slug = ${slug} AND id <> ${exceptId} LIMIT 1`
    : await db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM property WHERE slug = ${slug} LIMIT 1`;
  return rows.length > 0;
}

export async function createProperty(data: PropertyInput): Promise<string> {
  await ensurePropertyTable();
  const id = randomUUID();
  const publishedAt = data.status === "published" ? new Date() : null;
  await db.$executeRaw`
    INSERT INTO property (
      id, slug, title, headline, status, price, price_note,
      property_type, property_type_other, layout, size_ping, main_building_ping, land_ping,
      floor_info, age_years, parking, direction, district, address, address_public,
      community, builder, highlights, description, suitable_for, life_info, transport_info,
      cover_url, photo_urls, video_urls, seller_id, internal_note, sort_order, published_at
    ) VALUES (
      ${id}, ${data.slug}, ${data.title}, ${data.headline}, ${data.status}, ${data.price}, ${data.priceNote},
      ${data.propertyType}, ${data.propertyTypeOther}, ${data.layout},
      ${data.sizePing}, ${data.mainBuildingPing}, ${data.landPing},
      ${data.floorInfo}, ${data.ageYears}, ${data.parking}, ${data.direction},
      ${data.district}, ${data.address}, ${data.addressPublic},
      ${data.community}, ${data.builder}, ${data.highlights}, ${data.description},
      ${data.suitableFor}, ${data.lifeInfo}, ${data.transportInfo},
      ${data.coverUrl}, ${data.photoUrls}, ${data.videoUrls},
      ${data.sellerId}, ${data.internalNote}, ${data.sortOrder}, ${publishedAt}
    )
  `;
  return id;
}

export async function updateProperty(id: string, data: PropertyInput): Promise<void> {
  await ensurePropertyTable();
  // 第一次上架時補寫 published_at；之後改回草稿再上架不重寫，
  // 免得「上架日期」在列表上跳來跳去。
  await db.$executeRaw`
    UPDATE property SET
      slug = ${data.slug}, title = ${data.title}, headline = ${data.headline},
      status = ${data.status}, price = ${data.price}, price_note = ${data.priceNote},
      property_type = ${data.propertyType}, property_type_other = ${data.propertyTypeOther},
      layout = ${data.layout}, size_ping = ${data.sizePing},
      main_building_ping = ${data.mainBuildingPing}, land_ping = ${data.landPing},
      floor_info = ${data.floorInfo}, age_years = ${data.ageYears},
      parking = ${data.parking}, direction = ${data.direction},
      district = ${data.district}, address = ${data.address}, address_public = ${data.addressPublic},
      community = ${data.community}, builder = ${data.builder},
      highlights = ${data.highlights}, description = ${data.description},
      suitable_for = ${data.suitableFor}, life_info = ${data.lifeInfo},
      transport_info = ${data.transportInfo},
      cover_url = ${data.coverUrl}, photo_urls = ${data.photoUrls}, video_urls = ${data.videoUrls},
      seller_id = ${data.sellerId}, internal_note = ${data.internalNote},
      sort_order = ${data.sortOrder},
      published_at = CASE WHEN published_at IS NULL AND ${data.status} = 'published'
                          THEN NOW() ELSE published_at END,
      updated_at = NOW()
    WHERE id = ${id}
  `;
}

export async function deleteProperty(id: string): Promise<void> {
  await ensurePropertyTable();
  await db.$executeRaw`DELETE FROM property WHERE id = ${id}`;
}

/**
 * 首頁「成交案例」用的清單（2026-08-24）。
 *
 * 只撈 status='sold'。刻意**不回傳當成交價用的欄位給畫面顯示** ——
 * property.price 存的是「開價」不是「成交價」，把開價放在成交案例牆上
 * 等同對客戶暗示那是成交行情，屋主隱私與實價登錄兩邊都不該這樣用。
 * 卡片只呈現區域／類型／格局這種不敏感的條件。
 *
 * 排序用 updated_at（改成已成交那次的時間）最接近「成交時間」，
 * 沒有 updated_at 的舊資料退回 created_at。
 */
export async function listSoldProperties(limit = 6): Promise<PropertyRow[]> {
  await ensurePropertyTable();
  const rows = await db.$queryRawUnsafe<PropertyRow[]>(
    `SELECT * FROM property
      WHERE status = 'sold'
      ORDER BY sort_order DESC, COALESCE(updated_at, created_at) DESC
      LIMIT ?`,
    Math.min(limit, 24),
  );
  return rows.map(normalize);
}

/** 成交案例的統計數字（首頁「專業數據」用）。查不到就回 0，不要讓首頁掛掉。 */
export async function soldStats(): Promise<{ count: number; districts: number }> {
  await ensurePropertyTable();
  const rows = await db.$queryRaw<Array<{ count: bigint; districts: bigint }>>`
    SELECT COUNT(*) AS count, COUNT(DISTINCT district) AS districts
      FROM property WHERE status = 'sold'
  `;
  return { count: Number(rows[0]?.count || 0), districts: Number(rows[0]?.districts || 0) };
}
