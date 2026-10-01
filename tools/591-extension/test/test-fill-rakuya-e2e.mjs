/**
 * fillRakuya.js 的端對端測試：Playwright 開一張「長得像樂屋」的假表單（mock-rakuya.mjs），
 * 假造 chrome.runtime.sendMessage 給它資料包，讓真正的 fillRakuya.js 去填，再把填進去的值讀回來對答案。
 *
 * 🔴 沒有連到真的樂屋：page.route 攔下所有請求，只有假表單那一條網址會被回應，其他一律 abort，
 *    最後還會斷言「除了假表單，沒有任何請求被放行」（同 [[learning_測試不能碰真帳號]] 的規矩）。
 *
 * ⚠️ 這是第一版，還沒對真的樂屋網跑過——這裡測的是「填表程式邏輯正確」，不是「跟真樂屋表單對得上」。
 *
 * 跑法：node test/test-fill-rakuya-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseListing } from "../lib/parser.js";
import { derive, buildRows, buildPayload, cleanTitle, buildDescription } from "../lib/map591.js";
import { buildRakuya } from "../lib/rakuya-map.js";
import { buildRakuyaMock } from "./mock-rakuya.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const require = createRequire(path.join(root, "..", "591-autofill", "package.json"));
const { chromium } = require("playwright");

const fx = (name) => fs.readFileSync(path.join(here, "fixtures", name), "utf8");
const SETTINGS = { name: "蕭茗馥", phone: "0932-645-362", line: "0932645362", company: "太平洋房屋 測試店", contract: "有簽訂", descHead: "☆ 物件特色", tail: "歡迎來電 {{phone}}" };
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const RAKUYA_URL = { rent: "https://member.rakuya.com.tw/rent/post/add", sale: "https://member.rakuya.com.tw/sell/post/add" };

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

function payloadFor(fixture, settings = SETTINGS) {
  const d = parseListing(fx(fixture));
  const o = derive(d, 2026);
  const rows = buildRows(d, o);
  const p = buildPayload(d, o, rows, cleanTitle(d.rawTitle), buildDescription(d, o, settings), settings);
  p.target = "rakuya";
  p.rakuya = buildRakuya(d, o, p, 2026);
  return p;
}

async function runOne(browser, kind, payload) {
  const mockUrl = RAKUYA_URL[kind];
  const html = buildRakuyaMock(kind);
  const page = await browser.newPage();
  const fulfilled = [];
  const aborted = [];
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (u === mockUrl) {
      fulfilled.push(u);
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    }
    aborted.push(u);
    return route.abort();
  });
  const shim = `
    window.__sent = [];
    window.chrome = { runtime: { lastError: undefined, getManifest: () => ({ version: "0.0.0-test" }), sendMessage(msg, cb) {
      window.__sent.push(msg.type);
      const reply = (r) => setTimeout(() => cb && cb(r), 5);
      if (msg.type === "listing:get") return reply({ ok: true, payload: ${JSON.stringify(payload)} });
      if (msg.type === "listing:clear") return reply({ ok: true });
      if (msg.type === "listing:fetch-image") return reply({ ok: true, b64: "${PNG}", type: "image/png" });
      reply({ ok: false, error: "unknown " + msg.type });
    } } };`;
  await page.addInitScript(shim);
  await page.goto(mockUrl, { waitUntil: "load" });
  await page.addScriptTag({ path: path.join(root, "fillRakuya.js") });
  const done = await page
    .waitForFunction(() => [...document.querySelectorAll("#listing-panel li")].some((li) => /✅ 填完/.test(li.textContent)), null, { timeout: 40000 })
    .then(() => true)
    .catch(() => false);
  const state = await page.evaluate(() => {
    const $ = (s) => document.querySelector(s);
    const val = (name) => {
      const el = document.querySelector(`[name="${name}"]`);
      return el ? el.value : undefined;
    };
    const checkedRadio = (name) => {
      const r = [...document.querySelectorAll(`[name="${name}"]`)].find((i) => i.checked);
      return r ? r.value : "";
    };
    const checkedBoxes = (name) => [...document.querySelectorAll(`[name="${name}"]`)].filter((i) => i.checked).map((i) => i.value);
    const isChecked = (name) => {
      const el = document.querySelector(`[name="${name}"]`);
      return !!(el && el.checked);
    };
    return {
      log: [...document.querySelectorAll("#listing-panel li")].map((li) => li.textContent),
      missing: ($("#listing-panel .miss") || {}).textContent || "",
      panelTitle: ($("#listing-panel h4 span") || {}).textContent || "",
      legal: val("selectPropertyUsecode"),
      usecode: val("usecode"),
      typecode: val("typecode"),
      agetype: checkedRadio("agetype"),
      hname: val("hname"),
      city: val("city"),
      zipcode: val("zipcode"),
      addr_road: val("addr_road"),
      addr_lane: val("addr_lane"),
      addr_alley: val("addr_alley"),
      addr_num: val("addr_num"),
      is_community: checkedRadio("is_community"),
      community: val("community"),
      floors_type: checkedRadio("floors_type"),
      floors: [...document.querySelectorAll('[name="floors"]')].filter((el) => el.offsetParent !== null).map((el) => el.value),
      floors_max: val("floors_max"),
      surfloors: val("surfloors"),
      bedrooms: val("bedrooms"),
      livingrooms: val("livingrooms"),
      bathrooms: val("bathrooms"),
      findate: val("findate"),
      findateUnknow: isChecked("findateUnknow"),
      direction: val("direction"),
      lifts: (() => {
        const el = document.querySelector('[name="lifts"]');
        return el && el.tagName === "SELECT" ? el.value : checkedRadio("lifts");
      })(),
      parkings: checkedRadio("parkings"),
      parkings_kind: checkedRadio("parkings_kind"),
      reg_garagesize: val("reg_garagesize"),
      mainsize: val("mainsize"),
      totalsize: val("totalsize"),
      subsize: val("subsize"),
      sharesize: val("sharesize"),
      basesize: val("basesize"),
      is_size_including_parkings: isChecked("is_size_including_parkings"),
      manage: val("manage"),
      securityfee: val("securityfee"),
      listprice: val("listprice"),
      is_price_including_parkings: isChecked("is_price_including_parkings"),
      is_calc_single_price: isChecked("is_calc_single_price"),
      rental: val("rental"),
      rental_include: checkedBoxes("rental_include[]"),
      deposit_m: val("deposit_m"),
      property_right: checkedRadio("property_right"),
      short_rent: checkedRadio("short_rent"),
      is_immigrate_anytime: isChecked("is_immigrate_anytime"),
      cook: checkedRadio("cook"),
      pet: checkedRadio("pet"),
      sex: checkedRadio("sex"),
      ridentity: checkedRadio("ridentity"),
      landlord: checkedRadio("landlord"),
      desc: ($(".note-editable") || {}).textContent || "",
      descHtml: ($(".note-editable") || {}).innerHTML || "",
      elementary: val("elementary"),
      market: val("market"),
      park: val("park"),
      isOwnerContact: checkedRadio("isOwnerContact"),
      contact_name: val("contact_name"),
      tel2: val("tel2"),
      files: window.__mock.files || 0,
      sent: window.__sent,
      events: window.__mock.events,
    };
  });
  await page.close();
  return { done, state, fulfilled, aborted, mockUrl };
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  /* ───────── 出租：住宅（好好窩） ───────── */
  {
    const p = payloadFor("catalog-rent-markdown.txt");
    const { done, state: s, fulfilled, aborted, mockUrl } = await runOne(browser, "rent", p);
    eq("租：沒有連到真的樂屋（只回應假表單那一條）", [fulfilled, aborted.filter((u) => /rakuya\.com\.tw/.test(u))], [[mockUrl], []]);
    eq("租：跑到「✅ 填完」", done, true);
    if (!done) console.log(s.log.join("\n"));
    eq("租：面板標題有版本號", /樂屋刊登助手 v/.test(s.panelTitle), true);
    eq("租：法定用途/現況型式/現況類型三連選", [s.legal, s.usecode, s.typecode], ["住家用", "整層住家", "電梯大廈"]);
    eq("租：物件名稱（25 字內不截）", s.hname, "好好窩大2房");
    eq("租：地址縣市/行政區/街道三連選", [s.city, s.zipcode, s.addr_road], ["台中市", "梧棲區", "八德路"]);
    eq("租：巷弄空、號 120", [s.addr_lane, s.addr_alley, s.addr_num], ["", "", "120"]);
    eq("租：是社區、選到和築好好窩", [s.is_community, s.community], ["是社區", "和築好好窩"]);
    eq("租：樓層單層、樓層13→3、樓之不是樂屋欄位、總樓層15", [s.floors_type, s.floors, s.surfloors], ["單層", ["3"], "15"]);
    eq("租：格局 2/2/1", [s.bedrooms, s.livingrooms, s.bathrooms], ["2", "2", "1"]);
    eq("租：型錄沒竣工日 → 屋齡不詳勾起來", [s.findate, s.findateUnknow], ["", true]);
    eq("租：朝向（型錄「座西 朝東」→ 坐西朝東）", s.direction, "坐西朝東");
    eq("租：電梯 select 有", s.lifts, "有");
    eq("租：機車位不算車位 → 無車位", s.parkings, "無車位");
    eq("租：可使用坪數 20.2", s.mainsize, "20.2");
    eq("租：管理方式（含在租金裡，算有管理）", s.manage, "管理員(警衛)");
    eq("租：租金 15000", s.rental, "15000");
    eq("租：租金包含管理費", s.rental_include, ["管理費"]);
    eq("租：押金 2個月租金", s.deposit_m, "2個月租金");
    eq("租：產權有、短期租賃不可、隨時可遷入", [s.property_right, s.short_rent, s.is_immigrate_anytime], ["有", "不可", true]);
    eq("租：開伙可、寵物不可", [s.cook, s.pet], ["可", "不可"]);
    eq("租：性別不限、身份不限、不與房東同住", [s.sex, s.ridentity, s.landlord], ["不限", "不限", "不與房東同住"]);
    eq("租：文案貼進 note-editable", /物件特色/.test(s.desc) && /歡迎來電0932-645-362/.test(s.desc.replace(/\s+/g, "")), true);
    eq("租：聯絡方式切到自行填寫、姓名帶入", [s.isOwnerContact, s.contact_name], ["自行填寫", "蕭茗馥"]);
    eq("租：一開始沒有電話（mock 沒預填），列進待補", s.missing.includes("行動電話"), true);
    eq("租：照片 4 張塞進上傳框", s.files, 4);
    eq("租：待補清單有提供設備家具", s.missing.includes("提供設備、提供傢俱"), true);
    eq("租：填完有清掉資料包", s.sent.includes("listing:clear"), true);
    eq("租：沒有紅字錯誤", s.log.filter((l) => /出錯|程式出錯/.test(l)), []);
  }

  /* ───────── 出售：住宅（假樣本，領袖天廈） ───────── */
  {
    const p = payloadFor("catalog-sale-synthetic.txt");
    const { done, state: s, fulfilled, aborted, mockUrl } = await runOne(browser, "sale", p);
    eq("售：沒有連到真的樂屋", [fulfilled, aborted.filter((u) => /rakuya\.com\.tw/.test(u))], [[mockUrl], []]);
    eq("售：跑到「✅ 填完」", done, true);
    if (!done) console.log(s.log.join("\n"));
    eq("售：法定用途/現況型式/現況類型", [s.legal, s.usecode, s.typecode], ["住家用", "住宅", "電梯大廈"]);
    eq("售：屋齡分類 中古屋（33年）", s.agetype, "中古屋");
    eq("售：地址街道 四維路", s.addr_road, "四維路");
    eq("售：巷 71、號 2", [s.addr_lane, s.addr_num], ["71", "2"]);
    eq("售：社區 領袖天廈", s.community, "領袖天廈");
    eq("售：樓層單層 12、總樓層 15", [s.floors_type, s.floors, s.surfloors], ["單層", ["12"], "15"]);
    eq("售：格局 4/2/2", [s.bedrooms, s.livingrooms, s.bathrooms], ["4", "2", "2"]);
    eq("售：竣工年填了、不勾屋齡不詳", [s.findate, s.findateUnknow], ["33", false]);
    eq("售：朝向 坐北朝南", s.direction, "坐北朝南");
    eq("售：電梯 radio 有", s.lifts, "有");
    eq("售：車位有、坡道平面式", [s.parkings, s.parkings_kind], ["有車位", "坡道平面式"]);
    eq("售：車位坪數 10.5", s.reg_garagesize, "10.5");
    eq("售：權狀 51.16 含車位、主建物 40.08、附屬 0.895、共有 10.183", [s.totalsize, s.is_size_including_parkings, s.mainsize, s.subsize, s.sharesize], ["51.16", true, "40.08", "0.895", "10.183"]);
    eq("售：土地 5.2", s.basesize, "5.2");
    eq("售：管理員(警衛)、管理費 2342", [s.manage, s.securityfee], ["管理員(警衛)", "2342"]);
    eq("售：售價 868 含車位、算單價", [s.listprice, s.is_price_including_parkings, s.is_calc_single_price], ["868", true, true]);
    eq("售：文案貼進 note-editable", /物件特色/.test(s.desc), true);
    eq("售：鄰近國小/公園帶進環境欄位", [s.elementary, s.park], ["梧棲國小", "頂寮公園"]);
    eq("售：聯絡方式切到自行填寫、姓名帶入", [s.isOwnerContact, s.contact_name], ["自行填寫", "蕭茗馥"]);
    eq("售：照片沒有 → 列進待補", [s.files, s.missing.includes("照片")], [0, true]);
    eq("售：沒有紅字錯誤", s.log.filter((l) => /出錯|程式出錯/.test(l)), []);
  }

  /**
   * ───────── 封面貼圖合成後的 data: URL 照片，樂屋這邊也要能直接本機解碼（2026-09-24）─────────
   * app.js 的 launch() 換掉的封面照（data: URL）591／樂屋都適用（不是 591 專屬功能），這支的
   * fetchPhotoAsB64() 要跟 fill591.js 那份認得一樣的格式，不會誤送 listing:fetch-image 去問
   * background（data: URL 沒有 hostname，那支只認 houseol/cloudinary 網域）。
   */
  {
    const p = payloadFor("catalog-sale-synthetic.txt");
    const composited = `data:image/png;base64,${PNG}`;
    p.photos = [composited, "https://hq.houseol.com.tw/images/pictures/AA0002.jpg"];
    const { done, state: s } = await runOne(browser, "sale", p);
    eq("封面合成：跑到「✅ 填完」", done, true);
    if (!done) console.log(s.log.join("\n"));
    eq("封面合成：2 張都成功塞進上傳框（data: 那張也算進去）", s.files, 2);
    eq("封面合成：只有 1 張遠端照片真的發訊息問 background，data: 那張沒發（本機直接解碼）", s.sent.filter((t) => t === "listing:fetch-image").length, 1);
    eq("封面合成：沒有紅字錯誤", s.log.filter((l) => /出錯|程式出錯/.test(l)), []);
  }

  /**
   * ───────── 固定尾段設了字級／顏色：descHtml 直接整段當 innerHTML（Summernote 是純 contenteditable）─────────
   * 跟 591 的 ProseMirror 不同，這裡不用發 paste 事件——setSummernote 有 html 就直接整段用它。
   */
  {
    const styled = { ...SETTINGS, tailStyle: { size: "18px", bold: true, underline: true, lines: [{ color: "", bg: "#ffff00" }] } };
    const p = payloadFor("catalog-sale-synthetic.txt", styled);
    eq("樣式：payload 真的帶了 descHtml", typeof p.descHtml, "string");
    const { done, state: s } = await runOne(browser, "sale", p);
    eq("樣式：跑到「✅ 填完」", done, true);
    if (!done) console.log(s.log.join("\n"));
    eq("樣式：note-editable 的 innerHTML 就是 descHtml 本人（直接整段用，不用另外發事件）", s.descHtml, p.descHtml);
    eq("樣式：尾段套上了字級／底色／粗體／底線（樂屋是 contenteditable，底線留得住）", s.descHtml.includes('<span style="background-color:#ffff00"><span style="font-size:18px"><strong><u>'), true);
    /* 2026-09-24：descHtml 現在不是只有固定尾段設了樣式才會有值（抬頭固定粗體18px），訊息改成籠統的「含格式」 */
    eq("樣式：面板訊息有標「含格式」", s.log.some((l) => /文案已貼入（含格式）/.test(l)), true);
    eq("樣式：沒有紅字錯誤", s.log.filter((l) => /出錯|程式出錯/.test(l)), []);
  }

  /* ───────── 沒有資料包、或給 591 的資料包：不動 ───────── */
  {
    const page = await browser.newPage();
    await page.route("**/*", (route) => (route.request().url() === RAKUYA_URL.sale ? route.fulfill({ status: 200, contentType: "text/html", body: buildRakuyaMock("sale") }) : route.abort()));
    await page.addInitScript(`window.chrome = { runtime: { getManifest: () => ({version:"0"}), sendMessage(m, cb) { setTimeout(() => cb({ ok: true, payload: { v: 1, deal: "sale", target: "591" } }), 5); } } };`);
    await page.goto(RAKUYA_URL.sale, { waitUntil: "load" });
    await page.addScriptTag({ path: path.join(root, "fillRakuya.js") });
    await page.waitForTimeout(800);
    const untouched = await page.evaluate(
      () =>
        !document.querySelector("#listing-panel") &&
        [...document.querySelectorAll('input:not([type=radio]):not([type=checkbox]), select')].every((i) => !i.value) &&
        [...document.querySelectorAll("input[type=radio], input[type=checkbox]")].every((i) => !i.checked),
    );
    eq("給 591 的資料包：樂屋這支不動任何一格", untouched, true);
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`\n樂屋填表端對端測試：${pass} 過、${fail} 錯`);
process.exit(fail ? 1 : 0);
