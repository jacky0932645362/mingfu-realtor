/**
 * 離線測試 extract.mjs：用 Playwright 開一個假頁面（fixtures/sample-detail.html），
 * 讓真正的 extractListing() 去抓，再核對抓出來的值。
 * 不連網、不碰真的 591，跟 591-autofill 的 test-fill-e2e.mjs 同一個做法。
 *
 * 跑法：node test-extract-logic.mjs
 */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { extractListing } from "./extract.mjs";

const FIXTURE = pathToFileURL(path.join(import.meta.dirname, "fixtures", "sample-detail.html")).href;

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

await browser.close();

console.log(`\n${pass} 過、${fail} 沒過`);
if (fail > 0) process.exit(1);
