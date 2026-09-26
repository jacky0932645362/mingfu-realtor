/**
 * 離線測試 catalog-check.mjs。跑法：node test-catalog-check.mjs
 *
 * 不連真的網路——把 global fetch 換成假的，回傳 591-extension 那邊已經驗證過的
 * 真實型錄頁 fixture（test/fixtures/catalog-real-page.html），確認「fetch → 用
 * parser.js 解析 → 跟快照比對」這條線真的接得起來（parser.js 本身的解析正確性
 * 已經有 591-extension/test/test-parser.mjs 在把關，這裡不重測）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fetchCatalogListing, checkExistence } from "./catalog-check.mjs";
import { newSnapshot } from "./snapshot.mjs";

const FIXTURE_591EXT = path.resolve(import.meta.dirname, "../591-extension/test/fixtures/catalog-real-page.html");
const REAL_HTML = readFileSync(FIXTURE_591EXT, "utf8");

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log(`✓ ${name}`); }
  catch (e) { fail++; console.log(`✗ ${name}\n    ${e.message}`); }
}

function mockFetchOnce(impl) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = orig; };
}

await t("fetchCatalogListing：真實型錄頁 HTML → 解析出坪數/樓層等欄位", async () => {
  const restore = mockFetchOnce(async () => ({ ok: true, status: 200, text: async () => REAL_HTML }));
  try {
    const r = await fetchCatalogListing("https://example.com/Ecatalog.aspx?No=TEST");
    assert.equal(r.ok, true);
    assert.ok(r.listing.regPing > 0, "應該解析出坪數");
    assert.ok(r.listing.floor > 0, "應該解析出樓層");
    // 這份 fixture 的門牌本來就是隱藏的（parser.js 自己的 warnings 會講），
    // 不能拿 addr 當存在檢查的判斷依據——這也是為什麼 COMPARE_FIELDS 只挑
    // 坪數/樓層/格局這種數字欄位，不挑地址文字。
    assert.ok(r.listing.warnings.some((w) => w.includes("地址")));
  } finally { restore(); }
});

await t("fetchCatalogListing：HTTP 非 200 → ok:false，不丟例外", async () => {
  const restore = mockFetchOnce(async () => ({ ok: false, status: 404, text: async () => "" }));
  try {
    const r = await fetchCatalogListing("https://example.com/gone");
    assert.equal(r.ok, false);
    assert.match(r.error, /404/);
  } finally { restore(); }
});

await t("fetchCatalogListing：網路直接炸掉 → ok:false，不丟例外", async () => {
  const restore = mockFetchOnce(async () => { throw new Error("ECONNRESET"); });
  try {
    const r = await fetchCatalogListing("https://example.com/x");
    assert.equal(r.ok, false);
    assert.match(r.error, /ECONNRESET/);
  } finally { restore(); }
});

await t("fetchCatalogListing：抓到 200 但內容完全不是型錄頁 → ok:false（不是假裝解析成功）", async () => {
  const restore = mockFetchOnce(async () => ({ ok: true, status: 200, text: async () => "<html><body>不是型錄頁</body></html>" }));
  try {
    const r = await fetchCatalogListing("https://example.com/notacatalog");
    assert.equal(r.ok, false);
  } finally { restore(); }
});

await t("fetchCatalogListing：沒給 catalogUrl → 直接回 ok:false，不會真的發request", async () => {
  const r = await fetchCatalogListing("");
  assert.equal(r.ok, false);
});

await t("checkExistence：抓失敗時回傳 verdict fetch_failed，可以直接餵給 store.markChecked()", async () => {
  const restore = mockFetchOnce(async () => { throw new Error("timeout"); });
  try {
    const snap = newSnapshot({ listing: { regPing: 20, floor: 5 } });
    const r = await checkExistence(snap);
    assert.equal(r.verdict, "fetch_failed");
  } finally { restore(); }
});

await t("checkExistence：抓到同一戶（欄位吻合）→ verdict same", async () => {
  const restore = mockFetchOnce(async () => ({ ok: true, status: 200, text: async () => REAL_HTML }));
  try {
    const first = await fetchCatalogListing("https://example.com/Ecatalog.aspx?No=TEST");
    const snap = newSnapshot({ listing: first.listing, catalogUrl: "https://example.com/Ecatalog.aspx?No=TEST" });
    const r = await checkExistence(snap);
    assert.equal(r.verdict, "same");
  } finally { restore(); }
});

await t("checkExistence：抓到的坪數／樓層都對不起來 → verdict different", async () => {
  const restore = mockFetchOnce(async () => ({ ok: true, status: 200, text: async () => REAL_HTML }));
  try {
    const first = await fetchCatalogListing("https://example.com/Ecatalog.aspx?No=TEST");
    const fakeOldListing = { ...first.listing, regPing: (first.listing.regPing || 0) + 50, floor: 99 };
    const snap = newSnapshot({ listing: fakeOldListing, catalogUrl: "https://example.com/Ecatalog.aspx?No=TEST" });
    const r = await checkExistence(snap);
    assert.equal(r.verdict, "different");
  } finally { restore(); }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
