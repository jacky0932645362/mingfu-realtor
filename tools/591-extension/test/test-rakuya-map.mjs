/**
 * 樂屋對應層測試（純函式，不碰瀏覽器）。跑法：node test/test-rakuya-map.mjs
 *
 * ⚠️ 這是第一版，還沒對真的樂屋網跑過——這裡測的是「我的函式邏輯照自己的設計運作」，
 *    不是「跟真的樂屋表單對得上」。真結構要等本人拿真帳號實測後再校正。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseListing } from "../lib/parser.js";
import { derive, buildRows, buildPayload, cleanTitle, buildDescription } from "../lib/map591.js";
import { buildRakuya, rakuyaParkKind, RAKUYA_TITLE_MAX } from "../lib/rakuya-map.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) => fs.readFileSync(path.join(here, "fixtures", name), "utf8");
const SETTINGS = { name: "蕭茗馥", phone: "0932-645-362", line: "0932645362", company: "太平洋房屋 測試店", contract: "有簽訂", descHead: "☆ 物件特色", tail: "歡迎來電 {{phone}}" };

let pass = 0;
let fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.log(`❌ ${label}\n   得到 ${JSON.stringify(got)}\n   應該 ${JSON.stringify(want)}`);
  }
}

function rakuyaFor(fixture, nowYear = 2026) {
  const d = parseListing(fx(fixture));
  const o = derive(d, nowYear);
  const rows = buildRows(d, o);
  const p = buildPayload(d, o, rows, cleanTitle(d.rawTitle), buildDescription(d, o, SETTINGS), SETTINGS);
  return { d, o, p, rk: buildRakuya(d, o, p, nowYear) };
}

/* ───────── 車位型式 ───────── */
{
  eq("車位：坡道/平面", rakuyaParkKind("坡道/平面"), "坡道平面式");
  eq("車位：升降/機械", rakuyaParkKind("升降/機械"), "昇降機械式");
  eq("車位：昇降/平面（昇跟升都要認）", rakuyaParkKind("昇降/平面"), "昇降平面式");
  eq("車位：循環", rakuyaParkKind("機械循環式車位"), "機械循環式");
  eq("車位：庭院", rakuyaParkKind("庭院式"), "庭院式");
  eq("車位：車庫", rakuyaParkKind("獨立車庫"), "獨立車庫");
  eq("車位：電腦選號", rakuyaParkKind("電腦選號"), "電腦選號");
  eq("車位：純機械（沒寫坡道/升降）", rakuyaParkKind("機械式"), "機械式車位");
  eq("車位：空字串/沒資料 → 預設平面式", rakuyaParkKind(""), "平面式車位");
}

/* ───────── 出租：住宅（好好窩） ───────── */
{
  const { d, rk } = rakuyaFor("catalog-rent-markdown.txt");
  eq("租：現況型式沿用 591 的 status", rk.usecode, "整層住家");
  eq("租：型態電梯大廈", rk.typecode, "電梯大廈");
  eq("租：法定用途（型錄謄本用途「住家/」→ 住家用）", rk.legal, "住家用");
  eq("租：有社區", rk.isCommunity, true);
  eq("租：單層（不是整棟）", rk.floorsType, "單層");
  eq("租：型錄沒竣工日 → 屋齡抓不到 → 當中古屋", [rk.ageYears, rk.ageType], [null, "中古屋"]);
  eq("租：管理費有 → 管理員(警衛)", [rk.manage, rk.manageFee], ["管理員(警衛)", null]);
  eq("租：機車位不算車位 → 無車位", rk.parkStatus, "無車位");
  eq("租：標題 25 字內不截", [rk.title25, rk.titleTruncated], ["好好窩大2房", false]);
  eq("租：聯絡人帶入設定", rk.contactName, "蕭茗馥");
  eq("租：押金2個月 → 2個月租金", rk.rent.depositSel, "2個月租金");
  eq("租：租金包含管理費 → 含管理費", rk.rent.includes, ["管理費"]);
  eq("租：附機車位不算含車位費", rk.rent.includes.includes("停車費"), false);
  eq("租：開伙可、寵物不可（照型錄）", [rk.rent.cook, rk.rent.pet], ["可", "不可"]);
  eq("租：預設不可短期出租、性別不限、身份不限、不與房東同住", [rk.rent.shortRent, rk.rent.sex, rk.rent.identity, rk.rent.landlord], ["不可", "不限", "不限", "不與房東同住"]);
  eq("租：已辦產（型錄沒寫未辦）", rk.rent.propertyRight, "有");
  eq("售：rent 是 undefined（不是出租）", rakuyaFor("catalog-sale-synthetic.txt").rk.rent, undefined);
}

