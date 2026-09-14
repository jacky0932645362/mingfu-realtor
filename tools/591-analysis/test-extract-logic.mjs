/**
 * 離線測試 extract.mjs：用 Playwright 開假頁面（fixtures/sample-detail.html 物件頁、
 * fixtures/sample-search.html 搜尋頁），讓真正的抽取函式去抓，再核對抓出來的值。
 * 不連網、不碰真的 591，跟 591-autofill 的 test-fill-e2e.mjs 同一個做法。
 * 後段另外測 _shared.mjs 的純邏輯（地址拆解、去重）。
 *
 * 跑法：node test-extract-logic.mjs
 */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { extractListing, extractSearchComps } from "./extract.mjs";
import { buildCommunitySearchUrl, dedupeComps, normalizeCommunityName, parseAddress } from "./_shared.mjs";

const FIXTURE = pathToFileURL(path.join(import.meta.dirname, "fixtures", "sample-detail.html")).href;
const SEARCH_FIXTURE = pathToFileURL(path.join(import.meta.dirname, "fixtures", "sample-search.html")).href;

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
  } else {
    fail++;
    console.log(`✗ ${label}\n    期望: ${JSON.stringify(expected)}\n    實際: ${JSON.stringify(actual)}`);
  }
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.goto(FIXTURE);

const data = await extractListing(page);

check("title", data.title, "棋棋積極談價‼️富宇松禾苑高樓三房+平車|崇德商圈");
check("totalPrice.value", data.totalPrice.value, 1828);
check("totalPrice.includesParking", data.totalPrice.includesParking, true);
check("unitPrice.value", data.unitPrice.value, 43.54);
check("layout", data.layout, "3房2廳1衛2陽台");
check("ageYears", data.ageYears, 4);
check("registeredPing", data.registeredPing, "41.98坪(含車位)");
check("floor", data.floor, "12F/15F");
check("orientation", data.orientation, "坐東南朝西北");
check("communityName", data.communityName, "富宇松禾苑");
check("communityId", data.communityId, "102202");
check("address", data.address, "台中市北屯區松和街");
check("warnings（不該有任何缺項）", data.warnings, []);

check("community.name", data.community.name, "富宇松禾苑");
check("community.onSaleStartPrice", data.community.onSaleStartPrice, 1828);
check("community.avgDealUnitPrice", data.community.avgDealUnitPrice, 43.5);
check("community.avgDealRoomType", data.community.avgDealRoomType, "3房");
check("community.onSaleCount", data.community.onSaleCount, 67);
check("community.recentListedCount", data.community.recentListedCount, 18);
check("community.priceDroppedCount", data.community.priceDroppedCount, 9);
check("community.dealCount", data.community.dealCount, 339);

// ⭐ 這兩項是反爬蟲亂序破解的核心驗證：DOM 順序是「24」，畫面實際順序（style.order）是「42」。
check("roomBreakdown[0]（二房，亂序坪數還原）", data.community.roomBreakdown[0], {
  roomType: "二房",
  count: 3,
  sizeText: "42坪",
  priceMin: 1888,
  priceMax: 1888,
});
check("roomBreakdown[1]（三房，亂序坪數還原）", data.community.roomBreakdown[1], {
  roomType: "三房",
  count: 64,
  sizeText: "42~65坪",
  priceMin: 1828,
  priceMax: 2700,
});

check("recentDeals[0]", data.community.recentDeals[0], {
  yearMonth: "115-01",
  layout: "3房2廳",
  size: "37.8坪",
  floor: "7樓",
  unitPrice: "43.5萬/坪",
  totalPrice: "1,550萬",
});
check("recentDeals.length", data.community.recentDeals.length, 2);

// ── 搜尋頁：同社區在售競品（含總價／權狀坪／樓層，全是 591 純文字）──
await page.goto(SEARCH_FIXTURE);
const subject = { communityName: "聯悅臻", district: "梧棲區", road: "臨港路四段" };
const search = await extractSearchComps(page, subject);

