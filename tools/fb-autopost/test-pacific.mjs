// 太平洋官網成交檢查（src/lib/fb-pacific.ts）的純函式測試。不連網、不碰資料庫。
// 跑法：node test-pacific.mjs
// 頁面片段是 2026-10-05 對正式站抓下來的原文（S2906738 還在架上、S9999999 不存在）。
import { registerAliasHooks } from "./_shared.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";

registerAliasHooks();
const ROOT = path.resolve(import.meta.dirname, "../..");
const P = await import(`${pathToFileURL(ROOT).href}/src/lib/fb-pacific.ts`);

let pass = 0;
let fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`❌ ${name}\n   得到 ${JSON.stringify(got)}\n   應該 ${JSON.stringify(want)}`);
  }
}

const LIVE_SALE = `<head><meta property="og:title" content="梧棲美建地 - 臺中市梧棲區南簡段" />
<meta property="og:description" content="總價3900萬，坪數159.12坪" /></head>`;
const LIVE_RENT = `<meta property="og:title" content="海線三房出租" /><meta property="og:description" content="租金23000元，坪數53.19坪" />`;
const GONE = `<meta property="og:title" content="" />\n<meta property="og:description" content="" />`;

// ── 網址／編號正規化 ──
eq("只貼出售編號", P.normalizePacificInput("S2906738"), "https://www.pacific.com.tw/Object/ObjectDetail/?saleID=S2906738");
eq("只貼出租編號（小寫）", P.normalizePacificInput(" r3487344 "), "https://www.pacific.com.tw/Object/ObjectRentDetail/?saleID=R3487344");
eq(
  "完整網址（帶其他參數）",
  P.normalizePacificInput("https://www.pacific.com.tw/Object/ObjectDetail/?saleID=S2989488&from=line"),
  "https://www.pacific.com.tw/Object/ObjectDetail/?saleID=S2989488",
);
eq("別的網站不收", P.normalizePacificInput("https://sale.591.com.tw/home/house/detail/2/123.html"), null);
eq("空字串", P.normalizePacificInput("   "), null);
eq("從網址取編號", P.pacificIdFromUrl("https://www.pacific.com.tw/Object/ObjectDetail/?saleID=S2906738"), "S2906738");

// ── 解析頁面 ──
eq("出售頁", P.parsePacificPage(LIVE_SALE), {
  exists: true,
  title: "梧棲美建地 - 臺中市梧棲區南簡段",
  priceWan: 3900,
  rent: null,
  ping: 159.12,
});
eq("出租頁", P.parsePacificPage(LIVE_RENT).rent, 23000);
eq("不存在的編號", P.parsePacificPage(GONE).exists, false);
eq("只剩站名也算不存在", P.parsePacificPage(`<meta property="og:title" content="太平洋房屋" />`).exists, false);

// ── 判斷 ──
const base = { title: "梧棲美建地", priceWan: 3900, rent: null, ping: 159.12 };
eq("一樣", P.judgePacific(base, P.parsePacificPage(LIVE_SALE)).verdict, "same");
eq("消失＝gone", P.judgePacific(base, P.parsePacificPage(GONE)).verdict, "gone");
const cut = P.judgePacific(base, { ...P.parsePacificPage(LIVE_SALE), priceWan: 3680 });
eq("降價不算下架", cut.verdict, "same");
eq("降價寫進備註", cut.notes, ["官網總價 3900→3680 萬"]);
eq("坪數差 0.3 不算換戶", P.judgePacific(base, { ...P.parsePacificPage(LIVE_SALE), ping: 159.42 }).verdict, "same");
eq("坪數差很多＝changed", P.judgePacific(base, { ...P.parsePacificPage(LIVE_SALE), ping: 38.66 }).verdict, "changed");

console.log(`\n${fail ? "❌" : "✅"} ${pass} 項通過、${fail} 項失敗`);
process.exit(fail ? 1 : 0);
