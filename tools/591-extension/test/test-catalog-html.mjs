/**
 * 「貼型錄頁網址自動解析」的純函式測試：isCatalogHtml／catalogTextFromHtml／soleCatalogUrl。
 * 跑法：node test/test-catalog-html.mjs
 *
 * fixtures/catalog-real-page.html 是 2026-09-15 對著本人真實一戶型錄頁 fetch 回來的 HTML
 * （物件編號、經紀證照人員/公司/加盟店名稱已改成假的，地址/社區/聯絡人/照片都是型錄本來就有的）。
 * ⚠️ 只驗證過這一筆；愛屋常常換版，尤其「顯示門牌」那個型錄（本人自己貼過的另一戶）沒有真實 HTML
 * 可以核對，這裡用照官方 JS 程式碼真的看過的屬性名（alt/fla）搭出一段最小可行的合成 HTML 測。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCatalogHtml, catalogTextFromHtml, soleCatalogUrl, decodeHtmlEntities, withShowAddr, photosFromCatalogHtml, listingNoFromUrl } from "../lib/parser.js";
import { parseListing } from "../lib/parser.js";
import { cleanTitle } from "../lib/map591.js";

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

/* ───────── soleCatalogUrl：判斷貼的是不是「單獨一條型錄頁網址」 ───────── */
eq("單獨一條型錄頁網址 → 算", soleCatalogUrl("https://es.houseol.com.tw/Ecatalog.aspx?UID=SP254&UAID=H229&No=AD5360000&AID=H229"), "https://es.houseol.com.tw/Ecatalog.aspx?UID=SP254&UAID=H229&No=AD5360000&AID=H229");
eq("前後有空白也算（trim）", soleCatalogUrl("  https://es.houseol.com.tw/Ecatalog.aspx?No=AD1  \n"), "https://es.houseol.com.tw/Ecatalog.aspx?No=AD1");
eq("網址後面還有別的字 → 不算，當一般貼上的文字處理", soleCatalogUrl("https://es.houseol.com.tw/Ecatalog.aspx?No=AD1 這是我自己打的說明"), null);
eq("兩行（網址+其他行）→ 不算", soleCatalogUrl("https://es.houseol.com.tw/Ecatalog.aspx?No=AD1\n地址：台中市"), null);
eq("更多照片那種帶 picstr 的連結不算型錄頁本身", soleCatalogUrl("https://es.houseol.com.tw/EInfos.aspx?type=3&picstr=https://hq.houseol.com.tw/images/pictures/x.jpg"), null);
eq("空字串 → null", soleCatalogUrl(""), null);
eq("591 的網址不算愛屋型錄頁", soleCatalogUrl("https://user.591.com.tw/post/first"), null);

/* ───────── withShowAddr：貼網址一定要加這個參數，不然門牌不會展開 ───────── */
eq("原本沒有問號 → 補上 ?showaddr=1", withShowAddr("https://es.houseol.com.tw/Ecatalog.aspx"), "https://es.houseol.com.tw/Ecatalog.aspx?showaddr=1");
eq("原本已經有其他參數 → 用 & 接上，其他參數不動", withShowAddr("https://es.houseol.com.tw/Ecatalog.aspx?UID=SP254&No=AD1"), "https://es.houseol.com.tw/Ecatalog.aspx?UID=SP254&No=AD1&showaddr=1");
eq("已經帶 showaddr=0 → 覆蓋成 1，不是變成兩個", withShowAddr("https://es.houseol.com.tw/Ecatalog.aspx?showaddr=0"), "https://es.houseol.com.tw/Ecatalog.aspx?showaddr=1");
eq("不是合法網址 → 原樣放回，不要丟例外把整個解析流程炸掉", withShowAddr("不是網址"), "不是網址");

/* ───────── decodeHtmlEntities ───────── */
eq("常見實體 amp/lt/gt/quot", decodeHtmlEntities("A&amp;B &lt;tag&gt; &quot;q&quot;"), 'A&B <tag> "q"');
eq("ensp/nbsp 轉半形空白", decodeHtmlEntities("主&ensp;+附屬"), "主 +附屬");
eq("數字實體與十六進位實體", decodeHtmlEntities("&#65;&#x42;"), "AB");
eq("不認得的實體原樣放回", decodeHtmlEntities("A&foo;B"), "A&foo;B");

