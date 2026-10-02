/**
 * 對應層測試：listing → 591 每一格 → 資料包 → 網址。跑法：node test/test-map.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseListing, listingNoFromUrl } from "../lib/parser.js";
import { derive, buildRows, buildPayload, launchUrl, cleanTitle, titleCheck, suggestTitle, applyTitlePrefix, buildDescription, factsLine, fillTail, descRisks } from "../lib/map591.js";
import { findRisks, findMarkdown } from "../lib/risk.js";

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
const rowOf = (rows, label) => rows.find((r) => !r.group && r.label.replace(/^\s*└\s*/, "") === label);
const SETTINGS = { name: "蕭茗馥", phone: "0932-645-362", line: "0932645362", company: "太平洋房屋 測試店", contract: "有簽訂", descHead: "☆ 物件特色", tail: "歡迎來電預約看屋 {{phone}}（{{name}}）{{company}}" };

/* ───────── 出租 ───────── */
{
  const d = parseListing(fx("catalog-rent-markdown.txt"));
  const o = derive(d, 2026);
  eq("租：第①頁", [o.adType, o.legal, o.status, o.type], ["出租", "", "整層住家", "電梯大樓"]);
  eq("租：電梯 有", o.elevator, "有");
  eq("租：座向 → 坐西朝東", o.facing, "坐西朝東");
  eq("租：出租樓層＋之", [o.sellFloor, o.sellFloorNote], [3, "單層，之 5"]);
  eq("租：機車位不算車位", o.hasPark, false);
  eq("租：可使用坪數＝主+附屬", o.usePing, 20.2);
  eq("租：押金", o.rentDeposit, "2個月");
  eq("租：租金包含管理費", o.rentIncludes, ["管理費"]);
  eq("租：開伙預設可、寵物照型錄不可", [o.cook, o.pets], ["可", "不可"]);
  eq("租：完工年 null（沒竣工日）", o.rocY, null);

  const rows = buildRows(d, o);
  eq("租：紅底的格子", rows.filter((r) => r.need).map((r) => r.label), ["裝潢時間", "裝潢程度", "提供設備", "提供家具"]);
  eq("租：租金列", rowOf(rows, "租金").value, "15000");
  eq("租：車位列＝無＋機車位提醒", [rowOf(rows, "車位").value, /機車位/.test(rowOf(rows, "車位").note)], ["無", true]);
  eq("租：整串地址唯讀", rowOf(rows, "整串地址").ref, true);

  const title = cleanTitle(d.rawTitle);
  eq("租：標題去掉「租-」", title, "好好窩大2房");
  eq("租：標題 6 字剛好過", titleCheck(title).ok, true);
  eq("租：建議標題只用真的有的資料", suggestTitle(d, o), "和築好好窩 2房2廳 含管理費 附機車位 3樓");

  /* 愛屋頁面 <title> 會在標題後面接「空白＋價格」，本人不要這個尾巴出現在 591／樂屋標題（2026-10-02） */
  eq("標題：拿掉結尾的「2萬」", cleanTitle("租-遠雄質感三房含車含管可寵 2萬"), "遠雄質感三房含車含管可寵");
  eq("標題：拿掉結尾的小數價格「1.8萬」", cleanTitle("兩房兩衛拎包入住 1.8萬"), "兩房兩衛拎包入住");
  eq("標題：出售的「1698萬」也拿掉（租-售-前綴照樣拿掉）", cleanTitle("售-沙鹿全新前院四房透天 1698萬"), "沙鹿全新前院四房透天");
  eq("標題：拿掉結尾的「25000元」", cleanTitle("租-好好窩大2房 25000元"), "好好窩大2房");
  eq("標題：拿掉結尾的「1.2億」", cleanTitle("近中科靜宜透天別墅 1.2億"), "近中科靜宜透天別墅");
  eq("標題：價格前面沒隔空白的是本人自己打的字，不動（月租2萬三房）", cleanTitle("租-月租2萬三房含車"), "月租2萬三房含車");
  eq("標題：價格不在結尾不動", cleanTitle("租-三房 2萬 可寵"), "三房 2萬 可寵");
  eq("標題：沒有價格尾巴原樣（只拿掉前綴）", cleanTitle("租-好好窩大2房"), "好好窩大2房");
  eq("標題：數字結尾但不是價格單位不動（2房）", cleanTitle("和築好好窩 2房"), "和築好好窩 2房");
  eq("標題：全形空白隔開的價格也拿掉", cleanTitle("租-三房含車　2萬"), "三房含車");
  eq("標題：空字串／null 不丟例外", [cleanTitle(""), cleanTitle(null)], ["", ""]);

  /* 「物件名稱開頭」（⚙ 我的資料，2026-10-02 本人要求）：例如【房仲蕭邦】，每戶標題最前面固定加 */
  eq("開頭：標題最前面固定加上、不另外加分隔", applyTitlePrefix(title, "【房仲蕭邦】"), "【房仲蕭邦】好好窩大2房");
  eq("開頭：標題已經是這個開頭就不重複加（重新解析／按套用都不會疊兩層）", applyTitlePrefix("【房仲蕭邦】好好窩大2房", "【房仲蕭邦】"), "【房仲蕭邦】好好窩大2房");
  eq("開頭：沒設開頭就原樣", applyTitlePrefix(title, ""), "好好窩大2房");
  eq(
    "開頭：改設定時只把最前面的舊開頭換成新的，標題其他本人手改過的字不動",
    applyTitlePrefix("【房仲蕭邦】花漾天鵝✨高樓層三房平車✨全配", "｜蕭邦｜", "【房仲蕭邦】"),
    "｜蕭邦｜花漾天鵝✨高樓層三房平車✨全配",
  );
  eq("開頭：清空設定會把標題最前面的舊開頭拿掉", applyTitlePrefix("【房仲蕭邦】好好窩大2房", "", "【房仲蕭邦】"), "好好窩大2房");
  eq("開頭：標題本來就沒有舊開頭（本人自己刪掉了）→ 只補新開頭", applyTitlePrefix("好好窩大2房", "【新】", "【房仲蕭邦】"), "【新】好好窩大2房");
  eq("開頭：標題是空的就維持空的，不會變成「只有開頭」卻看起來合格", applyTitlePrefix("", "【房仲蕭邦】"), "");
  eq("開頭：建議標題也帶開頭（按「套用」才不會把設好的開頭蓋掉）", suggestTitle(d, o, "【房仲蕭邦】"), "【房仲蕭邦】和築好好窩 2房2廳 含管理費 附機車位 3樓");
  eq(
    "開頭：建議標題加了開頭總長度仍守 30 字上限（開頭佔掉的字從本文扣）",
    [...suggestTitle(d, o, "【房仲蕭邦】房仲蕭邦專屬")].length,
    30,
  );
  eq("租：規格摘要", factsLine(d, o), "2房2廳1衛｜權狀 29.7 坪（主＋附屬 20.2 坪）｜3樓／共15樓｜和築好好窩｜坐西朝東");
  const desc = buildDescription(d, o, SETTINGS);
  eq("租：描述含補充說明那行", /✨租金含管理費，附機車位/.test(desc), true);
  eq("租：描述尾段代換", /歡迎來電預約看屋 0932-645-362（蕭茗馥）太平洋房屋 測試店$/.test(desc), true);
  eq("租：沒填尾段就沒尾段", /歡迎/.test(buildDescription(d, o, { ...SETTINGS, tail: "" })), false);
  eq("租：描述不重複列規格摘要（2026-09-17 本人拍板拿掉，③每一格已經填得到）", desc.includes(factsLine(d, o)), false);

  const p = buildPayload(d, o, rows, title, desc, SETTINGS);
  eq("包：v/deal", [p.v, p.deal], [1, "rent"]);
  eq("包：地址", p.addr, { city: "台中市", town: "梧棲區", road: "八德路", lane: "", alley: "", no: "120", sub: "", hide: true });
  eq("包：樓層", p.floor, { sell: 3, sub: "5", total: 15 });
  eq("包：格局", p.layout, { room: 2, hall: 2, bath: 1 });
  eq("包：完工都 null", p.done, { y: null, m: null, d: null });
  eq("包：租", p.rent.monthly, 15000);
  eq("包：租 includes", p.rent.includes, ["管理費"]);
  eq("包：租 identity 三個", p.rent.identity, ["學生", "上班族", "家庭"]);
  eq("包：租 park false", p.rent.park, false);
  eq("包：管理費 has null（租金含、金額未知）", p.fee.has, null);
  eq("包：聯絡人", p.contact, { name: "蕭茗馥", contract: "有簽訂", serviceFee: true });
  eq("包：照片 4 張", p.photos.length, 4);
  eq("包：出租直接開第②頁", launchUrl(p), "https://user.591.com.tw/post/two/rent?is_use_first=1&kind=1&shape=2&purpose=&purpose_custom=");
  /* 2026-09-24 本人先要求抬頭（☆ 物件特色）固定粗體＋18px，截圖真的貼進 591 之後又追加「✨ 特色行
     也要跟其他的一樣」——沒設固定尾段樣式時，descHtml 現在整篇（抬頭＋特色行＋尾段文字）都固定套
     粗體18px，不是只有抬頭（跟以前「完全沒有 descHtml」也不一樣） */
  eq(
    "包：沒設固定尾段樣式 → descHtml 整篇都固定套粗體18px（沒有另外的顏色/底色可套）",
    p.descHtml.startsWith('<p><span style="font-size:18px"><strong>☆ 物件特色</strong></span></p>') &&
      p.descHtml.includes('<p><span style="font-size:18px"><strong>歡迎來電預約看屋 0932-645-362（蕭茗馥）太平洋房屋 測試店</strong></span></p>'),
    true,
  );

  /* 固定尾段設了字級／顏色：buildPayload 要把 descHtml 接好——細節（巢狀順序、找起點）在 lib/tailStyle.js 自己的測試 */
  const styledSettings = { ...SETTINGS, tailStyle: { size: "18px", bold: true, underline: false, lines: [{ color: "#c00000", bg: "" }] } };
  const pStyled = buildPayload(d, o, rows, title, buildDescription(d, o, styledSettings), styledSettings);
  eq("包：設了樣式才有 descHtml", typeof pStyled.descHtml, "string");
  eq(
    "包：descHtml 尾段套上字級／粗體／顏色，✨ 特色行套固定粗體18px（不是尾段那組可自訂顏色）",
    pStyled.descHtml.includes('<p><span style="font-size:18px"><strong>✨租金含管理費，附機車位</strong></span></p>') &&
      pStyled.descHtml.includes('<span style="font-size:18px"><span style="color:#c00000"><strong>歡迎來電預約看屋 0932-645-362（蕭茗馥）太平洋房屋 測試店</strong></span></span>'),
    true,
  );

  /* 樂屋出租：描述最後一行的下一行自動加愛屋連結（2026-09-26 本人拍板，見
     [[project_樂屋出租循環刊登]]）。app.js 的 rakuyaVariant() 是重新呼叫一次
     buildPayload()、desc 多接一行，這裡直接照同一招測，不用整套 app.js／Playwright。
     2026-09-27 本人追加要求：倒數第二行加物件編號（連結還是留在最後一行）——本人
     先前是手打「編號:AD5358836」進固定尾段模板，連結改自動加之後編號也一併自動化，
     不用再對每一戶手動改模板文字。編號直接從同一顆 catalogUrl 用既有的
     listingNoFromUrl() 抽，跟 591 外掛別的地方（照片過濾）抽的是同一個編號。 */
  eq("租：型錄本身有愛屋連結，才能測這條", typeof d.catalogUrl === "string" && d.catalogUrl.length > 0, true);
  const listingNo = listingNoFromUrl(d.catalogUrl);
  eq("租：型錄網址抽得出物件編號", listingNo, "AD5350000");
  const pWithLink = buildPayload(d, o, rows, title, `${desc}\n${listingNo}\n${d.catalogUrl}`, SETTINGS);
  eq("樂屋出租：desc 最後一行是愛屋連結", pWithLink.desc.trimEnd().endsWith(d.catalogUrl), true);
  eq("樂屋出租：desc 倒數第二行是物件編號", pWithLink.desc.trimEnd().split("\n").at(-2), listingNo);
  eq("樂屋出租：desc 原本的內容還在（只是接在後面，不是取代）", pWithLink.desc.startsWith(desc), true);
  /* descHtml 裡的 & 會被 escapeHtml() 正確轉成 &amp;（型錄網址常帶好幾個查詢參數），
     所以這裡不能直接找整串 d.catalogUrl，改用不含 & 的網域片段確認連結真的有進去 */
  eq("樂屋出租：descHtml 也含連結（不是只有純文字 desc 更新、HTML 版沒跟上）", pWithLink.descHtml.includes("houseol.com.tw/Ecatalog.aspx"), true);
  /* 沒設固定尾段樣式時這一行跟其他非尾段行一樣套粗體18px（<p><span..><strong>編號</strong></span></p>），
     不是裸的 <p>編號</p>，所以外層容許任意巢狀的 span/strong 開合標籤 */
  eq("樂屋出租：descHtml 也含物件編號自己的一行", new RegExp(`<p>(?:<[^>]+>)*${listingNo}(?:</[^>]+>)*</p>`).test(pWithLink.descHtml), true);
  /* 2026-09-26 本人截圖示範：純文字網址不算成功，要是真的 <a href> 連結（反白手動插入
     連結後網址才會變藍色）——buildTailDescHtml() 已經改成整行是網址就自動包 <a>，這裡
     確認 rakuyaVariant() 這條路徑組出來的 descHtml 真的是 <a> 不是純文字 */
  eq("樂屋出租：descHtml 裡的連結是真的 <a href> 標籤，不是看起來像連結的純文字", /<a href="https:\/\/es\.houseol\.com\.tw\/Ecatalog\.aspx[^"]*" target="_blank"/.test(pWithLink.descHtml), true);
  eq(
    "樂屋出租：物件編號那一行在連結那一行之前（不是連結先出現）",
    pWithLink.descHtml.indexOf(listingNo) < pWithLink.descHtml.indexOf("houseol.com.tw/Ecatalog.aspx"),
    true,
  );
  eq("591 原本的 payload 不受影響（沒有連結也沒有編號，範圍只限樂屋出租）", p.desc.includes(d.catalogUrl) || p.desc.includes(listingNo), false);

  /* 使用者改了格子 → 以改的為準 */
  const rows2 = buildRows(d, o);
  rowOf(rows2, "租金").value = "16000";
  rowOf(rows2, "裝潢程度").value = "簡易裝潢";
  rowOf(rows2, "裝潢時間").value = "1年內";
  rowOf(rows2, "管理費").value = "1500";
  rowOf(rows2, "租金包含").value = "管理費、水費";
  rowOf(rows2, "身份要求").value = "上班族";
  rowOf(rows2, "車位").value = "有";
  rowOf(rows2, "車位型式").value = "平面式";
  const p2 = buildPayload(d, o, rows2, title, desc, SETTINGS);
  eq("改格：租金", p2.rent.monthly, 16000);
  eq("改格：裝潢", [p2.deco, p2.rent.decoTime], ["簡易裝潢", "1年內"]);
  eq("改格：管理費金額 → has true", [p2.fee.has, p2.fee.amount], [true, 1500]);
  eq("改格：租金包含兩項", p2.rent.includes, ["管理費", "水費"]);
  eq("改格：身份只剩上班族", p2.rent.identity, ["上班族"]);
  eq("改格：車位改有", [p2.rent.park, p2.area.parkType], [true, "平面式"]);
}

