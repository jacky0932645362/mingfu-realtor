/**
 * 把 tools/fb-autopost/config/groups.json 同步進資料庫的 fb_group 表。
 * list-groups.mjs 跑完會自己同步；這支是「同步那步失敗、想單獨重跑」時用的。
 *
 * 跑法（在 card-booking/ 底下）：node scripts/sync-fb-groups.mjs
 *
 * 🔴 本人在後台的設定（is_active / cooldown_days / note）不會被覆蓋。
 *    「從 FB 抓來的事實」（名稱、人數、公開私密、審核、有沒有討論/商品買賣分頁）會更新，
 *    accepts 也會照分頁能力重算（有討論+商品→both、只討論→post、只商品→marketplace）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");

for (const line of readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!process.env.DATABASE_URL) {
  console.error("❌ .env.local 裡找不到 DATABASE_URL");
  process.exit(1);
}

const GROUPS_FILE = path.join(ROOT, "tools", "fb-autopost", "config", "groups.json");
let data;
try {
  data = JSON.parse(readFileSync(GROUPS_FILE, "utf8"));
} catch (e) {
  console.error(`❌ 讀不到 ${GROUPS_FILE}\n   ${e.message}\n   先在 tools/fb-autopost/ 跑 npm run groups`);
  process.exit(1);
}
const 社團 = Array.isArray(data.社團) ? data.社團 : [];
if (社團.length === 0) {
  console.error("❌ groups.json 裡一個社團都沒有");
  process.exit(1);
}

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient({ log: ["error"] });

for (const [n, def] of [
  ["member_count", "INT NULL"],
  ["privacy", "VARCHAR(16) NULL"],
  ["needs_approval", "TINYINT NULL"],
  ["has_discussion", "TINYINT NULL"],
  ["has_marketplace", "TINYINT NULL"],
  ["hidden", "TINYINT NULL DEFAULT 0"],
  ["scanned_at", "DATETIME NULL"],
]) {
  try {
    await db.$executeRawUnsafe(`ALTER TABLE fb_group ADD COLUMN IF NOT EXISTS ${n} ${def}`);
  } catch {
    /* 已存在 */
  }
}

const key = (u) => {
  const m = String(u).match(/groups\/([^/?#]+)/);
  return m ? m[1].toLowerCase() : String(u).toLowerCase();
};
const 算accepts = (有討論, 有商品) => {
  if (有討論 && 有商品) return "both";
  if (有討論 && 有商品 === false) return "post";
  if (有討論 === false && 有商品) return "marketplace";
  return null;
};

const 現有 = await db.$queryRawUnsafe("SELECT id, url FROM fb_group");
const byKey = new Map(現有.map((r) => [key(r.url), r.id]));

let added = 0;
let updated = 0;
for (const g of 社團) {
  const k = key(g.網址);
  const scannedAt = g.人數 != null || g.隱私 != null ? new Date() : null;
  const acc = 算accepts(g.有討論, g.有商品買賣);
  const b = (v) => (v == null ? null : v ? 1 : 0);
  const hit = byKey.get(k);
  if (hit) {
    // 🔴 COALESCE：這次抓不到就保留舊值
    await db.$executeRawUnsafe(
      `UPDATE fb_group SET name=?, url=?,
           member_count=COALESCE(?, member_count),
           privacy=COALESCE(?, privacy),
           needs_approval=COALESCE(?, needs_approval),
           has_discussion=COALESCE(?, has_discussion),
           has_marketplace=COALESCE(?, has_marketplace),
           accepts=COALESCE(?, accepts),
           scanned_at=COALESCE(?, scanned_at), updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      String(g.名稱).slice(0, 200),
      String(g.網址).slice(0, 500),
      g.人數 ?? null,
      g.隱私 ?? null,
      b(g.要審核),
      b(g.有討論),
      b(g.有商品買賣),
      acc,
      scannedAt,
      hit,
    );
    updated++;
  } else {
    const id = globalThis.crypto.randomUUID().replace(/-/g, "");
    await db.$executeRawUnsafe(
      `INSERT INTO fb_group (id, name, url, accepts, cooldown_days, is_active, member_count, privacy, needs_approval, has_discussion, has_marketplace, scanned_at, created_at)
       VALUES (?, ?, ?, ?, 7, 0, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      id,
      String(g.名稱).slice(0, 200),
      String(g.網址).slice(0, 500),
      acc || "both",
      g.人數 ?? null,
      g.隱私 ?? null,
      b(g.要審核),
      b(g.有討論),
      b(g.有商品買賣),
      scannedAt,
    );
    byKey.set(k, id);
    added++;
  }
}
await db.$disconnect();
console.log(`✅ 同步完成：新增 ${added}、更新 ${updated}（共 ${社團.length}）`);