/* ───────── isCatalogHtml ───────── */
eq("真的型錄頁 HTML → true", isCatalogHtml(fx("catalog-real-page.html")), true);
eq("隨便一段 HTML（沒有 t-th/t-td）→ false", isCatalogHtml("<html><body><h1>Hello</h1></body></html>"), false);
eq("有 t-th 但沒有任何型錄頁記號 → false（避免抓到別的網站剛好也用這個 class 名稱）", isCatalogHtml('<div class="t-th">x</div>'), false);
eq("空字串 → false", isCatalogHtml(""), false);

/* ───────── catalogTextFromHtml + parseListing：對真實型錄頁 ───────── */
{
  const html = fx("catalog-real-page.html");
  const text = catalogTextFromHtml(html);
  eq("重組出來的文字會被 detectSource 判成型錄格式", /不動產電子型錄/.test(text), true);
  eq("標題（來自 <title>）", text.split("\n")[1], "兩房兩衛拎包入住 1.8萬");
  eq("欄位標籤用 t-th 不是 t-td 裡的 title（「類別/謄本用途」不是「現況類別/謄本用途」）", text.includes("類別/謄本用途\n住家/集合住宅"), true);
  eq("環境特色不會把「更多照片」網址吃進去", text.match(/環境特色\n([\s\S]*?)\n(?:地圖|經紀人員|$)/)[1].split("\n").length, 5);
  eq("更多照片的 picstr 網址有跟著留在文字裡", /picstr=https:\/\/hq\.houseol\.com\.tw/.test(text), true);
  eq("經紀人員／電話有抓到", /經紀人員：蕭茗馥\n電話：0932645362/.test(text), true);

  const listing = parseListing(text);
  eq("parseListing 判成型錄來源", listing.source, "catalog");
  eq("出租、租金 18000", [listing.deal, listing.rent], ["rent", 18000]);
  eq("標題", listing.rawTitle, "兩房兩衛拎包入住 1.8萬");
  eq("押金", listing.deposit, "2個月");
  eq("登記坪數／建物面積", [listing.regPing, listing.buildingPing], [29.84, 26.35]);
  eq("樓別 6/6", [listing.floor, listing.total], [6, 6]);
  eq("房廳衛 2/2/2", [listing.room, listing.hall, listing.bath], [2, 2, 2]);
  eq("社區", listing.community, "佳美城肯");
  eq("竣工 2026/2/12", [listing.y, listing.m, listing.dd], [2026, 2, 12]);
  eq("朝向", listing.facing, "座東北 朝西南");
  eq("環境特色 5 條、乾淨沒有夾帶網址", listing.features, ["家具家電全數到位", "所有設備全新未用", "禁寵、禁神明、禁八大", "租補入戶籍通通可以", "有汽機車位"]);
  eq("照片 5 張（來自更多照片的 picstr）", listing.photos.length, 5);
  eq("經紀人員／電話", [listing.agent, listing.agentPhone], ["蕭茗馥", "0932645362"]);
  eq("這筆型錄本身沒有門牌號，地址抓不到、有列警告（不是本工具的錯，型錄本來就沒有）", [listing.addr, listing.warnings.includes("沒抓到地址（型錄頁要先把地址旁的「顯示」點開再複製）")], ["", true]);
}

/**
 * ───────── photosFromCatalogHtml：照片順序要跟愛屋頁面上看到的一樣（2026-09-23）─────────
 * 這份真實 HTML 裡，「更多照片」連結（menu 選單、picstr=e~i）在原始碼裡其實出現在縮圖
 * <ul><li><img></li></ul>（a/b/d）**前面**——舊版整份 HTML 由上到下掃一遍，會把 e~i 排到 a/b/d
 * 前面（[a,e,f,g,h,i,b,d]），跟本人在愛屋頁面上實際看到的順序兜不起來，591 拿第一張當封面，
 * 順序錯了封面就可能選錯張。改成縮圖固定排前面、更多照片接在後面，跟原始碼裡誰先誰後無關。
 */
{
  const html = fx("catalog-real-page.html");
  const photos = photosFromCatalogHtml(html, "AD5360000");
  eq("縮圖（a/b/d）在前、更多照片（e~i）接在後，不是照原始 HTML 出現順序", photos.map((u) => u.slice(-5, -4)), ["a", "b", "d", "e", "f", "g", "h", "i"]);
}