/* ───────── 出售 ───────── */
{
  const d = parseListing(fx("catalog-sale-synthetic.txt"));
  const o = derive(d, 2026);
  eq("售：第①頁", [o.adType, o.legal, o.status, o.type], ["出售", "住家用", "住宅", "電梯大樓"]);
  eq("售：謄本用途", o.tengben, "住家用");
  eq("售：民國年", [o.rocY, o.rocYEstimated], [82, false]);
  eq("售：出售樓層 12 之 1", [o.sellFloor, o.sellFloorNote], [12, "單層，之 1"]);
  eq("售：有車位、坡道/平面 → 平面式停車位", [o.hasPark, o.parkSel, o.areaOpt, o.priceOpt], [true, "平面式停車位", "含車位面積", "含車位價格"]);
  eq("售：自備款 20%", o.down, 174);
  eq("售：生活機能只勾明寫的兩個", o.life, ["近學校", "近公園綠地"]);
  eq("售：座向 坐北朝南", o.facing, "坐北朝南");
  eq("售：整串地址", o.fullAddr, "台中市梧棲區四維路71巷2號");

  const rows = buildRows(d, o);
  eq("售：紅底只剩裝潢程度", rows.filter((r) => r.need).map((r) => r.label), ["裝潢程度"]);
  eq("售：管理費有無＝有", rowOf(rows, "管理費有無").value, "有");
  eq("售：完工年月日", [rowOf(rows, "完工 民國年").value, rowOf(rows, "完工 月").value, rowOf(rows, "完工 日").value], ["82", "5", "20"]);
  eq("售：對照區有謄本用途", rows.some((r) => r.ref && r.label === "類別／謄本用途"), true);

  const title = cleanTitle(d.rawTitle);
  const desc = buildDescription(d, o, SETTINGS);
  eq("售：描述 ✨ 三行", (desc.match(/✨/g) || []).length, 3);
  const p = buildPayload(d, o, rows, title, desc, SETTINGS);
  eq("售包：地址含巷", p.addr, { city: "台中市", town: "梧棲區", road: "四維路", lane: "71", alley: "", no: "2", sub: "", hide: true });
  eq("售包：樓層", p.floor, { sell: 12, sub: "1", total: 15 });
  eq("售包：完工", p.done, { y: 82, m: 5, d: 20 });
  eq("售包：面積", p.area, { reg: 51.16, inclPark: true, park: 10.5, parkType: "平面式停車位", main: 40.08, att: 0.895, pub: 10.183, land: 5.2 });
  eq("售包：價格", p.price, { total: 868, inclPark: true, down: 174 });
  eq("售包：管理費", p.fee, { has: true, amount: 2342, cycle: "月繳" });
  eq("售包：帶租約否、裝潢空", [p.lease, p.deco], [false, ""]);
  eq("售包：生活機能", p.life, ["近學校", "近公園綠地"]);
  eq("售包：rent null", p.rent, null);
  eq("售包：出售直接開第②頁", launchUrl(p), "https://user.591.com.tw/post/two/sale?is_use_first=1&kind=9&shape=2&purpose=3&purpose_custom=");
  eq("售：標題太短會說", titleCheck("兩房").ok, false);
  eq("售：標題超長會說", titleCheck("一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一").msg.includes("超出 1 字"), true);
  eq("售：風險字（最便宜）", descRisks(title, desc).map((r) => r.word), ["最高級用語"]);
}

