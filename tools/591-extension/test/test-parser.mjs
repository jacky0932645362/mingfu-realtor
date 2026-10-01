/**
 * 解析器測試。跑法：node test/test-parser.mjs
 * 樣本：test/fixtures/（租屋型錄是本人 2026-09-11 真實型錄改過門牌與物件編號；出售型錄是照欄位排法編的假樣本）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseListing, detectSource, readRentCond, picstrUrls, photosFromCatalogHtml, listingNoFromUrl, splitLinks, collectPhotos, isCatalogPage, stripMarkdownLinks, photoUrlKey } from "../lib/parser.js";
import { splitAddress } from "../lib/address.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) => fs.readFileSync(path.join(here, "fixtures", name), "utf8");

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

/* ───────── 地址 ───────── */
{
  const a = splitAddress("台中市梧棲區八德路89號4樓之8");
  eq("地址：縣市", a.city, "台中市");
  eq("地址：鄉鎮", a.town, "梧棲區");
  eq("地址：街道", a.road, "八德路");
  eq("地址：號", a.no, "89");
  eq("地址：之（號）空", a.sub, "");
  eq("地址：樓", a.floor, 4);
  eq("地址：樓之", a.floorSub, "8");
  eq("地址：到號為止", a.text, "台中市梧棲區八德路89號");
  const b = splitAddress("台中市大肚區沙田路三段734巷56之2號");
  eq("地址：段留在街道裡", b.road, "沙田路三段");
  eq("地址：巷", b.lane, "734");
  eq("地址：之N號", [b.no, b.sub], ["56", "2"]);
  eq("地址：沒樓層", b.floor, null);
  const c = splitAddress("臺中市梧棲區四維路７１巷２號１２樓之１");
  eq("地址：全形數字＋臺", [c.city, c.lane, c.no, c.floor, c.floorSub], ["台中市", "71", "2", 12, "1"]);
  const d = splitAddress("梧棲區中央路二段50號之3");
  eq("地址：沒縣市、號之N", [d.city, d.town, d.road, d.no, d.sub], ["", "梧棲區", "中央路二段", "50", "3"]);
  const e = splitAddress("台中市清水區中山路100巷5弄8號");
  eq("地址：巷弄", [e.lane, e.alley, e.no], ["100", "5", "8"]);
  /* 2026-09-11 真實案例（昇祐 One Plus 商辦）：型錄地址寫中文數字樓層「十三樓之２」，
     原本的正規式只認阿拉伯數字，樓層會整個抓不到、也不會有警告，591 那格就靜靜地空著 */
  const f1 = splitAddress("台中市梧棲區四維中路331號十三樓之2");
  eq("地址：中文數字樓層＋之（十三樓之2）", [f1.floor, f1.floorSub, f1.no], [13, "2", "331"]);
  const f2 = splitAddress("台中市梧棲區四維中路331號二十樓之1");
  eq("地址：中文數字樓層（二十樓，兩位數）", f2.floor, 20);
  const f3 = splitAddress("台中市梧棲區四維中路331號十樓");
  eq("地址：中文數字樓層（十樓，剛好十）", [f3.floor, f3.floorSub], [10, ""]);
  const f4 = splitAddress("台中市梧棲區四維中路331號九樓之3");
  eq("地址：中文數字樓層（個位數，九樓）", f4.floor, 9);
}