/**
 * ───────── 有「顯示」門牌功能的型錄：完整地址在 #showaddr 的 alt 屬性 ─────────
 * 2026-09-16 本人拿真實型錄頁（沙鹿區自強路）截圖比對出來的真實結構，不是猜的：
 * `<span id='addr'>路名</span><span id='showaddr' class="showaddrBnt" alt='完整地址' fla='路名'>顯示</span>`。
 * 一開始用 `(?:alt|fla)` 交給正規式挑、前面又是貪婪的 `[^>]*`，結果每次都回溯去吃到「最後一個」
 * 符合的屬性——這顆元素剛好 alt 在前 fla 在後，於是每次都抓成 fla（不含門牌的短版），這才是本人
 * 「貼網址永遠抓不到門牌」的真正原因，跟「有沒有登入」「有沒有帶 showaddr=1」都無關。
 */
{
  const html = `<html><head><title>邊間平車兩房</title></head><body>
    <div class="caption"><span id='addr'>台中市梧棲區中和街</span><span id='showaddr' class="showaddrBnt" alt='台中市梧棲區中和街36號3樓' fla='台中市梧棲區中和街'>顯示</span></div>
    <div class="t-th">登記坪數</div><div class="t-td"><div class="title">登記坪數</div><p>32.5 坪</p></div>
    <div class="t-th">租　　金</div><div class="t-td"><div class="title">租　　金</div><p>1.6萬</p></div>
    <div class="t-th">樓別/樓高</div><div class="t-td"><div class="title">樓別/樓高</div><p>3 /5</p></div>
  </body></html>`;
  eq("isCatalogHtml：有 t-th 也有 showaddr 記號 → true", isCatalogHtml(html), true);
  const text = catalogTextFromHtml(html);
  eq("地址用 alt（完整地址，含門牌），不是 fla（不含門牌的短版）", text.split("\n")[2], "台中市梧棲區中和街36號3樓");
  const listing = parseListing(text);
  eq("完整地址正確拆出門牌號", [listing.addrParts.road, listing.addrParts.no, listing.floor], ["中和街", "36", 3]);
  eq("這種情況不該有「沒抓到地址」的警告", listing.warnings.includes("沒抓到地址（型錄頁要先把地址旁的「顯示」點開再複製）"), false);
}

/** 全形門牌數字（愛屋真實資料長這樣，例：７１８號）要交給 parseCatalog() 的 normalizeText() 轉半形 */
{
  const html = `<div class="caption"><span id='addr'>沙鹿區自強路</span><span id='showaddr' class="showaddrBnt" alt='台中市沙鹿區自強路７１８號' fla='沙鹿區自強路'>顯示</span></div>`;
  const listing = parseListing(catalogTextFromHtml(html));
  eq("全形門牌數字轉成半形", listing.addrParts.no, "718");
  eq("地址本身也轉成半形", listing.addr, "台中市沙鹿區自強路718號");
}

