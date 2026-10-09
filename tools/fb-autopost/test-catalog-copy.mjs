/**
 * 「貼愛屋連結／591／樂屋連結／案號 → 自動產生 FB 廣告文案」的離線測試。
 * 純函式＋本人真實的愛屋型錄頁 HTML（fixture 放在 591 外掛的 test/fixtures，那邊是原件），不連網路、不連資料庫。
 *
 * 跑法：node test-catalog-copy.mjs
 *
 * 重點驗：
 *   ・輸入判斷：愛屋連結／案號／591／樂屋，認不得的老實說、不亂猜（evilhouseol.com.tw 不算愛屋）
 *   ・文案版型跟同業截圖一樣（💰📍🏠📐🏢📅🚗✨），型錄沒有的欄位整行省略＋提醒，不編
 *   ・🔴 地址只到路名（文案裡不准出現門牌號）
 *   ・拿真實型錄頁驗：標題結尾的價格尾巴要拿掉、「➁➂➃」圈圈數字要拿掉
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "../..");
const FIX = path.resolve(HERE, "../591-extension/test/fixtures");
const lib = (n) => import(`${pathToFileURL(ROOT).href}/src/lib/${n}.ts`);

const input = await lib("listing-input");
const catalog = await lib("catalog-import");
const copy = await lib("catalog-copy");

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${name}${extra ? `　→ ${extra}` : ""}`);
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)}，應該 ${JSON.stringify(want)}`);

/* ── ① 輸入判斷 ── */
{
  const c = (s) => input.classifyListingInput(s);
  eq("① 案號", c("AA6345420"), { ok: true, input: { kind: "no", no: "AA6345420" } });
  eq("① 案號小寫、前後空白也吃", c("  aa6345420 \n"), { ok: true, input: { kind: "no", no: "AA6345420" } });
  eq("① 「編號：AD5358801」整句", c("物件編號：AD5358801"), { ok: true, input: { kind: "no", no: "AD5358801" } });
  const hu = "https://es.houseol.com.tw/Ecatalog.aspx?UID=SP254&UAID=H229&No=AA6345420&AID=H229";
  eq("① 愛屋型錄連結", c(hu), { ok: true, input: { kind: "houseol", url: hu } });
  eq("① 連結夾在整句話裡（尾巴有標點）", c(`看這間：${hu}。`).input, { kind: "houseol", url: hu });
  ok("① 愛屋的「更多照片」連結不算型錄頁", c("https://es.houseol.com.tw/EInfos.aspx?type=3&picstr=https://hq.houseol.com.tw/images/pictures/x.jpg").ok === false);
  ok("① 愛屋但不是 .aspx（首頁）不算", c("https://es.houseol.com.tw/").ok === false);
  eq("① 591 連結", c("https://sale.591.com.tw/home/house/detail/2/12345678.html").input?.kind, "591");
  eq("① 591 出租", c("https://rent.591.com.tw/12345678").input?.kind, "591");
  eq("① 樂屋連結", c("https://www.rakuya.com.tw/sell_item/info?ehid=abc123").input?.kind, "rakuya");
  ok("① 🔴 evilhouseol.com.tw 不算愛屋", c("https://evilhouseol.com.tw/Ecatalog.aspx?No=AA1234567").ok === false);
  ok("① 🔴 houseol.com.tw.evil.com 不算愛屋", c("https://houseol.com.tw.evil.com/Ecatalog.aspx?No=AA1234567").ok === false);
  ok("① 🔴 evil591.com.tw 不算 591", c("https://evil591.com.tw/x").ok === false);
  ok("① 別的網站老實說不支援", (() => { const r = c("https://www.google.com/"); return r.ok === false && r.error.includes("不支援"); })());
  ok("① 空字串要有提示", (() => { const r = c("   "); return r.ok === false && r.error.length > 5; })());
  ok("① 亂打的字不亂猜", c("hello world").ok === false);
  ok("① 太短的編號不算（AA123）", c("AA123").ok === false);
  eq("① 案號 → 他自己的型錄網址", input.catalogUrlForNo("aa6345420"), hu);
  ok("① 組出來的網址通過型錄頁判斷", input.isHouseolCatalogUrl(input.catalogUrlForNo("AD5358801")));
}

