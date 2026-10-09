/**
 * 把「你加入的社團」抓下來 → 寫進 config/groups.json → 同步進官網後台的 fb_group 表。
 *
 * 跑法：
 *   npm run groups            抓清單 ＋ 逐一進每個社團抓「人數／公開私密／要不要審核／有沒有討論分頁」＋ 同步進資料庫
 *   npm run groups -- --fast  只抓清單（名稱＋網址），不進每個社團（快，但沒有人數）
 *   npm run groups -- --no-db  抓完只寫 groups.json，不碰資料庫
 *
 * ⭐ 為什麼要有這支：社團網址是 `facebook.com/groups/1909761542949…` 這種數字，
 *    手打十個一定會打錯，打錯的後果是「發到別人的社團」。讓程式自己去讀。
 *
 * 🔴 只會看，不會發文、不會加入或退出任何社團。
 *    抓回來的社團在後台預設「未啟用」—— 要發哪些由本人在後台勾，程式不替他決定。
 */
import { chromium } from "playwright";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  AUTH_FILE,
  SHOTS_DIR,
  PROJECT_ROOT,
  authSessionStatus,
  authFileForIdentity,
  ensureDir,
  humanDelay,
  loadEnv,
  stamp,
  登入問題說明,
} from "./_shared.mjs";

const argv = process.argv.slice(2);
const FAST = argv.includes("--fast");
const NO_DB = argv.includes("--no-db");

/**
 * 2026-10-07 發文身分：`--identity=<登入代號>` 用那個身分的登入檔抓「那個帳號加入的社團」，
 * 寫進那個身分自己的清單（config/groups-<代號>.json ＋ 資料庫 fb_group.identity_id）。
 * 沒加＝主帳號，跟以前一模一樣。
 */
const IDENTITY_KEY = argv.find((a) => a.startsWith("--identity="))?.slice("--identity=".length).trim() || null;
let AUTH_TARGET = AUTH_FILE;
if (IDENTITY_KEY) {
  try {
    AUTH_TARGET = authFileForIdentity(IDENTITY_KEY);
  } catch (e) {
    console.error(`\n❌ ${e.message}\n   登入代號長這樣：acct-k7m2（在後台「發文身分」頁、那個身分的卡片上）。\n`);
    process.exit(1);
  }
}

if (!authSessionStatus(AUTH_TARGET).有登入) {
  console.error(
    IDENTITY_KEY
      ? `\n❌ 現在跑不了。發文身分「${IDENTITY_KEY}」還沒登入（或登入過期）。\n   先雙擊 FB其他帳號-1登入.bat、輸入同一個登入代號登入那個帳號，再來抓社團。\n`
      : `\n❌ 現在跑不了。\n   ${登入問題說明()}\n`,
  );
  process.exit(1);
}

const GROUPS_FILE = path.join(import.meta.dirname, "config", IDENTITY_KEY ? `groups-${IDENTITY_KEY}.json` : "groups.json");
if (IDENTITY_KEY && !existsSync(GROUPS_FILE)) {
  ensureDir(path.dirname(GROUPS_FILE));
  writeFileSync(GROUPS_FILE, JSON.stringify({ 社團: [] }, null, 2), "utf8");
}
if (IDENTITY_KEY) console.log(`\n抓的是發文身分「${IDENTITY_KEY}」的社團清單 → ${path.basename(GROUPS_FILE)}（主帳號的清單不會被動到）`);

const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--start-maximized"] });
const context = await browser.newContext({ storageState: AUTH_TARGET, viewport: null, locale: "zh-TW" });
const page = await context.newPage();
ensureDir(SHOTS_DIR);

/** "14.3 萬" → 143000 */
function 人數轉數字(raw) {
  if (!raw) return null;
  const m = String(raw).match(/([\d,.]+)\s*(萬|億)?/);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  if (m[2] === "萬") n *= 10_000;
  else if (m[2] === "億") n *= 100_000_000;
  return Math.round(n);
}