/* ───────── 租屋型錄（markdown 連結版：Claude 桌面版貼出來的樣子） ───────── */
{
  const raw = fx("catalog-rent-markdown.txt");
  eq("來源判斷：型錄", detectSource(raw), "catalog");
  const d = parseListing(raw);
  eq("租：deal", d.deal, "rent");
  eq("租：標題", d.rawTitle, "租-好好窩大2房");
  eq("租：同事名單被砍掉（標題不是名單）", /王小明/.test(d.rawTitle), false);
  eq("租：地址到號", d.addr, "台中市梧棲區八德路120號");
  eq("租：地址尾巴的「隱藏」被拿掉", /隱藏/.test(d.addr), false);
  eq("租：樓層來自地址", [d.floor, d.floorSub], [3, "5"]);
  eq("租：總樓高", d.total, 15);
  eq("租：租金 1.5萬 → 15000", d.rent, 15000);
  eq("租：押金原文", d.deposit, "2個月");
  eq("租：沒有委託總價", d.price, null);
  eq("租：登記坪數", d.regPing, 29.7);
  eq("租：主+附屬", d.mainAttPing, 20.2);
  eq("租：主建物／附屬／公設", [d.mainPing, d.attPing, d.pubPing], [17.736, 2.468, 9.504]);
  eq("租：房廳衛", [d.room, d.hall, d.bath], [2, 2, 1]);
  eq("租：謄本用途原文", d.usage, "住家/");
  eq("租：類型原文", d.kind, "大樓 /空屋");
  eq("租：社區（不是標題）", d.community, "和築好好窩");
  eq("租：管理費欄是空的", d.fee, null);
  eq("租：面臨路寬空欄位不會吃到「建物外觀」", d.exterior, "二丁掛");
  eq("租：座向", d.facing, "座西 朝東");
  eq("租：結構", d.struct, "鋼筋混凝土RC");
  eq("租：物件編號", d.no, "AD5350000");
  eq("租：鑰匙", d.keyNote, "7店 / 聯絡承辦人員");
  eq("租：補充說明", d.extraNote, "租金含管理費，附機車位");
  eq("租：環境特色（按鈕那排不會混進來）", d.features, ["禁神明廳，禁寵"]);
  eq("租：租住條件", d.rentCond, { noPets: true, cook: null, feeIncluded: true, parkIncluded: false, noSmoking: false, noAltar: true, motorbike: true });
  eq("租：更多照片 4 張", d.photos.length, 4);
  eq("租：照片順序 f g h i", d.photos.map((u) => u.slice(-5, -4)), ["f", "g", "h", "i"]);
  eq("租：型錄頁網址（有 No= 的那條）", /Ecatalog\.aspx\?UID=SP254.*No=AD5350000.*showaddr=1/.test(d.catalogUrl), true);
  eq("租：經紀人員／電話", [d.agent, d.agentPhone], ["蕭茗馥", "0932645362"]);
  eq("租：沒竣工日", d.y, null);
  eq("租：提醒只有竣工日那條", d.warnings, ["型錄沒有竣工日期：591 出租會點「屋齡不詳」，知道完工年的話自己改"]);
}

/* ───────── 租屋型錄（純文字版：textarea 真正收到的樣子） ───────── */
{
  const raw = fx("catalog-rent-plain.txt");
  const d = parseListing(raw);
  eq("純文字：deal", d.deal, "rent");
  eq("純文字：地址", d.addr, "台中市梧棲區八德路120號");
  eq("純文字：租金", d.rent, 15000);
  eq("純文字：社區", d.community, "和築好好窩");
  eq("純文字：環境特色沒吃到「地圖 街景…」", d.features, ["禁神明廳，禁寵"]);
  eq("純文字：沒有照片網址", d.photos, []);
  eq("純文字：沒有型錄頁網址", d.catalogUrl, "");
  eq("純文字：補充說明", d.extraNote, "租金含管理費，附機車位");
}

/* ───────── 出售型錄（假樣本） ───────── */
{
  const raw = fx("catalog-sale-synthetic.txt");
  const d = parseListing(raw);
  eq("售：deal", d.deal, "sale");
  eq("售：標題", d.rawTitle, "社區最便宜全新美兩房平車");
  eq("售：社區不是標題的「社區最便宜…」", d.community, "領袖天廈");
  eq("售：地址", d.addr, "台中市梧棲區四維路71巷2號");
  eq("售：地址拆", [d.addrParts.lane, d.addrParts.no, d.floor, d.floorSub], ["71", "2", 12, "1"]);
  eq("售：總價", d.price, 868);
  eq("售：登記坪", d.regPing, 51.16);
  eq("售：含車位坪", d.parkPing, 10.5);
  eq("售：土地", d.landPing, 5.2);
  eq("售：樓別/樓高", [d.floorRaw, d.total], ["12", 15]);
  eq("售：房廳衛", [d.room, d.hall, d.bath], [4, 2, 2]);
  eq("售：車位型式", d.parkType, "坡道/平面");
  eq("售：車位編號", d.parkNo, "B2-35");
  eq("售：謄本用途", d.usage, "住家/住家用");
  eq("售：管理費非貪婪（不是抓到「2」）", [d.fee, d.feeCycle], [2342, "月繳"]);
  eq("售：竣工日期", [d.y, d.m, d.dd], [1993, 5, 20]);
  eq("售：座向", d.facing, "座北 朝南");
  eq("售：鄰近學校／公園", [d.school, d.park], ["梧棲國小", "頂寮公園"]);
  eq("售：鄰近市場空欄位不會吃到「使用分區」", d.market, "");
  eq("售：使用分區", d.zone, "住宅區");
  eq("售：生活圈", d.lifeArea, "梧棲市區");
  eq("售：屋齡文字", d.ageText, "33年");
  eq("售：特色三行、✨ 拿掉", d.features, ["領袖天廈，全新美裝潢兩房平車", "高樓層視野佳，採光通風好", "近梧棲國小、頂寮公園"]);
  eq("售：沒照片", d.photos, []);
  eq("售：沒有提醒", d.warnings, []);
}