/* ── ② 從 591／樂屋頁面裡反查愛屋 ── */
{
  const f = input.findHouseolRef;
  eq(
    "② 完整型錄連結（HTML 裡 & 被轉成 &amp;）",
    f('<p>詳細資料 <a href="https://es.houseol.com.tw/Ecatalog.aspx?UID=SP254&amp;UAID=H229&amp;No=AD5358836&amp;AID=H229">看型錄</a></p>'),
    { kind: "url", url: "https://es.houseol.com.tw/Ecatalog.aspx?UID=SP254&UAID=H229&No=AD5358836&AID=H229", no: "AD5358836" },
  );
  eq("② 純文字連結", f("物件編號:AD5358836\nhttps://es.houseol.com.tw/Ecatalog.aspx?No=AD5358836&AID=H229\n").kind, "url");
  eq("② 只有編號（沒連結）", f("好房 歡迎來電\n編號：AA6345420\n"), { kind: "no", no: "AA6345420" });
  eq("② 「物件編號」＋HTML 標籤夾在中間", f("物件編號：<b>AD5358836</b>"), { kind: "no", no: "AD5358836" });
  ok("② 🔴 沒有「編號」字樣的亂碼 id 不撈（免得抓錯戶）", f('<div id="AB1234567890" data-x="ZZ9876543"></div> 台中市梧棲區 2房2廳') === null);
  ok("② 找不到回 null", f("") === null && f(null) === null);
  ok("② 連結不是型錄頁（EInfos 照片連結）不算", f("https://es.houseol.com.tw/EInfos.aspx?type=3&picstr=x") === null);
}

/* ── ③ 標題價格尾巴 ── */
{
  const c = catalog.cleanCatalogTitle;
  eq("③ 結尾的「 1880萬」拿掉", c("專售近中科靜宜沙鹿雙車美墅 1880萬"), "專售近中科靜宜沙鹿雙車美墅");
  eq("③ 小數「 1.8萬」", c("兩房兩衛拎包入住 1.8萬"), "兩房兩衛拎包入住");
  eq("③ 「 1.2億」", c("豪宅 1.2億"), "豪宅");
  eq("③ 沒隔空白的是本人自己打的字，不動", c("新成屋698萬"), "新成屋698萬");
  eq("③ 不在結尾的不動", c("近捷運 2萬坪基地 大兩房"), "近捷運 2萬坪基地 大兩房");
  eq("③ 沒有價格的原樣", c("覓蜜二房平車視野戶|三區核心"), "覓蜜二房平車視野戶|三區核心");
  eq("③ null 安全", c(null), "");
}

/* ── ④ 特色行首的清單符號 ── */
{
  const s = catalog.splitFeatureLines;
  eq(
    "④ ①②➁➂❶⓵ 1. 2、 ✨ ・ 各種開頭都拿掉",
    s("①甲\n②乙\n➁丙\n➂丁\n❶戊\n⓵己\n1.庚\n2、辛\n✨壬\n・癸\n3)子"),
    ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸", "子"],
  );
  eq("④ 空行與按鈕文字丟掉", s("甲\n\n地圖 街景 更多照片 成交行情\n乙"), ["甲", "乙"]);
  eq("④ 內文中間的數字不動", s("近 7-11、全家 5 分鐘"), ["近 7-11、全家 5 分鐘"]);
}