/* ───────── 型態推導、不認得的組合 ───────── */
{
  const base = parseListing(fx("catalog-sale-synthetic.txt"));
  const mk = (patch) => ({ ...base, ...patch });
  eq("型態：透天 → 透天厝、樓層 0", (() => { const o = derive(mk({ kind: "透天 /自住" })); return [o.type, o.sellFloor]; })(), ["透天厝", 0]);
  eq("型態：大樓 8 樓 → 華廈", derive(mk({ total: 8 })).type, "華廈");
  eq("型態：華廈出租算電梯大樓", derive(mk({ kind: "華廈", deal: "rent" })).type, "電梯大樓");
  eq("型態：套房出售 → 現況套房", derive(mk({ kind: "套房" })).status, "套房");
  eq("型態：套房出租 → 獨立套房", derive(mk({ kind: "套房", deal: "rent" })).status, "獨立套房");
  eq("法定用途：住家/住商用 → 住商用", derive(mk({ usage: "住家/住商用" })).legal, "住商用");
  eq("法定用途：斜線後空 → 住家用", derive(mk({ usage: "住家/" })).legal, "住家用");
  eq("只知道屋齡 → 反推民國年、標記", (() => { const o = derive(mk({ y: null, ageYears: 33 }), 2026); return [o.rocY, o.rocYEstimated]; })(), [82, true]);
  eq("車位：機械 → 機械式停車位", derive(mk({ parkType: "升降/機械" })).parkSel, "機械式停車位");
  eq("車位：無 → 不含", (() => { const o = derive(mk({ parkType: "無", parkPing: null })); return [o.hasPark, o.areaOpt]; })(), [false, "不含車位面積"]);
  const pTown = buildPayload(mk({ kind: "透天 /自住" }), derive(mk({ kind: "透天 /自住" })), buildRows(mk({ kind: "透天 /自住" }), derive(mk({ kind: "透天 /自住" }))), "x", "y", SETTINGS);
  eq("透天：直接開第②頁 shape=3", launchUrl(pTown), "https://user.591.com.tw/post/two/sale?is_use_first=1&kind=9&shape=3&purpose=3&purpose_custom=");
  eq("不認得（商業用）→ 開第①頁", launchUrl({ deal: "sale", first: { adType: "出售", legal: "商業用", status: "住宅", type: "電梯大樓" } }), "https://user.591.com.tw/post/first");
  eq("不認得（公寓出租）→ 開第①頁", launchUrl({ deal: "rent", first: { adType: "出租", legal: "", status: "整層住家", type: "公寓" } }), "https://user.591.com.tw/post/first");
  eq("法定用途：辦公室 → 一般事務所（2026-09-11 商辦案例補的，原本掉進『住家用』預設）", derive(mk({ usage: "辦公/辦公室" })).legal, "一般事務所");
}