/**
 * ───────── 管理費格式放寬（2026-09-23）─────────
 * 本人兩戶真實型錄的管理費都是空的（見 test-catalog-html.mjs），沒有「有值」的真實樣本能核對格式；
 * 「2342元/月繳 | 500元/月繳」（上面那組出售假樣本用的）是自己編的，不是 confirmed 的真實格式。
 * 這裡放寬成「元」跟「/週期」都選填，真實資料如果比較陽春（只有數字）也抓得到；完全不是數字格式
 * （例如「面議」）就老實抓不到，並且要在警告裡帶原文，方便真的遇到抓錯格式時直接複製回報。
 */
{
  const base = fx("catalog-sale-synthetic.txt");
  const noCycle = base.replace("2342元/月繳 | 500元/月繳", "2000| 500");
  const d1 = parseListing(noCycle);
  eq("管理費沒有「元」也沒有繳費週期 → 金額抓得到、週期用預設「月繳」", [d1.fee, d1.feeCycle], [2000, "月繳"]);

  const unparseable = base.replace("2342元/月繳 | 500元/月繳", "面議");
  const d2 = parseListing(unparseable);
  eq("管理費完全不是數字格式（例如「面議」）→ 老實抓不到，維持 null", d2.fee, null);
  eq("抓不到金額但「管理費」有出現 → 警告帶原文，方便回報怎麼調規則", d2.warnings.some((w) => w.includes("管理費") && w.includes("面議")), true);
}

/* ───────── 自己打的文字 ───────── */
{
  const raw = fx("freeform-sale.txt");
  eq("來源判斷：自由文字", detectSource(raw), "freeform");
  const d = parseListing(raw);
  eq("自由：標題（「」裡的）", d.rawTitle, "梧棲高樓層視野三房平車");
  eq("自由：地址全形轉半形、樓層拆出", [d.addr, d.floor, d.floorSub], ["台中市梧棲區四維路71巷2號", 12, "1"]);
  eq("自由：售價", d.price, 868);
  eq("自由：格局", [d.room, d.hall, d.bath], [3, 2, 2]);
  eq("自由：坪數們", [d.regPing, d.mainPing, d.attPing, d.pubPing], [51.16, 40.08, 0.895, 10.183]);
  eq("自由：屋齡", d.ageYears, 33);
  eq("自由：樓層 12/15", d.total, 15);
  eq("自由：社區", d.community, "領袖天廈");
  eq("自由：管理費", d.fee, 2342);
  eq("自由：車位", d.parkType, "坡道平面");
  eq("自由：類型 → 大樓", d.kind, "大樓");
  eq("自由：特色行", d.features.length, 3);
  eq("自由：沒謄本用途要提醒", d.warnings.some((w) => /謄本用途/.test(w)), true);
}

/* ───────── 租住條件 ───────── */
{
  eq("條件：附機車位不算含車位", readRentCond("租金含管理費，附機車位").parkIncluded, false);
  eq("條件：含車 算", readRentCond("租金含管含車").parkIncluded, true);
  eq("條件：含管", readRentCond("租金含管含車").feeIncluded, true);
  eq("條件：禁菸、寵", readRentCond("禁菸、寵").noPets, true);
  eq("條件：可養寵物", readRentCond("可養寵物").noPets, false);
  eq("條件：不可開伙", readRentCond("不可開伙").cook, false);
  eq("條件：沒寫就 null", readRentCond("採光好").cook, null);
}

/* ───────── 照片工具 ───────── */
{
  const two = "https://es.houseol.com.tw/EInfos.aspx?type=3&picstr=https://hq.houseol.com.tw/images/pictures/H229AA1a.jpg,https://hq.houseol.com.tw/images/pictures/H229AA1b.jpghttps://es.houseol.com.tw/EInfos.aspx?type=3&picstr=https://hq.houseol.com.tw/images/pictures/H229AA1c.jpg";
  eq("照片：兩條更多照片連結黏在一起也吃得到 3 張", picstrUrls(two).length, 3);
  eq("照片：splitLinks 切成 2 條", splitLinks(two).length, 2);
  eq("照片：URL 編碼過的 picstr", picstrUrls("x?picstr=https%3A%2F%2Fhq.houseol.com.tw%2Fimages%2Fpictures%2FA.jpg%2Chttps%3A%2F%2Fhq.houseol.com.tw%2Fimages%2Fpictures%2FB.jpg").length, 2);
  const page = "https://es.houseol.com.tw/Ecatalog.aspx?UID=SP254&No=AD5350000&AID=H229";
  eq("照片：型錄頁判斷", [isCatalogPage(page), isCatalogPage(two)], [true, false]);
  eq("照片：物件編號", listingNoFromUrl(page), "AD5350000");
  const html = `<img src="//hq.houseol.com.tw/images/pictures/H229AD5350000a.jpg"><img src="https://hq.houseol.com.tw/images/pictures/4817_3.jpg"><img src="https://hq.houseol.com.tw/images/pictures/H229AD5350000d.jpg"><img src="https://hq.houseol.com.tw/images/pictures/H229AD5350000a.jpg">`;
  eq("照片：從型錄頁 HTML 撈這一戶（排 logo、去重、// 補 https）", photosFromCatalogHtml(html, "AD5350000"), ["https://hq.houseol.com.tw/images/pictures/H229AD5350000a.jpg", "https://hq.houseol.com.tw/images/pictures/H229AD5350000d.jpg"]);
  eq("照片：型錄頁沒掃過算 0 張、掃過用掃到的", collectPhotos(page + " " + two, { [page]: ["https://hq.houseol.com.tw/images/pictures/H229AA1z.jpg"] }).length, 4);
  eq("markdown 連結：文字與網址分開", stripMarkdownLinks("看[更多照片](https://x.y/z?picstr=https://hq.houseol.com.tw/images/pictures/a.jpg)吧"), { text: "看更多照片吧", urls: ["https://x.y/z?picstr=https://hq.houseol.com.tw/images/pictures/a.jpg"] });
}

