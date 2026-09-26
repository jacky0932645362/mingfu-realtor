/**
 * 離線測試 lib/catalog-check.js。跑法：node test/test-catalog-check.mjs
 * 用真實型錄頁 fixture（跟 591-extension 共用同一份，不是編的資料），把 global fetch
 * 換成假的，不連真的網路。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fetchCatalogListing, checkExistence } from "../lib/catalog-check.js";
import { newSnapshot } from "../lib/snapshot.js";

const REAL_HTML = readFileSync(
  path.resolve(import.meta.dirname, "../../591-extension/test/fixtures/catalog-real-page.html"),
  "utf8",
);

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

await t("fetchCatalogListing：真實型錄頁 HTML → 解析出坪數/樓層", async () => {
  const restore = mockFetchOnce(async () => ({ ok: true, status: 200, text: async () => REAL_HTML }));
  try {
    const r = await fetchCatalogListing("https://example.com/Ecatalog.aspx?No=TEST");
    assert.equal(r.ok, true);
    assert.ok(r.listing.regPing > 0);
    assert.ok(r.listing.floor > 0);
  } finally { restore(); }
});

await t("fetchCatalogListing：HTTP 非 200 → ok:false", async () => {
  const restore = mockFetchOnce(async () => ({ ok: false, status: 404 }));
  try {
    const r = await fetchCatalogListing("https://example.com/gone");
    assert.equal(r.ok, false);
  } finally { restore(); }
});

await t("checkExistence：抓失敗 → verdict fetch_failed", async () => {
  const restore = mockFetchOnce(async () => { throw new Error("timeout"); });
  try {
    const snap = newSnapshot({ listing: { regPing: 20, floor: 5 } });
    const r = await checkExistence(snap);
    assert.equal(r.verdict, "fetch_failed");
  } finally { restore(); }
});

await t("checkExistence：同一戶 → same；欄位對不起來 → different", async () => {
  const restore = mockFetchOnce(async () => ({ ok: true, status: 200, text: async () => REAL_HTML }));
  try {
    const first = await fetchCatalogListing("https://example.com/Ecatalog.aspx?No=TEST");
    const okSnap = newSnapshot({ listing: first.listing, catalogUrl: "https://example.com/Ecatalog.aspx?No=TEST" });
    assert.equal((await checkExistence(okSnap)).verdict, "same");

    const badListing = { ...first.listing, regPing: (first.listing.regPing || 0) + 50, floor: 99 };
    const badSnap = newSnapshot({ listing: badListing, catalogUrl: "https://example.com/Ecatalog.aspx?No=TEST" });
    assert.equal((await checkExistence(badSnap)).verdict, "different");
  } finally { restore(); }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
