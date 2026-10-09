/**
 * 發文身分（2026-10-07）— 資料層。純函式與常數在 fb-identity-core.ts（不碰資料庫、測得起來）。
 *
 * 新表 fb_identity：這個網站自己建的，沒有「另一台」的相容包袱。
 * 🔴 這個檔**不准 import fb-factory.ts**（fb-factory 的 ensureFbCoreTables 會呼叫這裡的建表）——
 *    要查 fb_task／fb_group 數量的統計放在 fb-factory.ts 的 identityUsage()。
 *
 * 登入檔路徑（auth/fb-state-<代號>.json）網站完全不知道、也不該知道：那是桌機上的檔案。
 * 網站只存「登入代號」（auth_key），桌機 runner 自己組路徑，登入有沒有效由 runner 回報
 * （reportIdentityLogin）——網站在 Vercel 上，讀不到桌機的檔案。
 */
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_IDENTITY_ID,
  DEFAULT_IDENTITY_NAME,
  isIdentityKind,
  makeAuthKey,
  normalizeIdentityId,
  type IdentityKind,
} from "@/lib/fb-identity-core";

export type FbIdentityRow = {
  id: string;
  kind: string;
  name: string;
  is_default: number;
  is_active: number;
  /** 個人帳號的登入代號（主帳號是 null，登入檔沿用原本的 fb-state.json） */
  auth_key: string | null;
  /** 粉絲專頁（第二段）用 */
  page_id: string | null;
  page_url: string | null;
  /** 桌機 runner 回報：登入檔存不存在、有沒有 c_user／xs。null＝還沒回報過 */
  login_ok: number | null;
  login_checked_at: Date | null;
  login_note: string | null;
  sort_order: number;
  created_at: Date;
  updated_at: Date | null;
};

let ensured = false;