check("search.foundCount（「已為你找到145間房屋」）", search.foundCount, 145);
check("search.renderedCount（含建案廣告與別區推薦）", search.renderedCount, 5);
check("search.comps.length（過濾後只剩本社區三筆：建案卡與大里區那筆被丟掉）", search.comps.length, 3);
check("comps[0]（欄位齊全，社區名「聯悦臻」異體字也對得上）", search.comps[0], {
  title: "海創🌊-🍎聯悅臻朝南朝外最便宜三房配B1車位🍎聯悦臻",
  url: "https://sale.591.com.tw/home/house/detail/2/20610001.html",
  community: "聯悦臻",
  buildingType: "電梯大樓",
  layout: "3房2廳2衛",
  sizePing: 49.87,
  mainPing: 24.55,
  ageText: "1年",
  floor: "13F/24F",
  totalPrice: 1128,
  priceIncludesParking: true,
  priceDrop: "降70萬",
  unitPrice: 22.62,
  tags: ["含車位"],
});
check("comps[1].tags（「AI即時回覆」這種功能標籤要濾掉，物件標籤留著）", search.comps[1].tags, ["含車位", "有陽台", "有格局圖"]);
check("comps[1].priceDrop（沒降價就是 null，不是空字串）", search.comps[1].priceDrop, null);
check("刻意不收經紀人姓名（本人 2026-09-14 拍板內部版也不秀）", search.comps[0].agent, undefined);

// ── 去重：同樓層＋同權狀坪＋同總價 → 同一戶 ──
const deduped = dedupeComps(search.comps);
check("dedupe：第 1、2 筆被標成同一組 A", [search.comps[0].dupGroup, search.comps[1].dupGroup], ["A", "A"]);
check("dedupe：dupCount 都是 2", [search.comps[0].dupCount, search.comps[1].dupCount], [2, 2]);
check("dedupe：第 3 筆（16F/39.3坪/888萬）不是重複", search.comps[2].dupGroup, undefined);
check("dedupe：3 筆刊登＝2 戶、1 組重複", [deduped.uniqueCount, deduped.dupGroupCount], [2, 1]);
check(
  "dedupe：缺總價的不參與去重（寧可少標）",
  dedupeComps([
    { floor: "5F/10F", sizePing: 30, totalPrice: null },
    { floor: "5F/10F", sizePing: 30, totalPrice: null },
  ]).uniqueCount,
  2,
);
check(
  "dedupe：38.71 跟 38.7 坪（不同仲介四捨五入）要對得上",
  dedupeComps([
    { floor: "2F/24F", sizePing: 38.71, totalPrice: 780 },
    { floor: "2F/24F", sizePing: 38.7, totalPrice: 780 },
  ]).dupGroupCount,
  1,
);
check(
  "dedupe：只有樓層＋坪數相同、總價不同 → 不算同一戶（同層鏡像戶）",
  dedupeComps([
    { floor: "5F/10F", sizePing: 30, totalPrice: 900 },
    { floor: "5F/10F", sizePing: 30, totalPrice: 950 },
  ]).dupGroupCount,
  0,
);

// ── 地址拆解 → 591 縣市代碼 ──
check("parseAddress 台中", parseAddress("台中市梧棲區臨港路四段"), { city: "台中市", regionId: 8, district: "梧棲區", road: "臨港路四段" });
check("parseAddress 「臺」中也要認得", parseAddress("臺中市沙鹿區向上路六段").regionId, 8);
check("parseAddress 新北市", parseAddress("新北市板橋區文化路一段"), { city: "新北市", regionId: 3, district: "板橋區", road: "文化路一段" });
check("parseAddress 縣＋鄉", parseAddress("彰化縣花壇鄉中山路").district, "花壇鄉");
check("parseAddress 拆不出來 → 全 null", parseAddress("梧棲區臨港路"), { city: null, regionId: null, district: null, road: null });
check("normalizeCommunityName 悦→悅、去空白括號", normalizeCommunityName("聯悦臻 (華廈區)"), "聯悅臻華廈區");
check("buildCommunitySearchUrl", buildCommunitySearchUrl(8, "聯悅臻"), "https://sale.591.com.tw/?region=8&keywords=%E8%81%AF%E6%82%85%E8%87%BB");

await browser.close();

console.log(`\n${pass} 過、${fail} 沒過`);
if (fail > 0) process.exit(1);
