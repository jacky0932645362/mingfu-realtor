/**
 * 591／樂屋上架外掛的同事授權碼 —— 資料層（2026-09-12）
 *
 * 本人要把「物件上架助手」外掛給同事測試用，仿同業黃瑋凱那套「一組碼、綁電腦數、有效期限」的做法，
 * 但驗證伺服器是自己的（card-booking），不是外部服務——本人隨時能在 /admin/post591-license
 * 看誰在用、續期、停用，不用重新發外掛壓縮檔。
 *
 * 兩張表：
 *   post591_license          一組授權碼（碼、備註、可用電腦數上限、到期日、是否停用）
 *   post591_license_install  這組碼底下每一台真的用過的電腦（安裝編號、上次使用、上架次數）
 *
 * 🔴 這裡只認「安裝編號 + 授權碼」，不收物件資料、不收使用者姓名電話——外掛本來就沒有送這些東西。
 */
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "@/lib/db";

export type LicenseRow = {
  license_key: string;
  label: string;
  seat_limit: number;
  expires_at: Date;
  revoked: number;
  created_at: Date;
};

export type LicenseWithUsage = LicenseRow & { install_count: number; launch_count: number };

export type InstallRow = {
  id: string;
  license_key: string;
  install_id: string;
  version: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
  launch_count: number;
};