/* ───────── 商辦出租（2026-09-11 真實案例：地址中文數字樓層＋沒有委託總價的謄本用途） ───────── */
{
  const d = parseListing(fx("catalog-rent-office-synthetic.txt"));
  const o = derive(d, 2026);
  eq("商辦：地址中文數字樓層拆對（十三樓之2）", [d.floor, d.floorSub], [13, "2"]);
  eq("商辦：樓別/樓高（阿拉伯數字）跟地址一致，沒有互相打架的警告", d.warnings.some((w) => /樓別.*樓層.*不一樣/.test(w)), false);
  eq("商辦：出租樓層＝13、之2", [o.sellFloor, o.sellFloorNote], [13, "單層，之 2"]);
  eq("商辦：房廳衛沒抓到（開放式格局，型錄本來就沒寫）", [d.room, d.warnings.includes("房/廳/衛沒抓到")], [null, true]);
}

/* ───────── 風險字 ───────── */
{
  eq("風險：保證增值", findRisks("保證增值").map((r) => r.word), ["保證／絕對", "增值／投報"]);
  eq("風險：藍線", findRisks("近捷運藍線").map((r) => r.word), ["未通車捷運"]);
  eq("風險：TOP1 全台", findRisks("全台 TOP 1").map((r) => r.word), ["TOP 1＋全台"]);
  eq("風險：全台第一", findRisks("全台第一").map((r) => r.word), ["最高級用語"]);
  eq("風險：乾淨文案沒事", findRisks("採光好，近公園"), []);
  eq("Markdown：**粗體**", findMarkdown("**大特價**\n正常").map((m) => m.kind), ["粗體 **"]);
  eq("尾段代換", fillTail("{{name}}/{{phone}}/{{line}}/{{company}}", SETTINGS), "蕭茗馥/0932-645-362/0932645362/太平洋房屋 測試店");
}

console.log(`\n對應層測試：${pass} 過、${fail} 錯`);
process.exit(fail ? 1 : 0);
