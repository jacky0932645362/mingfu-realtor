/**
 * 一次性：開幾個社團頁，驗「人數 / 公開私密 / 審核 / 討論分頁 / 商品買賣分頁」的抓法。
 * 跑法：node probe-member-count.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AUTH_FILE, authSessionStatus, humanDelay, 登入問題說明 } from "./_shared.mjs";

if (!authSessionStatus().有登入) {
  console.error(`\n❌ ${登入問題說明()}\n`);
  process.exit(1);
}

const N = Number(process.argv[2] || 8);
const groups = JSON.parse(readFileSync(path.join(import.meta.dirname, "config", "groups.json"), "utf8")).社團.slice(0, N);

const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--start-maximized"] });
const context = await browser.newContext({ storageState: AUTH_FILE, viewport: null, locale: "zh-TW" });
const page = await context.newPage();

try {
  for (const g of groups) {
    await page.goto(g.網址, { waitUntil: "domcontentloaded" });
    await humanDelay(3000, 4200);

    const d = await page.evaluate(() => {
      const body = document.body.innerText.replace(/\s+/g, " ");
      const 成員 = body.match(/([\d,.]+\s*(?:萬|億)?)\s*位成員/);
      const 隱私 = /不公開社團|私密社團|私人社團/.test(body)
        ? "private"
        : /公開社團/.test(body)
          ? "public"
          : null;
      const 要審核 = /正在等待管理員批准|貼文需要.*?管理員|你的貼文需要獲得核准/.test(body);
      const navRegion = (body.match(/關於[\s\S]{0,120}/) || [""])[0];
      const hrefs = [...document.querySelectorAll('a[href*="/groups/"]')].map((a) => a.getAttribute("href") || "");
      const 有商品買賣 =
        /關於[\s\S]{0,60}商品買賣/.test(body) ||
        /商品買賣[\s\S]{0,30}(精選|你的商品|尋求)/.test(navRegion) ||
        hrefs.some((h) => /\/(buy_sell_group|shop|for-sale)\b/.test(h));
      const 有討論 =
        /關於[\s\S]{0,40}(討論區?|貼文)/.test(navRegion) ||
        (!有商品買賣 && !/關於[\s\S]{0,60}商品買賣/.test(body));
      return { 成員: 成員 ? 成員[1].trim() : null, 隱私, 要審核, 有討論, 有商品買賣, navRegion: navRegion.slice(0, 90) };
    });
    console.log(
      `\n${g.名稱}\n  人數 ${d.成員 || "?"} · ${d.隱私 || "?"} · 審核=${d.要審核} · 討論=${d.有討論} · 商品買賣=${d.有商品買賣}\n  nav: ${d.navRegion}`,
    );
  }
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}
process.exit(process.exitCode || 0);