let tableEnsured = false;
export async function ensurePost591LicenseTables(): Promise<void> {
  if (tableEnsured) return;
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS post591_license (
      license_key  VARCHAR(32)  NOT NULL,
      label        VARCHAR(80)  NOT NULL DEFAULT '',
      seat_limit   INT          NOT NULL DEFAULT 5,
      expires_at   DATE         NOT NULL,
      revoked      TINYINT(1)   NOT NULL DEFAULT 0,
      created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (license_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS post591_license_install (
      id             VARCHAR(64)  NOT NULL,
      license_key    VARCHAR(32)  NOT NULL,
      install_id     VARCHAR(80)  NOT NULL,
      version        VARCHAR(20)  NULL,
      first_seen_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      launch_count   INT          NOT NULL DEFAULT 0,
      PRIMARY KEY (id),
      UNIQUE KEY post591_license_install_uniq (license_key, install_id),
      KEY post591_license_install_key_idx (license_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tableEnsured = true;
}

/** MF-XXXX-XXXX-XXXX，字母表刻意去掉 0/O、1/I/L 這種容易看錯、打錯的字元 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function generateLicenseKey(): string {
  const bytes = randomBytes(12);
  let out = "MF-";
  for (let i = 0; i < 12; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
    if (i === 3 || i === 7) out += "-";
  }
  return out;
}

function normalizeKey(k: string): string {
  return String(k || "").trim().toUpperCase();
}

export async function createLicense(input: { label: string; seatLimit: number; expiresAt: Date }): Promise<LicenseRow> {
  await ensurePost591LicenseTables();
  const key = generateLicenseKey();
  await db.$executeRaw`
    INSERT INTO post591_license (license_key, label, seat_limit, expires_at)
    VALUES (${key}, ${input.label.trim().slice(0, 80)}, ${Math.max(1, Math.min(500, input.seatLimit))}, ${input.expiresAt})
  `;
  const rows = await db.$queryRaw<LicenseRow[]>`SELECT * FROM post591_license WHERE license_key = ${key}`;
  return rows[0];
}

export async function listLicenses(): Promise<LicenseWithUsage[]> {
  await ensurePost591LicenseTables();
  const rows = await db.$queryRaw<Array<LicenseRow & { install_count: bigint; launch_count: bigint | null }>>`
    SELECT l.*,
           COUNT(i.id) AS install_count,
           COALESCE(SUM(i.launch_count), 0) AS launch_count
      FROM post591_license l
      LEFT JOIN post591_license_install i ON i.license_key = l.license_key
     GROUP BY l.license_key
     ORDER BY l.created_at DESC
  `;
  return rows.map((r) => ({ ...r, install_count: Number(r.install_count), launch_count: Number(r.launch_count || 0) }));
}

export async function listInstalls(key: string): Promise<InstallRow[]> {
  await ensurePost591LicenseTables();
  return db.$queryRaw<InstallRow[]>`
    SELECT * FROM post591_license_install WHERE license_key = ${normalizeKey(key)} ORDER BY last_seen_at DESC
  `;
}

export async function setRevoked(key: string, revoked: boolean): Promise<void> {
  await ensurePost591LicenseTables();
  await db.$executeRaw`UPDATE post591_license SET revoked = ${revoked ? 1 : 0} WHERE license_key = ${normalizeKey(key)}`;
}

export async function extendLicense(key: string, expiresAt: Date): Promise<void> {
  await ensurePost591LicenseTables();
  await db.$executeRaw`UPDATE post591_license SET expires_at = ${expiresAt} WHERE license_key = ${normalizeKey(key)}`;
}

export async function setSeatLimit(key: string, seatLimit: number): Promise<void> {
  await ensurePost591LicenseTables();
  await db.$executeRaw`UPDATE post591_license SET seat_limit = ${Math.max(1, Math.min(500, seatLimit))} WHERE license_key = ${normalizeKey(key)}`;
}

/** 移除一台裝置的占用名額（本人幫同事「換電腦了」騰位子用，不用整組碼重發） */
export async function removeInstall(key: string, installId: string): Promise<void> {
  await ensurePost591LicenseTables();
  await db.$executeRaw`DELETE FROM post591_license_install WHERE license_key = ${normalizeKey(key)} AND install_id = ${installId}`;
}

export async function deleteLicense(key: string): Promise<void> {
  await ensurePost591LicenseTables();
  const k = normalizeKey(key);
  await db.$executeRaw`DELETE FROM post591_license_install WHERE license_key = ${k}`;
  await db.$executeRaw`DELETE FROM post591_license WHERE license_key = ${k}`;
}

function formatDateTW(d: Date): string {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export type VerifyResult =
  | { ok: true; name: string; expiresAt: string; expiresText: string }
  | { ok: false; reason: "bad_request" | "no_key" | "revoked" | "expired" | "seat_limit"; expiresAt?: string; expiresText?: string };

/**
 * 外掛每次開啟（省流量，快取幾小時）跟每次按「上架」（一定打，用來記使用次數）都會呼叫這裡。
 * 一組碼可以綁 seat_limit 台不同的電腦（用外掛自己產生的安裝編號分辨，不是看 IP），
 * 額滿之後新的電腦要用會被擋，本人在後台把舊電腦移除或調高上限就能解。
 */
export async function verifyLicense(input: { key: string; installId: string; version?: string; event?: string }): Promise<VerifyResult> {
  const key = normalizeKey(input.key);
  const installId = String(input.installId || "").trim();
  if (!key || !installId) return { ok: false, reason: "bad_request" };
  await ensurePost591LicenseTables();

  const rows = await db.$queryRaw<LicenseRow[]>`SELECT * FROM post591_license WHERE license_key = ${key} LIMIT 1`;
  const lic = rows[0];
  if (!lic) return { ok: false, reason: "no_key" };
  if (lic.revoked) return { ok: false, reason: "revoked" };
  const expiresAt = new Date(lic.expires_at);
  const expiresText = formatDateTW(expiresAt);
  // expires_at 存的是「到期當天」，讓到期日整天都算有效，過了才擋
  const cutoff = new Date(expiresAt);
  cutoff.setHours(23, 59, 59, 999);
  if (cutoff.getTime() < Date.now()) return { ok: false, reason: "expired", expiresAt: expiresAt.toISOString(), expiresText };

  const existing = await db.$queryRaw<InstallRow[]>`
    SELECT * FROM post591_license_install WHERE license_key = ${key} AND install_id = ${installId} LIMIT 1
  `;
  if (existing.length === 0) {
    const countRows = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM post591_license_install WHERE license_key = ${key}
    `;
    if (Number(countRows[0]?.n || 0) >= lic.seat_limit) return { ok: false, reason: "seat_limit" };
    await db.$executeRaw`
      INSERT INTO post591_license_install (id, license_key, install_id, version, launch_count)
      VALUES (${randomUUID()}, ${key}, ${installId}, ${input.version || null}, ${input.event === "launch" ? 1 : 0})
    `;
  } else if (input.event === "launch") {
    await db.$executeRaw`
      UPDATE post591_license_install SET last_seen_at = CURRENT_TIMESTAMP, version = ${input.version || null}, launch_count = launch_count + 1
       WHERE license_key = ${key} AND install_id = ${installId}
    `;
  } else {
    await db.$executeRaw`
      UPDATE post591_license_install SET last_seen_at = CURRENT_TIMESTAMP, version = ${input.version || null}
       WHERE license_key = ${key} AND install_id = ${installId}
    `;
  }

  return { ok: true, name: lic.label || "", expiresAt: expiresAt.toISOString(), expiresText };
}