/**
 * ───────── 街名本身是中文數字、門牌被隱藏：地址行原本會整個抓空 ─────────
 * fixtures/catalog-real-page-cn-numeral-street.html 是 2026-09-23 對著本人真實一戶
 * 出售型錄頁（沙鹿區平等十一街）fetch 回來的 HTML，完全沒有改過內容。
 * 這筆的地址行「沙鹿區平等十一街」通篇沒有半個阿拉伯數字（「十一」是中文數字，
 * 而且這筆連 #showaddr 門牌顯示按鈕都沒有，門牌本來就沒登錄），原本的 addrLine
 * 判斷要求整行要有 `\d` 才承認是地址行，結果連「區」「路名」都被判定不是地址，
 * 整欄空白且警告文字誤導成「沒抓到地址」——跟 address.js 的中文數字樓層是同一種坑，
 * 差別在這裡壞的是「有沒有找到地址行」本身，不是「地址行裡的某個子欄位」。
 */
{
  const html = fx("catalog-real-page-cn-numeral-street.html");
  eq("真的型錄頁 HTML → true", isCatalogHtml(html), true);
  const listing = parseListing(catalogTextFromHtml(html));
  eq("標題", listing.rawTitle, "專售近中科靜宜沙鹿雙車美墅 1880萬");
  eq("中文數字街名也能抓到區＋路名", [listing.addrParts.town, listing.addrParts.road], ["沙鹿區", "平等十一街"]);
  eq("警告narrows成「沒有號」，不是「整個沒抓到」", listing.warnings.includes("地址沒有「號」（門牌被隱藏了），591 的「號」要自己填"), true);
  eq("委託總價", listing.price, 1880);
  eq("登記坪數／主建物／土地登記", [listing.regPing, listing.mainPing, listing.landPing], [47.35, 43.735, 29.6]);
  eq("樓別/樓高（別墅 1-3樓／共3樓）", [listing.floorRaw, listing.total], ["1-3", 3]);
  eq("房廳衛 4/3/3", [listing.room, listing.hall, listing.bath], [4, 3, 3]);
  eq("社區", listing.community, "麗豐藝品");
  eq("朝向", listing.facing, "座西北 朝東南");
  eq("物件編號", listingNoFromUrl("https://es.houseol.com.tw/Ecatalog.aspx?UID=SP254&UAID=H229&No=AA5959255&AID=H229"), "AA5959255");
  eq(
    "型錄頁面上這一戶的照片（排掉公司 logo）",
    photosFromCatalogHtml(html, "AA5959255").length,
    19,
  );
}

/**
 * ───────── 環境特色的 class 名稱不是只有一種：'points_m'（本人回報 591／樂屋都抓不到特色）─────────
 * fixtures/catalog-real-page-points-m.html 是 2026-09-25 對著本人真實一戶出租型錄頁（梧棲區
 * 有樂仕）fetch 回來的 HTML（物件編號、經紀人員/電話/公司/加盟店名已改成假的，其餘照原樣）。
 * 本人回報「591 和樂屋網都一樣抓不到」這一戶的環境特色，查出來是這份型錄的環境特色 class 是
 * 'points_m'，不是另一份真實 fixture（catalog-real-page.html）用的 'points'——原本的正規式要求
 * class 值完全等於 points，'_m' 版一個都配不到，整段「環境特色」連同 label 都進不了重組出來的
 * 文字，parseCatalog() 自然一條 ✨ 特色行都看不到。同一戶也順便確認了編號風格不是只有「①②③」，
 * 這份是純數字「1.」「2.」——splitFeatureLines() 原本不認得純數字編號，不拿掉的話會變成
 * 「✨1.兩房車位…」，一起補了。
 */
{
  const html = fx("catalog-real-page-points-m.html");
  eq("真的型錄頁 HTML → true", isCatalogHtml(html), true);
  const text = catalogTextFromHtml(html);
  eq("重組出來的文字有「環境特色」這個 label（以前 points_m 版本整段消失）", text.includes("環境特色"), true);
  const listing = parseListing(text);
  eq("標題", listing.rawTitle, "租-有樂仕兩房車位高樓海景房傢俱電全配含管含網路可貓可拜拜 1.7萬");
  eq("出租、租金 17000", [listing.deal, listing.rent], ["rent", 17000]);
  eq(
    "環境特色 4 條，純數字編號「1.」「2.」乾淨拿掉、不是變成「✨1.」",
    listing.features,
    ["兩房車位可貓可拜拜高樓視野海景戶", "傢俱電全配,可入籍.可租補.含管理費管含網路", "衛浴皆有浴缸有開窗，通風良好", "鄰近梧棲國小、國中、梧棲市場.三井Outlet、文化路商圈,生活採買與休閒娛樂皆便利"],
  );
  eq(
    "型錄頁面上這一戶的照片（排掉公司 logo）",
    photosFromCatalogHtml(html, "AD0000001").length,
    11,
  );
}

