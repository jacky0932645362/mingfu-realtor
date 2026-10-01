/**
 * 「①貼上資料」直接貼型錄頁網址、自動抓回來解析的操作頁端對端測試。
 * 假造 chrome.runtime.sendMessage 的 listing:fetch-page 回應成真的抓回來的型錄頁 HTML
 * （test/fixtures/catalog-real-page.html，2026-09-15 對本人真實一戶型錄頁 fetch 存下來的）。
 * 跑法：node test/test-app-catalog-url.mjs
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
const CATALOG_URL = "https://es.houseol.com.tw/Ecatalog.aspx?UID=SP254&UAID=H229&No=AD5360000&AID=H229";

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
  const catalogHtml = fx("catalog-real-page.html");
  const shim = `
    window.__sent = [];
    window.chrome = { runtime: { lastError: undefined, getManifest: () => ({ version: "0.0.0-test" }), sendMessage(msg, cb) {
      window.__sent.push({ type: msg.type, url: msg.url });
      const reply = (r) => setTimeout(() => cb && cb(r), 5);
      if (msg.type === "listing:fetch-page") {
        // 實抓的網址要帶 showaddr=1（本人 2026-09-16 實測沒帶這個參數門牌完全空白，見 app.js 的 withShowAddr）
        const okUrl = msg.url.startsWith(${JSON.stringify(CATALOG_URL)}) && /[?&]showaddr=1(&|$)/.test(msg.url);
        return reply(okUrl ? { ok: true, html: ${JSON.stringify(catalogHtml)} } : { ok: false, error: "unexpected url: " + msg.url });
      }
      if (msg.type === "listing:license-check") return reply({ ok: true, license: { ok: true, name: "測試", expiresText: "2099-12-31" }, message: "" });
      reply({ ok: false, error: "unknown " + msg.type });
    } } };`;
  await page.addInitScript(shim);
  await page.goto("https://ext.test/app.html", { waitUntil: "load" });
  await page.waitForTimeout(300);
  eq("載入沒有 JS 錯誤", errors, []);

  await page.fill("#raw", `  ${CATALOG_URL}  \n`); // 前後帶空白/換行，模擬使用者貼上時手滑
  eq("貼了型錄頁網址，解析鈕會亮", await page.evaluate(() => !document.getElementById("parse").disabled), true);
  await page.click("#parse");
  await page.waitForFunction(() => !document.getElementById("result").hidden, null, { timeout: 10000 }).catch(() => {});
  const state = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#rows .row")].map((r) => ({ label: r.querySelector(".lab").textContent.replace("*", ""), value: r.querySelector("input").value }));
    const rowOf = (label) => (rows.find((r) => r.label === label) || {}).value ?? "";
    return {
      resultHidden: document.getElementById("result").hidden,
      title: document.getElementById("title").value,
      desc: document.getElementById("desc").value,
      warns: document.getElementById("warns").textContent,
      photosMsg: document.getElementById("photos-msg").textContent,
      photoLink: document.getElementById("photo-link").value,
      community: rowOf("社區名稱"),
      totalFloor: rowOf("出租總樓層"),
      rent: rowOf("租金"),
    };
  });
  eq(
    "有跟背景程式要型錄頁，網址前後空白已經 trim、而且自動補上 showaddr=1（不補的話門牌會是空的）",
    (await page.evaluate(() => window.__sent)).some((m) => m.type === "listing:fetch-page" && m.url.startsWith(CATALOG_URL) && /[?&]showaddr=1(&|$)/.test(m.url)),
    true,
  );
  eq("結果區長出來了（真的解析成功，不是卡在載入中）", state.resultHidden, false);
  eq("標題正確帶出（來自型錄頁 <title>）", state.title, "兩房兩衛拎包入住 1.8萬");
  eq("社區正確帶出", state.community, "佳美城肯");
  eq("出租總樓層 6", state.totalFloor, "6");
  eq("租金 18000", state.rent, "18000");
  eq("描述有帶進特色行", /①?家具家電全數到位|✨家具家電全數到位/.test(state.desc) || /家具家電全數到位/.test(state.desc), true);
  eq("這筆型錄本身沒有門牌號，警告有誠實列出來（不是本工具的錯）", state.warns.includes("沒抓到地址"), true);
  eq("parse-msg 也誠實講門牌沒帶到，不是默默沒反應", /門牌沒帶到/.test(await page.textContent("#parse-msg")), true);
  eq(
    "門牌沒帶到時，訊息裡附了 caption 完整內容的除錯字串，不用開 DevTools 就能回報實際結構",
    /除錯：HTML長度\d+／caption內容＝/.test(await page.textContent("#parse-msg")),
    true,
  );
  eq("照片訊息抓到 5 張（更多照片的 picstr）", /5 張/.test(state.photosMsg), true);
  eq("照片連結格自動帶入這條型錄頁網址（讓既有的嵌入照片掃描機制也能用）", state.photoLink.includes(CATALOG_URL), true);
  eq("全程沒有 JS 錯誤", errors, []);

  /* 網址抓失敗（背景程式回錯誤）：要看得到明確訊息，不能整頁卡住或看起來像沒反應 */
  await page.click("#clear");
  await page.fill("#raw", "https://es.houseol.com.tw/Ecatalog.aspx?No=NOT-THIS-ONE");
  await page.click("#parse");
  await page.waitForTimeout(400);
  const failMsg = await page.textContent("#parse-msg");
  eq("網址不對／抓不到時，parse-msg 有清楚說明、不是空白卡住", /抓不到|Ctrl\+A/.test(failMsg), true);
  eq("抓失敗時解析鈕會恢復可以按（不會卡在灰掉）", await page.evaluate(() => document.getElementById("parse").disabled), false);

  await page.close();
} finally {
  await browser.close();
}
console.log(`\n貼網址自動解析測試：${pass} 過、${fail} 錯`);
process.exit(fail ? 1 : 0);
