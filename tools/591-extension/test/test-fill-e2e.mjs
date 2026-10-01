/**
 * 填表程式（fill591.js）的端對端測試：用 Playwright 開一張「長得像 591」的假表單（mock-591.mjs），
 * 假造 chrome.runtime.sendMessage 給它資料包，讓真正的 fill591.js 去填，再把填進去的值讀回來對答案。
 *
 * 🔴 沒有連到真的 591：page.route 攔下所有請求，只有假表單那一條網址會被回應，其他一律 abort，
 *    最後還會斷言「除了假表單，沒有任何請求被放行」（[[learning_測試不能碰真帳號]]）。
 *
 * 跑法：node test/test-fill-e2e.mjs   （借用 ../591-autofill/node_modules 的 Playwright，用系統 Chrome）
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseListing } from "../lib/parser.js";
import { derive, buildRows, buildPayload, cleanTitle, buildDescription, launchUrl } from "../lib/map591.js";
import { buildMock } from "./mock-591.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const require = createRequire(path.join(root, "..", "591-autofill", "package.json"));
const { chromium } = require("playwright");

const fx = (name) => fs.readFileSync(path.join(here, "fixtures", name), "utf8");
const SETTINGS = { name: "蕭茗馥", phone: "0932-645-362", line: "0932645362", company: "太平洋房屋 測試店", contract: "有簽訂", descHead: "☆ 物件特色", tail: "歡迎來電 {{phone}}" };
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

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
  return buildPayload(d, o, rows, cleanTitle(d.rawTitle), buildDescription(d, o, settings), settings);
}

async function runOne(browser, kind, payload) {
  const mockUrl = launchUrl(payload);
  const html = buildMock(kind);
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
    window.chrome = { runtime: { lastError: undefined, sendMessage(msg, cb) {
      window.__sent.push(msg.type);
      const reply = (r) => setTimeout(() => cb && cb(r), 5);
      if (msg.type === "listing:get") return reply({ ok: true, payload: ${JSON.stringify(payload)} });
      if (msg.type === "listing:clear") return reply({ ok: true });
      if (msg.type === "listing:fetch-image") return reply({ ok: true, b64: "${PNG}", type: "image/png" });
      reply({ ok: false, error: "unknown " + msg.type });
    } } };`;
  await page.addInitScript(shim);
  await page.goto(mockUrl, { waitUntil: "load" });
  await page.addScriptTag({ path: path.join(root, "fill591.js") });
  const done = await page
    .waitForFunction(() => [...document.querySelectorAll("#listing-panel li")].some((li) => /✅ 填完/.test(li.textContent)), null, { timeout: 40000 })
    .then(() => true)
    .catch(() => false);
  const raw = await page.evaluate(() => {
    const $ = (s) => document.querySelector(s);
    const items = [...document.querySelectorAll(".ant-form-item")].map((i) => ({
      label: i.querySelector(".ant-form-item-label").textContent.replace(/\s*\(說明\)|\s*說明$/g, "").trim(),
      nums: [...i.querySelectorAll(".ant-input-number-input")].map((x) => x.value),
      txts: [...i.querySelectorAll("input.ant-input")].map((x) => x.value),
      checked: [...i.querySelectorAll("label.ant-radio-wrapper-checked, label.ant-checkbox-wrapper-checked")].map((x) => x.textContent.trim()),
      sels: [...i.querySelectorAll(".ant-select .ant-select-selection-item")].map((x) => x.textContent),
      f: Object.fromEntries([...i.querySelectorAll("[data-f]")].map((x) => [x.dataset.f, x.value])),
    }));
    return {
      items,
      // 全頁抓，不綁定某個 .ant-form-item —— 商辦表單「樓／樓之」跟「巷/號/之」不同一列（不同 .ant-form-item）
      f: Object.fromEntries([...document.querySelectorAll("[data-f]")].map((x) => [x.dataset.f, x.value])),
      log: [...document.querySelectorAll("#listing-panel li")].map((li) => li.textContent),
      missing: ($("#listing-panel .miss") || {}).textContent || "",
      modalHidden: $("#city-modal").hidden,
      city: window.__mock.city,
      allChecked: [...document.querySelectorAll("label.ant-radio-wrapper-checked, label.ant-checkbox-wrapper-checked")].map((x) => x.textContent.trim()),
      desc: $(".ProseMirror").textContent,
      descHtml: $(".ProseMirror").innerHTML,
      files: window.__mock.files || 0,
      floorPlanFile: window.__mock.floorPlanFile || "",
      sent: window.__sent,
      events: window.__mock.events,
    };
  });
  const item = (l) => raw.items.find((i) => i.label.startsWith(l)) || { nums: [], txts: [], checked: [], sels: [], f: {} };
  const addr = item("出售地址").label ? item("出售地址") : item("出租地址");
  const state = {
    ...raw,
    nums: (l) => item(l).nums,
    txt: (l) => item(l).txts[0] ?? "",
    checked: (l) => item(l).checked,
    sel: (l) => item(l).sels[0] ?? "",
    addrSel: addr.sels,
    lane: raw.f.lane, no: raw.f.no, sub: raw.f.sub, floor: raw.f.floor, floorSub: raw.f.floorSub, alley: addr.nums[0],
    hideNo: raw.allChecked.includes("隱藏門號"),
    title: item("廣告標題").txts[0] ?? "",
    contact: item("聯絡人").txts[0] ?? "",
    v: {
      totalFloor: (item("出售總樓層").label ? item("出售總樓層") : item("出租總樓層")).nums[0],
      community: item("社區名稱").txts[0] ?? "",
      layout: item("格局").nums,
      done: item("建築完工時間").nums,
      doneRadio: item("建築完工時間").checked,
      facing: item("朝向").sels[0] ?? "",
      reg: item("權狀坪數").nums,
      life: raw.allChecked.filter((x) => /^近/.test(x)),
      contract: item("委託書").checked,
      agency: raw.allChecked.some((x) => /經紀業/.test(x)),
    },
  };
  await page.close();
  return { done, state, fulfilled, aborted, mockUrl };
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  /* ───────── 出租 ───────── */
  {
    const p = payloadFor("catalog-rent-markdown.txt");
    const { done, state: s, fulfilled, aborted, mockUrl } = await runOne(browser, "rent", p);
    eq("租：沒有連到真的 591（只回應假表單那一條）", [fulfilled, aborted.filter((u) => /591\.com\.tw|houseol/.test(u))], [[mockUrl], []]);
    eq("租：跑到「✅ 填完」", done, true);
    if (!done) console.log(s.log.join("\n"));
    eq("租：縣市彈窗選了台中市並關掉", [s.city, s.modalHidden], ["台中市", true]);
    eq("租：地址走匯入（縣市／鄉鎮／街道）", s.addrSel, ["台中市", "梧棲區", "八德路"]);
    eq("租：號 120、樓 3、樓之 5、巷弄空", [s.no, s.floor, s.floorSub, s.lane, s.alley, s.sub], ["120", "3", "5", "", "", ""]);
    eq("租：隱藏門號勾了", s.hideNo, true);
    eq("租：出租總樓層 15", s.v.totalFloor, "15");
    eq("租：電梯 有", s.checked("電梯"), ["有"]);
    eq("租：社區名稱", s.v.community, "和築好好窩");
    eq("租：格局 2/2/1、第 4 格不動", s.v.layout, ["2", "2", "1", ""]);
    eq("租：可使用坪數", s.nums("可使用坪數"), ["20.2"]);
    eq("租：權狀坪數", s.v.reg, ["29.7"]);
    eq("租：車位 無", s.checked("車位"), ["無"]);
    eq("租：完工時間點屋齡不詳、年月日空", [s.v.doneRadio, s.v.done], [["屋齡不詳"], ["", "", ""]]);
    eq("租：朝向", s.v.facing, "坐西朝東");
    eq("租：最短租期 1年", s.checked("最短租期"), ["1年"]);
    eq("租：隨時可遷入", s.checked("可遷入日"), ["隨時可遷入"]);
    eq("租：身份三個都勾", s.checked("身份要求"), ["學生", "上班族", "家庭"]);
    eq("租：開伙可、寵物不可", [s.checked("開伙"), s.checked("養寵物")], [["可"], ["不可"]]);
    eq("租：租金", s.txt("租金"), "15000");
    eq("租：押金 2個月", s.checked("押金"), ["2個月"]);
    eq("租：租金包含 只勾管理費", s.checked("租金包含"), ["管理費"]);
    eq("租：水電", [s.checked("水費"), s.checked("電費")], [["台水繳費"], ["台電繳費"]]);
    eq("租：管理費金額空、也沒勾無（列在待補）", [s.txt("管理費"), s.checked("管理費")], ["", []]);
    eq("租：生活機能沒勾", s.v.life, []);
    eq("租：標題", s.title, "好好窩大2房");
    eq("租：文案貼進 ProseMirror", /☆物件特色.*✨禁神明廳，禁寵.*歡迎來電0932-645-362/.test(s.desc.replace(/\s+/g, "")), true);
    eq("租：聯絡人", s.contact, "蕭茗馥");
    eq("租：委託書／產權登記", [s.v.contract, s.checked("產權登記")], [["有簽訂"], ["已辦產"]]);
    eq("租：服務費不動", s.checked("服務費"), []);
    eq("租：經紀業資料勾了", s.v.agency, true);
    eq("租：照片 4 張塞進上傳框", s.files, 4);
    eq("租：待補清單", ["裝潢時間", "裝潢程度", "提供設備", "管理費金額"].every((k) => s.missing.includes(k)), true);
    eq("租：填完有清掉資料包", s.sent.includes("listing:clear"), true);
    eq("租：沒有紅字錯誤", s.log.filter((l) => /出錯|程式出錯/.test(l)), []);
  }

  /* ───────── 出售（沒有匯入地址快速框的版面 → 一格一格選、街道走搜尋面板） ───────── */
  {
    const p = payloadFor("catalog-sale-synthetic.txt");
    const { done, state: s, fulfilled, aborted, mockUrl } = await runOne(browser, "sale", p);
    eq("售：沒有連到真的 591", [fulfilled, aborted.filter((u) => /591\.com\.tw|houseol/.test(u))], [[mockUrl], []]);
    eq("售：跑到「✅ 填完」", done, true);
    if (!done) console.log(s.log.join("\n"));
    eq("售：縣市／鄉鎮用下拉選、街道走搜尋面板", s.addrSel, ["台中市", "梧棲區", "四維路"]);
    eq("售：街道一開始不在清單裡（模擬分頁很後面）、按放大鏡搜尋才出現再點清單", [s.events.includes("street-search:四維路"), s.events.includes("street:四維路")], [true, true]);
    /* 2026-09-18：同一次搜尋只能送一遍。原本除了點放大鏡還多送一組 Enter 當保險，但那等於同一個關鍵字
       送兩次查詢，真站上若是「新查詢取消舊查詢」的寫法就可能兩邊都被吃掉、清單回 0 條。 */
    eq("售：同一個路名只送一次搜尋，不重複送", s.events.filter((e) => e === "street-search:四維路").length, 1);
    eq("售：巷 71、號 2、樓 12、樓之 1", [s.lane, s.no, s.floor, s.floorSub], ["71", "2", "12", "1"]);
    eq("售：出售總樓層", s.v.totalFloor, "15");
    eq("售：社區", s.v.community, "領袖天廈");
    eq("售：格局 4/2/2", s.v.layout, ["4", "2", "2", ""]);
    eq("售：完工 成屋 82/5/20", [s.v.doneRadio, s.v.done], [["成屋"], ["82", "5", "20"]]);
    eq("售：朝向", s.v.facing, "坐北朝南");
    eq("售：權狀 51.16 含車位面積", [s.v.reg, s.checked("權狀坪數")], [["51.16"], ["含車位面積"]]);
    eq("售：車位面積 10.5、型式平面式停車位", [s.nums("車位面積"), s.sel("車位面積")], [["10.5"], "平面式停車位"]);
    eq("售：主／附／公／土", [s.nums("主建物"), s.nums("附屬建物"), s.nums("共有部分"), s.nums("土地坪數")], [["40.08"], ["0.895"], ["10.183"], ["5.2"]]);
    eq("售：售價 868 含車位價格、自備款 174", [s.txt("售價"), s.checked("售價"), s.txt("自備款")], ["868", ["含車位價格"], "174"]);
    eq("售：管理費 有 2342", [s.checked("管理費"), s.nums("管理費")], [["有"], ["2342"]]);
    eq("售：帶租約 否", s.checked("帶租約"), ["否"]);
    eq("售：裝潢程度沒選（待補）", [s.checked("裝潢程度"), s.missing.includes("裝潢程度")], [[], true]);
    eq("售：生活機能 近學校、近公園綠地", s.v.life, ["近學校", "近公園綠地"]);
    eq("售：標題", s.title, "社區最便宜全新美兩房平車");
    eq("售：服務費 收取", s.checked("服務費"), ["收取服務費"]);
    eq("售：委託書", s.v.contract, ["有簽訂"]);
    eq("售：經紀業資料勾了", s.v.agency, true);
    eq("售：沒照片 → 列在待補", [s.files, s.missing.includes("照片")], [0, true]);
    eq("售：沒有紅字錯誤", s.log.filter((l) => /出錯|程式出錯/.test(l)), []);
  }

  /**
   * ───────── 街道帶「幾段」搜尋不到，要改搜路名主體（2026-09-12 真實案例：臨港路四段）─────────
   * 清單裡真的有這條路（手動翻頁找得到），但 591 的搜尋對完整「路名+幾段」是 0 條結果；
   * 借用出售那組（街道走搜尋面板）的資料包，只把路名換成帶「段」的，其他都不動。
   */
  {
    const p = payloadFor("catalog-sale-synthetic.txt");
    p.addr = { ...p.addr, road: "臨港路四段", lane: "" };
    const { done, state: s } = await runOne(browser, "sale", p);
    eq("段：跑到「✅ 填完」", done, true);
    if (!done) console.log(s.log.join("\n"));
    eq("段：先搜完整路名「臨港路四段」，591 這格對完整名稱是 0 條", s.events.includes("street-search:臨港路四段"), true);
    eq("段：搜不到才改搜路名主體「臨港路」", s.events.includes("street-search:臨港路"), true);
    eq("段：最後選到的是完整的「臨港路四段」", s.addrSel[2], "臨港路四段");
    eq("段：面板有印出兩次搜尋結果的診斷訊息", s.log.some((l) => /搜尋「臨港路四段」後清單剩 0 條/.test(l)) && s.log.some((l) => /改搜路名主體「臨港路」後清單剩.*找到「臨港路四段」了/.test(l)), true);
    eq("段：沒有紅字錯誤", s.log.filter((l) => /出錯|程式出錯/.test(l)), []);
  }

  /**
   * ───────── 街道搜尋完全找不到（真實案例：沙鹿自強路），誠實告知交給本人手動選 ─────────
   * 2026-09-16～18 一整段追下來的結論：不要自動點「顯示所有街道」。連續 5 個版本、換過 4 種觸發/
   * 等待方式都是點擊前後零變化（選擇器每次都用 DevTools 核對過）；2026-09-18 再比對同業已驗證可用的
   * v1.5.3，他那支 `pickStreet` 也**根本沒有這段**，搜不到就交還給人選。所以這裡驗證的是「不再白等、
   * 直接誠實回報」，不是驗證翻頁（那條路沒有人做得到）。街道真的搜不到時該走的是「匯入地址」快速框。
   */
  {
    const p = payloadFor("catalog-sale-synthetic.txt");
    p.addr = { ...p.addr, road: "自強路", lane: "" };
    const { done, state: s } = await runOne(browser, "sale", p);
    eq("誠實回報：跑到「✅ 填完」", done, true);
    if (!done) console.log(s.log.join("\n"));
    eq("誠實回報：591 的搜尋對「自強路」是 0 條", s.events.includes("street-search:自強路"), true);
    eq("誠實回報：不會再嘗試點「顯示所有街道」（實測點不動，同業那支也沒點）", s.events.includes("show-all-streets"), false);
    eq("誠實回報：街道沒選到，維持原樣", s.addrSel[2], "");
    eq("誠實回報：面板直接告訴本人下一步怎麼做，不是丟一句失敗", s.log.some((l) => /按「顯示所有街道」翻頁選這條路/.test(l)), true);
    eq("誠實回報：沒有紅字錯誤", s.log.filter((l) => /出錯|程式出錯/.test(l)), []);
  }

  /**
   * ───────── 商辦出租（2026-09-11 真實案例重現）─────────
   * 這個版面沒有「填寫完整地址」快速框，街道是「要打字才有選項」的一般下拉（不是搜尋面板），
   * 而且「樓／樓之」跟「巷/號/之」不同一列（不同 .ant-form-item）。
   * 本人真的用這套外掛貼了一筆商辦型錄上 591，這兩點都踩到：街道沒選到、「樓」那格空著也沒被列為待補。
   */
  {
    const p = payloadFor("catalog-rent-office-synthetic.txt");
    const { done, state: s, fulfilled, aborted, mockUrl } = await runOne(browser, "office", p);
    eq("商辦：沒有連到真的 591", [fulfilled, aborted.filter((u) => /591\.com\.tw|houseol/.test(u))], [[mockUrl], []]);
    eq("商辦：跑到「✅ 填完」", done, true);
    if (!done) console.log(s.log.join("\n"));
    eq("商辦：沒有走匯入地址（這個版面沒有快速框）", s.events.some((e) => e.startsWith("import:")), false);
    eq("商辦：縣市／鄉鎮／街道都選到了（街道清單是等到才出現的，不是打字篩出來）", s.addrSel, ["台中市", "梧棲區", "測試中路"]);
    eq("商辦：街道下拉一開始是空的（清單要等，不是一開就有）、等到之後才 render 出選項", s.events.some((e) => /^render:road=0$/.test(e)) && s.events.some((e) => /^render:road=20$/.test(e)), true);
    eq("商辦：街道用選的、不是走搜尋面板（這版面沒有放大鏡面板）", s.events.includes("select:測試中路"), true);
    eq("商辦：號 331、巷弄之都空", [s.no, s.lane, s.alley, s.sub], ["331", "", "", ""]);
    eq("🔴 商辦：「樓」在下一列也抓到了＝13、樓之＝2（這是這次真的踩到的臭蟲，樓別/樓高欄跟地址中文數字都要抓對）", [s.floor, s.floorSub], ["13", "2"]);
    eq("商辦：門牌那排沒有「只找到 N 個框」的警告", s.log.some((l) => /只找到.*個框/.test(l)), false);
    eq("商辦：出租總樓層 14、電梯有", [s.v.totalFloor, s.checked("電梯")], ["14", ["有"]]);
    eq("商辦：社區名稱", s.v.community, "測試One Plus");
    eq("商辦：格局是空的（辦公室型錄本來就沒有房廳衛）", s.v.layout, ["", "", "", ""]);
    eq("商辦：可使用坪數 30.41、權狀坪數 58.99", [s.nums("可使用坪數"), s.v.reg], [["30.41"], ["58.99"]]);
    eq("商辦：車位有、型式平面式", [s.checked("車位"), s.sel("車位")], [["有"], "平面式"]);
    eq("商辦：完工成屋 114/5/28", [s.v.doneRadio, s.v.done], [["成屋"], ["114", "5", "28"]]);
    eq("商辦：朝向坐北朝南", s.v.facing, "坐北朝南");
    eq("商辦：租金 28000、押金 2個月", [s.txt("租金"), s.checked("押金")], ["28000", ["2個月"]]);
    eq("商辦：租金包含勾「無」（型錄沒寫含管）", s.checked("租金包含"), ["無"]);
    eq("商辦：管理費 4816", s.txt("管理費"), "4816");
    eq("商辦：生活機能 近學校、近公園綠地", s.v.life, ["近學校", "近公園綠地"]);
    eq("商辦：標題", s.title, "測試辦公商辦｜高樓視野大露台平面車位");
    eq("商辦：待補清單有列裝潢時間/程度/設備/家具", ["裝潢時間", "裝潢程度", "提供設備", "提供家具"].every((k) => s.missing.includes(k)), true);
    eq("商辦：沒有紅字錯誤", s.log.filter((l) => /出錯|程式出錯/.test(l)), []);
  }

  /**
   * ───────── 格局圖：591 出售要傳到專屬的「格局圖」那一格，不進一般照片區（2026-09-23）─────────
   * app.js 偵測到格局圖後會把它從 p.photos 抽出來、另外放 p.floorPlan（見 app.js 的 launch()）——
   * 這裡直接模擬 app.js 已經做完這件事的 payload，驗證 fill591.js 這端「傳到哪一格」的邏輯：
   * 格局圖傳去 mock 裡限 1 張的 #floorplan-photo，其餘照片照舊走 input[type=file][multiple]。
   */
  {
    const p = payloadFor("catalog-sale-synthetic.txt");
    const allUrls = ["https://hq.houseol.com.tw/images/pictures/AA0001.jpg", "https://hq.houseol.com.tw/images/pictures/AA0002.jpg", "https://hq.houseol.com.tw/images/pictures/AA0003.jpg"];
    p.floorPlan = allUrls[1];
    p.photos = allUrls.filter((u) => u !== p.floorPlan); // app.js launch() 會先把猜到的那張從 photos 抽掉
    const { done, state: s } = await runOne(browser, "sale", p);
    eq("格局圖：跑到「✅ 填完」", done, true);
    if (!done) console.log(s.log.join("\n"));
    eq("格局圖：傳進了限 1 張的「格局圖」那一格", s.floorPlanFile, "floorplan.png");
    eq("格局圖：一般照片區只有剩下的 2 張，沒有連格局圖那張也塞進去", s.files, 2);
    eq("格局圖：面板有印出「已傳到「格局圖」那一格」", s.log.some((l) => /格局圖已傳到「格局圖」那一格/.test(l)), true);
    eq("格局圖：沒有紅字錯誤", s.log.filter((l) => /出錯|程式出錯/.test(l)), []);
  }

  /**
   * ───────── 封面貼圖合成後的 data: URL 照片，上傳時不用跨網域抓、直接本機解碼（2026-09-24）─────────
   * app.js 的 launch() 合成完封面貼圖後，photos[0] 會被換成 data: URL（本機 canvas 合成結果，
   * 不是愛屋的遠端網址）——這裡驗證 fill591.js 的 fetchPhotoAsB64() 真的認得出 data: URL、
   * 直接解碼 base64 塞進上傳框，不會誤送一支 listing:fetch-image 去問 background（那支只認
   * houseol/cloudinary 網域，data: URL 沒有 hostname，硬送只會白白多一次訊息，也可能出錯）。
   */
  {
    const p = payloadFor("catalog-sale-synthetic.txt");
    const composited = `data:image/png;base64,${PNG}`;
    p.photos = [composited, "https://hq.houseol.com.tw/images/pictures/AA0002.jpg", "https://hq.houseol.com.tw/images/pictures/AA0003.jpg"];
    const { done, state: s } = await runOne(browser, "sale", p);
    eq("封面合成：跑到「✅ 填完」", done, true);
    if (!done) console.log(s.log.join("\n"));
    eq("封面合成：3 張都成功塞進上傳框（data: 那張也算進去）", s.files, 3);
    eq(
      "封面合成：只有 2 張遠端照片真的發訊息問 background，data: 那張沒發（本機直接解碼）",
      s.sent.filter((t) => t === "listing:fetch-image").length,
      2,
    );
    eq("封面合成：沒有紅字錯誤", s.log.filter((l) => /出錯|程式出錯/.test(l)), []);
  }

  /**
   * ───────── 固定尾段設了字級／顏色：descHtml 要套上格式 ─────────
   * 2026-09-15 本人第一次真的測（v0.3.0）：字級／粗體完全沒套上，貼進 591 變成純文字——當時走的是
   * 合成 paste 事件帶 text/html，猜是 ProseMirror 認得出這不是使用者真的按 Ctrl+V（isTrusted:false）
   * 選擇性不處理格式，改成先試 execCommand("insertHTML")（瀏覽器原生指令，走真正的 DOM 編輯管線）。
   * mock 的 ProseMirror 只是「長得像」，不是真的 591：這裡驗證的是「execCommand("insertHTML") 有沒有
   * 把完整的 descHtml 真的插進 DOM」，insertHTML 在任何 contenteditable 都是瀏覽器原生行為，
   * 不代表 591 真正的 ProseMirror 收到之後會不會又用它自己的 schema 把格式濾掉——那件事還沒驗證過，
   * 麻煩本人重新載入外掛再測一次（見 [[project_591上架外掛]]）。
   */
  {
    const styled = { ...SETTINGS, tailStyle: { size: "18px", bold: true, underline: false, lines: [{ color: "#c00000", bg: "" }] } };
    const p = payloadFor("catalog-rent-markdown.txt", styled);
    eq("樣式：payload 真的帶了 descHtml（前面步驟串起來有效）", typeof p.descHtml, "string");
    const { done, state: s } = await runOne(browser, "rent", p);
    eq("樣式：跑到「✅ 填完」", done, true);
    if (!done) console.log(s.log.join("\n"));
    eq("樣式：execCommand(insertHTML) 就成功了，不用退回發 paste 事件", s.events.includes("pm-paste:html"), false);
    eq("樣式：貼進去的 HTML 就是 descHtml 本人", s.descHtml, p.descHtml);
    eq("樣式：尾段套上了字級／粗體／顏色", s.descHtml.includes('<span style="font-size:18px"><span style="color:#c00000"><strong>'), true);
    /* 2026-09-24 本人截圖回報：貼進 591 後抬頭跟尾段是粗體大字，✨ 特色行卻是 591 預設小字沒粗體，
       要求「跟其他的都一樣」——規則改成尾段範圍以外的每一行都固定套粗體18px，✨ 特色行不再是例外 */
    eq("樣式：✨ 特色行也套固定粗體18px（不是尾段那組可自訂顏色，是跟抬頭一樣的固定樣式）", s.descHtml.includes('<p><span style="font-size:18px"><strong>✨租金含管理費，附機車位</strong></span></p>'), true);
    /* 2026-09-24：descHtml 現在不是只有固定尾段設了樣式才會有值（抬頭固定粗體18px），訊息改成籠統的「含格式」 */
    eq("樣式：面板訊息有標「含格式」", s.log.some((l) => /文案已貼入（含格式）/.test(l)), true);
    eq("樣式：沒有紅字錯誤", s.log.filter((l) => /出錯|程式出錯/.test(l)), []);
  }

  /* ───────── 沒有資料包：什麼都不做 ───────── */
  {
    const page = await browser.newPage();
    await page.route("**/*", (route) => (route.request().url().endsWith("/post/two/sale?x=1") ? route.fulfill({ status: 200, contentType: "text/html", body: buildMock("sale") }) : route.abort()));
    await page.addInitScript(`window.chrome = { runtime: { sendMessage(m, cb) { setTimeout(() => cb({ ok: true, payload: null }), 5); } } };`);
    await page.goto("https://user.591.com.tw/post/two/sale?x=1", { waitUntil: "load" });
    await page.addScriptTag({ path: path.join(root, "fill591.js") });
    await page.waitForTimeout(800);
    const untouched = await page.evaluate(() => !document.querySelector("#listing-panel") && [...document.querySelectorAll("input")].every((i) => !i.value));
    eq("沒有資料包：不長面板、不動任何一格", untouched, true);
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`\n填表端對端測試：${pass} 過、${fail} 錯`);
process.exit(fail ? 1 : 0);
