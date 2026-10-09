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
  /**
   * 2026-10-09 第二段（nullable）：
   *   parent_identity_id  粉專「以粉專身分發到社團」要借哪個個人帳號的登入檔（那個帳號要是粉專管理員）。null＝這個粉專只發自己動態
   *   ext_user_id         IG／Threads 的帳號編號（粉專的編號放 page_id）
   *   ext_username        IG／Threads 的 @帳號名
   */
  parent_identity_id?: string | null;
  ext_user_id?: string | null;
  ext_username?: string | null;
  /** 備註（本人自己寫的，例：主帳號、公司粉專） */
  note?: string | null;
};

/**
 * 官方 API 的鑰匙（粉專／IG／Threads）。🔴 刻意放在另一張表：fb_identity 那張會整列送到後台畫面，
 * 鑰匙不能跟著出去。只有伺服器端（發文、續期）讀這張。
 */
export type IdentityTokenRow = {
  identity_id: string;
  access_token: string;
  token_expires_at: Date | null;
  scopes: string | null;
  connected_at: Date;
  refreshed_at: Date | null;
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
  for (const [name, def] of [
    ["parent_identity_id", "VARCHAR(64) NULL"],
    ["ext_user_id", "VARCHAR(64) NULL"],
    ["ext_username", "VARCHAR(120) NULL"],
    // 2026-10-09 本人要的表格版「備註」欄（例：主帳號、公司粉專）
    ["note", "VARCHAR(200) NULL"],
  ] as const) {
    try {
      await db.$executeRawUnsafe(`ALTER TABLE fb_identity ADD COLUMN IF NOT EXISTS ${name} ${def}`);
    } catch {
      // 舊版 MySQL 不吃 IF NOT EXISTS —— 欄位已存在時會丟，吞掉
    }
  }
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS fb_identity_token (
      identity_id      VARCHAR(64)  NOT NULL,
      access_token     TEXT         NOT NULL,
      token_expires_at DATETIME     NULL,
      scopes           VARCHAR(300) NULL,
      connected_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      refreshed_at     DATETIME     NULL,
      PRIMARY KEY (identity_id)
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
export async function createPersonalIdentity(name: string, note?: string): Promise<IdentityResult> {
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
    `INSERT INTO fb_identity (id, kind, name, is_default, is_active, auth_key, sort_order, note)
     VALUES (?, 'personal', ?, 0, 1, ?, ?, ?)`,
    id,
    clean,
    authKey,
    order,
    (note || "").trim().slice(0, 200) || null,
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

export async function setIdentityNote(id: string, note: string): Promise<IdentityResult> {
  await ensureFbIdentityTable();
  const row = await getIdentity(id);
  if (!row) return { ok: false, error: "找不到這個身分" };
  await db.$executeRawUnsafe(
    "UPDATE fb_identity SET note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    note.trim().slice(0, 200) || null,
    row.id,
  );
  return { ok: true, id: row.id };
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
  // 粉專／IG／Threads 的發文紀錄記在 fb_task_item.target_identity_id（欄位是 fb-factory 建的，還沒建過就當 0）
  const apiN = await db
    .$queryRawUnsafe<Array<{ n: unknown }>>("SELECT COUNT(*) AS n FROM fb_task_item WHERE target_identity_id = ?", row.id)
    .then((r) => Number(String(r[0]?.n ?? 0)))
    .catch(() => 0);
  if (apiN > 0) return { ok: false, error: `這個身分有 ${apiN} 筆排程／發文紀錄，刪掉歷史就對不上了——改用「停用」` };
  // 有粉專借這個個人帳號發社團的話，先解除（不然粉專會指到不存在的帳號）
  await db.$executeRawUnsafe("UPDATE fb_identity SET parent_identity_id = NULL WHERE parent_identity_id = ?", row.id);

  await db.$executeRawUnsafe("DELETE FROM fb_identity_token WHERE identity_id = ?", row.id);
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

/* ────────────────── 官方 API 身分：粉專／IG／Threads（2026-10-09 第二段） ────────────────── */

export type ApiIdentityKind = "page" | "ig" | "threads";

/**
 * 授權回來之後存身分＋鑰匙。同一個粉專／IG／Threads 帳號（用平台給的編號認）重新授權＝更新鑰匙，
 * 不會多一列；本人改過的名字不蓋掉，只更新 @帳號名、粉專網址，並重新啟用。
 */
export async function upsertApiIdentity(data: {
  kind: ApiIdentityKind;
  extId: string;
  name: string;
  username?: string | null;
  pageUrl?: string | null;
  accessToken: string;
  expiresAt: Date | null;
  scopes: string[];
}): Promise<{ id: string; created: boolean }> {
  await ensureFbIdentityTable();
  const extId = String(data.extId).trim();
  if (!extId) throw new Error("平台沒回帳號編號");
  const col = data.kind === "page" ? "page_id" : "ext_user_id";
  const found = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM fb_identity WHERE kind = ? AND ${col} = ? LIMIT 1`,
    data.kind,
    extId,
  );
  let id = found[0]?.id;
  const created = !id;
  if (id) {
    await db.$executeRawUnsafe(
      `UPDATE fb_identity SET is_active = 1, ext_username = ?, page_url = COALESCE(?, page_url), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      data.username ?? null,
      data.pageUrl ?? null,
      id,
    );
  } else {
    id = randomUUID().replace(/-/g, "");
    const existing = await listIdentities();
    const order = existing.reduce((m, r) => Math.max(m, r.sort_order), 0) + 1;
    // 名字撞到既有身分就在後面加平台，免得畫面上兩個一模一樣分不出來
    let name = (data.name || data.username || extId).trim().slice(0, 90);
    if (existing.some((r) => r.name === name)) name = `${name}（${data.kind === "page" ? "粉專" : data.kind === "ig" ? "IG" : "Threads"}）`;
    await db.$executeRawUnsafe(
      `INSERT INTO fb_identity (id, kind, name, is_default, is_active, page_id, page_url, ext_user_id, ext_username, sort_order)
       VALUES (?, ?, ?, 0, 1, ?, ?, ?, ?, ?)`,
      id,
      data.kind,
      name,
      data.kind === "page" ? extId : null,
      data.pageUrl ?? null,
      data.kind === "page" ? null : extId,
      data.username ?? null,
      order,
    );
  }
  await db.$executeRawUnsafe(
    `INSERT INTO fb_identity_token (identity_id, access_token, token_expires_at, scopes, connected_at, refreshed_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, NULL)
     ON DUPLICATE KEY UPDATE access_token = VALUES(access_token), token_expires_at = VALUES(token_expires_at),
       scopes = VALUES(scopes), connected_at = CURRENT_TIMESTAMP, refreshed_at = NULL`,
    id,
    data.accessToken,
    data.expiresAt,
    data.scopes.join(",").slice(0, 300),
  );
  return { id, created };
}

/** 伺服器端專用：拿某個身分的官方 API 鑰匙。沒有回 null。 */
export async function getIdentityToken(id: string): Promise<IdentityTokenRow | null> {
  await ensureFbIdentityTable();
  const rows = await db.$queryRawUnsafe<IdentityTokenRow[]>("SELECT * FROM fb_identity_token WHERE identity_id = ? LIMIT 1", id);
  return rows[0] || null;
}

export async function updateIdentityToken(id: string, accessToken: string, expiresAt: Date | null): Promise<void> {
  await ensureFbIdentityTable();
  await db.$executeRawUnsafe(
    "UPDATE fb_identity_token SET access_token = ?, token_expires_at = ?, refreshed_at = CURRENT_TIMESTAMP WHERE identity_id = ?",
    accessToken,
    expiresAt,
    id,
  );
}

/** 給畫面看的鑰匙狀態（不含鑰匙本體）。 */
export async function identityTokenStatus(): Promise<Map<string, { expiresAt: Date | null; connectedAt: Date; refreshedAt: Date | null }>> {
  await ensureFbIdentityTable();
  const rows = await db.$queryRawUnsafe<Array<{ identity_id: string; token_expires_at: Date | null; connected_at: Date; refreshed_at: Date | null }>>(
    "SELECT identity_id, token_expires_at, connected_at, refreshed_at FROM fb_identity_token",
  );
  return new Map(rows.map((r) => [r.identity_id, { expiresAt: r.token_expires_at, connectedAt: r.connected_at, refreshedAt: r.refreshed_at }]));
}

/**
 * 粉專「以粉專身分發到社團」要借哪個個人帳號的登入檔。傳 null＝不發社團（只發粉專動態）。
 * 🔴 只准指到「個人帳號、啟用中」；那個帳號是不是真的是粉專管理員，網站驗不到，要桌機實測（見「檢查粉專身分」批次檔）。
 */
export async function setPageParent(pageIdentityId: string, parentId: string | null): Promise<IdentityResult> {
  await ensureFbIdentityTable();
  const page = await getIdentity(pageIdentityId);
  if (!page || page.kind !== "page") return { ok: false, error: "找不到這個粉專身分" };
  if (parentId) {
    const parent = await getIdentity(parentId);
    if (!parent || parent.kind !== "personal") return { ok: false, error: "只能選個人帳號" };
    if (parent.is_active !== 1) return { ok: false, error: `「${parent.name}」已停用` };
  }
  await db.$executeRawUnsafe(
    // 換了借用的帳號＝上一次「粉專身分檢查」的結果不算數了，清掉讓畫面顯示「還沒檢查」
    "UPDATE fb_identity SET parent_identity_id = ?, login_ok = NULL, login_checked_at = NULL, login_note = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    parentId ? parentId : null,
    page.id,
  );
  return { ok: true, id: page.id };
}
