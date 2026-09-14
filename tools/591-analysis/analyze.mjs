/**
 * 591 競品分析 —— 貼一個物件網址，產生報告
 *
 * 跑法：node analyze.mjs <591物件網址>
 *   例：node analyze.mjs https://sale.591.com.tw/home/house/detail/2/20731244.html
 *   沒給網址會用終端機問。
 *
 * ⚠️ 這支腳本刻意做了跟 591 自動填表一樣的「慢一點但不會出事」設計：
 *   1. **最多開兩頁，不會更多。** 你貼的那一頁，加上用社區名在 591 主站搜一次的
 *      結果頁（同一個社區、同一個網站）。不吃網址清單、不會自己點進結果裡每一筆
 *      去查、不模擬捲動載入更多、不翻頁抓完整份清單——搜尋頁只抓打開當下已經
 *      渲染出來的那三十筆左右，報告裡會誠實寫「找到 N 筆，顯示 M 筆」。
 *   2. **用真的 Chrome、看得到畫面。** 跟真人開瀏覽器看一頁沒有本質差異，
 *      不是背景無聲跑的爬蟲程式。
 *   3. **591 頁面明文禁止自動抓取程式**（見頁尾的免責聲明），這件事本人已經
 *      知情並選擇沿用跟 591 自動填表一樣的做法。不要把這支腳本改成排程、
 *      批次跑很多網址，那已經超出當初評估過的風險範圍。
 *   4. **總價／權狀坪／樓層來自搜尋頁的純文字，不是破解來的。** market.591.com.tw
 *      的社區清單頁用 obfuscate 元件把這三格藏起來，我們從頭到尾沒有去繞它，
 *      2026-09-14 起乾脆不讀那頁了（見 extract.mjs 開頭的說明）。
 */
import { chromium } from "playwright";
import { extractListing, extractSearchComps } from "./extract.mjs";
import { renderReport } from "./render-report.mjs";
import {
  askLine, buildCommunitySearchUrl, dedupeComps, ensureDir, loadOwner, normalizeDetailUrl,
  parseAddress, REPORTS_DIR, stamp,
} from "./_shared.mjs";
import { writeFileSync } from "node:fs";
import path from "node:path";

let inputUrl = process.argv[2];
if (!inputUrl) {
  if (!process.stdin.isTTY) {
    console.error("用法：node analyze.mjs <591物件網址>");
    process.exit(1);
  }
  inputUrl = await askLine("貼 591 物件詳情頁網址：");
}

let url;
try {
  url = normalizeDetailUrl(inputUrl);
} catch (err) {
  console.error(`\n${err.message}`);
  process.exit(1);
}

console.log(`\n開啟：${url}`);
const headless = process.env.ANALYSIS_HEADLESS === "1";
const browser = await chromium.launch({ channel: "chrome", headless, args: ["--start-maximized"] });
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  // 社區資訊區塊是頁面主要內容之一，通常隨頁面一起出現；等它一下，
  // 等不到也繼續（extract.mjs 會把缺少的部分記進 warnings，不會整支掛掉）。
  await page.waitForSelector(".n-community-container", { timeout: 8000 }).catch(() => {});

  let data = await extractListing(page);

  // 實測遇過一次：社區資訊區塊（獨立元件）已經 hydrate 完成，但頁面主要的
  // 標題／價格／規格那個元件還沒——這時候讀到的不是「還沒出現」而是字面上的
  // 樣板語法（extract.mjs 的 text() 已經擋掉，回空字串），跟真的抓不到長得一樣。
  // 多等一下再讀一次同一個已開好的頁面（不是重新整頁，不會多打一次 591），
  // 通常這樣就夠了；還是空的就照實記警告，不繼續空等。
  if (!data.title) {
    console.log("\n標題還沒 hydrate 完成，等 1.5 秒後重讀一次同一頁...");
    await page.waitForTimeout(1500);
    data = await extractListing(page);
  }

  console.log(`\n物件：${data.title || "（抓不到標題）"}`);
  console.log(`總價：${data.totalPrice?.raw || "—"} 萬　單價：${data.unitPrice?.raw || "—"}`);
  console.log(`社區：${data.communityName || "—"}`);
  if (data.community) {
    console.log(
      `社區在售 ${data.community.onSaleCount ?? "—"} 間・近半個月上架 ${data.community.recentListedCount ?? "—"} 間・降價 ${data.community.priceDroppedCount ?? "—"} 間`,
    );
  }
  // 第二頁：用社區名在 591 主站搜一次，逐筆拿同社區在售物件（含總價／權狀坪／樓層）。
  // 跟第一頁同一個瀏覽器分頁繼續開，不開新視窗。
  if (data.community) {
    const addr = parseAddress(data.address);
    const name = data.community.name || data.communityName;
    data.community.comps = [];
    data.community.compsMeta = null;
    if (!name) {
      data.warnings.push("沒有社區名，無法搜同社區在售物件");
    } else if (!addr.regionId) {
      data.warnings.push(`地址「${data.address || ""}」拆不出縣市，無法搜同社區在售物件（591 不帶縣市會預設搜台北市）`);
    } else {
      const searchUrl = buildCommunitySearchUrl(addr.regionId, name);
      console.log(`\n搜同社區在售物件：${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForSelector(".ware-item", { timeout: 8000 }).catch(() => {});
      const { foundCount, renderedCount, comps } = await extractSearchComps(page, {
        communityName: name,
        district: addr.district,
        road: addr.road,
      });
      const deduped = dedupeComps(comps);
      data.community.comps = deduped.comps;
      data.community.compsMeta = {
        searchUrl, foundCount, renderedCount,
        matchedCount: comps.length,
        uniqueCount: deduped.uniqueCount,
        dupGroupCount: deduped.dupGroupCount,
      };
      console.log(
        `591 找到 ${foundCount ?? "—"} 筆，頁面顯示 ${renderedCount} 筆，屬本社區 ${comps.length} 筆，` +
          `去重後 ${deduped.uniqueCount} 戶（${deduped.dupGroupCount} 組重複刊登）`,
      );
      if (renderedCount > 0 && comps.length === 0) {
        data.warnings.push("搜尋頁有結果但沒有一筆對得上這個社區（社區名拼法或地址對不上，看 extract.mjs 的過濾條件）");
      }
    }
  }

  if (data.warnings.length) {
    console.log(`\n⚠️  有 ${data.warnings.length} 項抓不到：`);
    for (const w of data.warnings) console.log(`   ・${w}`);
    console.log("   （591 可能局部改版了，報告仍會產生，缺的欄位會留白不是亂填）");
  }

  const owner = await loadOwner();
  const html = renderReport(data, owner);

  ensureDir(REPORTS_DIR);
  const slug = (data.communityName || data.title || "物件").replace(/[\\/:*?"<>|]/g, "").slice(0, 20);
  const base = path.join(REPORTS_DIR, `${stamp()}_${slug}`);
  const outFile = `${base}.html`;
  writeFileSync(outFile, html, "utf8");
  // 抓到的原始資料另存一份：之後只改報告文字／版面時，跑 render-only.mjs 重排就好，
  // 不用再開一次 591。
  writeFileSync(`${base}.json`, JSON.stringify(data, null, 2), "utf8");

  console.log(`\n報告已產生：${outFile}`);
} finally {
  await browser.close();
}