/**
 * ───────── 環境特色的 class 名稱其實是第三種：'points_s'（本人拿另一戶測，points_m 的修法沒補到）─────────
 * fixtures/catalog-real-page-points-s.html 是 2026-09-25 對著本人真實一戶出售型錄頁（沙鹿區
 * 保成一街）fetch 回來的 HTML（物件編號、經紀人員/電話/公司/加盟店名已改成假的，其餘照原樣）。
 * 本人先回報 AA6350101 這戶「591 和樂屋網都一樣抓不到」環境特色，同時給了另一戶 AD5358768
 * 當對照組說「這筆有出現」——兩戶一比對才發現愛屋的環境特色 class 名稱其實有三種：'points'
 * （最早那份 fixture）、'points_m'（上一輪修的）、現在這戶用的是 'points_s'。原本把正規式從
 * `points` 放寬成 `points(?:_m)?` 只堵住了第二種，第三種一樣整段消失。與其繼續一種一種補，
 * 這次改成 `points\w*`（結尾是任意單字字元）一次涵蓋所有已知與未知的後綴。
 * 這戶同時也是編號「①②③」「1.2.3.」之外的第三種寫法沒有的額外驗證：第 5、6、7 點沒有各自
 * 包一個 `<div>`，是**同一個 `<div class='points_s'>` 裡面塞了三段文字、中間只用原始換行字元
 * （`\n\n`）分隔**（實際 HTML：`...5.近新光田特區...\n\n6.近向上路...\n\n7.台中中科通勤...`）。
 * splitFeatureLines() 既有的換行切割邏輯本來就會把這種塞在同一個 div 裡的多點拆開，這裡
 * 一併驗證拆出來後仍是 3 條乾淨的獨立特色，不是黏成一條或漏點。
 */
{
  const html = fx("catalog-real-page-points-s.html");
  eq("真的型錄頁 HTML → true", isCatalogHtml(html), true);
  const text = catalogTextFromHtml(html);
  eq("重組出來的文字有「環境特色」這個 label（以前 points_s 版本整段消失）", text.includes("環境特色"), true);
  const listing = parseListing(text);
  eq("標題", listing.rawTitle, "沙鹿全新前院四房透天 1698萬");
  eq("出售、委託總價 1698", [listing.deal, listing.price], ["sale", 1698]);
  eq(
    "環境特色 7 條，其中 5、6、7 點原始 HTML 擠在同一個 <div> 用換行分隔，也要乾淨拆成 3 條獨立特色",
    listing.features,
    [
      "傳統格局，二三樓前後正四房，空間大又好利用",
      "梯間屋頂層設計通風塔，採光又有熱空氣對流，夏天不悶熱",
      "全新交屋，前院停車，家庭首購首選",
      "二三四樓都有陽台設計，光線自然進來不壓迫",
      "近新光田特區，鹿陽國小，近全聯生活機能便利",
      "近向上路/特五/龍井國三，三路環抱，通勤零壓力",
      "台中中科通勤20分鐘，中科技業工程師置產熱門地段",
    ],
  );
  eq(
    "型錄頁面上這一戶的照片（排掉公司 logo）",
    photosFromCatalogHtml(html, "AA0000002").length,
    16,
  );
}

/**
 * ───────── 貼網址自動解析：標題不要帶「價格尾巴」（本人 2026-10-02 回報樂屋物件名稱每次都出現「2萬」）─────────
 * 型錄頁的 <title> 標籤會在標題後面接「空白＋價格」，catalogTextFromHtml() 用的是這個標籤，所以
 * rawTitle 帶著價格（上面各段都還是這樣斷言，沒動）；真正進到 591／樂屋標題欄之前要經過 cleanTitle()。
 * 這裡用四份真實型錄頁（出租、出售都有，價格有小數也有四位整數）確認一路下來標題乾淨。
 */
{
  const cases = [
    ["catalog-real-page.html", "兩房兩衛拎包入住"],
    ["catalog-real-page-cn-numeral-street.html", "專售近中科靜宜沙鹿雙車美墅"],
    ["catalog-real-page-points-m.html", "有樂仕兩房車位高樓海景房傢俱電全配含管含網路可貓可拜拜"],
    ["catalog-real-page-points-s.html", "沙鹿全新前院四房透天"],
  ];
  for (const [file, want] of cases) {
    const raw = parseListing(catalogTextFromHtml(fx(file))).rawTitle;
    eq(`${file}：rawTitle 還是帶價格（來源 <title> 標籤）`, /\s[\d,.]+(萬|億|元)$/.test(raw), true);
    eq(`${file}：進標題欄前 cleanTitle() 拿掉前綴與價格尾巴`, cleanTitle(raw), want);
  }
}

console.log(`\n${pass} 過、${fail} 沒過`);
if (fail) process.exit(1);
