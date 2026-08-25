/**
 * 591 競品分析 —— 貼一個物件網址，產生報告
 *
 * 跑法：node analyze.mjs <591物件網址>
 *   例：node analyze.mjs https://sale.591.com.tw/home/house/detail/2/20731244.html
 *   沒給網址會用終端機問。
 *
 * ⚠️ 這支腳本刻意做了跟 591 自動填表一樣的「慢一點但不會出事」設計：
 *   1. **最多開兩頁，不會更多。** 你貼的那一頁，加上該頁本身連去的「本社區在售物件」
 *      清單頁（同一個社區，不是另一個網站）。不吃網址清單、不會自己點進清單裡
 *      每一筆去查、不模擬捲動載入更多、不翻頁抓完整份清單——清單頁只抓打開當下
 *      已經渲染出來的那十來筆，報告裡會誠實寫「顯示前 N 筆，共 M 筆」。
 *   2. **用真的 Chrome、看得到畫面。** 跟真人開瀏覽器看一頁沒有本質差異，
 *      不是背景無聲跑的爬蟲程式。
 *   3. **591 頁面明文禁止自動抓取程式**（見頁尾的免責聲明），這件事本人已經
 *      知情並選擇沿用跟 591 自動填表一樣的做法。不要把這支腳本改成排程、
 *      批次跑很多網址，那已經超出當初評估過的風險範圍。
 *   4. **清單頁上 591 用自訂元件把總價／坪數／樓層直接藏起來**（見 extract.mjs
 *      的 `extractCommunityComps` 註解）。這裡不試圖破解，那三個欄位在報告裡
 *      就是留白＋一個連去單一物件頁的連結，不是 bug。
 */
import { chromium } from "playwright";
import { extractListing, extractCommunityComps } from "./extract.mjs";
import { renderReport } from "./render-report.mjs";
import { askLine, ensureDir, loadOwner, normalizeDetailUrl, REPORTS_DIR, stamp } from "./_shared.mjs";
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
  if (data.warnings.length) {
    console.log(`\n⚠️  有 ${data.warnings.length} 項抓不到：`);
    for (const w of data.warnings) console.log(`   ・${w}`);
    console.log("   （591 可能局部改版了，報告仍會產生，缺的欄位會留白不是亂填）");
  }

  // 第二頁（同一個社區的在售物件清單）：這才是真正逐筆比較的「競品」，
  // 不是只有社區級的統計數字。跟第一頁同一個瀏覽器分頁繼續開，不開新視窗。
  if (data.community?.onSaleListUrl) {
    console.log(`\n開啟社區在售清單：${data.community.onSaleListUrl}`);
    await page.goto(data.community.onSaleListUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("a > div.info", { timeout: 8000 }).catch(() => {});
    data.community.comps = await extractCommunityComps(page);
    console.log(`抓到 ${data.community.comps.length} 筆在售競品（頁面預設顯示的部分）`);
  } else {
    data.community && (data.community.comps = []);
  }

  const owner = await loadOwner();
  const html = renderReport(data, owner);

  ensureDir(REPORTS_DIR);
  const slug = (data.communityName || data.title || "物件").replace(/[\\/:*?"<>|]/g, "").slice(0, 20);
  const outFile = path.join(REPORTS_DIR, `${stamp()}_${slug}.html`);
  writeFileSync(outFile, html, "utf8");

  console.log(`\n報告已產生：${outFile}`);
} finally {
  await browser.close();
}
