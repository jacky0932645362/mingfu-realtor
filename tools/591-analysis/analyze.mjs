/**
 * 591 競品分析 —— 貼一個物件網址，產生報告
 *
 * 跑法：node analyze.mjs <591物件網址>
 *   例：node analyze.mjs https://sale.591.com.tw/home/house/detail/2/20731244.html
 *   沒給網址會用終端機問。
 *
 * ⚠️ 這支腳本刻意做了跟 591 自動填表一樣的「慢一點但不會出事」設計：
 *   1. **一次一筆。** 沒有批次迴圈、不吃網址清單、不會自己去點其他物件連結。
 *      只抓你貼的這一頁本來就顯示給人看的內容，不额外爬社區的其他頁面。
 *   2. **用真的 Chrome、看得到畫面。** 跟真人開瀏覽器看一頁沒有本質差異，
 *      不是背景無聲跑的爬蟲程式。
 *   3. **591 頁面明文禁止自動抓取程式**（見頁尾的免責聲明），這件事本人已經
 *      知情並選擇沿用跟 591 自動填表一樣的做法。不要把這支腳本改成排程、
 *      批次跑很多網址，那已經超出當初評估過的風險範圍。
 */
import { chromium } from "playwright";
import { extractListing } from "./extract.mjs";
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

  const data = await extractListing(page);

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