/* ── ⑤ 本人真實的出售型錄（沙鹿區平等十一街，1880 萬雙車美墅）→ 文案 ── */
{
  const html = readFileSync(path.join(FIX, "catalog-real-page-cn-numeral-street.html"), "utf8");
  const d = catalog.parseCatalog(catalog.catalogTextFromHtml(html));
  eq("⑤ 標題拿掉價格尾巴", d.title, "專售近中科靜宜沙鹿雙車美墅");
  eq("⑤ rawTitle 原樣留著", d.rawTitle, "專售近中科靜宜沙鹿雙車美墅 1880萬");
  eq("⑤ 主＋附屬坪數有抓到", d.mainAttPing, 47.35);

  const out = copy.buildCatalogAdCopy(d);
  const want = [
    "【專售近中科靜宜沙鹿雙車美墅】",
    "",
    "💰 開價 1880 萬",
    "📍 沙鹿區平等十一街",
    "🏠 4房3廳3衛",
    "📐 登記 47.35 坪（主＋附屬 47.35 坪）",
    "🏢 1-3樓 / 共 3 樓",
    "📅 屋齡 4 年",
    "🚗 車位：車庫/庭院",
    "",
    "✨ 環境特色",
    "・北勢國小旁，上學走路可到，學區美宅沙鹿北勢生活圈",
    "・面寬5米5，前院停車，近7-11、全家、北勢商圈、學區。",
    "・四大美房、輕屋齡，交通與生活機能完善且便利👍",
    "・未來捷運藍線和北勢商圈步行🉑抵達，機能便利成家首選。",
  ].join("\n");
  eq("⑤ 整份貼文內容跟截圖版型一致", out.body, want);
  eq("⑤ 標題（只給自己看）", out.title, "專售近中科靜宜沙鹿雙車美墅");
  eq("⑤ 這戶欄位齊全，沒有提醒", out.warnings, []);
  ok("⑤ 🔴 文案裡沒有門牌（N號）", !/\d+\s*號/.test(out.body), out.body);
  ok("⑤ 圈圈數字開頭都拿掉了", !/[①-⑳➀-➓❶-❿]/.test(out.body));
  ok("⑤ 沒有 Markdown 符號（FB 不吃）", !/\*\*|^#|\[.*\]\(.*\)|`/m.test(out.body));
}

/* ── ⑥ 本人真實的出租型錄（梧棲區文心街，18000/月，沒有門牌號） ── */
{
  const html = readFileSync(path.join(FIX, "catalog-real-page.html"), "utf8");
  const d = catalog.parseCatalog(catalog.catalogTextFromHtml(html));
  const out = copy.buildCatalogAdCopy(d);
  eq("⑥ 標題拿掉「 1.8萬」", out.title, "兩房兩衛拎包入住");
  ok("⑥ 出租顯示租金、不寫開價", out.body.includes("💰 租金 18,000 元／月") && !out.body.includes("開價"), out.body);
  ok("⑥ 格局 2房2廳2衛", out.body.includes("🏠 2房2廳2衛"), out.body);
  ok("⑥ 樓別 6樓 / 共 6 樓", out.body.includes("🏢 6樓 / 共 6 樓"), out.body);
  ok("⑥ 環境特色 5 條", (out.body.match(/^・/gm) || []).length === 5, out.body);
  // 2026-10-07：這筆型錄的地址是「梧棲區文心街」（街名沒有任何數字、門牌也沒登錄）。
  // 原本地址行要有數字才認，整行被丟掉、連區跟路名都沒了——同業工具對同款型錄是讀得到路名的。
  ok("⑥ 街名沒有數字、沒有門牌也讀得到「區＋路名」", out.body.includes("📍 梧棲區文心街"), out.body);
  ok("⑥ 🔴 沒編門牌（就算型錄頁沒有，也不會有號）", !/\d+\s*號/.test(out.body));
}

/* ── ⑥b 同業截圖裡那一戶（AA6345420 覓蜜二房平車視野戶）：欄位要跟截圖一模一樣 ── */
{
  const html = readFileSync(path.join(HERE, "test-fixture-catalog-AA6345420.html"), "utf8");
  const d = catalog.parseCatalog(catalog.catalogTextFromHtml(html));
  const out = copy.buildCatalogAdCopy(d);
  const want = [
    "【覓蜜二房平車視野戶|三區核心】",
    "",
    "💰 開價 738 萬",
    "📍 梧棲區民族路",
    "🏠 2房2廳1衛",
    "📐 登記 36.86 坪（主＋附屬 17.68 坪）",
    "🏢 4樓 / 共 12 樓",
    "📅 屋齡 2.5 年",
    "🚗 車位：坡道/平面",
    "",
    "✨ 環境特色",
    "・永益發建設是由總太集團營造品質，品牌建商，品質有保障",
    "・朝南格局，採光通風佳，視野遼闊，低樓層也不壓迫",
    "・社區管理嚴謹，住戶單純、自住比例高，公設齊全",
    "・沙鹿、清水、梧棲三區交界，近沙鹿交流道，交通便利",
    "・生活機能完整：家樂福5分、交流道9分、中科20分、市場火車站10分",
  ].join("\n");
  eq("⑥b 整份內容＝同業截圖（路名、坪數、樓層、屋齡、車位、特色全一樣）", out.body, want);
  eq("⑥b 欄位齊全沒有提醒", out.warnings, []);
  eq("⑥b 截圖上的標題", out.title, "覓蜜二房平車視野戶|三區核心");
  ok("⑥b 照片也抓得到（截圖那邊是 18 張）", catalog.photosFromCatalogHtml(html, "AA6345420").length === 18, String(catalog.photosFromCatalogHtml(html, "AA6345420").length));
}

/* ── ⑥c 全形冒號／括號還原（parseCatalog 為了比對標籤轉成半形，貼 FB 要還原） ── */
{
  const r = copy.restoreCjkPunctuation;
  eq("⑥c 緊貼中文的冒號 → 全形", r("生活機能完整:家樂福5分"), "生活機能完整：家樂福5分");
  eq("⑥c 時間的冒號不動", r("營業 9:30~18:00"), "營業 9:30~18:00");
  eq("⑥c 括號裡有中文 → 全形", r("Wi-Fi (免費)x"), "Wi-Fi （免費）x");
  eq("⑥c 純英數括號不動", r("面積(A+B)"), "面積(A+B)");
  eq("⑥c 網址不動", r("詳見 https://a.b/c"), "詳見 https://a.b/c");
}

/* ── ⑥d 地址行：有「地址:」標籤就直接用、沒標籤（貼上的純文字）才退回猜 ── */
{
  const labeled = catalog.parseCatalog("不動產電子型錄\n某某好屋\n地址:梧棲區民族路\n委託總價\n888萬");
  eq("⑥d 標好的地址（街名沒數字）", [labeled.addrParts.town, labeled.addrParts.road], ["梧棲區", "民族路"]);
  const guessed = catalog.parseCatalog("不動產電子型錄\n某某好屋\n台中市梧棲區八德路89號4樓之8\n委託總價\n888萬");
  eq("⑥d 沒標籤的純文字：退回猜（有數字的地址行）", [guessed.addr, guessed.floor], ["台中市梧棲區八德路89號", 4]);
  const noTitle = catalog.parseCatalog("不動產電子型錄\n地址:梧棲區民族路\n委託總價\n888萬");
  eq("⑥d 型錄沒有標題時，地址行不會被當成標題", [noTitle.rawTitle, noTitle.addrParts.road], ["", "民族路"]);
  const hidden = catalog.parseCatalog("不動產電子型錄\n某某好屋\n地址:台中市梧棲區中和街36號3樓 顯示\n委託總價\n888萬");
  eq("⑥d 行尾的「顯示」按鈕字拿掉、門牌照拆", [hidden.addrParts.no, hidden.addrParts.floor], ["36", 3]);
}

/* ── ⑦ 另外兩份真實型錄（環境特色 class 不同、排版不同）→ 特色都抓得到 ── */
for (const [file, minFeatures] of [
  ["catalog-real-page-points-m.html", 1],
  ["catalog-real-page-points-s.html", 3],
]) {
  const html = readFileSync(path.join(FIX, file), "utf8");
  const d = catalog.parseCatalog(catalog.catalogTextFromHtml(html));
  const out = copy.buildCatalogAdCopy(d);
  ok(`⑦ ${file}：環境特色至少 ${minFeatures} 條`, d.features.length >= minFeatures, String(d.features.length));
  ok(`⑦ ${file}：文案有 ✨ 環境特色段`, out.body.includes("✨ 環境特色"), out.body.slice(0, 200));
  ok(`⑦ ${file}：特色沒有殘留清單符號開頭`, d.features.every((f) => !/^[\s①-⑳➀-➓❶-❿⓵-⓾\d.、)・]/.test(f)), JSON.stringify(d.features.slice(0, 3)));
  ok(`⑦ ${file}：文案沒有門牌`, !/\d+\s*號/.test(out.body));
}

