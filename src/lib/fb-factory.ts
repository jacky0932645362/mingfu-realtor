/**
 * FB 貼文工廠 — 資料層（2026-09-03）
 *
 * ⚠️ 這個模組**接的是另一台電腦已經建好的表**，不是新設計的。
 *    另一台跑了「FB 貼文工廠」的後台，四張表已經在同一顆 TiDB 上：
 *
 *      fb_draft       一則文案（facts_json ＋ post_text ＋ marketplace_json ＋ 兩個 status）
 *      fb_group       要貼的社團（name / url / accepts / is_active / cooldown_days / last_posted_at）
 *      fb_task        一個排程任務的表頭（draft_id / title / run_at / status / channel）
 *      fb_task_item   任務底下每一個目標（channel = self|group、status、done_at、sort_order）
 *
 *    這個檔**只讀寫這四張的既有欄位**，不 ALTER、不改語意。
 *    執行器（桌機 runner）自己的記帳放在獨立的 fb_task_run，不碰別人的表。
 *
 * 🔴 enum 值另一台的程式碼必須跟這裡一致（目前資料庫裡每個欄位都只有一種值，猜不到全集）：
 *      fb_draft.*_status   : draft | scheduled | posted
 *      fb_task.status      : pending | running | done | failed | cancelled | expired
 *      fb_task_item.status : pending | posted | skipped | failed
 *      fb_task.channel     : post | marketplace
 *      fb_task_item.channel: self | group
 *      fb_group.accepts    : both | post | marketplace
 *
 * ══════════════════════════════════════════════════════════════
 * 📌 自動發文是「遙控器 ＋ 桌機」兩段式：
 *      這個網站  →  只把「幾點發什麼到哪」寫進 fb_task / fb_task_item
 *      桌機 runner →  撈到期的、用 Playwright 真的發、回寫 status
 *    Vercel 上跑不了瀏覽器、沒有 FB cookie，所以發文的手一定在桌機。
 *    發文引擎沿用 tools/fb-autopost/（打完字對答案、擋 Markdown、90 分鐘間隔都已跑通）。
 * ══════════════════════════════════════════════════════════════
 */
import { db } from "@/lib/db";
// 🔴 要走 @/ 別名不能寫 ./fb-humanize：桌機 runner 是用裸 node 直接 import 這個 .ts 檔，只有 @/ 會被 registerAliasHooks 接成 .ts
import { rollJitterSec } from "@/lib/fb-humanize";
import { deriveIgCaption, deriveThreadsText } from "@/lib/fb-social-copy";
import { rhythmHold, type RhythmSnapshot, type RhythmChannel } from "@/lib/fb-rhythm";
import { ensureFbIdentityTable } from "@/lib/fb-identity";
import { normalizeIdentityId, identityIdForDisplay } from "@/lib/fb-identity-core";
import { randomUUID } from "node:crypto";

/* ────────────────── 通路 ────────────────── */

/**
 * 兩條通路：一般貼文（個人主頁＋社團，共用 post_text）、Marketplace（marketplace_json）。
 * fb_draft 沒有獨立的 group_text 欄位 —— 現役設計是社團跟主頁貼同一份 post_text。
 */
export const FB_CHANNELS = [
  { key: "post", label: "一般貼文", icon: "megaphone" },
  { key: "marketplace", label: "Marketplace", icon: "cart" },
] as const;

export type FbChannel = "post" | "marketplace";

export function channelLabel(key: string): string {
  return FB_CHANNELS.find((c) => c.key === key)?.label || key;
}

export function isChannel(v: unknown): v is FbChannel {
  return v === "post" || v === "marketplace";
}

/* ────────────────── IG／Threads（2026-09-21，本人：「發文也想要分享到 IG 跟 Threads」） ──────────────────
 *
 * 不是新通路（fb_task.channel 仍然只有 post｜marketplace），是一般貼文任務底下**多兩種目標**：
 * fb_task_item.channel = 'ig' | 'threads'（跟 'self'｜'group' 並列）。
 * 這樣排程頁的「要貼到哪些地方」多兩個勾勾就好，執行紀錄／進度 N/M 也自動算進去。
 * 文案各自一版存在 fb_draft.social_json（沒存過就從 post_text 推導）。
 * 真的發是走官方 API（Instagram API with Instagram Login／Threads API），不是 Playwright ——
 * 見 src/lib/social-publish.ts。
 */
export const SOCIAL_PLATFORMS = [
  { key: "ig", label: "Instagram", icon: "camera" },
  { key: "threads", label: "Threads", icon: "threads" },
] as const;

export type SocialPlatform = "ig" | "threads";

export function isSocialPlatform(v: unknown): v is SocialPlatform {
  return v === "ig" || v === "threads";
}

export function socialLabel(key: string): string {
  return SOCIAL_PLATFORMS.find((c) => c.key === key)?.label || key;
}

/** 一個平台的版本：內文＋發了沒。edited=true 代表本人改過、之後不再用推導值蓋。 */
export type SocialVersion = {
  text: string;
  edited: boolean;
  status: "draft" | "posted";
  url: string | null;
  postedAt: string | null;
};

export type SocialPayload = Partial<Record<SocialPlatform, SocialVersion>>;

/** fb_task_item 的目標顯示名。self／group 是 FB，ig／threads 是 2026-09-21 加的。 */
export function itemTargetName(itemChannel: string, groupName?: string | null): string {
  if (itemChannel === "self") return "自己的 FB 動態";
  if (itemChannel === "ig") return "Instagram";
  if (itemChannel === "threads") return "Threads";
  if (itemChannel === "page") return "粉專動態";
  return groupName || "社團";
}

/** 這個 item 是不是 FB 上的（自己的動態／社團）。IG／Threads 不算。 */
export function isFbItem(itemChannel: string): boolean {
  return itemChannel === "self" || itemChannel === "group";
}

/** fb_draft 上對應這個通路的 status 欄位名。 */
function statusColumn(channel: FbChannel): "post_status" | "marketplace_status" {
  return channel === "post" ? "post_status" : "marketplace_status";
}

/* ────────────────── 型別（照資料庫實際欄位） ────────────────── */

export type FbDraftRow = {
  id: string;
  title: string;
  kind: string;
  source_property_id: string | null;
  property_url: string | null;
  facts_json: string | null;
  post_text: string | null;
  marketplace_json: string | null;
  post_status: string;
  marketplace_status: string;
  post_url: string | null;
  marketplace_url: string | null;
  /** IG／Threads 版本（2026-09-21 這台加的欄位，nullable；另一台的程式碼不會被影響）。 */
  social_json?: string | null;
  /** 2026-10-05 太平洋官網綁定與檢查結果（nullable，另一台的程式碼看不到也不受影響） */
  pacific_url?: string | null;
  pacific_baseline?: string | null;
  pacific_status?: string | null;
  pacific_note?: string | null;
  pacific_checked_at?: Date | null;
  board_archived_at?: Date | null;
  /** 2026-10-05 自動重新曝光（見 src/lib/fb-recycle.ts） */
  recycle_enabled?: number | null;
  recycle_state?: string | null;
  recycle_json?: string | null;
  recycle_note?: string | null;
  recycle_started_at?: Date | null;
  created_at: Date;
  updated_at: Date | null;
};

export type FbGroupRow = {
  id: string;
  name: string;
  url: string;
  /** 2026-10-07 發文身分：這個社團是哪個身分的清單。null＝主帳號（舊資料都是 null）。 */
  identity_id?: string | null;
  note: string | null;
  cooldown_days: number;
  is_active: number;
  last_posted_at: Date | null;
  accepts: string;
  /** 社團人數（已換算成整數，「14.3 萬」→ 143000）。桌機 list-groups.mjs 抓的。 */
  member_count: number | null;
  /** public / private */
  privacy: string | null;
  /** 1 = 貼文要管理員審核（「送出去」不等於「上架了」） */
  needs_approval: number | null;
  /** 1 = 有「討論」分頁（可發一般貼文） */
  has_discussion: number | null;
  /** 1 = 有「商品買賣」分頁（可上架 Marketplace 商品） */
  has_marketplace: number | null;
  /** 1 = 封存（從清單收起來，不顯示、不能選來發文；重抓不會把它叫回來） */
  hidden: number | null;
  /** 抓過一次的時間（null = 還沒跑過 enrich） */
  scanned_at: Date | null;
  created_at: Date;
  updated_at: Date | null;
};

export type FbTaskRow = {
  id: string;
  draft_id: string;
  title: string;
  run_at: Date;
  status: string;
  channel: string;
  /** 2026-10-07 發文身分：用哪個身分發。null＝主帳號（舊資料都是 null）。 */
  identity_id?: string | null;
  created_at: Date;
  updated_at: Date | null;
};

export type FbTaskItemRow = {
  id: string;
  task_id: string;
  channel: string;
  group_id: string | null;
  group_name: string | null;
  group_url: string | null;
  status: string;
  note: string | null;
  done_at: Date | null;
  sort_order: number;
  /** 2026-10-09：粉專動態／IG／Threads 目標發到哪一個身分（NULL＝舊資料） */
  target_identity_id?: string | null;
};

/** 這個 item 是不是走官方 API 的（粉專動態／IG／Threads）——runner 認領後先用 API 發，不開瀏覽器。 */
export function isApiItem(itemChannel: string): boolean {
  return itemChannel === "page" || itemChannel === "ig" || itemChannel === "threads";
}

/** runner 的私有記帳，1:1 對 fb_task。這是唯一一張「我建的」表。 */
export type FbTaskRunRow = {
  task_id: string;
  claimed_at: Date | null;
  claimed_by: string | null;
  attempts: number;
  last_error: string | null;
  expires_at: Date | null;
  auto_publish: number;
  /** Marketplace 專用：到點除了上架 Marketplace 本身，還要不要照 draft 的 groupIds 一起勾社團。 */
  crosspost: number;
  /** 擬真模式：排程時抽好的抖動秒數。runner 要等到 run_at ＋ 這個秒數才撈得到（2026-09-18）。 */
  jitter_sec: number;
  finished_at: Date | null;
};

/**
 * 自動刪文（2026-09-05）。跟 fb_task 不一樣的地方：目標不是排程當下選好的，
 * 是桌機執行時去 FB「活動紀錄」用內文比對現找的，所以沒有 xxx_item 這種明細表，
 * 結果整批記在 fb_delete_task_run 的 result_json。這兩張都是這個網站自己建的。
 */
export type FbDeleteTaskRow = {
  id: string;
  draft_id: string;
  title: string;
  match_text: string;
  max_items: number;
  older_than_days: number | null;
  run_at: Date;
  status: string;
  /** 2026-09-19：限定只清這一個社團的（跟 match_text 是 AND 關係，不是取代）。null＝不限社團（原本的「按工作流清空」）。 */
  group_id: string | null;
  /** 2026-10-07 發文身分：用哪個帳號的登入去刪（刪文只刪「登入的那個帳號自己發的」）。null＝主帳號。 */
  identity_id?: string | null;
  created_at: Date;
  updated_at: Date | null;
};

export type FbDeleteTaskRunRow = {
  task_id: string;
  claimed_at: Date | null;
  claimed_by: string | null;
  attempts: number;
  last_error: string | null;
  expires_at: Date | null;
  auto_confirm: number;
  finished_at: Date | null;
  deleted_count: number | null;
  skipped_count: number | null;
  result_json: string | null;
};

/* ────────────────── 建表（只建自己的那張） ────────────────── */

let ensured = false;

