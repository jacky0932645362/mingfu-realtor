/**
 * lib/pacific.js 的規則測試（2026-10-01）。跟 license.js／lib/floorplan.js 同一招：這支要給
 * background.js 用 importScripts() 載入（service worker 不是 ES module），寫成
 * (function(root){...})(...) 的老派寫法，這裡用 eval 把它讀進 node 測。
 *
 * 跑法：node test/test-pacific.mjs
 *
 * fixtures 不是編的：是本人要求「出售也要」之後，直接在 Claude 瀏覽器對 pacific.com.tw 正式站
 * console 打 SearchObject2 這支 API 拿到的真實回應（只精簡掉跟比對邏輯無關的欄位，company／
 * pic／saleID／objectName 這幾個關鍵欄位照原樣留著）：
 * - RES_CHANGHONG：搜尋本人真實物件「租-長虹天擎3房平車全配」（愛屋編號 AD5401497），剛好 1 筆，
 *   pic 檔名裡有 H229AD5401497a.jpg——這戶後來也在真的樂屋描述驗證過這組 saleID=R3487344 正確。
 * - RES_SHENGYOU：搜尋寬鬆關鍵字「昇祐」，同一棟樓跳出 10 筆類似單位（本人親自示範「這樣搜會
 *   搜到一堆不同戶」的真實案例），其中幾筆 company 是"HB"（別家仲介公司，不是太平洋自己的資料，
 *   pic 也不是愛屋圖檔主機）——拿來測「同一次回應裡有別家公司的物件混在一起，不能只看 pic 字串」
 *   這條規則。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "lib", "pacific.js"), "utf8");
// eslint-disable-next-line no-eval
(0, eval)(src);
const { pacificSearchKeyword, matchPacificListing, pacificDetailUrl } = globalThis.P591Pacific;

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

/* ───────── pacificSearchKeyword：愛屋 rawTitle 常帶價格尾巴，太平洋官網的 objectName 沒有 ───────── */
eq("拿掉「2.3萬」尾巴", pacificSearchKeyword("租-長虹天擎3房平車全配 2.3萬"), "租-長虹天擎3房平車全配");
eq("拿掉「25000元」尾巴", pacificSearchKeyword("兩房兩衛拎包入住 25000元"), "兩房兩衛拎包入住");
eq("沒有價格尾巴就原樣（只 trim）", pacificSearchKeyword("  租-昇祐ONE PLUS全新商辦|高樓視野+車位  "), "租-昇祐ONE PLUS全新商辦|高樓視野+車位");
eq("空字串／null → 空字串", pacificSearchKeyword(null), "");

/* ───────── matchPacificListing：真實 API 回應 fixtures ───────── */
const RES_CHANGHONG = {
  totalCount: 1,
  lstData: [
    { company: "Smart", saleID: "R3487344", objectName: "租-長虹天擎3房平車全配", pic: "https://hq.houseol.com.tw/images/pictures/H229AD5401497a.jpg" },
  ],
};
const RES_SHENGYOU = {
  totalCount: 10,
  lstData: [
    { company: "Smart", saleID: "R2968388", objectName: "租-昇祐one plus商辦｜高樓視野大", pic: "https://hq.houseol.com.tw/images/pictures/H229AD5358706a.jpg" },
    { company: "Smart", saleID: "R2963223", objectName: "租-昇祐商辦", pic: "https://hq.houseol.com.tw/images/pictures/H229AD5358866a.jpg" },
    { company: "Smart", saleID: "R2949048", objectName: "租-昇祐全新商辦", pic: "https://hq.houseol.com.tw/images/pictures/H229AD5355656a.jpg" },
    { company: "Smart", saleID: "R2984604", objectName: "租-昇祐 ONE PLUS商辦", pic: "https://hq.houseol.com.tw/images/pictures/h229ad5358735a.jpg" },
    { company: "Smart", saleID: "R3162545", objectName: "租-昇祐One Plus商辦", pic: "https://hq.houseol.com.tw/images/pictures/h229ad5401454a.jpg" },
    { company: "HB", saleID: "RR93845", objectName: "梧棲商辦昇祐商務中心", pic: "https://img.hbhousing.com.tw/pictures/C288/C288RR93845a.jpg" },
    { company: "HB", saleID: "JR104580", objectName: "昇祐ONEPLUS商辦大樓", pic: "https://img.hbhousing.com.tw/pictures/C218/C218JR104580a.jpg" },
  ],
};

eq("長虹天擎：剛好 1 筆、pic 裡有愛屋編號 → 回傳那一筆的 saleID", matchPacificListing(RES_CHANGHONG, "AD5401497"), "R3487344");
eq("比對不分大小寫（listingNo 給小寫，pic 檔名是大寫）", matchPacificListing(RES_CHANGHONG, "ad5401497"), "R3487344");
eq("pic 檔名本身是小寫也要比對得到（h229ad5358735a.jpg）", matchPacificListing(RES_SHENGYOU, "AD5358735"), "R2984604");
eq(
  "昇祐：10 筆裡沒有一筆 pic 對得上這個愛屋編號（這戶根本還沒同步到官網）→ null，不猜",
  matchPacificListing(RES_SHENGYOU, "AD5358812"),
  null,
);
eq("company 不是 Smart（HB 那兩筆）就算 pic 字串剛好對得上也不採計", matchPacificListing(RES_SHENGYOU, "RR93845"), null);
eq("沒有 listingNo → null", matchPacificListing(RES_CHANGHONG, ""), null);
eq("searchResponse 是空物件／沒有 lstData → null，不丟例外", matchPacificListing({}, "AD5401497"), null);
eq("searchResponse 是 null → null，不丟例外", matchPacificListing(null, "AD5401497"), null);

{
  const twoHits = {
    lstData: [
      { company: "Smart", saleID: "R0000001", pic: "https://hq.houseol.com.tw/images/pictures/H229AD0000001a.jpg" },
      { company: "Smart", saleID: "R0000002", pic: "https://hq.houseol.com.tw/images/pictures/H229AD0000001b.jpg" },
    ],
  };
  eq("同一個編號同時命中兩筆（理論上不該發生，防呆）→ null，不猜哪一筆", matchPacificListing(twoHits, "AD0000001"), null);
}

/* ───────── pacificDetailUrl ───────── */
eq("出租 → ObjectRentDetail", pacificDetailUrl("R3487344", { rent: true }), "https://www.pacific.com.tw/Object/ObjectRentDetail/?saleID=R3487344");
eq("出售 → ObjectDetail", pacificDetailUrl("S2896428", { rent: false }), "https://www.pacific.com.tw/Object/ObjectDetail/?saleID=S2896428");
eq("沒有 saleID → 空字串", pacificDetailUrl("", { rent: true }), "");
eq("saleID 裡有特殊字元要做 URL 編碼", pacificDetailUrl("R1 2", { rent: true }), "https://www.pacific.com.tw/Object/ObjectRentDetail/?saleID=R1%202");

console.log(`\n${pass} 過、${fail} 沒過`);
if (fail) process.exit(1);
