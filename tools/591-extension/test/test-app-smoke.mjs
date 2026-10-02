/**
 * 操作頁（app.html + app.js）的煙霧測試：用 Playwright 把外掛資料夾當成一個網站端出來（沒有 chrome.* → 預覽模式），
 * 貼型錄 → 解析 → 看畫面有沒有長出每一格、標題、描述、照片訊息；按上架應該說「只是預覽」。
 * 跑法：node test/test-app-smoke.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const require = createRequire(path.join(root, "..", "591-autofill", "package.json"));
const { chromium } = require("playwright");
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
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== "ext.test") return route.abort();
    const file = path.join(root, u.pathname.replace(/^\//, "") || "app.html");
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) });
  });
  await page.goto("https://ext.test/app.html", { waitUntil: "load" });
  await page.waitForTimeout(300);
  eq("載入沒有 JS 錯誤", errors, []);
  eq("第一次用：我的資料是打開的", await page.evaluate(() => !document.getElementById("settings").hidden), true);
  eq("解析鈕一開始是灰的", await page.evaluate(() => document.getElementById("parse").disabled), true);

  /* 填我的資料 */
  await page.fill("#s-name", "蕭茗馥");
  await page.fill("#s-phone", "0932-645-362");
  await page.fill("#s-tail", "歡迎來電 {{phone}}");
  eq("固定尾段只有一行 → 樣式那邊長出一行可以選顏色", await page.evaluate(() => document.querySelectorAll("#ts-lines .ts-line").length), 1);
  await page.check("#ts-bold");
  await page.click('#ts-lines .ts-swatch-row[data-role="color"] .ts-swatch:nth-child(3)'); // 1=文字標籤 2=✕不設定 3=色盤第一色(#000000)
  eq("點了色盤：設定面板的預覽跟著變粗體、有顏色", await page.evaluate(() => document.querySelector("#ts-preview div").getAttribute("style")), "font-weight:700;color:#000000");
  await page.click("#s-save");
  eq("儲存有回應", await page.textContent("#s-msg"), "已儲存 ✓");

  /* 貼型錄 → 解析 */
  await page.fill("#raw", fx("catalog-rent-markdown.txt"));
  eq("貼了字解析鈕就亮", await page.evaluate(() => document.getElementById("parse").disabled), false);
  await page.click("#parse");
  await page.waitForTimeout(300);
  eq("結果區長出來", await page.evaluate(() => !document.getElementById("result").hidden), true);
  eq("第①頁步驟", await page.evaluate(() => [...document.querySelectorAll("#steps .step")].map((e) => e.textContent)), ["出租", "整層住家", "電梯大樓"]);
  const rows = await page.evaluate(() => [...document.querySelectorAll("#rows .row")].map((r) => ({ label: r.querySelector(".lab").textContent.replace("*", ""), value: r.querySelector("input").value, need: r.classList.contains("need") })));
  eq("每一格：租金", rows.find((r) => r.label === "租金").value, "15000");
  eq("每一格：紅底四格", rows.filter((r) => r.need).map((r) => r.label), ["裝潢時間", "裝潢程度", "提供設備", "提供家具"]);
  eq("每一格：聯絡人帶入設定", rows.find((r) => r.label === "聯絡人").value, "蕭茗馥");
  eq("標題去掉租-", await page.inputValue("#title"), "好好窩大2房");
  eq("標題字數提示", await page.textContent("#title-msg"), "6 字，在 6～30 之間");
  eq("有建議標題", await page.evaluate(() => !document.getElementById("title-suggest").hidden), true);
  await page.click("#title-apply");
  eq("套用建議標題", await page.inputValue("#title"), "和築好好窩 2房2廳 含管理費 附機車位 3樓");
  const desc = await page.inputValue("#desc");
  eq("描述有尾段代換", /歡迎來電 0932-645-362$/.test(desc), true);
  eq(
    "上架時長這樣：尾段套上剛剛在「我的資料」選的樣式（粗體＋黑色）",
    await page.evaluate(() => {
      const divs = [...document.querySelectorAll("#desc-preview div")];
      const last = divs[divs.length - 1];
      return !!last && last.getAttribute("style") === "font-weight:700;color:#000000" && last.textContent === "歡迎來電 0932-645-362";
    }),
    true,
  );
  eq("描述沒有風險字提示", await page.evaluate(() => document.getElementById("risks").hidden), true);
  await page.fill("#desc", desc + "\n保證增值 **超值**");
  eq("加了風險字＋Markdown 會標", await page.evaluate(() => document.getElementById("risks").textContent.includes("保證") && document.getElementById("risks").textContent.includes("Markdown")), true);
  eq("照片訊息：4 張", await page.textContent("#photos-msg"), "型錄文字裡帶了 4 張「更多照片」的網址。");
  eq("照片連結格自動帶了型錄頁網址", /Ecatalog\.aspx/.test(await page.inputValue("#photo-link")), true);
  eq("照片連結訊息（預覽模式掃不了型錄頁，但會算更多照片那 4 張）", /上架時會傳 4 張/.test(await page.textContent("#photo-link-msg")), true);

  /* 改一格紅底 → 紅底數字要減 */
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("#rows .row")].find((r) => r.querySelector(".lab").textContent.includes("裝潢程度"));
    const input = row.querySelector("input");
    input.value = "簡易裝潢";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  eq("補了一格紅底剩 3", await page.textContent("#need-msg"), "還有 3 格紅底沒補（不補也能上架，外掛會把它們列在面板上要你自己填）");

  /* 上架（沒有 chrome.* → 只是預覽） */
  await page.click("#launch");
  await page.waitForTimeout(200);
  eq("預覽模式按上架會說明", await page.textContent("#launch-msg"), "這一頁要從 Chrome 外掛圖示打開才能上架（現在只是預覽）。");
  await page.click("#launch-rakuya");
  await page.waitForTimeout(150);
  eq("預覽模式按上架到樂屋也會說明（同一句，兩顆共用）", await page.textContent("#launch-msg"), "這一頁要從 Chrome 外掛圖示打開才能上架（現在只是預覽）。");
  await page.click("#launch-both");
  await page.waitForTimeout(150);
  eq("預覽模式按一起上架也是同一句", await page.textContent("#launch-msg"), "這一頁要從 Chrome 外掛圖示打開才能上架（現在只是預覽）。");
  eq("全程沒有 JS 錯誤", errors, []);

  /* 純文字型錄（沒連結）也能解析 */
  await page.click("#clear");
  await page.fill("#raw", fx("catalog-rent-plain.txt"));
  await page.click("#parse");
  await page.waitForTimeout(200);
  eq("純文字：照片訊息", await page.textContent("#photos-msg"), "型錄文字裡沒有照片網址。");
  eq("純文字：照片連結格空、提示去貼", /沒有照片/.test(await page.textContent("#photo-link-msg")), true);

  /* 物件名稱開頭（⚙ 我的資料，2026-10-02 本人要求）：設一次，每戶標題最前面自動加 */
  await page.click("#clear");
  await page.fill("#s-title-prefix", "【房仲蕭邦】");
  await page.click("#s-save");
  await page.fill("#raw", fx("catalog-rent-markdown.txt"));
  await page.click("#parse");
  await page.waitForTimeout(300);
  eq("開頭：解析後標題最前面自動加上", await page.inputValue("#title"), "【房仲蕭邦】好好窩大2房");
  eq("開頭：建議標題也帶開頭", await page.textContent("#title-suggest-text"), "【房仲蕭邦】和築好好窩 2房2廳 含管理費 附機車位 3樓");
  await page.click("#title-apply");
  eq("開頭：按「套用」建議標題後開頭還在、沒被蓋掉", await page.inputValue("#title"), "【房仲蕭邦】和築好好窩 2房2廳 含管理費 附機車位 3樓");
  eq(
    "開頭：標題 29 字，591 合格但樂屋上限 25 字會被截 → ④ 先提醒（只提醒、不擋）",
    await page.textContent("#title-msg"),
    "29 字，在 6～30 之間；⚠ 樂屋上限 25 字，上樂屋會被截掉最後 4 字",
  );
  await page.fill("#s-title-prefix", "｜蕭邦｜");
  await page.click("#s-save");
  eq("開頭：改設定按儲存，標題最前面的舊開頭換成新的、其他字不動", await page.inputValue("#title"), "｜蕭邦｜和築好好窩 2房2廳 含管理費 附機車位 3樓");
  await page.fill("#s-title-prefix", "");
  await page.click("#s-save");
  eq("開頭：清空設定按儲存，標題最前面的開頭拿掉", await page.inputValue("#title"), "和築好好窩 2房2廳 含管理費 附機車位 3樓");
  eq("開頭：標題 23 字沒超過樂屋上限就不提醒", /樂屋上限/.test(await page.textContent("#title-msg")), false);
  eq("開頭：這一段沒有 JS 錯誤", errors, []);
  await page.close();
} finally {
  await browser.close();
}
console.log(`\n操作頁煙霧測試：${pass} 過、${fail} 錯`);
process.exit(fail ? 1 : 0);