/* ───────── 出售：住宅（假樣本，領袖天廈） ───────── */
{
  const { rk } = rakuyaFor("catalog-sale-synthetic.txt");
  eq("售：現況型式（不是套房 → 住宅）", rk.usecode, "住宅");
  eq("售：法定用途（謄本「住家/住家用」）", rk.legal, "住家用");
  eq("售：竣工 1993 年、2026 年算屋齡 33 → 中古屋", [rk.ageYears, rk.ageType], [33, "中古屋"]);
  eq("售：有車位、坡道/平面 → 坡道平面式", [rk.parkStatus, rk.parkKind], ["有車位", "坡道平面式"]);
  eq("售：管理費 2342 → 管理員(警衛)", [rk.manage, rk.manageFee], ["管理員(警衛)", 2342]);
  eq("售：鄰近學校/公園帶進環境欄位", [rk.env.elementary, rk.env.park], ["梧棲國小", "頂寮公園"]);
  eq("售：標題沒超過 25 字不截", rk.titleTruncated, false);
}

/* ───────── 出租：商辦（辦公室，測法定用途不是靠 591 的 legal） ───────── */
{
  const { rk } = rakuyaFor("catalog-rent-office-synthetic.txt");
  eq("🔴 商辦出租：法定用途要是「一般事務所」（591 的 derive() 出租會清空 legal，樂屋不能沿用那個空值）", rk.legal, "一般事務所");
  eq("商辦：竣工 2025、現在 2026 → 屋齡 1 年 → 新屋", [rk.ageYears, rk.ageType], [1, "新屋"]);
  eq("商辦：型錄沒房廳衛，開放式格局，跟樂屋無關不影響 buildRakuya 本身", typeof rk.usecode, "string");
  eq("商辦：管理費是型錄另外列的金額（不是「租金已含」），租金包含清單裡不算", rk.rent.includes.includes("管理費"), false);
  eq("商辦：但知道有管理費金額，管理方式還是算「管理員(警衛)」", rk.manage, "管理員(警衛)");
  eq("商辦：型錄禁寵 → pet 不可", rk.rent.pet, "不可");
}

/* ───────── 標題超過 25 字要截 ───────── */
{
  const { d, o, p } = rakuyaFor("catalog-sale-synthetic.txt");
  const longTitle = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十";
  eq("標題超過 25 字時的長度基準", [...longTitle].length > RAKUYA_TITLE_MAX, true);
  const rk = buildRakuya(d, o, { ...p, title: longTitle }, 2026);
  eq("標題：截到 25 字、標記截過", [rk.title25, [...rk.title25].length, rk.titleTruncated], [[...longTitle].slice(0, 25).join(""), 25, true]);
}

/* ───────── 屋齡：只知道民國年反推（591 的 rocY），沒有西元竣工日 ───────── */
{
  const { d, o, p } = rakuyaFor("catalog-sale-synthetic.txt");
  const o2 = { ...o, rocY: 100 }; // 民國100年 = 西元2011年，假裝沒有 d.y
  const d2 = { ...d, y: null };
  const rk = buildRakuya(d2, o2, p, 2026);
  eq("屋齡：沒有西元竣工日時改用民國年(rocY)反推", rk.ageYears, 2026 - (100 + 1911));
}

console.log(`\n樂屋對應層測試：${pass} 過、${fail} 錯`);
process.exit(fail ? 1 : 0);
