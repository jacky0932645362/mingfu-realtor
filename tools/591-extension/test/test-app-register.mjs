/**
 * 2026-09-19 新功能：按「上架」成功開好分頁後，順手登記一筆到官網的追蹤清單（listing:register）。
 * 沒有型錄來源網址（純文字貼的，不是貼型錄頁網址／型錄文字帶連結）就不登記；
 * 上架本身失敗（授權碼問題等）也不登記。跑法：node test/test-app-register.mjs
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

/**
 * launchOk=false 用來模擬「解析當下授權還有效（快取），但按上架那一刻背景程式重打伺服器發現不行了」
 * ——這是唯一「解析成功、能按到上架鈕，但上架本身失敗」的真實路徑（requireLicense() 兩邊用同一份
 * 快取的 license 變數，解析／上架都會擋；只有背景程式在 launch 時的伺服器重驗證會晚一步才發現）。
 */
function shim(launchOk) {
  return `
    window.__sent = [];
    window.chrome = { runtime: { lastError: undefined, getManifest: () => ({ version: "0.0.0-test" }), sendMessage(msg, cb) {
      window.__sent.push(msg);
      const reply = (r) => setTimeout(() => cb && cb(r), 5);
      if (msg.type === "listing:license-check" || msg.type === "listing:license-set") return reply({ ok: true, license: { ok: true, name: "測試", expiresText: "2099-12-31" }, message: "" });
      if (msg.type === "listing:launch") return reply(${launchOk} ? { ok: true, tabId: 1, url: "https://user.591.com.tw/post/first" } : { ok: false, error: "授權碼失效", license: { ok: false } });
      if (msg.type === "listing:register") return reply({ ok: true });
      reply({ ok: false, error: "unknown " + msg.type });
    } } };`;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  /* ① 貼型錄頁網址帶連結的文字 → 有 catalogUrl → 上架成功應該登記追蹤 */
  {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname !== "ext.test") return route.abort();
      const file = path.join(root, u.pathname.replace(/^\//, "") || "app.html");
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) });
    });
    await page.addInitScript(shim(true));
    await page.goto("https://ext.test/app.html", { waitUntil: "load" });
    await page.fill("#s-name", "蕭茗馥");
    await page.fill("#s-phone", "0932-645-362");
    await page.click("#s-save");
    await page.fill("#raw", fx("catalog-rent-markdown.txt"));
    await page.click("#parse");
    await page.waitForTimeout(300);
    await page.click("#launch");
    await page.waitForTimeout(200);

    const sent = await page.evaluate(() => window.__sent);
    const reg = sent.find((m) => m.type === "listing:register");
    eq("上架成功且有型錄來源 → 有送 listing:register", !!reg, true);
    eq("登記帶了來源網址（型錄頁）", /Ecatalog\.aspx/.test(reg?.sourceUrl || ""), true);
    eq("登記帶了標題", (reg?.title || "").length > 0, true);
    eq("登記帶了地址", (reg?.address || "").length > 0, true);
    eq("登記標明平台 591", reg?.platform, "591");
    eq("全程沒有 JS 錯誤", errors, []);
    await page.close();
  }

  /* ② 一起上架（both）：平台要標 "both" */
  {
    const page = await browser.newPage();
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname !== "ext.test") return route.abort();
      const file = path.join(root, u.pathname.replace(/^\//, "") || "app.html");
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) });
    });
    await page.addInitScript(shim(true));
    await page.goto("https://ext.test/app.html", { waitUntil: "load" });
    await page.fill("#s-name", "蕭茗馥");
    await page.fill("#s-phone", "0932-645-362");
    await page.click("#s-save");
    await page.fill("#raw", fx("catalog-rent-markdown.txt"));
    await page.click("#parse");
    await page.waitForTimeout(300);
    await page.click("#launch-both");
    await page.waitForTimeout(200);
    const reg = (await page.evaluate(() => window.__sent)).find((m) => m.type === "listing:register");
    eq("一起上架：登記標明平台 both", reg?.platform, "both");
    await page.close();
  }

  /* ③ 純文字貼上（沒有型錄來源網址）→ 不應該登記追蹤 */
  {
    const page = await browser.newPage();
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname !== "ext.test") return route.abort();
      const file = path.join(root, u.pathname.replace(/^\//, "") || "app.html");
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) });
    });
    await page.addInitScript(shim(true));
    await page.goto("https://ext.test/app.html", { waitUntil: "load" });
    await page.fill("#s-name", "蕭茗馥");
    await page.fill("#s-phone", "0932-645-362");
    await page.click("#s-save");
    await page.fill("#raw", fx("catalog-rent-plain.txt"));
    await page.click("#parse");
    await page.waitForTimeout(300);
    await page.click("#launch");
    await page.waitForTimeout(200);
    const sent = await page.evaluate(() => window.__sent);
    eq("純文字貼上（沒有型錄網址）→ 上架成功但沒有 listing:register", sent.some((m) => m.type === "listing:register"), false);
    eq("但確實有正常送出 listing:launch（上架本身不受影響）", sent.some((m) => m.type === "listing:launch"), true);
    await page.close();
  }

  /* ④ 上架本身失敗（授權碼問題）→ 不應該登記追蹤 */
  {
    const page = await browser.newPage();
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname !== "ext.test") return route.abort();
      const file = path.join(root, u.pathname.replace(/^\//, "") || "app.html");
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) });
    });
    await page.addInitScript(shim(false));
    await page.goto("https://ext.test/app.html", { waitUntil: "load" });
    await page.fill("#s-name", "蕭茗馥");
    await page.fill("#s-phone", "0932-645-362");
    await page.click("#s-save");
    await page.fill("#raw", fx("catalog-rent-markdown.txt"));
    await page.click("#parse");
    await page.waitForTimeout(300);
    await page.click("#launch");
    await page.waitForTimeout(200);
    const sent = await page.evaluate(() => window.__sent);
    eq("上架被授權擋下來 → 沒有 listing:register", sent.some((m) => m.type === "listing:register"), false);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`\n追蹤清單登記測試：${pass} 過、${fail} 錯`);
process.exit(fail ? 1 : 0);