try {
  /* ── 1. 抓清單（左側「你加入的社團」） ── */
  console.log("開啟「你的社團」…");
  await page.goto("https://www.facebook.com/groups/joins/", { waitUntil: "domcontentloaded" });
  await humanDelay(3500, 4500);

  console.log("往下捲，把清單載完…");
  // 🔴 2026-09-05 修：舊寫法「連一次沒變就停」太脆弱——FB 虛擬化清單偶爾渲染慢半拍，
  //    單次沒新增不代表捲完了。改成跟 delete-groups.mjs 讀活動紀錄同一套「連續兩次沒變才停」，
  //    上限也從 20 次拉高到 50 次（社團數多的話 20 次不夠捲到底，本人實測 315 個只捲到 132 個就提早停了）。
  let 上次數量 = 0;
  let 連續沒變 = 0;
  for (let i = 0; i < 50; i++) {
    await page.mouse.wheel(0, 2200);
    await humanDelay(900, 1400);
    const n = await page.locator('a[href*="/groups/"]').count();
    連續沒變 = n === 上次數量 ? 連續沒變 + 1 : 0;
    if (連續沒變 >= 2 && i > 3) break;
    上次數量 = n;
  }

  const 清單 = await page.evaluate(() => {
    const map = new Map();
    for (const a of document.querySelectorAll('a[href*="/groups/"]')) {
      const href = a.href.split("?")[0].replace(/\/$/, "");
      const m = href.match(/^https:\/\/www\.facebook\.com\/groups\/([^/]+)$/);
      if (!m || ["joins", "feed", "discover", "create"].includes(m[1])) continue;
      let 名稱 = (a.innerText || "").trim().split("\n")[0];
      名稱 = 名稱
        .replace(/^未讀\s*/, "")
        .replace(/\s*上次發文時間：.*$/, "")
        .split(/[:：]\s*["「]/)[0]
        .trim()
        .slice(0, 80);
      if (!名稱) continue;
      if (!map.has(href)) map.set(href, 名稱);
    }
    return [...map].map(([網址, 名稱]) => ({ 名稱, 網址 }));
  });
  await page.screenshot({ path: path.join(SHOTS_DIR, `${stamp()}-社團清單.png`) }).catch(() => {});
  console.log(`  抓到 ${清單.length} 個社團`);

  /* ── 2. 逐一進每個社團，抓人數 / 公開私密 / 審核 / 討論分頁 ── */
  const 細節 = new Map();
  if (!FAST) {
    console.log(`\n逐一進每個社團抓細節（每個隔幾秒，${清單.length} 個大約 ${Math.ceil((清單.length * 6) / 60)} 分鐘）…`);
    for (let i = 0; i < 清單.length; i++) {
      const g = 清單[i];
      try {
        await page.goto(g.網址, { waitUntil: "domcontentloaded" });
        await humanDelay(2600, 4200);
        const d = await page.evaluate(() => {
          const body = document.body.innerText.replace(/\s+/g, " ");
          const 成員 = body.match(/([\d,.]+\s*(?:萬|億)?)\s*位成員/);
          const 隱私 = /不公開社團|私密社團|私人社團/.test(body)
            ? "private"
            : /公開社團/.test(body)
              ? "public"
              : null;
          const 要審核 = /正在等待管理員批准|貼文需要.*?管理員|你的貼文需要獲得核准/.test(body);

          // 分頁能力 —— 「關於」永遠是第一個分頁，後面接的就是這個社團有的分頁
          const navRegion = (body.match(/關於[\s\S]{0,120}/) || [""])[0];
          const hrefs = [...document.querySelectorAll('a[href*="/groups/"]')].map((a) => a.getAttribute("href") || "");
          const 有商品買賣 =
            /關於[\s\S]{0,60}商品買賣/.test(body) ||
            /商品買賣[\s\S]{0,30}(精選|你的商品|尋求)/.test(navRegion) ||
            hrefs.some((h) => /\/(buy_sell_group|shop|for-sale)\b/.test(h));
          const 有討論 =
            /關於[\s\S]{0,40}(討論區?|貼文)/.test(navRegion) ||
            (!有商品買賣 && !/關於[\s\S]{0,60}商品買賣/.test(body));

          return { 成員: 成員 ? 成員[1].trim() : null, 隱私, 要審核, 有討論, 有商品買賣 };
        });
        細節.set(g.網址, {
          人數: 人數轉數字(d.成員),
          隱私: d.隱私,
          要審核: d.要審核,
          有討論: d.有討論,
          有商品買賣: d.有商品買賣,
        });
        if ((i + 1) % 10 === 0) {
          console.log(`  …${i + 1}/${清單.length}`);
          await humanDelay(4000, 7000); // 每 10 個多喘一下
        }
      } catch (e) {
        console.log(`  ⚠ ${g.名稱}：${e.message.slice(0, 60)}`);
      }
    }
  }

  /* ── 3. 寫 groups.json（保留本人在檔案裡的「啟用」設定） ── */
  const 舊 = JSON.parse(readFileSync(GROUPS_FILE, "utf8"));
  const 舊設定 = new Map((舊.社團 || []).map((g) => [g.網址, g]));
  舊.社團 = 清單.map((g) => {
    const d = 細節.get(g.網址) || {};
    const prev = 舊設定.get(g.網址) || {};
    return {
      名稱: g.名稱,
      網址: g.網址,
      啟用: prev.啟用 ?? false,
      備註: prev.備註 ?? "",
      人數: d.人數 ?? prev.人數 ?? null,
      隱私: d.隱私 ?? prev.隱私 ?? null,
      要審核: d.要審核 ?? prev.要審核 ?? null,
      有討論: d.有討論 ?? prev.有討論 ?? null,
      有商品買賣: d.有商品買賣 ?? prev.有商品買賣 ?? null,
    };
  });
  舊._上次更新 = stamp();
  writeFileSync(GROUPS_FILE, JSON.stringify(舊, null, 2), "utf8");
  console.log(`\n✅ 已寫進 config/groups.json（${舊.社團.length} 個）`);

  /* ── 4. 同步進資料庫 fb_group ── */
  if (!NO_DB) {
    try {
      loadEnv();
      if (!process.env.DATABASE_URL) throw new Error("找不到 DATABASE_URL");
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

      // 2026-10-07 發文身分：fb_group 多一欄 identity_id（NULL＝主帳號）。這支自己連資料庫，所以欄位自己補。
      try {
        await db.$executeRawUnsafe("ALTER TABLE fb_group ADD COLUMN IF NOT EXISTS identity_id VARCHAR(64) NULL");
      } catch {
        /* 已存在 */
      }
      // 登入代號 → 身分的 id。查不到就中止同步（不要把另一個帳號的社團寫成主帳號的）
      let identityId = null;
      if (IDENTITY_KEY) {
        const found = await db.$queryRawUnsafe("SELECT id FROM fb_identity WHERE auth_key = ? LIMIT 1", IDENTITY_KEY);
        if (!found.length) {
          throw new Error(`資料庫裡找不到登入代號 ${IDENTITY_KEY} 的發文身分——先到後台「發文身分」頁新增，再來抓社團（groups-${IDENTITY_KEY}.json 已經寫好了）`);
        }
        identityId = found[0].id;
      }

      // 判重只在「同一個身分的清單」裡比：同一個社團兩個帳號都有加入，會是兩列（各自有自己的啟用／冷卻／封存設定）
      const 現有 = (await db.$queryRawUnsafe("SELECT id, url, identity_id FROM fb_group")).filter(
        (r) => (r.identity_id || null) === identityId,
      );
      const key = (u) => {
        const m = String(u).match(/groups\/([^/?#]+)/);
        return m ? m[1].toLowerCase() : String(u).toLowerCase();
      };
      const byKey = new Map(現有.map((r) => [key(r.url), r.id]));

      // 有討論＋有商品買賣 → both；只有討論 → post；只有商品買賣 → marketplace
      const 算accepts = (有討論, 有商品) => {
        if (有討論 && 有商品) return "both";
        if (有討論 && 有商品 === false) return "post";
        if (有討論 === false && 有商品) return "marketplace";
        return null; // 抓不到 → 不動
      };

      let added = 0;
      let updated = 0;
      for (const g of 舊.社團) {
        const k = key(g.網址);
        const scannedAt = g.人數 != null || g.隱私 != null ? new Date() : null;
        const acc = 算accepts(g.有討論, g.有商品買賣);
        const hit = byKey.get(k);
        if (hit) {
          // 🔴 COALESCE：這次抓不到（null）就保留舊值，不要把之前抓好的洗掉
          await db.$executeRawUnsafe(
            `UPDATE fb_group SET name=?, url=?,
                 member_count=COALESCE(?, member_count),
                 privacy=COALESCE(?, privacy),
                 needs_approval=COALESCE(?, needs_approval),
                 has_discussion=COALESCE(?, has_discussion),
                 has_marketplace=COALESCE(?, has_marketplace),
                 accepts=COALESCE(?, accepts),
                 scanned_at=COALESCE(?, scanned_at), updated_at=CURRENT_TIMESTAMP WHERE id=?`,
            g.名稱.slice(0, 200),
            g.網址.slice(0, 500),
            g.人數,
            g.隱私,
            g.要審核 == null ? null : g.要審核 ? 1 : 0,
            g.有討論 == null ? null : g.有討論 ? 1 : 0,
            g.有商品買賣 == null ? null : g.有商品買賣 ? 1 : 0,
            acc,
            scannedAt,
            hit,
          );
          updated++;
        } else {
          const id = globalThis.crypto.randomUUID().replace(/-/g, "");
          await db.$executeRawUnsafe(
            `INSERT INTO fb_group (id, name, url, accepts, cooldown_days, is_active, member_count, privacy, needs_approval, has_discussion, has_marketplace, scanned_at, identity_id, created_at)
             VALUES (?, ?, ?, ?, 7, 0, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            id,
            g.名稱.slice(0, 200),
            g.網址.slice(0, 500),
            acc || "both",
            g.人數,
            g.隱私,
            g.要審核 == null ? null : g.要審核 ? 1 : 0,
            g.有討論 == null ? null : g.有討論 ? 1 : 0,
            g.有商品買賣 == null ? null : g.有商品買賣 ? 1 : 0,
            scannedAt,
            identityId,
          );
          byKey.set(k, id);
          added++;
        }
      }
      await db.$disconnect();
      console.log(`✅ 已同步進資料庫：新增 ${added}、更新 ${updated}`);
      console.log(`   後台 → 社團清單，已經看得到全部 ${舊.社團.length} 個，用勾的挑要發哪些。`);
    } catch (e) {
      console.log(`\n⚠ 資料庫沒同步到（groups.json 有寫好，不影響）：${e.message}`);
      console.log(`   之後可以單獨跑：node ${path.relative(process.cwd(), path.join(PROJECT_ROOT, "scripts", "sync-fb-groups.mjs"))}`);
    }
  }

  /* ── 摘要 ── */
  const 有人數 = 舊.社團.filter((g) => g.人數 != null).length;
  const 只商品 = 舊.社團.filter((g) => g.有商品買賣 && !g.有討論).length;
  const 只討論 = 舊.社團.filter((g) => g.有討論 && !g.有商品買賣).length;
  const 兩種都可 = 舊.社團.filter((g) => g.有討論 && g.有商品買賣).length;
  const 要審核 = 舊.社團.filter((g) => g.要審核).length;
  console.log(
    `\n📊 ${舊.社團.length} 個社團：${有人數} 個抓到人數 ｜ ${兩種都可} 個兩種都能發、${只討論} 個只能發一般貼文、${只商品} 個只能上架 Marketplace ｜ ${要審核} 個貼文要管理員審核`,
  );
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  await page.screenshot({ path: path.join(SHOTS_DIR, `${stamp()}-抓社團失敗.png`) }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}

process.exit(process.exitCode || 0);
