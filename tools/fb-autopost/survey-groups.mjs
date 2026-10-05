/**
 * 抽查社團：每個社團的「發文入口」到底長什麼樣
 *
 * 跑法：node survey-groups.mjs [要看幾個]
 *
 * ⭐ 為什麼要有這支：2026-08-25 抄第一個社團時發現，**不同社團的發文入口不一樣**——
 *    ・一般社團：「寫點什麼吧…」→ 跟首頁一樣的「建立貼文」視窗
 *    ・買賣社團：沒有一般發文框，只有一顆滿版的「商品拍賣」→ 走的是填表單的流程
 *    房仲加的社團很多是買賣型的，比例不先問清楚，程式會寫錯方向。
 *
 * 🔴 只看，不發文、不點任何按鈕。純粹載入頁面看有什麼。
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { AUTH_FILE, loadGroups, authSessionStatus, humanDelay, 登入問題說明 } from "./_shared.mjs";

if (!authSessionStatus().有登入) {
  console.error(`\n❌ ${登入問題說明()}\n`);
  process.exit(1);
}

const 要看幾個 = Number(process.argv[2] || 10);
const 全部 = loadGroups().社團;

// 優先看跟房地產／台中海線有關的 —— 那才是實際會發文的地方
const 排序 = [...全部].sort((a, b) => {
  const 分 = (n) => (/房|屋|地產|不動產|買賣|海線|梧棲|清水|沙鹿|龍井/.test(n) ? 0 : 1);
  return 分(a.名稱) - 分(b.名稱);
});
const 要看 = 排序.slice(0, 要看幾個);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({
  storageState: AUTH_FILE,
  viewport: { width: 1400, height: 900 },
  locale: "zh-TW",
});
const page = await ctx.newPage();

const 結果 = [];
for (const [i, g] of 要看.entries()) {
  process.stdout.write(`(${i + 1}/${要看.length}) ${g.名稱.slice(0, 22)}… `);
  try {
    await page.goto(g.網址, { waitUntil: "domcontentloaded", timeout: 45000 });
    // ⚠️ 社團頁載得比首頁慢很多。等太短會抄到還在「載入中……」的骨架，
    //    結果每個社團都判成「看不出來」。要等到骨架消失才算數。
    for (let t = 0; t < 20; t++) {
      await humanDelay(900, 1100);
      const 還在載 = await page.locator('[role="status"][aria-label*="載入"]').count().catch(() => 0);
      const 有東西 = await page.locator('div[role="button"]').count().catch(() => 0);
      if (!還在載 && 有東西 > 20) break;
    }
    await humanDelay(2000, 2600);

    const info = await page.evaluate(() => {
      const 全文 = document.body.innerText || "";
      const 滿版鈕 = Array.from(document.querySelectorAll('div[role="button"]'))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { aria: el.getAttribute("aria-label") || "", text: (el.innerText || "").trim().slice(0, 16), w: Math.round(r.width) };
        })
        .filter((b) => b.w > 300 && (b.aria || b.text));
      // 🔴 社團的發文框寫「留個言吧……」，不是首頁那句「在想些什麼」。
      //    而且要認 div[role=button]，不能只搜頁面文字 ——
      //    貼文底下的留言框長得很像，但那是 role=textbox。
      const 發文框 = Array.from(document.querySelectorAll('div[role="button"]')).some((el) => {
        const t = (el.innerText || "").trim();
        return /留個言吧|寫點什麼|在想些什麼/.test(t) && el.getBoundingClientRect().width > 300;
      });
      return {
        有一般發文框: 發文框,
        有商品買賣分頁: /商品買賣|商品拍賣/.test(全文),
        要管理員審核: /管理員批准|管理員審核|待審核/.test(全文),
        不能發文: /你無法在此社團發文|已被停權|僅限管理員/.test(全文),
        滿版鈕: 滿版鈕.slice(0, 4),
      };
    });

    const 類型 = info.有一般發文框 ? "可以發文" : "沒有發文框";
    結果.push({ 名稱: g.名稱, 網址: g.網址, 類型, ...info });
    console.log(`${類型}${info.要管理員審核 ? "（要審核）" : ""}`);
  } catch (e) {
    結果.push({ 名稱: g.名稱, 網址: g.網址, 類型: "開不起來", 錯誤: e.message.slice(0, 60) });
    console.log("開不起來");
  }
}

await browser.close();

const 統計 = 結果.reduce((a, r) => ((a[r.類型] = (a[r.類型] || 0) + 1), a), {});
console.log(`\n${"─".repeat(60)}`);
console.log("抽查結果：", JSON.stringify(統計));
console.log(`要管理員審核的：${結果.filter((r) => r.要管理員審核).length} 個`);

const out = path.join(import.meta.dirname, "config", "group-survey.json");
writeFileSync(out, JSON.stringify({ 抽查了: 結果.length, 統計, 明細: 結果 }, null, 2), "utf8");
console.log(`明細寫進 ${out}`);