export async function ensureFbRunnerTable(): Promise<void> {
  if (ensured) return;
  // 只有這張是我建的。四張現役表由另一台的程式碼負責建，這裡不碰。
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS fb_task_run (
      task_id      VARCHAR(64)  NOT NULL,
      claimed_at   DATETIME     NULL,
      claimed_by   VARCHAR(80)  NULL,
      attempts     INT          NOT NULL DEFAULT 0,
      last_error   VARCHAR(500) NULL,
      expires_at   DATETIME     NULL,
      auto_publish TINYINT(1)   NOT NULL DEFAULT 1,
      crosspost    TINYINT(1)   NOT NULL DEFAULT 0,
      jitter_sec   INT          NOT NULL DEFAULT 0,
      finished_at  DATETIME     NULL,
      PRIMARY KEY (task_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // 舊資料庫已經有 fb_task_run 但沒有後來加的欄位 —— 補上（都是 additive、有預設值，舊資料不受影響）：
  //   crosspost（Phase 4，2026-09-06）、jitter_sec（擬真模式，2026-09-18）
  for (const def of [
    "crosspost TINYINT(1) NOT NULL DEFAULT 0",
    "jitter_sec INT NOT NULL DEFAULT 0",
  ]) {
    try {
      await db.$executeRawUnsafe(`ALTER TABLE fb_task_run ADD COLUMN IF NOT EXISTS ${def}`);
    } catch {
      // 舊版 MySQL 不吃 IF NOT EXISTS —— 欄位已存在時這裡會丟，吞掉即可
    }
  }
  ensured = true;
}

/**
 * 現役四張表若還沒被另一台建過（例如只在這台開發），這裡補一份**與另一台一致**的定義。
 * 全 `IF NOT EXISTS` —— 已經存在就完全不動，欄位以另一台為準。
 */
export async function ensureFbCoreTables(): Promise<void> {
  // 🔴 這幾條的欄位定義**照 2026-09-03 觀察到的線上實際結構抄的**（另一台建的），
  //    尤其 facts_json / post_text / marketplace_json 是 NOT NULL、updated_at 有 default。
  //    全 IF NOT EXISTS：線上已經有就完全不動，這裡只保證「全新資料庫也長一樣」。
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS fb_draft (
      id                 VARCHAR(64)  NOT NULL,
      title              VARCHAR(300) NOT NULL,
      kind               VARCHAR(24)  NOT NULL DEFAULT 'listing',
      source_property_id VARCHAR(64)  NULL,
      property_url        VARCHAR(500) NULL,
      facts_json         LONGTEXT     NOT NULL,
      post_text          LONGTEXT     NOT NULL,
      marketplace_json   LONGTEXT     NOT NULL,
      post_status        VARCHAR(16)  NOT NULL DEFAULT 'draft',
      marketplace_status VARCHAR(16)  NOT NULL DEFAULT 'draft',
      post_url           VARCHAR(500) NULL,
      marketplace_url    VARCHAR(500) NULL,
      created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS fb_group (
      id             VARCHAR(64)  NOT NULL,
      name           VARCHAR(200) NOT NULL,
      url            VARCHAR(500) NOT NULL,
      note           VARCHAR(300) NULL,
      cooldown_days  INT          NOT NULL DEFAULT 7,
      is_active      TINYINT      NOT NULL DEFAULT 1,
      last_posted_at DATETIME     NULL,
      accepts        VARCHAR(16)  NOT NULL DEFAULT 'both',
      created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS fb_task (
      id         VARCHAR(64)  NOT NULL,
      draft_id   VARCHAR(64)  NOT NULL,
      title      VARCHAR(300) NOT NULL,
      run_at     DATETIME     NOT NULL,
      status     VARCHAR(16)  NOT NULL DEFAULT 'pending',
      channel    VARCHAR(16)  NOT NULL DEFAULT 'post',
      created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS fb_task_item (
      id         VARCHAR(64)  NOT NULL,
      task_id    VARCHAR(64)  NOT NULL,
      channel    VARCHAR(16)  NOT NULL,
      group_id   VARCHAR(64)  NULL,
      group_name VARCHAR(200) NULL,
      group_url  VARCHAR(500) NULL,
      status     VARCHAR(16)  NOT NULL DEFAULT 'pending',
      note       VARCHAR(300) NULL,
      done_at    DATETIME     NULL,
      sort_order INT          NOT NULL DEFAULT 0,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureFbGroupColumns();
  await ensureFbTaskItemColumns();
  await ensureFbDraftColumns();
  await ensureFbRunnerTable();
  await ensureFbDeleteTables();
  await ensureFbIdentityTable();
  await ensureFbIdentityColumns();
}

/**
 * 發文身分（2026-10-07）：fb_task／fb_group 各加一欄 identity_id。
 * nullable、不設預設值——舊資料與「另一台」的程式碼寫進來的都是 NULL，
 * NULL ＝ 主帳號（見 fb-identity-core.ts），所以什麼都不用回填、不會有任何舊資料變樣。
 */
let identityColsEnsured = false;
async function ensureFbIdentityColumns(): Promise<void> {
  if (identityColsEnsured) return;
  for (const table of ["fb_task", "fb_group"]) {
    try {
      await db.$executeRawUnsafe(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS identity_id VARCHAR(64) NULL`);
    } catch {
      // 舊版 MySQL 不吃 IF NOT EXISTS —— 欄位已存在時這裡會丟，吞掉即可
    }
  }
  identityColsEnsured = true;
}

/** fb_draft 後加的欄位（2026-09-21）：IG／Threads 版本。nullable、只加不改。 */
let draftColsEnsured = false;
async function ensureFbDraftColumns(): Promise<void> {
  if (draftColsEnsured) return;
  try {
    await db.$executeRawUnsafe("ALTER TABLE fb_draft ADD COLUMN IF NOT EXISTS social_json LONGTEXT NULL");
  } catch {
    // 舊版 MySQL 不吃 IF NOT EXISTS —— 欄位已存在時這裡會丟，吞掉即可
  }
  // 2026-10-05 上架／下架看板第二階段：綁太平洋官網物件頁，每天檢查還在不在（下架＝多半已成交）
  for (const [name, def] of [
    ["pacific_url", "VARCHAR(300) NULL"],
    ["pacific_baseline", "TEXT NULL"],
    ["pacific_status", "VARCHAR(20) NULL"],
    ["pacific_note", "VARCHAR(500) NULL"],
    ["pacific_checked_at", "DATETIME NULL"],
    ["board_archived_at", "DATETIME NULL"],
    // 第三階段（2026-10-05）：自動重新曝光＝到期先刪社團舊文、刪完再重貼同一批社團
    ["recycle_enabled", "TINYINT NULL"],
    ["recycle_state", "VARCHAR(20) NULL"],
    ["recycle_json", "TEXT NULL"],
    ["recycle_note", "VARCHAR(500) NULL"],
    ["recycle_started_at", "DATETIME NULL"],
  ] as const) {
    try {
      await db.$executeRawUnsafe(`ALTER TABLE fb_draft ADD COLUMN IF NOT EXISTS ${name} ${def}`);
    } catch {
      // 同上
    }
  }
  draftColsEnsured = true;
}

/**
 * fb_task_item 後加的欄位（2026-09-20）：自動刪文真的把某一篇刪掉之後，把那一列標起來，
 * 「按社團清空」／「按工作流清空」的篇數才會跟著減少、不會清完還一直顯示 N 篇。
 * 跟 fb_group 那批一樣 ADD COLUMN IF NOT EXISTS、全 nullable，另一台的程式碼不會被影響。
 */
let taskItemColsEnsured = false;
async function ensureFbTaskItemColumns(): Promise<void> {
  if (taskItemColsEnsured) return;
  for (const [name, def] of [
    ["deleted_at", "DATETIME NULL"],
    ["delete_task_id", "VARCHAR(64) NULL"],
    // 2026-10-09：粉專動態／IG／Threads 目標要發到哪一個身分（多組帳號）。NULL＝舊資料（當時只有一組）
    ["target_identity_id", "VARCHAR(64) NULL"],
  ] as Array<[string, string]>) {
    try {
      await db.$executeRawUnsafe(`ALTER TABLE fb_task_item ADD COLUMN IF NOT EXISTS ${name} ${def}`);
    } catch {
      // 舊版 MySQL 不吃 IF NOT EXISTS —— 欄位已存在時這裡會丟，吞掉即可
    }
  }
  taskItemColsEnsured = true;
}

/** 自動刪文的兩張表，全新設計、這個網站自己建，沒有另一台的相容性包袱。 */
let deleteTablesEnsured = false;
export async function ensureFbDeleteTables(): Promise<void> {
  if (deleteTablesEnsured) return;
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS fb_delete_task (
      id              VARCHAR(64)  NOT NULL,
      draft_id        VARCHAR(64)  NOT NULL,
      title           VARCHAR(300) NOT NULL,
      match_text      VARCHAR(500) NOT NULL,
      max_items       INT          NOT NULL DEFAULT 15,
      older_than_days INT          NULL,
      run_at          DATETIME     NOT NULL,
      status          VARCHAR(16)  NOT NULL DEFAULT 'pending',
      created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // 2026-09-19：additive 補一欄。「按社團清空」用得到——限定只處理這一個社團的活動紀錄，
  // 跟 match_text（內文比對）是 AND 關係，不是取代它（避免只給社團、沒給內文比對，
  // 把使用者在那個社團手動發的其他貼文也一起刪掉）。舊資料全部是 null＝不限社團（原本的行為）。
  try {
    await db.$executeRawUnsafe(`ALTER TABLE fb_delete_task ADD COLUMN IF NOT EXISTS group_id VARCHAR(64) NULL`);
  } catch {
    // 舊版 MySQL 不吃 IF NOT EXISTS —— 欄位已存在時這裡會丟，吞掉即可
  }
  // 2026-10-07 發文身分：刪文要用「當初發文的那個帳號」的登入去刪（活動紀錄只看得到登入帳號自己發的）。
  // 舊資料全部 null＝主帳號。
  try {
    await db.$executeRawUnsafe(`ALTER TABLE fb_delete_task ADD COLUMN IF NOT EXISTS identity_id VARCHAR(64) NULL`);
  } catch {
    // 同上
  }
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS fb_delete_task_run (
      task_id       VARCHAR(64)  NOT NULL,
      claimed_at    DATETIME     NULL,
      claimed_by    VARCHAR(80)  NULL,
      attempts      INT          NOT NULL DEFAULT 0,
      last_error    VARCHAR(500) NULL,
      expires_at    DATETIME     NULL,
      auto_confirm  TINYINT(1)   NOT NULL DEFAULT 1,
      finished_at   DATETIME     NULL,
      deleted_count INT          NULL,
      skipped_count INT          NULL,
      result_json   LONGTEXT     NULL,
      PRIMARY KEY (task_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  deleteTablesEnsured = true;
}

/**
 * fb_group 後加的欄位（member_count / privacy / needs_approval / scanned_at）。
 * `CREATE TABLE IF NOT EXISTS` 不會補欄位，所以用 ADD COLUMN IF NOT EXISTS（TiDB 支援）。
 * 全部 nullable —— 桌機 `list-groups.mjs` 跑過 enrich 才會有值。
 */
let groupColsEnsured = false;
async function ensureFbGroupColumns(): Promise<void> {
  if (groupColsEnsured) return;
  const cols: Array<[string, string]> = [
    ["member_count", "INT NULL"],
    ["privacy", "VARCHAR(16) NULL"],
    ["needs_approval", "TINYINT NULL"],
    ["has_discussion", "TINYINT NULL"],
    ["has_marketplace", "TINYINT NULL"],
    ["hidden", "TINYINT NULL DEFAULT 0"],
    ["scanned_at", "DATETIME NULL"],
  ];
  for (const [name, def] of cols) {
    try {
      await db.$executeRawUnsafe(`ALTER TABLE fb_group ADD COLUMN IF NOT EXISTS ${name} ${def}`);
    } catch {
      // 舊版 MySQL 不吃 IF NOT EXISTS —— 欄位已存在時這裡會丟，吞掉即可
    }
  }
  groupColsEnsured = true;
}

/* ────────────────── 小工具 ────────────────── */

export function splitLines(raw: string | null): string[] {
  return (raw || "")
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 抓文案第一行（鉤子）當自動刪文的比對指紋 —— 跟桌機 `delete-groups.mjs --from-post`
 * 挑指紋的邏輯一致（同一篇發到 N 個社團，內文開頭都一樣，比對得到全部分身）。
 */
export function firstLineForMatch(postText: string | null): string {
  return (postText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean) || "";
}

/** 從 FB 社團網址拆出社團編號，用來判「同一個社團」（有沒有結尾斜線／?ref= 都算同一個）。 */
export function parseGroupKey(rawUrl: string): string {
  const url = (rawUrl || "").trim();
  const m = url.match(/(?:facebook|fb)\.com\/groups\/([^/?#\s]+)/i);
  if (m) return decodeURIComponent(m[1]).toLowerCase();
  return url.toLowerCase().replace(/\/+$/, "");
}

export function normalizeGroupUrl(rawUrl: string): string {
  const url = (rawUrl || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (/^(?:www\.|m\.|web\.)?(?:facebook|fb)\.com\//i.test(url)) return `https://${url}`;
  if (/^\d{5,}$/.test(url)) return `https://www.facebook.com/groups/${url}`;
  return url;
}

/**
 * 日期一律自己組字串，不用 `Intl.DateTimeFormat("zh-TW")` ——
 * 那個格式化「上午/下午」時 Node（SSR）吐 U+2009、瀏覽器吐一般空格，觸發 hydration mismatch。
 */
export function fmtDateTime(d: Date | string | null): string {
  if (!d) return "—";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}/${p(t.getMonth() + 1)}/${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

export function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}/${p(t.getMonth() + 1)}/${p(t.getDate())}`;
}

/**
 * `<input type="datetime-local">` 的值 → Date（當本地時間逐段組，不要 `new Date(字串)`）。
 */
export function parseLocalDateTime(value: string): Date | null {
  const m = (value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toLocalInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ────────────────── facts_json / marketplace_json ────────────────── */

export type DraftFacts = {
  title?: string | null;
  communityName?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  totalPriceWan?: number | null;
  unitPriceWan?: number | null;
  areaPing?: number | null;
  mainAreaPing?: number | null;
  layout?: string | null;
  floorInfo?: string | null;
  buildingType?: string | null;
  ageText?: string | null;
  parking?: string | null;
  features?: string[];
  note?: string | null;
  /**
   * 手動填的文案自己帶的照片網址（第一張＝封面）。
   * 從物件庫產的文案不用這個 —— 照片走 source_property_id 那條。
   */
  photos?: string[];
  /**
   * 這篇要附的影片（2026-09-22，一支就好）。網址或桌機路徑都收，跟 photos 同一顆 FB 上傳欄位
   * 一起塞（selectors.json 已驗證那顆 input 的 accept 同時吃圖片與影片）。
   * 跟 photos 不一樣的地方：不管是不是從物件庫產的文案，這個欄位一律可以編輯——
   * 物件庫本身的影片是 YouTube 連結（給官網嵌入用），不是能下載的檔案本體，FB 這裡用不到。
   */
  video?: string | null;
};

export type MarketplacePayload = {
  title: string;
  priceTwd: number | null;
  description: string;
  location: string;
  /**
   * FB Marketplace 的「狀況」（全新／二手 - 近全新／二手 - 良好／二手 - 普通）。
   * 房子沒有一個選項是對的，FB 還是強制要選——2026-09-06 起改成寫文案的時候就要選好
   * （本人要求），不要留到 `post-marketplace.mjs` 跑的時候才用暫定值頂著。
   */
  condition?: string;
  fields: {
    propertyType?: string | null;
    layout?: string | null;
    areaPing?: number | null;
    floorInfo?: string | null;
  };
  /**
   * 打算在 FB「在更多地方上架」（= 刊登流程第二步 ?step=audience）勾的社團（fb_group.id 陣列）。
   * 2026-09-05 新增時只是後台幫你先想好、記起來的清單；2026-09-06 起，桌機
   * `post-marketplace.mjs --publish --crosspost` 會真的讀這個清單去 FB 畫面上勾選（Phase 3）。
   * 這個網頁後台本身仍然不會自動幫你勾——要去桌機手動跑那支工具。
   */
  groupIds?: string[];
};

export function parseFacts(raw: string | null): DraftFacts {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as DraftFacts;
  } catch {
    return {};
  }
}

export function parseMarketplace(raw: string | null): MarketplacePayload | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MarketplacePayload;
  } catch {
    return null;
  }
}

/* ────────────────── 文案（fb_draft） ────────────────── */

export type DraftQueue = "all" | "todo" | "done";

export type FbDraftInput = {
  title: string;
  sourcePropertyId: string | null;
  propertyUrl: string | null;
  facts: DraftFacts;
  postText: string;
  marketplace: MarketplacePayload | null;
};

export async function createFbDraft(data: FbDraftInput): Promise<string> {
  await ensureFbCoreTables();
  const id = randomUUID().replace(/-/g, "");
  // marketplace_json 是 NOT NULL —— 沒有 Marketplace 版本就存空字串（不是 null）。
  // parseMarketplace('') 會回 null，listFbDrafts 的 marketplace queue 也用 <> '' 過濾掉。
  await db.$executeRawUnsafe(
    `INSERT INTO fb_draft
       (id, title, kind, source_property_id, property_url, facts_json, post_text,
        marketplace_json, post_status, marketplace_status, created_at, updated_at)
     VALUES (?, ?, 'listing', ?, ?, ?, ?, ?, 'draft', 'draft', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    id,
    data.title.slice(0, 300),
    data.sourcePropertyId,
    data.propertyUrl,
    JSON.stringify(data.facts),
    data.postText,
    data.marketplace ? JSON.stringify(data.marketplace) : "",
  );
  return id;
}

export async function listFbDrafts(opts?: {
  channel?: FbChannel;
  queue?: DraftQueue;
  limit?: number;
}): Promise<FbDraftRow[]> {
  await ensureFbCoreTables();
  const channel: FbChannel = opts?.channel || "post";
  const col = statusColumn(channel);

  const filters: string[] = ["1=1"];
  const queue = opts?.queue || "all";
  if (queue === "todo") filters.push(`${col} = 'draft'`);
  else if (queue === "done") filters.push(`${col} <> 'draft'`);
  if (channel === "marketplace") filters.push("marketplace_json IS NOT NULL AND marketplace_json <> ''");

  return db.$queryRawUnsafe<FbDraftRow[]>(
    `SELECT * FROM fb_draft WHERE ${filters.join(" AND ")}
      ORDER BY created_at DESC LIMIT ?`,
    Math.min(opts?.limit || 200, 500),
  );
}

export async function getFbDraft(id: string): Promise<FbDraftRow | null> {
  await ensureFbCoreTables();
  const rows = await db.$queryRaw<FbDraftRow[]>`SELECT * FROM fb_draft WHERE id = ${id} LIMIT 1`;
  return rows[0] || null;
}

/** 疊一塊 patch 進 marketplace_json，缺的欄位補空殼。一般貼文的 post_text 是獨立欄位，不會被這個動到。 */
async function patchMarketplace(id: string, patch: Partial<MarketplacePayload>): Promise<void> {
  const mp = parseMarketplace((await getFbDraft(id))?.marketplace_json ?? null);
  const next: MarketplacePayload = {
    title: mp?.title ?? "",
    priceTwd: mp?.priceTwd ?? null,
    description: mp?.description ?? "",
    location: mp?.location ?? "",
    condition: mp?.condition ?? "",
    fields: mp?.fields ?? {},
    groupIds: mp?.groupIds ?? [],
    ...patch,
  };
  await db.$executeRawUnsafe(
    "UPDATE fb_draft SET marketplace_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    JSON.stringify(next),
    id,
  );
}

export async function updateDraftText(
  id: string,
  channel: FbChannel,
  text: string,
): Promise<void> {
  await ensureFbCoreTables();
  if (channel === "post") {
    await db.$executeRawUnsafe(
      "UPDATE fb_draft SET post_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      text,
      id,
    );
  } else {
    await patchMarketplace(id, { description: text });
  }
}

/**
 * Marketplace 的價格是獨立欄位（`marketplace_json.priceTwd`），跟一般貼文的 post_text
 * 完全分開存 —— 改這裡不會動到一般貼文裡寫的價格，反之亦然（2026-09-05 本人要求兩邊分開改）。
 */
export async function updateMarketplacePrice(id: string, priceTwd: number | null): Promise<void> {
  await ensureFbCoreTables();
  await patchMarketplace(id, { priceTwd });
}

/** FB 開放的「狀況」選項，2026-09-06 實抄畫面確認只有這 4 個，不用捲動。 */
export const MARKETPLACE_CONDITIONS = ["全新", "二手 - 近全新", "二手 - 良好", "二手 - 普通"] as const;

export async function updateMarketplaceCondition(id: string, condition: string): Promise<void> {
  await ensureFbCoreTables();
  await patchMarketplace(id, { condition });
}

/**
 * Marketplace 的標題。跟價格／狀況同一個道理：這是**獨立欄位**，
 * 改它不會動到一般貼文的內文（一般貼文沒有「標題」這種東西，整篇都是 post_text）。
 * 2026-09-08 補上編輯介面 —— 在這之前畫面上只有唯讀顯示＋複製鈕，想改沒地方改。
 */
export async function updateMarketplaceTitle(id: string, title: string): Promise<void> {
  await ensureFbCoreTables();
  await patchMarketplace(id, { title });
}

/**
 * Marketplace 的地點。⚠️ 這格主要是給你自己看／複製用 ——
 * 桌機 `post-marketplace.mjs` 實際打進 FB 地點欄的是 `facts_json` 的 city＋district
 * （2026-09-06 拍板：FB 那欄是地區級自動完成，只填「台中市梧棲區」，不填到路名），
 * 只有 facts 沒有 city/district 時才會退回用這格。
 */
export async function updateMarketplaceLocation(id: string, location: string): Promise<void> {
  await ensureFbCoreTables();
  await patchMarketplace(id, { location });
}

/**
 * 記下「打算在 FB 上架時勾哪些社團」。這個函式本身只寫資料庫，不會替他去 FB 按任何東西——
 * 真的勾選是桌機 post-marketplace.mjs --crosspost 讀這筆資料去做（見 groupIds 欄位註解）。
 */
export async function setMarketplaceGroups(id: string, groupIds: string[]): Promise<void> {
  await ensureFbCoreTables();
  await patchMarketplace(id, { groupIds });
}

/**
 * 手動填的文案自己帶的照片，存進 facts_json.photos（第一張＝封面）。
 * 從物件庫產的文案不走這裡 —— 那種照片跟著 source_property_id。
 */
export async function setDraftPhotos(id: string, photos: string[]): Promise<void> {
  await ensureFbCoreTables();
  const draft = await getFbDraft(id);
  if (!draft) throw new Error("找不到這則文案");
  const facts = parseFacts(draft.facts_json);
  facts.photos = photos.length ? photos : undefined;
  await db.$executeRawUnsafe(
    "UPDATE fb_draft SET facts_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    JSON.stringify(facts),
    id,
  );
}

/**
 * 這篇要附的影片，存進 facts_json.video（一支就好）。跟 setDraftPhotos 不一樣的地方：
 * 不看 source_property_id——不管文案是不是從物件庫產的，影片都能在貼文庫直接編輯
 * （物件庫的影片是 YouTube 連結，給官網嵌入用，不是 FB 能上傳的檔案本體）。
 */
export async function setDraftVideo(id: string, video: string | null): Promise<void> {
  await ensureFbCoreTables();
  const draft = await getFbDraft(id);
  if (!draft) throw new Error("找不到這則文案");
  const facts = parseFacts(draft.facts_json);
  facts.video = video || undefined;
  await db.$executeRawUnsafe(
    "UPDATE fb_draft SET facts_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    JSON.stringify(facts),
    id,
  );
}

export async function setDraftStatus(
  id: string,
  channel: FbChannel,
  status: "draft" | "scheduled" | "posted",
): Promise<void> {
  await ensureFbCoreTables();
  const col = statusColumn(channel);
  await db.$executeRawUnsafe(
    `UPDATE fb_draft SET ${col} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    status,
    id,
  );
}

/* ────────────────── IG／Threads 版本（fb_draft.social_json） ────────────────── */

export function parseSocial(raw: string | null | undefined): SocialPayload {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as SocialPayload;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/**
 * 兩個平台的版本。沒存過（或本人沒改過）的內文用推導值 —— 一般貼文改了，
 * IG／Threads 會跟著變；本人在貼文庫改過某平台的版本後（edited=true）才固定下來。
 */
export function getSocialVersions(draft: FbDraftRow): Record<SocialPlatform, SocialVersion> {
  const stored = parseSocial(draft.social_json);
  const facts = parseFacts(draft.facts_json);
  const post = draft.post_text || "";
  const pick = (platform: SocialPlatform): SocialVersion => {
    const v = stored[platform];
    const derived = platform === "ig" ? deriveIgCaption(post) : deriveThreadsText(post, facts);
    return {
      text: v?.edited && v.text ? v.text : derived,
      edited: Boolean(v?.edited),
      status: v?.status === "posted" ? "posted" : "draft",
      url: v?.url ?? null,
      postedAt: v?.postedAt ?? null,
    };
  };
  return { ig: pick("ig"), threads: pick("threads") };
}

async function patchSocial(id: string, platform: SocialPlatform, patch: Partial<SocialVersion>): Promise<void> {
  await ensureFbCoreTables();
  const draft = await getFbDraft(id);
  if (!draft) throw new Error("找不到這則文案");
  const all = parseSocial(draft.social_json);
  const cur = getSocialVersions(draft)[platform];
  all[platform] = { ...cur, ...patch };
  await db.$executeRawUnsafe(
    "UPDATE fb_draft SET social_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    JSON.stringify(all),
    id,
  );
}

/** 本人改了某平台的內文 → 存起來並標 edited（之後不再被推導值蓋掉）。空字串＝回到推導值。 */
export async function updateSocialText(id: string, platform: SocialPlatform, text: string): Promise<void> {
  const t = text.trim();
  await patchSocial(id, platform, t ? { text: t, edited: true } : { text: "", edited: false });
}

export async function setSocialStatus(
  id: string,
  platform: SocialPlatform,
  status: "draft" | "posted",
  url: string | null = null,
): Promise<void> {
  await patchSocial(id, platform, {
    status,
    url: status === "posted" ? url : null,
    postedAt: status === "posted" ? new Date().toISOString() : null,
  });
}

/**
 * 刪文案。連帶刪它的排程與 runner 記帳；fb_task_item 一併清掉
 * （那些指向不存在的文案沒有意義，而且執行紀錄的統計是照 done 過的 item 算，
 *  還沒 done 的 pending item 刪掉不影響歷史數字）。
 */
export async function deleteFbDraft(id: string): Promise<void> {
  await ensureFbCoreTables();
  const tasks = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM fb_task WHERE draft_id = ${id}`;
  for (const t of tasks) {
    await db.$executeRawUnsafe("DELETE FROM fb_task_item WHERE task_id = ?", t.id);
    await db.$executeRawUnsafe("DELETE FROM fb_task_run WHERE task_id = ?", t.id);
  }
  await db.$executeRawUnsafe("DELETE FROM fb_task WHERE draft_id = ?", id);
  await db.$executeRawUnsafe("DELETE FROM fb_draft WHERE id = ?", id);
}

/* ────────────────── 社團（fb_group） ────────────────── */

/** accepts 欄位判斷：這個社團收不收某個通路的文。 */
function acceptsChannel(accepts: string, channel: FbChannel): boolean {
  if (accepts === "both") return true;
  return accepts === channel;
}

export async function listFbGroups(opts?: {
  channel?: FbChannel;
  onlyActive?: boolean;
  /** true = 只回封存的；false/undefined = 只回沒封存的；"all" = 全部 */
  hidden?: boolean | "all";
  /**
   * 2026-10-07 發文身分：只回這個身分的社團清單。不傳／null／"main" ＝ 主帳號的（舊資料全在這，
   * 所以沒新增身分時結果跟以前一模一樣）；"all" ＝ 不分身分全回（排程頁要一次載完各身分的社團用）。
   */
  identityId?: string | null | "all";
}): Promise<FbGroupRow[]> {
  await ensureFbCoreTables();
  const wantAllIdentities = opts?.identityId === "all";
  const wantIdentity = wantAllIdentities ? null : normalizeIdentityId(opts?.identityId);
  // 人數多的排前面（觸及大的先看到）；沒抓過人數的排最後、照建立順序
  const rows = await db.$queryRawUnsafe<FbGroupRow[]>(
    `SELECT * FROM fb_group
      ORDER BY (member_count IS NULL) ASC, member_count DESC, created_at ASC`,
  );
  return rows.filter((g) => {
    if (!wantAllIdentities && normalizeIdentityId(g.identity_id) !== wantIdentity) return false;
    const isHidden = g.hidden === 1;
    if (opts?.hidden === "all") {
      /* 全部 */
    } else if (opts?.hidden === true) {
      if (!isHidden) return false;
    } else if (isHidden) {
      return false;
    }
    if (opts?.onlyActive && g.is_active !== 1) return false;
    if (opts?.channel && !acceptsChannel(g.accepts, opts.channel)) return false;
    return true;
  });
}

/** 發文身分管理頁用：每個身分名下有幾個社團、幾筆排程。key 是 identityIdForDisplay（主帳號＝"main"）。 */
export type IdentityUsage = {
  groups: number;
  activeGroups: number;
  pendingTasks: number;
  doneTasks: number;
  lastDoneAt: Date | null;
};

export async function identityUsage(): Promise<Map<string, IdentityUsage>> {
  await ensureFbCoreTables();
  const [g, t] = await Promise.all([
    db.$queryRawUnsafe<Array<{ identity_id: string | null; n: unknown; active: unknown }>>(
      `SELECT identity_id, COUNT(*) AS n,
              SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active
         FROM fb_group WHERE hidden IS NULL OR hidden = 0 GROUP BY identity_id`,
    ),
    db.$queryRawUnsafe<Array<{ identity_id: string | null; pending: unknown; done: unknown; last_at: Date | null }>>(
      `SELECT identity_id,
              SUM(CASE WHEN status IN ('pending','running') THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
              MAX(CASE WHEN status = 'done' THEN updated_at END) AS last_at
         FROM fb_task GROUP BY identity_id`,
    ),
  ]);
  const out = new Map<string, IdentityUsage>();
  const slot = (id: string | null): IdentityUsage => {
    const key = identityIdForDisplay(id);
    let u = out.get(key);
    if (!u) {
      u = { groups: 0, activeGroups: 0, pendingTasks: 0, doneTasks: 0, lastDoneAt: null };
      out.set(key, u);
    }
    return u;
  };
  const num = (v: unknown) => Number(String(v ?? 0));
  for (const r of g) {
    const u = slot(r.identity_id);
    u.groups += num(r.n);
    u.activeGroups += num(r.active);
  }
  for (const r of t) {
    const u = slot(r.identity_id);
    u.pendingTasks += num(r.pending);
    u.doneTasks += num(r.done);
    if (r.last_at) u.lastDoneAt = new Date(r.last_at);
  }
  return out;
}

/** 台中／海線關鍵字 —— 用來一鍵封存「不是這區的」。 */
export const HAILINE_KEYWORDS = [
  "海線", "山線", "台中", "臺中", "梧棲", "清水", "沙鹿", "龍井", "大甲", "大安",
  "外埔", "后里", "神岡", "大雅", "豐原", "大肚", "西屯", "南屯", "北屯", "中科",
];

export async function setGroupsHidden(ids: string[], hidden: boolean): Promise<void> {
  await ensureFbCoreTables();
  if (ids.length === 0) return;
  const ph = ids.map(() => "?").join(",");
  await db.$executeRawUnsafe(
    `UPDATE fb_group SET hidden = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${ph})`,
    hidden ? 1 : 0,
    ...ids,
  );
}

/**
 * 一鍵封存「名稱裡沒有台中/海線關鍵字」的社團。
 * 回傳封存了幾個。已經勾「啟用」的**不動**（本人特意選過就不要自作主張收掉）。
 */
export async function hideNonHailineGroups(identityId?: string | null): Promise<{ hidden: number }> {
  await ensureFbCoreTables();
  const want = normalizeIdentityId(identityId);
  const rows = await db.$queryRawUnsafe<
    Array<{ id: string; name: string; is_active: number; hidden: number | null; identity_id: string | null }>
  >(`SELECT id, name, is_active, hidden, identity_id FROM fb_group`);
  const toHide = rows
    .filter(
      (g) =>
        normalizeIdentityId(g.identity_id) === want &&
        g.hidden !== 1 &&
        g.is_active !== 1 &&
        !HAILINE_KEYWORDS.some((k) => g.name.includes(k)),
    )
    .map((g) => g.id);
  await setGroupsHidden(toHide, true);
  return { hidden: toHide.length };
}

/** 人數字串 → 整數。"14.3 萬位成員" → 143000、"577 位成員" → 577、"1,234" → 1234 */
export function parseMemberCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = String(raw).match(/([\d,.]+)\s*(萬|億)?/);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  if (m[2] === "萬") n *= 10_000;
  else if (m[2] === "億") n *= 100_000_000;
  return Math.round(n);
}

/** 143000 → "14.3萬"、335000 → "33.5萬"、5242 → "5,242" */
export function fmtMemberCount(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 10_000) {
    const wan = (n / 10_000).toFixed(1).replace(/\.0$/, "");
    return `${wan}萬`;
  }
  return n.toLocaleString("en-US");
}

export async function getFbGroup(id: string): Promise<FbGroupRow | null> {
  await ensureFbCoreTables();
  const rows = await db.$queryRaw<FbGroupRow[]>`SELECT * FROM fb_group WHERE id = ${id} LIMIT 1`;
  return rows[0] || null;
}

/**
 * 批次加社團。回傳「真的加了幾個、更新了幾個」。
 * 用 group_key（從網址拆的編號）判重，不是整串網址。
 */
export async function addFbGroups(
  entries: Array<{ name: string; url: string; accepts: string; cooldownDays: number }>,
  /** 2026-10-07 發文身分：加進哪個身分的清單。不傳＝主帳號。判重只在同一個身分的清單裡比。 */
  identityId?: string | null,
): Promise<{ added: number; updated: number }> {
  await ensureFbCoreTables();
  const identity = normalizeIdentityId(identityId);
  const existing = (
    await db.$queryRawUnsafe<Array<{ id: string; url: string; identity_id: string | null }>>(
      `SELECT id, url, identity_id FROM fb_group`,
    )
  ).filter((g) => normalizeIdentityId(g.identity_id) === identity);
  const byKey = new Map(existing.map((g) => [parseGroupKey(g.url), g.id]));

  let added = 0;
  let updated = 0;
  for (const e of entries) {
    const url = normalizeGroupUrl(e.url);
    const key = parseGroupKey(url);
    if (!key) continue;
    const hitId = byKey.get(key);
    if (hitId) {
      await db.$executeRawUnsafe(
        "UPDATE fb_group SET name = ?, url = ?, accepts = ?, cooldown_days = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        e.name,
        url,
        e.accepts,
        e.cooldownDays,
        hitId,
      );
      updated += 1;
    } else {
      const id = randomUUID().replace(/-/g, "");
      await db.$executeRawUnsafe(
        "INSERT INTO fb_group (id, name, url, accepts, cooldown_days, is_active, identity_id, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)",
        id,
        e.name,
        url,
        e.accepts,
        e.cooldownDays,
        identity,
      );
      byKey.set(key, id);
      added += 1;
    }
  }
  return { added, updated };
}

export async function setGroupActive(id: string, active: boolean): Promise<void> {
  await ensureFbCoreTables();
  await db.$executeRawUnsafe("UPDATE fb_group SET is_active = ? WHERE id = ?", active ? 1 : 0, id);
}

/** 一次開/關多個社團（勾選式 UI 用）。 */
export async function setGroupsActive(ids: string[], active: boolean): Promise<void> {
  await ensureFbCoreTables();
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  await db.$executeRawUnsafe(
    `UPDATE fb_group SET is_active = ? WHERE id IN (${placeholders})`,
    active ? 1 : 0,
    ...ids,
  );
}

export async function setGroupCooldown(id: string, days: number): Promise<void> {
  await ensureFbCoreTables();
  const d = Math.max(0, Math.min(90, Math.floor(days)));
  await db.$executeRawUnsafe("UPDATE fb_group SET cooldown_days = ? WHERE id = ?", d, id);
}

export async function setGroupAccepts(id: string, accepts: string): Promise<void> {
  await ensureFbCoreTables();
  const a = ["both", "post", "marketplace"].includes(accepts) ? accepts : "both";
  await db.$executeRawUnsafe("UPDATE fb_group SET accepts = ? WHERE id = ?", a, id);
}

/**
 * 桌機 `list-groups.mjs` 把抓到的社團同步進 fb_group。
 *
 * - 用 group_key（網址拆出的編號）判重
 * - **本人的設定不覆蓋**：`is_active` / `cooldown_days` / `note` 只在第一次 INSERT 時給預設，
 *   之後更新只動「從 FB 抓來的事實」（名稱、人數、公開私密、要不要審核）
 * - `accepts`：第一次 INSERT 時照「有沒有討論分頁」給（沒有＝marketplace），之後不動
 */
export async function syncGroupsFromScrape(
  entries: Array<{
    name: string;
    url: string;
    memberCount: number | null;
    privacy: string | null;
    needsApproval: boolean | null;
    hasDiscussion: boolean | null;
    hasMarketplace: boolean | null;
  }>,
  /** 2026-10-07 發文身分：這批是哪個帳號登入抓到的。不傳＝主帳號。判重只在同一個身分的清單裡比。 */
  identityId?: string | null,
): Promise<{ added: number; updated: number }> {
  await ensureFbCoreTables();
  const identity = normalizeIdentityId(identityId);
  const existing = (
    await db.$queryRawUnsafe<Array<{ id: string; url: string; identity_id: string | null }>>(
      `SELECT id, url, identity_id FROM fb_group`,
    )
  ).filter((g) => normalizeIdentityId(g.identity_id) === identity);
  const byKey = new Map(existing.map((g) => [parseGroupKey(g.url), g.id]));

  let added = 0;
  let updated = 0;
  for (const e of entries) {
    const url = normalizeGroupUrl(e.url);
    const key = parseGroupKey(url);
    if (!key) continue;
    const scannedAt = e.memberCount != null || e.privacy != null ? new Date() : null;
    const hitId = byKey.get(key);

    const acc =
      e.hasDiscussion && e.hasMarketplace
        ? "both"
        : e.hasDiscussion && e.hasMarketplace === false
          ? "post"
          : e.hasDiscussion === false && e.hasMarketplace
            ? "marketplace"
            : null;
    const b = (v: boolean | null) => (v == null ? null : v ? 1 : 0);

    if (hitId) {
      // 🔴 COALESCE：這次抓不到（null）就保留舊值
      await db.$executeRawUnsafe(
        `UPDATE fb_group
            SET name = ?, url = ?,
                member_count = COALESCE(?, member_count),
                privacy = COALESCE(?, privacy),
                needs_approval = COALESCE(?, needs_approval),
                has_discussion = COALESCE(?, has_discussion),
                has_marketplace = COALESCE(?, has_marketplace),
                accepts = COALESCE(?, accepts),
                scanned_at = COALESCE(?, scanned_at), updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        e.name.slice(0, 200),
        url.slice(0, 500),
        e.memberCount,
        e.privacy,
        b(e.needsApproval),
        b(e.hasDiscussion),
        b(e.hasMarketplace),
        acc,
        scannedAt,
        hitId,
      );
      updated += 1;
    } else {
      const id = randomUUID().replace(/-/g, "");
      await db.$executeRawUnsafe(
        `INSERT INTO fb_group
           (id, name, url, accepts, cooldown_days, is_active, member_count, privacy, needs_approval, has_discussion, has_marketplace, scanned_at, identity_id, created_at)
         VALUES (?, ?, ?, ?, 7, 0, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        id,
        e.name.slice(0, 200),
        url.slice(0, 500),
        acc || "both",
        e.memberCount,
        e.privacy,
        b(e.needsApproval),
        b(e.hasDiscussion),
        b(e.hasMarketplace),
        scannedAt,
        identity,
      );
      byKey.set(key, id);
      added += 1;
    }
  }
  return { added, updated };
}

export async function deleteFbGroup(id: string): Promise<void> {
  await ensureFbCoreTables();
  await db.$executeRawUnsafe("DELETE FROM fb_group WHERE id = ?", id);
}

/**
 * 每個社團最後一次「成功貼上」是什麼時候。
 *
 * fb_group 上有 `last_posted_at` 欄位（另一台的設計），但那個只要有一條路徑忘了更新就會停在舊時間 ——
 * 而它的用途是擋「太近不要重貼」，停在舊時間＝該擋的沒擋。所以這裡**優先從 fb_task_item 現算**，
 * 現算不到才退回讀欄位。
 */
export async function lastPostedByGroup(): Promise<Map<string, Date>> {
  await ensureFbCoreTables();
  const rows = await db.$queryRaw<Array<{ group_id: string; last_at: Date }>>`
    SELECT group_id, MAX(done_at) AS last_at
      FROM fb_task_item
     WHERE status = 'posted' AND group_id IS NOT NULL AND done_at IS NOT NULL
     GROUP BY group_id
  `;
  const map = new Map<string, Date>();
  for (const r of rows) if (r.group_id) map.set(r.group_id, new Date(r.last_at));

  // 補上只有欄位、沒有 item 紀錄的（例如資料從別處匯入）
  const groups = await db.$queryRaw<Array<{ id: string; last_posted_at: Date | null }>>`
    SELECT id, last_posted_at FROM fb_group WHERE last_posted_at IS NOT NULL
  `;
  for (const g of groups) {
    if (!map.has(g.id) && g.last_posted_at) map.set(g.id, new Date(g.last_posted_at));
  }
  return map;
}

export function daysSince(last: Date | undefined, now = new Date()): number | null {
  if (!last) return null;
  return Math.floor((now.getTime() - last.getTime()) / 86_400_000);
}

/* ────────────────── 擬真模式（2026-09-18）：純函式搬到 fb-humanize.ts，這裡只轉出 ────────────────── */

export {
  JITTER_MAX_MINUTES,
  COOLDOWN_JITTER_RATIO,
  rollJitterSec,
  effectiveCooldownDays,
  jitterWindowLabel,
} from "@/lib/fb-humanize";

/* ────────────────── 排程（fb_task ＋ fb_task_item ＋ fb_task_run） ────────────────── */

export const DEFAULT_EXPIRE_HOURS = Number(process.env.FB_TASK_EXPIRE_HOURS || 6);

export async function createFbTask(data: {
  draftId: string;
  title: string;
  channel: FbChannel;
  runAt: Date;
  postToTimeline: boolean;
  groups: Array<{ id: string; name: string; url: string }>;
  autoPublish: boolean;
  /** Marketplace 專用：到點要不要照 draft 的 groupIds 一起勾社團上架。一般貼文用不到。 */
  crosspost?: boolean;
  /** 一般貼文專用（2026-09-21）：同時發到 IG／Threads（各自一個 fb_task_item，channel='ig'｜'threads'）。 */
  shareIg?: boolean;
  shareThreads?: boolean;
  /**
   * 2026-10-09：走官方 API 的目標，每個都指定身分（粉專動態／IG／Threads，可以好幾組）。
   * 有給這個就不看 shareIg／shareThreads。
   */
  apiTargets?: Array<{ channel: "page" | "ig" | "threads"; identityId: string }>;
  expiresAt?: Date | null;
  /** 擬真抖動秒數。不給就現抽一個；「立即發佈」要給 0。 */
  jitterSec?: number;
  /** 2026-10-07 發文身分：用哪個身分發。不給／"main"＝主帳號（存 NULL）。 */
  identityId?: string | null;
}): Promise<string> {
  await ensureFbCoreTables();
  await ensureFbRunnerTable();
  const taskId = randomUUID().replace(/-/g, "");
  const jitterSec = Math.max(0, Math.floor(data.jitterSec ?? rollJitterSec()));

  await db.$executeRawUnsafe(
    `INSERT INTO fb_task (id, draft_id, title, run_at, status, channel, identity_id, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, CURRENT_TIMESTAMP)`,
    taskId,
    data.draftId,
    data.title.slice(0, 300),
    data.runAt,
    data.channel,
    normalizeIdentityId(data.identityId),
  );

  let order = 0;
  if (data.postToTimeline) {
    await db.$executeRawUnsafe(
      `INSERT INTO fb_task_item (id, task_id, channel, status, sort_order)
       VALUES (?, ?, 'self', 'pending', ?)`,
      randomUUID().replace(/-/g, ""),
      taskId,
      order++,
    );
  }
  // 走官方 API 的（粉專動態／IG／Threads）排在 FB 動態後面、社團前面：runner 認領後先用 API 發（幾十秒），再開瀏覽器跑社團
  const apiTargets =
    data.apiTargets ??
    [data.shareIg ? "ig" : null, data.shareThreads ? "threads" : null]
      .filter((p): p is "ig" | "threads" => Boolean(p))
      .map((channel) => ({ channel, identityId: "" }));
  for (const t of apiTargets) {
    await db.$executeRawUnsafe(
      `INSERT INTO fb_task_item (id, task_id, channel, status, sort_order, target_identity_id)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
      randomUUID().replace(/-/g, ""),
      taskId,
      t.channel,
      order++,
      t.identityId || null,
    );
  }
  for (const g of data.groups) {
    await db.$executeRawUnsafe(
      `INSERT INTO fb_task_item (id, task_id, channel, group_id, group_name, group_url, status, sort_order)
       VALUES (?, ?, 'group', ?, ?, ?, 'pending', ?)`,
      randomUUID().replace(/-/g, ""),
      taskId,
      g.id,
      g.name.slice(0, 200),
      g.url.slice(0, 500),
      order++,
    );
  }

  const expiresAt =
    data.expiresAt !== undefined
      ? data.expiresAt
      : new Date(data.runAt.getTime() + DEFAULT_EXPIRE_HOURS * 3_600_000);
  await db.$executeRawUnsafe(
    `INSERT INTO fb_task_run (task_id, expires_at, auto_publish, crosspost, jitter_sec) VALUES (?, ?, ?, ?, ?)`,
    taskId,
    expiresAt,
    data.autoPublish ? 1 : 0,
    data.crosspost ? 1 : 0,
    jitterSec,
  );

  return taskId;
}

export async function listFbTasks(opts?: {
  channel?: FbChannel;
  status?: string;
  limit?: number;
}): Promise<FbTaskRow[]> {
  await ensureFbCoreTables();
  const filters: string[] = ["1=1"];
  const params: unknown[] = [];
  if (opts?.channel) {
    filters.push("channel = ?");
    params.push(opts.channel);
  }
  if (opts?.status) {
    filters.push("status = ?");
    params.push(opts.status);
  }
  return db.$queryRawUnsafe<FbTaskRow[]>(
    `SELECT * FROM fb_task WHERE ${filters.join(" AND ")} ORDER BY run_at ASC LIMIT ?`,
    ...params,
    Math.min(opts?.limit || 200, 500),
  );
}

export async function getFbTask(id: string): Promise<FbTaskRow | null> {
  await ensureFbCoreTables();
  const rows = await db.$queryRaw<FbTaskRow[]>`SELECT * FROM fb_task WHERE id = ${id} LIMIT 1`;
  return rows[0] || null;
}

export async function getTaskItems(taskId: string): Promise<FbTaskItemRow[]> {
  await ensureFbCoreTables();
  return db.$queryRaw<FbTaskItemRow[]>`
    SELECT * FROM fb_task_item WHERE task_id = ${taskId} ORDER BY sort_order ASC
  `;
}

export async function getTaskRun(taskId: string): Promise<FbTaskRunRow | null> {
  await ensureFbCoreTables();
  const rows = await db.$queryRaw<FbTaskRunRow[]>`SELECT * FROM fb_task_run WHERE task_id = ${taskId} LIMIT 1`;
  return rows[0] || null;
}

export async function setTaskStatus(
  id: string,
  status: "pending" | "running" | "done" | "failed" | "cancelled" | "expired",
): Promise<void> {
  await ensureFbCoreTables();
  await db.$executeRawUnsafe(
    "UPDATE fb_task SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    status,
    id,
  );
}

export async function deleteFbTask(id: string): Promise<void> {
  await ensureFbCoreTables();
  await db.$executeRawUnsafe("DELETE FROM fb_task_item WHERE task_id = ?", id);
  await db.$executeRawUnsafe("DELETE FROM fb_task_run WHERE task_id = ?", id);
  await db.$executeRawUnsafe("DELETE FROM fb_task WHERE id = ?", id);
}

/**
 * 改一個排程的時間（不用取消重排）。
 *
 * 順便把記帳重置成「像新排的一樣」：新的失效時間、清掉認領／錯誤、attempts 歸零，
 * 之前 failed 的目標退回 pending（重排＝要它重發一次）。
 * ⚠️ posted 的目標不動 —— 已經發出去的不要再發一次。
 * ⚠️ skipped 的也不動 —— 那是「這個社團結構上收不了這種文」，重排也一樣。
 */
export async function rescheduleTask(
  taskId: string,
  runAt: Date,
  jitterSec: number = rollJitterSec(),
): Promise<void> {
  await ensureFbCoreTables();
  await ensureFbRunnerTable();
  await db.$executeRawUnsafe(
    "UPDATE fb_task SET run_at = ?, status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    runAt,
    taskId,
  );
  // 改時間 ＝ 重新抽一次抖動（不然同一筆重排好幾次，抖動永遠是同一個數）
  await db.$executeRawUnsafe(
    `UPDATE fb_task_run
        SET expires_at = ?, claimed_at = NULL, claimed_by = NULL, finished_at = NULL,
            attempts = 0, last_error = NULL, jitter_sec = ?
      WHERE task_id = ?`,
    new Date(runAt.getTime() + DEFAULT_EXPIRE_HOURS * 3_600_000),
    Math.max(0, Math.floor(jitterSec)),
    taskId,
  );
  await db.$executeRawUnsafe(
    "UPDATE fb_task_item SET status = 'pending', done_at = NULL, note = NULL WHERE task_id = ? AND status = 'failed'",
    taskId,
  );
}

export async function dueFbTasks(now = new Date()): Promise<FbTaskRow[]> {
  await ensureFbCoreTables();
  return db.$queryRaw<FbTaskRow[]>`
    SELECT * FROM fb_task WHERE status = 'pending' AND run_at <= ${now} ORDER BY run_at ASC
  `;
}

/* ── runner 用：認領與收尾 ── */

/**
 * 認領超過這麼久還沒收尾，就當那台 runner 掛了、可以被重新認領。
 * 2026-09-19 從 30 拉到 240：社團間隔改成 6～14 分之後，一篇發 5 個社團會跑到一小時以上，
 * 30 分鐘會讓「還在正常跑」的工作被手動點的 FB-Runner.bat 再撈一次（同一篇發兩次）。
 * 代價是 runner 真的死掉時要 4 小時才會補跑（失效時間 6 小時，還來得及）。
 */
const CLAIM_STALE_MINUTES = Number(process.env.FB_CLAIM_STALE_MINUTES || 240);

/* ── 節奏保護（資料庫版；純判斷在 fb-rhythm.ts） ── */

/** 本地時間的今天 00:00。dev server／runner 都跑在桌機（台北），跟 done_at 寫入時的 new Date() 同一個時區。 */
function startOfToday(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 從資料庫抓「最近發生了什麼」，給 rhythmHold 判斷。 */
export async function rhythmSnapshot(now = new Date()): Promise<RhythmSnapshot> {
  await ensureFbCoreTables();
  const today = startOfToday(now);
  const [feed, mp, feedToday, mpToday] = await Promise.all([
    db.$queryRaw<Array<{ task_id: string; done_at: Date }>>`
      SELECT task_id, done_at FROM fb_task_item
       WHERE status = 'posted' AND done_at IS NOT NULL
       ORDER BY done_at DESC LIMIT 1
    `,
    db.$queryRaw<Array<{ finished_at: Date }>>`
      SELECT r.finished_at FROM fb_task_run r JOIN fb_task t ON t.id = r.task_id
       WHERE t.channel = 'marketplace' AND t.status = 'done' AND r.finished_at IS NOT NULL
       ORDER BY r.finished_at DESC LIMIT 1
    `,
    db.$queryRaw<Array<{ n: bigint | number }>>`
      SELECT COUNT(*) AS n FROM fb_task_item WHERE status = 'posted' AND done_at >= ${today}
    `,
    db.$queryRaw<Array<{ n: bigint | number }>>`
      SELECT COUNT(*) AS n FROM fb_task_run r JOIN fb_task t ON t.id = r.task_id
       WHERE t.channel = 'marketplace' AND t.status = 'done' AND r.finished_at >= ${today}
    `,
  ]);
  return {
    lastFeedAt: feed[0]?.done_at ? new Date(feed[0].done_at) : null,
    lastFeedTaskId: feed[0]?.task_id ?? null,
    lastMarketplaceAt: mp[0]?.finished_at ? new Date(mp[0].finished_at) : null,
    postedToday: Number(feedToday[0]?.n ?? 0) + Number(mpToday[0]?.n ?? 0),
  };
}

/** 這個通路現在為什麼撈不到新工作（節奏保護擋住）。沒擋 → null。給 API／runner 印給人看。 */
export async function claimHoldReason(channel: RhythmChannel, now = new Date()): Promise<string | null> {
  return rhythmHold(channel, await rhythmSnapshot(now), null, now);
}

/**
 * 沒有 fb_task_run 記帳的舊任務（另一台 UI 在這次整合之前排的），
 * run_at 超過這個小時數就不自動補跑 —— 那種要本人重新排一次。
 * 這條刻意存在：整合當下有一筆「今天 16:45」的排程，本人交代先別動它。
 */
const LEGACY_TASK_GRACE_HOURS = Number(process.env.FB_LEGACY_TASK_GRACE_HOURS || 3);

/**
 * 桌機 runner 撈下一筆該發的工作。先條件式 UPDATE fb_task_run 認領，蓋成功的才有資格發 ——
 * 避免排程重疊觸發兩支 runner 把同一篇貼兩次。
 *
 * fb_task 可能由這台或另一台的 UI 建。另一台不知道 fb_task_run 這張表，
 * 所以撈到「沒有 run 記帳」的任務時，這裡補一筆 run（預設 auto_publish=0，最保守），
 * 但太舊的（超過 grace 小時）不補、直接標過期。
 */
export async function claimNextTask(workerId: string, now = new Date()): Promise<FbTaskRow | null> {
  await ensureFbCoreTables();
  const staleBefore = new Date(now.getTime() - CLAIM_STALE_MINUTES * 60_000);
  const legacyBefore = new Date(now.getTime() - LEGACY_TASK_GRACE_HOURS * 3_600_000);

  // 沒有 run 記帳的 pending post 任務（另一台 UI 建的）：
  // 🔴 run_at 太舊的**完全不碰**（整合當下那筆「今天 16:45」的排程就落在這，本人交代先別動）。
  //    在 grace 窗內的才補一筆 run 記帳（預設 auto_publish=0，最保守），讓桌機能接手。
  const orphans = await db.$queryRaw<Array<{ id: string; run_at: Date }>>`
    SELECT t.id, t.run_at
      FROM fb_task t
      LEFT JOIN fb_task_run r ON r.task_id = t.id
     WHERE t.status = 'pending' AND t.channel = 'post'
       AND r.task_id IS NULL
       AND t.run_at >= ${legacyBefore}
  `;
  for (const o of orphans) {
    await db.$executeRawUnsafe(
      `INSERT INTO fb_task_run (task_id, auto_publish, expires_at)
       VALUES (?, 0, ?)
       ON DUPLICATE KEY UPDATE task_id = task_id`,
      o.id,
      new Date(new Date(o.run_at).getTime() + DEFAULT_EXPIRE_HOURS * 3_600_000),
    );
  }

  // 過期的先關掉
  const expired = await db.$queryRaw<Array<{ task_id: string }>>`
    SELECT r.task_id FROM fb_task_run r
      JOIN fb_task t ON t.id = r.task_id
     WHERE t.status = 'pending' AND r.expires_at IS NOT NULL AND r.expires_at < ${now}
  `;
  for (const e of expired) {
    await db.$executeRawUnsafe(
      "UPDATE fb_task SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      e.task_id,
    );
    await db.$executeRawUnsafe(
      "UPDATE fb_task_run SET last_error = '超過失效時間，沒有補發' WHERE task_id = ?",
      e.task_id,
    );
  }

  const candidates = await db.$queryRaw<Array<{ id: string }>>`
    SELECT t.id
      FROM fb_task t
      JOIN fb_task_run r ON r.task_id = t.id
     WHERE t.status IN ('pending', 'running')
       AND t.channel = 'post'
       AND DATE_ADD(t.run_at, INTERVAL r.jitter_sec SECOND) <= ${now}
       AND (r.claimed_at IS NULL OR r.claimed_at < ${staleBefore})
     ORDER BY t.run_at ASC
     LIMIT 5
  `;

  // 節奏保護：上一篇太近／今天到上限 → 這輪不認領，任務維持 pending，下一輪再看（見 fb-rhythm.ts）
  const snap = candidates.length ? await rhythmSnapshot(now) : null;
  for (const c of candidates) {
    if (snap && rhythmHold("post", snap, c.id, now)) continue;
    const affected = await db.$executeRawUnsafe(
      `UPDATE fb_task_run
          SET claimed_at = ?, claimed_by = ?, attempts = attempts + 1
        WHERE task_id = ?
          AND (claimed_at IS NULL OR claimed_at < ?)`,
      now,
      workerId.slice(0, 80),
      c.id,
      staleBefore,
    );
    if (affected === 1) {
      await db.$executeRawUnsafe(
        "UPDATE fb_task SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        c.id,
      );
      return getFbTask(c.id);
    }
  }
  return null;
}

export async function markItemResult(
  itemId: string,
  status: "posted" | "skipped" | "failed",
  note: string | null,
): Promise<void> {
  await ensureFbCoreTables();
  await db.$executeRawUnsafe(
    "UPDATE fb_task_item SET status = ?, note = ?, done_at = ? WHERE id = ?",
    status,
    note?.slice(0, 300) || null,
    status === "posted" ? new Date() : null,
    itemId,
  );
  // 成功貼到社團 → 順手更新 fb_group.last_posted_at（另一台的欄位，維持它有值）
  if (status === "posted") {
    const rows = await db.$queryRaw<Array<{ group_id: string | null }>>`
      SELECT group_id FROM fb_task_item WHERE id = ${itemId} LIMIT 1
    `;
    const gid = rows[0]?.group_id;
    if (gid) {
      await db.$executeRawUnsafe(
        "UPDATE fb_group SET last_posted_at = ? WHERE id = ?",
        new Date(),
        gid,
      );
    }
  }
}

/** 一份工作跑完（全部 item 都有結果了）。 */
export async function finishTask(taskId: string, note?: string): Promise<void> {
  await ensureFbCoreTables();
  const items = await getTaskItems(taskId);
  // post_status 講的是「FB 一般貼文發了沒」—— IG／Threads 的 item 不算進來，
  // 不然只發了 IG 也會把 FB 標成已發，之後想發 FB 找不到那則。
  const anyPosted = items.some((i) => isFbItem(i.channel) && i.status === "posted");
  const anyFbItem = items.some((i) => isFbItem(i.channel));
  const allSettled = items.every((i) => i.status !== "pending");

  await db.$executeRawUnsafe(
    "UPDATE fb_task SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    allSettled ? "done" : "pending",
    taskId,
  );
  await db.$executeRawUnsafe(
    "UPDATE fb_task_run SET claimed_at = NULL, claimed_by = NULL, finished_at = ?, last_error = ? WHERE task_id = ?",
    allSettled ? new Date() : null,
    note?.slice(0, 500) || null,
    taskId,
  );

  // 一般貼文全部發完 → 把 draft 標成 posted。
  // 這份工作根本沒有 FB 目標（只發 IG／Threads）→ 排程時標的 scheduled 要退回 draft，FB 那邊還沒發。
  if (allSettled) {
    const task = await getFbTask(taskId);
    if (task && anyPosted) await setDraftStatus(task.draft_id, "post", "posted");
    else if (task && !anyFbItem) await setDraftStatus(task.draft_id, "post", "draft");
  }
}

/** 這輪不能發但不是壞掉（例：還沒隔滿 90 分鐘）——放回佇列，把剛才那次認領還回去。 */
export async function releaseTask(taskId: string, note: string): Promise<void> {
  await ensureFbCoreTables();
  await db.$executeRawUnsafe(
    "UPDATE fb_task SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    taskId,
  );
  await db.$executeRawUnsafe(
    `UPDATE fb_task_run
        SET claimed_at = NULL, claimed_by = NULL,
            attempts = GREATEST(attempts - 1, 0), last_error = ?
      WHERE task_id = ?`,
    note.slice(0, 500),
    taskId,
  );
}

/**
 * 任務永久失敗（試滿次數、或「要人改」那種不重試的）之後，把文案退回「還沒貼」——
 * 不然 draft 會一直卡在 scheduled：貼文庫顯示「排程中」、排程頁的下拉又撈不到它
 * （只撈 status='draft'），本人改完內容想重排卻找不到那則。
 * （2026-09-21：「清水區 遠雄之星3」9/11 因為沒選「狀況」失敗後就這樣卡了 10 天。）
 * 跟 cancelTaskAction 同一條規矩：同一則還有別的任務在排／在跑，就不動它。
 */
async function rollbackDraftAfterFailure(taskId: string): Promise<void> {
  const task = await getFbTask(taskId);
  if (!task) return;
  const channel: FbChannel = task.channel === "marketplace" ? "marketplace" : "post";
  const others = await listFbTasks({ channel });
  const stillScheduled = others.some(
    (t) => t.id !== taskId && t.draft_id === task.draft_id && (t.status === "pending" || t.status === "running"),
  );
  if (!stillScheduled) await setDraftStatus(task.draft_id, channel, "draft");
}

/** 發失敗。試超過 maxAttempts 次就標 failed 不再重試（一直重試失敗貼文＝機器人行為）。 */
export async function failTask(taskId: string, error: string, maxAttempts = 3): Promise<void> {
  await ensureFbCoreTables();
  const run = await getTaskRun(taskId);
  const done = (run?.attempts || 0) >= maxAttempts;
  await db.$executeRawUnsafe(
    "UPDATE fb_task SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    done ? "failed" : "pending",
    taskId,
  );
  await db.$executeRawUnsafe(
    "UPDATE fb_task_run SET claimed_at = NULL, claimed_by = NULL, last_error = ?, finished_at = ? WHERE task_id = ?",
    error.slice(0, 500),
    done ? new Date() : null,
    taskId,
  );
  if (done) await rollbackDraftAfterFailure(taskId);
}

/* ────────────────── runner 用：Marketplace 通路（Phase 4，2026-09-06） ──────────────────
 *
 * 一般貼文的認領走 claimNextTask（`channel = 'post'` only）；Marketplace 走這一組。
 *
 * 跟一般貼文的差別：
 *  ・Marketplace 沒有 fb_task_item —— 社團不是「逐一貼」，是在單一刊登流程的「在更多地方上架」
 *    那一頁一次勾（post-marketplace.mjs --crosspost 讀 draft 的 groupIds 去勾）。
 *    所以不共用 finishTask（那個會 iterate items），另外寫一組。
 *  ・Marketplace 任務一定是這個網站建的（另一台的舊 UI 沒有 marketplace 通路），
 *    沒有「孤兒任務」要補 fb_task_run。
 *  ・到點一定是全自動（autoPublish 恆為 1）—— 排程 Marketplace 卻停在「儲存草稿」等人按沒有意義。
 */
export async function claimNextMarketplaceTask(
  workerId: string,
  now = new Date(),
  /**
   * 2026-10-07 發文身分：只認領「登入檔有效」的身分的任務（不傳＝不限制，跟以前一樣）。
   * 清單裡放 identity_id（主帳號放 null 或 "main"）。🔴 認領會把任務改成 running、attempts+1，
   * 登入沒接的身分不該被認領（跟以前「主帳號沒登入就整條路不認領」是同一個道理，只是現在分身分判斷）。
   */
  allowedIdentityIds?: Array<string | null>,
): Promise<FbTaskRow | null> {
  await ensureFbCoreTables();
  await ensureFbRunnerTable();
  const allowed = allowedIdentityIds ? new Set(allowedIdentityIds.map((x) => normalizeIdentityId(x))) : null;
  const staleBefore = new Date(now.getTime() - CLAIM_STALE_MINUTES * 60_000);

  // 過期的先關掉（桌機關著、隔天才開機，不會突然把昨天的商品刊出去）
  const expired = await db.$queryRaw<Array<{ task_id: string }>>`
    SELECT r.task_id FROM fb_task_run r
      JOIN fb_task t ON t.id = r.task_id
     WHERE t.status = 'pending' AND t.channel = 'marketplace'
       AND r.expires_at IS NOT NULL AND r.expires_at < ${now}
  `;
  for (const e of expired) {
    await db.$executeRawUnsafe(
      "UPDATE fb_task SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      e.task_id,
    );
    await db.$executeRawUnsafe(
      "UPDATE fb_task_run SET last_error = '超過失效時間，沒有補發' WHERE task_id = ?",
      e.task_id,
    );
  }

  const allCandidates = await db.$queryRaw<Array<{ id: string; identity_id: string | null }>>`
    SELECT t.id, t.identity_id
      FROM fb_task t
      JOIN fb_task_run r ON r.task_id = t.id
     WHERE t.status IN ('pending', 'running')
       AND t.channel = 'marketplace'
       AND DATE_ADD(t.run_at, INTERVAL r.jitter_sec SECOND) <= ${now}
       AND (r.claimed_at IS NULL OR r.claimed_at < ${staleBefore})
     ORDER BY t.run_at ASC
     LIMIT 20
  `;
  // 登入沒接的身分整個跳過（不認領、不動 attempts）。多撈幾筆再篩，免得前幾筆都是沒登入的身分、把有登入的擋在後面
  const candidates = (allowed ? allCandidates.filter((c) => allowed.has(normalizeIdentityId(c.identity_id))) : allCandidates).slice(0, 5);
  // 節奏保護：一般貼文剛發完／上一筆 Marketplace 太近／今天到上限 → 這輪不認領（見 fb-rhythm.ts）
  const snap = candidates.length ? await rhythmSnapshot(now) : null;
  for (const c of candidates) {
    if (snap && rhythmHold("marketplace", snap, c.id, now)) continue;
    const affected = await db.$executeRawUnsafe(
      `UPDATE fb_task_run
          SET claimed_at = ?, claimed_by = ?, attempts = attempts + 1
        WHERE task_id = ?
          AND (claimed_at IS NULL OR claimed_at < ?)`,
      now,
      workerId.slice(0, 80),
      c.id,
      staleBefore,
    );
    if (affected === 1) {
      await db.$executeRawUnsafe(
        "UPDATE fb_task SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        c.id,
      );
      return getFbTask(c.id);
    }
  }
  return null;
}

/** Marketplace 一份工作發完了。post-marketplace.mjs 自己已經把 draft.marketplace_status 標 posted，這裡收 task。 */
export async function finishMarketplaceTask(taskId: string, note?: string): Promise<void> {
  await ensureFbRunnerTable();
  await db.$executeRawUnsafe(
    "UPDATE fb_task SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    taskId,
  );
  await db.$executeRawUnsafe(
    "UPDATE fb_task_run SET claimed_at = NULL, claimed_by = NULL, finished_at = ?, last_error = ? WHERE task_id = ?",
    new Date(),
    note?.slice(0, 500) || null,
    taskId,
  );
  const task = await getFbTask(taskId);
  if (task) await setDraftStatus(task.draft_id, "marketplace", "posted");
}

/** 這輪不能發但不是壞掉（例：登入沒接、--dry）——放回佇列。 */
export async function releaseMarketplaceTask(taskId: string, note: string): Promise<void> {
  await ensureFbRunnerTable();
  await db.$executeRawUnsafe(
    "UPDATE fb_task SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    taskId,
  );
  await db.$executeRawUnsafe(
    `UPDATE fb_task_run
        SET claimed_at = NULL, claimed_by = NULL,
            attempts = GREATEST(attempts - 1, 0), last_error = ?
      WHERE task_id = ?`,
    note.slice(0, 500),
    taskId,
  );
}

/** 發失敗。試超過 maxAttempts 次就標 failed 不再重試。 */
export async function failMarketplaceTask(
  taskId: string,
  error: string,
  maxAttempts = 3,
): Promise<void> {
  await ensureFbRunnerTable();
  const run = await getTaskRun(taskId);
  const done = (run?.attempts || 0) >= maxAttempts;
  await db.$executeRawUnsafe(
    "UPDATE fb_task SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    done ? "failed" : "pending",
    taskId,
  );
  await db.$executeRawUnsafe(
    "UPDATE fb_task_run SET claimed_at = NULL, claimed_by = NULL, last_error = ?, finished_at = ? WHERE task_id = ?",
    error.slice(0, 500),
    done ? new Date() : null,
    taskId,
  );
  if (done) await rollbackDraftAfterFailure(taskId);
}

/* ────────────────── 自動刪文（fb_delete_task ＋ fb_delete_task_run） ────────────────── */

/**
 * 跟發文排程不同：目標不是排程時選好的（社團清單挑一挑），是桌機執行時
 * 到 FB「活動紀錄」用 match_text 比對現找的 —— 所以這裡沒有 xxx_item 明細表，
 * 一個 fb_delete_task 對應「一次批次刪除」，結果整批記進 fb_delete_task_run。
 */

/** 排程到期後多久算「失效不補跑」。刪除不像發文有時效性（晚兩天刪不會怎樣），窗開寬一點。 */
export const DEFAULT_DELETE_EXPIRE_HOURS = Number(process.env.FB_DELETE_EXPIRE_HOURS || 72);

export async function createDeleteTask(data: {
  draftId: string;
  title: string;
  matchText: string;
  maxItems: number;
  olderThanDays: number | null;
  runAt: Date;
  autoConfirm: boolean;
  /** 只清這一個社團的（2026-09-19「按社團清空」用）。留空＝不限社團，維持原本的「按工作流清空」行為。 */
  groupId?: string | null;
  /** 2026-10-07 發文身分：用哪個帳號的登入去刪。不給／"main"＝主帳號（存 NULL）。 */
  identityId?: string | null;
}): Promise<string> {
  await ensureFbDeleteTables();
  const id = randomUUID().replace(/-/g, "");
  await db.$executeRawUnsafe(
    `INSERT INTO fb_delete_task (id, draft_id, title, match_text, max_items, older_than_days, run_at, status, group_id, identity_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, CURRENT_TIMESTAMP)`,
    id,
    data.draftId,
    data.title.slice(0, 300),
    data.matchText.slice(0, 500),
    Math.max(1, Math.min(50, Math.floor(data.maxItems))),
    data.olderThanDays,
    data.runAt,
    data.groupId || null,
    normalizeIdentityId(data.identityId),
  );
  const expiresAt = new Date(data.runAt.getTime() + DEFAULT_DELETE_EXPIRE_HOURS * 3_600_000);
  await db.$executeRawUnsafe(
    `INSERT INTO fb_delete_task_run (task_id, expires_at, auto_confirm) VALUES (?, ?, ?)`,
    id,
    expiresAt,
    data.autoConfirm ? 1 : 0,
  );
  return id;
}

export async function listDeleteTasks(opts?: { status?: string; limit?: number }): Promise<FbDeleteTaskRow[]> {
  await ensureFbDeleteTables();
  const filters: string[] = ["1=1"];
  const params: unknown[] = [];
  if (opts?.status) {
    filters.push("status = ?");
    params.push(opts.status);
  }
  return db.$queryRawUnsafe<FbDeleteTaskRow[]>(
    `SELECT * FROM fb_delete_task WHERE ${filters.join(" AND ")} ORDER BY run_at DESC LIMIT ?`,
    ...params,
    Math.min(opts?.limit || 100, 300),
  );
}

export async function getDeleteTask(id: string): Promise<FbDeleteTaskRow | null> {
  await ensureFbDeleteTables();
  const rows = await db.$queryRaw<FbDeleteTaskRow[]>`SELECT * FROM fb_delete_task WHERE id = ${id} LIMIT 1`;
  return rows[0] || null;
}

export async function getDeleteTaskRun(id: string): Promise<FbDeleteTaskRunRow | null> {
  await ensureFbDeleteTables();
  const rows = await db.$queryRaw<FbDeleteTaskRunRow[]>`SELECT * FROM fb_delete_task_run WHERE task_id = ${id} LIMIT 1`;
  return rows[0] || null;
}

/* ── 「按工作流清空」／「按社團清空」：一目了然的兩張清單（2026-09-19，本人參考同業截圖要求）──
 *
 * 跟原本的「排一個自動刪文任務」表單不一樣：不用挑文案、手打比對字、選時間 ——
 * 直接從「真的發過去哪裡」反推，列出來一目了然，點下去就是清空「這一則工作流全部發過的地方」
 * 或「這一個社團被貼過的全部文案」。比對字串／篇數上限都是系統自己從 fb_task_item 算出來的，
 * 不是手打的，跟舊表單比起來反而更不容易打錯字誤刪。
 */

/** 已經有 pending／running 的清空任務在排了嗎？兩張新清單都要標「已排入」避免使用者重複點。 */
async function queuedDeleteKeys(identityId?: string | null): Promise<{ drafts: Set<string>; groups: Set<string> }> {
  await ensureFbDeleteTables();
  const identity = normalizeIdentityId(identityId);
  const rows = await db.$queryRawUnsafe<Array<{ draft_id: string; group_id: string | null }>>(
    `SELECT draft_id, group_id FROM fb_delete_task
      WHERE status IN ('pending', 'running') AND ${identity ? "identity_id = ?" : "identity_id IS NULL"}`,
    ...(identity ? [identity] : []),
  );
  const drafts = new Set<string>();
  const groups = new Set<string>();
  for (const r of rows) {
    if (r.group_id) groups.add(r.group_id);
    else drafts.add(r.draft_id);
  }
  return { drafts, groups };
}

export type DeletableDraftRow = {
  draftId: string;
  title: string;
  /** 比對用的指紋（文案第一行）。清空時直接拿這個當 match_text，不用手打。 */
  matchPreview: string;
  /** 這篇文案總共發到幾個地方（自己的動態＋社團合計）。 */
  postedCount: number;
  /** 其中發到社團的篇數（一鍵清空真正會處理的是這些；自己動態那篇走不到「你的內容」，要手動刪）。 */
  groupPostedCount: number;
  /** 其中發到自己動態的篇數。 */
  selfCount: number;
  /** 發到幾個不同社團（不含自己的動態）。 */
  groupCount: number;
  lastPostedAt: Date | null;
  /** 已經有一筆清空任務排著了（不分預覽／全自動），畫面上不要讓他再排一次。 */
  alreadyQueued: boolean;
};

/**
 * 「按工作流清空」：每一則發過的文案一列，篇數＝發到幾個地方（含自己的動態）。
 *
 * 2026-10-07 發文身分：只列「這個身分發的」（預設主帳號）。刪文是用登入帳號去自己的活動紀錄找，
 * 所以一定要用當初發文的那個帳號登入才刪得到、也才不會碰到別的帳號的貼文——清單跟刪除任務都按身分分開。
 */
export async function listDeletableDrafts(identityId?: string | null): Promise<DeletableDraftRow[]> {
  await ensureFbCoreTables();
  const identity = normalizeIdentityId(identityId);
  const rows = await db.$queryRawUnsafe<
    Array<{
      draft_id: string;
      title: string;
      post_text: string | null;
      posted_count: bigint;
      group_posted_count: bigint | number | null;
      self_count: bigint | number | null;
      group_count: bigint;
      last_at: Date | null;
    }>
  >(
    `SELECT t.draft_id AS draft_id, d.title AS title, d.post_text AS post_text,
           COUNT(*) AS posted_count,
           SUM(CASE WHEN i.channel = 'group' THEN 1 ELSE 0 END) AS group_posted_count,
           SUM(CASE WHEN i.channel = 'self' THEN 1 ELSE 0 END) AS self_count,
           COUNT(DISTINCT i.group_id) AS group_count,
           MAX(i.done_at) AS last_at
      FROM fb_task_item i
      JOIN fb_task t ON t.id = i.task_id
      JOIN fb_draft d ON d.id = t.draft_id
     WHERE i.status = 'posted' AND i.deleted_at IS NULL
       AND ${identity ? "t.identity_id = ?" : "t.identity_id IS NULL"}
     GROUP BY t.draft_id, d.title, d.post_text
     ORDER BY MAX(i.done_at) DESC`,
    ...(identity ? [identity] : []),
  );
  const queued = await queuedDeleteKeys(identity);
  return rows.map((r) => ({
    draftId: r.draft_id,
    title: r.title,
    matchPreview: firstLineForMatch(r.post_text),
    postedCount: Number(r.posted_count),
    groupPostedCount: Number(r.group_posted_count ?? 0),
    selfCount: Number(r.self_count ?? 0),
    groupCount: Number(r.group_count),
    lastPostedAt: r.last_at ? new Date(r.last_at) : null,
    alreadyQueued: queued.drafts.has(r.draft_id),
  }));
}

export type DeletableGroupDraftLine = {
  draftId: string;
  title: string;
  matchPreview: string;
  count: number;
};

export type DeletableGroupRow = {
  groupId: string;
  groupName: string;
  groupUrl: string | null;
  /** 這個社團總共被貼了幾篇（可能來自好幾則不同文案）。 */
  postedCount: number;
  lastPostedAt: Date | null;
  /** 社團目前是不是封存狀態（畫面上標示用，封存了一樣清得到）。 */
  hidden: boolean;
  /** 清空時要拆成一則文案一筆清空任務（每筆各自的比對字串不同），這裡列出組成。 */
  drafts: DeletableGroupDraftLine[];
  alreadyQueued: boolean;
};

/** 「按社團清空」：每一個被貼過的社團一列，篇數＝這個社團收過幾篇我們發的（可能橫跨多則文案）。只列這個身分發的（預設主帳號）。 */
export async function listDeletableGroups(identityId?: string | null): Promise<DeletableGroupRow[]> {
  await ensureFbCoreTables();
  const identity = normalizeIdentityId(identityId);
  const rows = await db.$queryRawUnsafe<
    Array<{
      group_id: string | null;
      group_name: string | null;
      group_url: string | null;
      draft_id: string;
      title: string;
      post_text: string | null;
      n: bigint;
      last_at: Date | null;
    }>
  >(
    `SELECT i.group_id AS group_id, i.group_name AS group_name, i.group_url AS group_url,
           t.draft_id AS draft_id, d.title AS title, d.post_text AS post_text,
           COUNT(*) AS n, MAX(i.done_at) AS last_at
      FROM fb_task_item i
      JOIN fb_task t ON t.id = i.task_id
      JOIN fb_draft d ON d.id = t.draft_id
     WHERE i.status = 'posted' AND i.channel = 'group' AND i.group_id IS NOT NULL AND i.deleted_at IS NULL
       AND ${identity ? "t.identity_id = ?" : "t.identity_id IS NULL"}
     GROUP BY i.group_id, i.group_name, i.group_url, t.draft_id, d.title, d.post_text`,
    ...(identity ? [identity] : []),
  );

  const queued = await queuedDeleteKeys(identity);
  const hiddenRows = await db.$queryRaw<Array<{ id: string; hidden: number | null }>>`SELECT id, hidden FROM fb_group`;
  const hiddenSet = new Set(hiddenRows.filter((g) => g.hidden === 1).map((g) => g.id));

  const byGroup = new Map<string, DeletableGroupRow>();
  for (const r of rows) {
    if (!r.group_id) continue;
    let g = byGroup.get(r.group_id);
    if (!g) {
      g = {
        groupId: r.group_id,
        groupName: r.group_name || r.group_id,
        groupUrl: r.group_url,
        postedCount: 0,
        lastPostedAt: null,
        hidden: hiddenSet.has(r.group_id),
        drafts: [],
        alreadyQueued: queued.groups.has(r.group_id),
      };
      byGroup.set(r.group_id, g);
    }
    g.postedCount += Number(r.n);
    const at = r.last_at ? new Date(r.last_at) : null;
    if (at && (!g.lastPostedAt || at > g.lastPostedAt)) g.lastPostedAt = at;
    g.drafts.push({ draftId: r.draft_id, title: r.title, matchPreview: firstLineForMatch(r.post_text), count: Number(r.n) });
  }
  return [...byGroup.values()].sort((a, b) => (b.lastPostedAt?.getTime() || 0) - (a.lastPostedAt?.getTime() || 0));
}

export async function cancelDeleteTask(id: string): Promise<void> {
  await ensureFbDeleteTables();
  await db.$executeRawUnsafe(
    "UPDATE fb_delete_task SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    id,
  );
}

export async function dueDeleteTasks(now = new Date()): Promise<FbDeleteTaskRow[]> {
  await ensureFbDeleteTables();
  return db.$queryRaw<FbDeleteTaskRow[]>`
    SELECT * FROM fb_delete_task WHERE status = 'pending' AND run_at <= ${now} ORDER BY run_at ASC
  `;
}

/* ── runner 用：認領與收尾。跟 fb_task 的認領機制同一套（條件式 UPDATE 卡併發），
   但這張是全新表、沒有「另一台 UI 建的孤兒任務」要相容，邏輯簡單很多。 ── */

const DELETE_CLAIM_STALE_MINUTES = Number(process.env.FB_DELETE_CLAIM_STALE_MINUTES || 30);

export async function claimNextDeleteTask(workerId: string, now = new Date()): Promise<FbDeleteTaskRow | null> {
  await ensureFbDeleteTables();
  const staleBefore = new Date(now.getTime() - DELETE_CLAIM_STALE_MINUTES * 60_000);

  const expired = await db.$queryRaw<Array<{ task_id: string }>>`
    SELECT r.task_id FROM fb_delete_task_run r
      JOIN fb_delete_task t ON t.id = r.task_id
     WHERE t.status = 'pending' AND r.expires_at IS NOT NULL AND r.expires_at < ${now}
  `;
  for (const e of expired) {
    await db.$executeRawUnsafe(
      "UPDATE fb_delete_task SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      e.task_id,
    );
  }

  const candidates = await db.$queryRaw<Array<{ id: string }>>`
    SELECT t.id
      FROM fb_delete_task t
      JOIN fb_delete_task_run r ON r.task_id = t.id
     WHERE t.status IN ('pending', 'running')
       AND t.run_at <= ${now}
       AND (r.claimed_at IS NULL OR r.claimed_at < ${staleBefore})
     ORDER BY t.run_at ASC
     LIMIT 5
  `;

  for (const c of candidates) {
    const affected = await db.$executeRawUnsafe(
      `UPDATE fb_delete_task_run
          SET claimed_at = ?, claimed_by = ?, attempts = attempts + 1
        WHERE task_id = ?
          AND (claimed_at IS NULL OR claimed_at < ?)`,
      now,
      workerId.slice(0, 80),
      c.id,
      staleBefore,
    );
    if (affected === 1) {
      await db.$executeRawUnsafe(
        "UPDATE fb_delete_task SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        c.id,
      );
      return getDeleteTask(c.id);
    }
  }
  return null;
}

export async function finishDeleteTask(
  taskId: string,
  result: { deletedCount: number; skippedCount: number; resultJson: string | null; note?: string },
): Promise<void> {
  await ensureFbDeleteTables();
  await db.$executeRawUnsafe(
    "UPDATE fb_delete_task SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    taskId,
  );
  await db.$executeRawUnsafe(
    `UPDATE fb_delete_task_run
        SET claimed_at = NULL, claimed_by = NULL, finished_at = ?, last_error = ?,
            deleted_count = ?, skipped_count = ?, result_json = ?
      WHERE task_id = ?`,
    new Date(),
    result.note?.slice(0, 500) || null,
    result.deletedCount,
    result.skippedCount,
    result.resultJson,
    taskId,
  );
  if (result.deletedCount > 0 && result.resultJson) {
    await markItemsDeleted(taskId, result.resultJson).catch(() => {
      /* 記帳失敗不要讓整個收尾炸掉 —— 貼文已經真的刪了，這裡只是讓畫面上的篇數對得上 */
    });
  }
}

/**
 * 這則文案曾經發到哪些社團（還沒被清掉的）。「按工作流清空」的 runner 要一個社團一個社團開「你的內容」，
 * 從這裡拿清單。只回有網址的（沒網址開不了「你的內容」）。
 */
export async function postedGroupsForDraft(
  draftId: string,
  /** 2026-10-07 發文身分：只列這個身分發過的（預設主帳號）。刪文要用當初發文的帳號登入才刪得到。 */
  identityId?: string | null,
): Promise<Array<{ id: string; name: string; url: string }>> {
  await ensureFbCoreTables();
  const identity = normalizeIdentityId(identityId);
  const rows = await db.$queryRawUnsafe<Array<{ group_id: string | null; group_name: string | null; group_url: string | null }>>(
    `SELECT i.group_id, i.group_name, i.group_url
      FROM fb_task_item i
      JOIN fb_task t ON t.id = i.task_id
     WHERE t.draft_id = ? AND i.status = 'posted' AND i.channel = 'group'
       AND i.deleted_at IS NULL AND i.group_url IS NOT NULL AND i.group_url <> ''
       AND ${identity ? "t.identity_id = ?" : "t.identity_id IS NULL"}
     ORDER BY i.done_at ASC`,
    draftId,
    ...(identity ? [identity] : []),
  );
  const seen = new Set<string>();
  const out: Array<{ id: string; name: string; url: string }> = [];
  for (const r of rows) {
    const key = parseGroupKey(r.group_url || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ id: r.group_id || key, name: r.group_name || key, url: normalizeGroupUrl(r.group_url || "") });
  }
  return out;
}

/**
 * 桌機真的刪掉之後，把對應的 fb_task_item 標成已刪（deleted_at）。
 * result_json 是 delete-group-content.mjs 回報的 items（每一項有 group 網址）——
 * 同一個社團刪了 n 篇，就把這則文案在那個社團最早的 n 列標起來。
 * 對不上社團的（舊的活動紀錄路徑回報的 group 是 null）就不動，寧可畫面多顯示也不要亂標。
 */
async function markItemsDeleted(taskId: string, resultJson: string): Promise<void> {
  const task = await getDeleteTask(taskId);
  if (!task) return;
  let items: Array<{ group?: string | null }> = [];
  try {
    const parsed = JSON.parse(resultJson) as unknown;
    if (Array.isArray(parsed)) items = parsed as Array<{ group?: string | null }>;
  } catch {
    return;
  }
  const perGroup = new Map<string, number>();
  for (const it of items) {
    const key = it.group ? parseGroupKey(it.group) : "";
    if (!key) continue;
    perGroup.set(key, (perGroup.get(key) || 0) + 1);
  }
  if (perGroup.size === 0) return;

  // 2026-10-07 發文身分：只標「這個刪除任務那個身分」發的那幾列（別的帳號發的同一則文案不能被連帶標成已刪）
  const taskIdentity = normalizeIdentityId(task.identity_id);
  const candidates = await db.$queryRawUnsafe<Array<{ id: string; group_id: string | null; group_url: string | null }>>(
    `SELECT i.id, i.group_id, i.group_url
      FROM fb_task_item i
      JOIN fb_task t ON t.id = i.task_id
     WHERE t.draft_id = ? AND i.status = 'posted' AND i.channel = 'group' AND i.deleted_at IS NULL
       AND ${taskIdentity ? "t.identity_id = ?" : "t.identity_id IS NULL"}
     ORDER BY i.done_at ASC`,
    task.draft_id,
    ...(taskIdentity ? [taskIdentity] : []),
  );
  const now = new Date();
  for (const [key, n] of perGroup) {
    const hits = candidates.filter((c) => parseGroupKey(c.group_url || "") === key || c.group_id === key).slice(0, n);
    for (const h of hits) {
      await db.$executeRawUnsafe(
        "UPDATE fb_task_item SET deleted_at = ?, delete_task_id = ? WHERE id = ? AND deleted_at IS NULL",
        now,
        taskId,
        h.id,
      );
    }
  }
}

/** 這輪不能刪但不是壞掉（例：登入沒接、桌機決定先不動手）——放回佇列，把剛才那次認領還回去。 */
export async function releaseDeleteTask(taskId: string, note: string): Promise<void> {
  await ensureFbDeleteTables();
  await db.$executeRawUnsafe(
    "UPDATE fb_delete_task SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    taskId,
  );
  await db.$executeRawUnsafe(
    `UPDATE fb_delete_task_run
        SET claimed_at = NULL, claimed_by = NULL,
            attempts = GREATEST(attempts - 1, 0), last_error = ?
      WHERE task_id = ?`,
    note.slice(0, 500),
    taskId,
  );
}

/** 執行失敗。試超過 maxAttempts 次就標 failed 不再重試 —— 一直重試刪除動作風險比重試發文更高。 */
export async function failDeleteTask(taskId: string, error: string, maxAttempts = 3): Promise<void> {
  await ensureFbDeleteTables();
  const run = await getDeleteTaskRun(taskId);
  const done = (run?.attempts || 0) >= maxAttempts;
  await db.$executeRawUnsafe(
    "UPDATE fb_delete_task SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    done ? "failed" : "pending",
    taskId,
  );
  await db.$executeRawUnsafe(
    "UPDATE fb_delete_task_run SET claimed_at = NULL, claimed_by = NULL, last_error = ?, finished_at = ? WHERE task_id = ?",
    error.slice(0, 500),
    done ? new Date() : null,
    taskId,
  );
}

/* ────────────────── 執行紀錄（從 fb_task_item 現算，沒有獨立的 log 表） ────────────────── */

export type ActivityRow = {
  itemId: string;
  taskId: string;
  channel: FbChannel;
  targetName: string;
  postTitle: string;
  status: string;
  note: string | null;
  at: Date | null;
};

export async function listActivity(opts?: {
  channel?: FbChannel;
  result?: string;
  limit?: number;
}): Promise<ActivityRow[]> {
  await ensureFbCoreTables();
  const filters: string[] = ["ti.status <> 'pending'"];
  const params: unknown[] = [];
  if (opts?.channel) {
    filters.push("t.channel = ?");
    params.push(opts.channel);
  }
  if (opts?.result && opts.result !== "all") {
    filters.push("ti.status = ?");
    params.push(opts.result);
  }
  const rows = await db.$queryRawUnsafe<
    Array<{
      item_id: string;
      task_id: string;
      channel: string;
      group_name: string | null;
      item_channel: string;
      title: string;
      status: string;
      note: string | null;
      done_at: Date | null;
    }>
  >(
    `SELECT ti.id AS item_id, ti.task_id, t.channel, ti.group_name, ti.channel AS item_channel,
            t.title, ti.status, ti.note, ti.done_at
       FROM fb_task_item ti
       JOIN fb_task t ON t.id = ti.task_id
      WHERE ${filters.join(" AND ")}
      ORDER BY COALESCE(ti.done_at, t.run_at) DESC
      LIMIT ?`,
    ...params,
    Math.min(opts?.limit || 300, 1000),
  );
  return rows.map((r) => ({
    itemId: r.item_id,
    taskId: r.task_id,
    channel: isChannel(r.channel) ? r.channel : "post",
    targetName: itemTargetName(r.item_channel, r.group_name),
    postTitle: r.title,
    status: r.status,
    note: r.note,
    at: r.done_at,
  }));
}

export type ActivityStats = {
  total: number;
  posted: number;
  failed: number;
  skipped: number;
  survival: number | null;
};

export async function activityStats(channel: FbChannel): Promise<ActivityStats> {
  await ensureFbCoreTables();
  const rows = await db.$queryRaw<
    Array<{ total: bigint; posted: bigint; failed: bigint; skipped: bigint }>
  >`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ti.status = 'posted'  THEN 1 ELSE 0 END) AS posted,
      SUM(CASE WHEN ti.status = 'failed'  THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN ti.status = 'skipped' THEN 1 ELSE 0 END) AS skipped
    FROM fb_task_item ti
    JOIN fb_task t ON t.id = ti.task_id
    WHERE t.channel = ${channel} AND ti.status <> 'pending'
  `;
  const r = rows[0];
  const posted = Number(r?.posted || 0);
  const failed = Number(r?.failed || 0);
  const denom = posted + failed;
  return {
    total: Number(r?.total || 0),
    posted,
    failed,
    skipped: Number(r?.skipped || 0),
    survival: denom > 0 ? Math.round((posted / denom) * 100) : null,
  };
}

export async function groupScoreboard(): Promise<
  Array<{ groupId: string; groupName: string; posted: number; failed: number }>
> {
  await ensureFbCoreTables();
  const rows = await db.$queryRaw<
    Array<{ group_id: string; group_name: string; posted: bigint; failed: bigint }>
  >`
    SELECT group_id,
           MAX(group_name) AS group_name,
           SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) AS posted,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM fb_task_item
     WHERE channel = 'group' AND group_id IS NOT NULL AND status <> 'pending'
     GROUP BY group_id
     ORDER BY failed DESC, posted DESC
  `;
  return rows.map((r) => ({
    groupId: r.group_id,
    groupName: r.group_name,
    posted: Number(r.posted),
    failed: Number(r.failed),
  }));
}

/* ────────────────── 總覽 ────────────────── */

export async function fbDashboardStats(): Promise<{
  drafts: number;
  groups: number;
  pendingTasks: number;
  dueTasks: number;
  dueDeleteTasks: number;
}> {
  await ensureFbCoreTables();
  const now = new Date();
  const [d, g, t, dt] = await Promise.all([
    db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM fb_draft`,
    db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM fb_group WHERE is_active = 1`,
    db.$queryRaw<Array<{ n: bigint; due: bigint }>>`
      SELECT COUNT(*) AS n,
             SUM(CASE WHEN run_at <= ${now} THEN 1 ELSE 0 END) AS due
        FROM fb_task WHERE status IN ('pending','running')
    `,
    db.$queryRaw<Array<{ due: bigint }>>`
      SELECT SUM(CASE WHEN run_at <= ${now} THEN 1 ELSE 0 END) AS due
        FROM fb_delete_task WHERE status IN ('pending','running')
    `,
  ]);
  return {
    drafts: Number(d[0]?.n || 0),
    groups: Number(g[0]?.n || 0),
    pendingTasks: Number(t[0]?.n || 0),
    dueTasks: Number(t[0]?.due || 0),
    dueDeleteTasks: Number(dt[0]?.due || 0),
  };
}

/* ────────────────── 上架／下架看板（2026-10-05，第一階段：只讀現有資料表） ──────────────────
 *
 * 本人看了同業「EZup好上架」的四分頁畫面想要同樣排版。差別是他以「物件」為主角，
 * 這個工廠原本以「文案／排程」為主角——所以這裡把每則文案（一戶）在某個通路的
 * 所有排程攤平，算出它現在落在哪一格。純讀取，不加欄位、不動 runner。
 *
 * 判斷順序（先中先贏）：
 *   ① 有 pending/running 的排程          → waiting  等待上架
 *   ② 最近一次排程一個目標都沒發成功，且是 failed/expired
 *      或 done 但有失敗                    → attention 需處理
 *   ③ 曾經發成功過（或 draft 狀態是 posted）→ done     完成上架
 *   ④ 其他                               → ready    可上架
 * 取消的排程是直接刪掉的（cancelTaskAction → deleteFbTask），所以不會出現在這裡。
 */
export type BoardStage = "ready" | "waiting" | "done" | "attention" | "archived";

export type BoardRow = {
  draftId: string;
  title: string;
  stage: BoardStage;
  priceWan: number | null;
  area: string;
  createdAt: Date;
  /** 最近一次真的發成功的時間（任何一個目標 posted 的 done_at 最大值） */
  lastPostedAt: Date | null;
  /** waiting：最早一筆還在排的排程；attention：出問題的那筆 */
  task: {
    id: string;
    runAt: Date;
    status: string;
    targets: number;
    groups: number;
    posted: number;
    failed: number;
    skipped: number;
    lastError: string | null;
  } | null;
  /** done：所有發成功的排程加總 */
  postedTargets: number;
  failedTargets: number;
  fbUrl: string | null;
  /** 第二階段（2026-10-05）：太平洋官網綁定與檢查結果 */
  pacificUrl: string | null;
  pacificStatus: string | null;
  pacificNote: string | null;
  pacificCheckedAt: Date | null;
  /** attention 的原因：官網下架（多半成交）／發文失敗 */
  attentionKind: "delisted" | "failed" | "recycle" | null;
  /** 還有沒發的排程（官網下架但排程還在＝會把成交的物件發出去，要提醒） */
  hasPendingTask: boolean;
  /** 第三階段（2026-10-05）：自動重新曝光 */
  recycleEnabled: boolean;
  recycleState: string | null;
  recycleNote: string | null;
};

export async function listBoardRows(channel: FbChannel): Promise<BoardRow[]> {
  await ensureFbCoreTables();
  await ensureFbRunnerTable();
  const drafts = await listFbDrafts({ channel, limit: 500 });
  const tasks = await db.$queryRawUnsafe<
    Array<{
      id: string;
      draft_id: string;
      run_at: Date;
      status: string;
      last_error: string | null;
      targets: unknown;
      groups: unknown;
      posted: unknown;
      failed: unknown;
      skipped: unknown;
      last_posted: Date | null;
    }>
  >(
    `SELECT t.id, t.draft_id, t.run_at, t.status, MAX(r.last_error) AS last_error,
            COUNT(ti.id) AS targets,
            SUM(CASE WHEN ti.channel = 'group' THEN 1 ELSE 0 END) AS \`groups\`,
            SUM(CASE WHEN ti.status = 'posted' THEN 1 ELSE 0 END) AS posted,
            SUM(CASE WHEN ti.status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN ti.status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
            MAX(CASE WHEN ti.status = 'posted' THEN ti.done_at ELSE NULL END) AS last_posted
       FROM fb_task t
       LEFT JOIN fb_task_run r ON r.task_id = t.id
       LEFT JOIN fb_task_item ti ON ti.task_id = t.id
      WHERE t.channel = ?
      GROUP BY t.id, t.draft_id, t.run_at, t.status
      ORDER BY t.run_at DESC`,
    channel,
  );

  const n = (v: unknown) => Number(v == null ? 0 : String(v)) || 0;
  const byDraft = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const list = byDraft.get(t.draft_id) || [];
    list.push(t);
    byDraft.set(t.draft_id, list);
  }

  return drafts.map((d) => {
    const facts = parseFacts(d.facts_json);
    const mp = parseMarketplace(d.marketplace_json);
    const mpWan = mp?.priceTwd != null ? Math.round(mp.priceTwd / 1000) / 10 : null;
    // 兩個通路價格分開存（2026-09-05）；這個通路沒填就拿另一個頂著，總比顯示「—」好認
    const priceWan = channel === "marketplace" ? mpWan ?? facts.totalPriceWan ?? null : facts.totalPriceWan ?? mpWan;
    const area = [facts.district, facts.communityName].filter(Boolean).join("・");
    const list = byDraft.get(d.id) || []; // run_at 由新到舊
    const toTask = (t: (typeof tasks)[number]) => ({
      id: t.id,
      runAt: t.run_at,
      status: t.status,
      targets: n(t.targets),
      groups: n(t.groups),
      posted: n(t.posted),
      failed: n(t.failed),
      skipped: n(t.skipped),
      lastError: t.last_error,
    });

    let lastPostedAt: Date | null = null;
    let postedTargets = 0;
    let failedTargets = 0;
    for (const t of list) {
      if (n(t.posted) > 0) {
        postedTargets += n(t.posted);
        failedTargets += n(t.failed);
        if (t.last_posted && (!lastPostedAt || t.last_posted > lastPostedAt)) lastPostedAt = t.last_posted;
      }
    }

    const active = list
      .filter((t) => t.status === "pending" || t.status === "running")
      .sort((a, b) => +a.run_at - +b.run_at)[0];
    const latest = list[0];
    const draftPosted = (channel === "post" ? d.post_status : d.marketplace_status) === "posted";

    let stage: BoardStage = "ready";
    let task: BoardRow["task"] = null;
    let attentionKind: BoardRow["attentionKind"] = null;
    const delisted = d.pacific_status === "gone" || d.pacific_status === "changed";
    if (d.board_archived_at) {
      stage = "archived";
    } else if (d.recycle_state === "paused") {
      // 自動重新曝光中途失敗：舊文可能已經刪了、新文沒貼，一定要讓本人看到
      stage = "attention";
      attentionKind = "recycle";
    } else if (delisted) {
      // 官網下架優先於其他狀態：就算還在排隊，也要先讓本人決定要不要取消（不然會把成交的物件發出去）
      stage = "attention";
      attentionKind = "delisted";
      task = active ? toTask(active) : null;
    } else if (active) {
      stage = "waiting";
      task = toTask(active);
    } else if (
      latest &&
      n(latest.posted) === 0 &&
      // 發到一半就逾時／失敗的（例如 20 個社團發成功、剩下沒發）算「完成上架」，成果欄會標失敗數；
      // 一個都沒發出去的才是真的要處理
      (latest.status === "failed" || latest.status === "expired" || (latest.status === "done" && n(latest.failed) > 0))
    ) {
      stage = "attention";
      attentionKind = "failed";
      task = toTask(latest);
    } else if (postedTargets > 0 || draftPosted) {
      stage = "done";
    }

    return {
      draftId: d.id,
      title: d.title,
      stage,
      priceWan,
      area,
      createdAt: d.created_at,
      lastPostedAt,
      task,
      postedTargets,
      failedTargets,
      fbUrl: (channel === "post" ? d.post_url : d.marketplace_url) || null,
      pacificUrl: d.pacific_url || null,
      pacificStatus: d.pacific_status || null,
      pacificNote: d.pacific_note || null,
      pacificCheckedAt: d.pacific_checked_at || null,
      attentionKind,
      hasPendingTask: Boolean(active),
      recycleEnabled: d.recycle_enabled === 1,
      recycleState: d.recycle_state || null,
      recycleNote: d.recycle_note || null,
    };
  });
}

/** 粉專動態／IG／Threads 帳號（2026-10-09）各自排了幾筆、發了幾筆（看 fb_task_item.target_identity_id）。 */
export async function apiIdentityUsage(): Promise<Map<string, { pending: number; posted: number; failed: number; lastAt: Date | null }>> {
  await ensureFbCoreTables();
  const rows = await db.$queryRawUnsafe<Array<{ id: string; pending: unknown; posted: unknown; failed: unknown; last_at: Date | null }>>(
    `SELECT target_identity_id AS id,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) AS posted,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            MAX(CASE WHEN status = 'posted' THEN done_at ELSE NULL END) AS last_at
       FROM fb_task_item WHERE target_identity_id IS NOT NULL GROUP BY target_identity_id`,
  );
  const n = (v: unknown) => Number(String(v ?? 0)) || 0;
  return new Map(rows.map((r) => [r.id, { pending: n(r.pending), posted: n(r.posted), failed: n(r.failed), lastAt: r.last_at }]));
}