export async function ensureFbIdentityTable(): Promise<void> {
  if (ensured) return;
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS fb_identity (
      id               VARCHAR(64)  NOT NULL,
      kind             VARCHAR(16)  NOT NULL DEFAULT 'personal',
      name             VARCHAR(100) NOT NULL,
      is_default       TINYINT      NOT NULL DEFAULT 0,
      is_active        TINYINT      NOT NULL DEFAULT 1,
      auth_key         VARCHAR(40)  NULL,
      page_id          VARCHAR(64)  NULL,
      page_url         VARCHAR(500) NULL,
      login_ok         TINYINT      NULL,
      login_checked_at DATETIME     NULL,
      login_note       VARCHAR(200) NULL,
      sort_order       INT          NOT NULL DEFAULT 0,
      created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME     NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // 原本就有的那個帳號 ＝ 主帳號。ON DUPLICATE KEY：已經有就完全不動（不蓋掉本人改過的名字）。
  await db.$executeRawUnsafe(
    `INSERT INTO fb_identity (id, kind, name, is_default, is_active, auth_key, sort_order)
     VALUES (?, 'personal', ?, 1, 1, NULL, 0)
     ON DUPLICATE KEY UPDATE id = id`,
    DEFAULT_IDENTITY_ID,
    DEFAULT_IDENTITY_NAME,
  );
  ensured = true;
}

export async function listIdentities(opts?: { onlyActive?: boolean }): Promise<FbIdentityRow[]> {
  await ensureFbIdentityTable();
  const rows = await db.$queryRawUnsafe<FbIdentityRow[]>(
    `SELECT * FROM fb_identity ORDER BY is_default DESC, sort_order ASC, created_at ASC`,
  );
  return opts?.onlyActive ? rows.filter((r) => r.is_active === 1) : rows;
}

/** 傳 null／空／"main" 都回主帳號。找不到（被刪了）回 null —— 呼叫端要自己決定怎麼處理，不要默默退回主帳號。 */
export async function getIdentity(id: string | null | undefined): Promise<FbIdentityRow | null> {
  await ensureFbIdentityTable();
  const key = normalizeIdentityId(id) ?? DEFAULT_IDENTITY_ID;
  const rows = await db.$queryRaw<FbIdentityRow[]>`SELECT * FROM fb_identity WHERE id = ${key} LIMIT 1`;
  return rows[0] || null;
}

export async function getDefaultIdentity(): Promise<FbIdentityRow> {
  const row = await getIdentity(DEFAULT_IDENTITY_ID);
  if (!row) throw new Error("主帳號身分不見了（fb_identity 表被動過？）");
  return row;
}

export type IdentityResult = { ok: boolean; error?: string; id?: string; authKey?: string | null };

/** 新增一個個人帳號身分。登入檔要之後在桌機用登入代號跑一次登入才有。 */
export async function createPersonalIdentity(name: string): Promise<IdentityResult> {
  await ensureFbIdentityTable();
  const clean = name.trim().slice(0, 100);
  if (!clean) return { ok: false, error: "取個名字（例：房仲蕭邦第二帳號）" };

  const existing = await listIdentities();
  if (existing.some((r) => r.name === clean)) return { ok: false, error: `已經有叫「${clean}」的身分了，換個名字` };

  // 登入代號要唯一：隨機 4 碼撞到再抽
  const used = new Set(existing.map((r) => r.auth_key).filter(Boolean));
  let authKey = makeAuthKey();
  for (let i = 0; i < 20 && used.has(authKey); i += 1) authKey = makeAuthKey();
  if (used.has(authKey)) return { ok: false, error: "產生登入代號失敗，再按一次" };

  const id = randomUUID().replace(/-/g, "");
  const order = existing.reduce((m, r) => Math.max(m, r.sort_order), 0) + 1;
  await db.$executeRawUnsafe(
    `INSERT INTO fb_identity (id, kind, name, is_default, is_active, auth_key, sort_order)
     VALUES (?, 'personal', ?, 0, 1, ?, ?)`,
    id,
    clean,
    authKey,
    order,
  );
  return { ok: true, id, authKey };
}

export async function renameIdentity(id: string, name: string): Promise<IdentityResult> {
  await ensureFbIdentityTable();
  const clean = name.trim().slice(0, 100);
  if (!clean) return { ok: false, error: "名字不能空白" };
  const all = await listIdentities();
  if (all.some((r) => r.id !== id && r.name === clean)) return { ok: false, error: `已經有叫「${clean}」的身分了` };
  await db.$executeRawUnsafe("UPDATE fb_identity SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", clean, id);
  return { ok: true, id };
}

/** 主帳號不能停用（沒有它整個系統就沒有預設身分可退）。 */
export async function setIdentityActive(id: string, active: boolean): Promise<IdentityResult> {
  await ensureFbIdentityTable();
  const row = await getIdentity(id);
  if (!row) return { ok: false, error: "找不到這個身分" };
  if (row.is_default === 1 && !active) return { ok: false, error: "主帳號不能停用" };
  await db.$executeRawUnsafe(
    "UPDATE fb_identity SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    active ? 1 : 0,
    row.id,
  );
  return { ok: true, id: row.id };
}

/**
 * 刪掉一個身分（只刪身分這一列）。擋三種情況：
 *   ・主帳號
 *   ・還有排程中／執行中的任務（刪了它們到點會找不到身分）
 *   ・名下還有社團或發過的紀錄 → 請改用「停用」，歷史紀錄才對得上是哪個帳號發的
 */
export async function deleteIdentity(id: string): Promise<IdentityResult> {
  await ensureFbIdentityTable();
  const row = await getIdentity(id);
  if (!row) return { ok: false, error: "找不到這個身分" };
  if (row.is_default === 1) return { ok: false, error: "主帳號不能刪" };

  const [tasks, groups] = await Promise.all([
    db.$queryRawUnsafe<Array<{ n: unknown }>>("SELECT COUNT(*) AS n FROM fb_task WHERE identity_id = ?", row.id),
    db.$queryRawUnsafe<Array<{ n: unknown }>>("SELECT COUNT(*) AS n FROM fb_group WHERE identity_id = ?", row.id),
  ]);
  const taskN = Number(String(tasks[0]?.n ?? 0));
  const groupN = Number(String(groups[0]?.n ?? 0));
  if (taskN > 0) return { ok: false, error: `這個身分名下有 ${taskN} 筆排程／發文紀錄，刪掉歷史就對不上了——改用「停用」` };
  if (groupN > 0) return { ok: false, error: `這個身分名下有 ${groupN} 個社團，先到「社團清單」處理掉再刪，或改用「停用」` };

  await db.$executeRawUnsafe("DELETE FROM fb_identity WHERE id = ?", row.id);
  return { ok: true, id: row.id };
}

/** 桌機 runner 回報這個身分的登入檔現在有沒有效。報錯不影響發文流程。 */
export async function reportIdentityLogin(id: string | null | undefined, ok: boolean, note?: string): Promise<void> {
  await ensureFbIdentityTable();
  const key = normalizeIdentityId(id) ?? DEFAULT_IDENTITY_ID;
  await db.$executeRawUnsafe(
    "UPDATE fb_identity SET login_ok = ?, login_checked_at = CURRENT_TIMESTAMP, login_note = ? WHERE id = ?",
    ok ? 1 : 0,
    (note || "").slice(0, 200) || null,
    key,
  );
}

export function isPersonal(row: Pick<FbIdentityRow, "kind">): boolean {
  return isIdentityKind(row.kind) && (row.kind as IdentityKind) === "personal";
}