/* ── ⑧ 欄位缺很多的型錄：缺什麼省略什麼、每個都有提醒、不補預設值 ── */
{
  const d = catalog.parseCatalog("不動產電子型錄\n某某好屋\n委託總價\n888萬");
  const out = copy.buildCatalogAdCopy(d);
  eq("⑧ 只有標題跟價格", out.body, "【某某好屋】\n\n💰 開價 888 萬");
  ok("⑧ 缺的欄位都有提醒", ["地址", "格局", "登記坪數", "樓別", "屋齡", "車位", "環境特色"].every((k) => out.warnings.some((w) => w.includes(k))), JSON.stringify(out.warnings));
  ok("⑧ 🔴 沒有編出任何預設值（沒有 0房、沒有 0坪）", !/0房|0 坪|0廳|0衛/.test(out.body));
  const empty = copy.buildCatalogAdCopy(catalog.parseCatalog(""));
  ok("⑧ 整份空的也不會炸、全部都有提醒", empty.body === "" && empty.warnings.length >= 7, JSON.stringify(empty));
}

console.log(`\n${"─".repeat(60)}`);
if (fails.length === 0) {
  console.log(`✅ ${pass} 項全過`);
  process.exit(0);
}
console.log(`❌ ${pass} 過、${fails.length} 失敗：`);
for (const f of fails) console.log(`   ・${f}`);
process.exit(1);