/**
 * ───────── photoUrlKey：愛屋圖檔網址的 ?Rnd= 快取參數不能拿來判斷是不是同一張照片 ─────────
 * 2026-09-25 本人回報樂屋抓到的照片有重複，直接對同一戶真實型錄頁分開抓兩次驗證出來：同一張封面照
 * （H229AA6363019a.jpg），第一次抓到 `?Rnd=233`、第二次抓到 `?Rnd=279`——不是猜的，是這兩個真實
 * 數字。逐字比對網址會把同一個檔案誤判成兩張不同的照片，重複塞進上傳框。
 */
{
  const a = "https://hq.houseol.com.tw/images/pictures/H229AA6363019a.jpg?Rnd=233";
  const b = "https://hq.houseol.com.tw/images/pictures/H229AA6363019a.jpg?Rnd=279"; // 同一個檔案，本人真實驗證過的另一個 Rnd 值
  const c = "https://hq.houseol.com.tw/images/pictures/H229AA6363019b.jpg?Rnd=233"; // 不同檔案（b 不是 a），Rnd 剛好一樣也不該判成同一張
  eq("photoUrlKey：只有 ?Rnd= 不一樣 → 同一個 key（同一張照片）", photoUrlKey(a) === photoUrlKey(b), true);
  eq("photoUrlKey：檔名不一樣 → 不同 key，就算 Rnd 剛好一樣", photoUrlKey(a) === photoUrlKey(c), false);
  eq("photoUrlKey：完全沒有 query string 也算同一個 key", photoUrlKey("https://x/y/z.jpg") === photoUrlKey("https://x/y/z.jpg?Rnd=1"), true);
  eq("photoUrlKey：不分大小寫", photoUrlKey("https://X/Y/Z.JPG") === photoUrlKey("https://x/y/z.jpg?Rnd=1"), true);

  /* photosFromCatalogHtml()：同一張照片在同一份 HTML 裡用不同 Rnd 出現兩次（縮圖 <img> 標籤重複
     出現、或跟 og:image 那種本來就會有的自然重複情境），去重要靠 photoUrlKey，不是逐字比對 */
  const html = `<img src="https://hq.houseol.com.tw/images/pictures/H229AA6363019a.jpg?Rnd=233"><img src="https://hq.houseol.com.tw/images/pictures/H229AA6363019a.jpg?Rnd=279">`;
  eq("photosFromCatalogHtml：同一張圖不同 Rnd 只算一張", photosFromCatalogHtml(html, "AA6363019").length, 1);

  /* collectPhotos()：型錄頁網址被掃過兩次（例如本人手動又按一次「解析」重新抓），scanned{} 裡
     同一個 key 對到的雖然是同一次查表結果，但貼上的文字裡如果混進另一次抓到、Rnd 不同的網址
     （例如使用者自己在「照片來源」那格又貼了一次同一張圖的直連），一樣要能認出是同一張 */
  const pageUrl = "https://es.houseol.com.tw/Ecatalog.aspx?No=AA6363019";
  const pasted = `${pageUrl} https://hq.houseol.com.tw/images/pictures/H229AA6363019a.jpg?Rnd=279`;
  const scanned = { [pageUrl]: ["https://hq.houseol.com.tw/images/pictures/H229AA6363019a.jpg?Rnd=233", "https://hq.houseol.com.tw/images/pictures/H229AA6363019b.jpg?Rnd=233"] };
  eq("collectPhotos：型錄頁掃到的 a（Rnd=233）跟另外貼的 a（Rnd=279）算同一張，總共 2 張不是 3 張", collectPhotos(pasted, scanned).length, 2);
}

console.log(`\n解析器測試：${pass} 過、${fail} 錯`);
process.exit(fail ? 1 : 0);
