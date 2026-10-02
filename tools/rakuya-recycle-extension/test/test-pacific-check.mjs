/**
 * 離線測試 lib/pacific-check.js。跑法：node test/test-pacific-check.mjs
 * fixtures 是 2026-10-02 對太平洋官網正式站真的抓下來的：還在的出租物件頁 vs 不存在的 saleID 頁。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractPacificUrl, parsePacificPage, judgePacific, checkPacific } from "../lib/pacific-check.js";

const fx = (n) => readFileSync(path.resolve(import.meta.dirname, "fixtures", n), "utf8");
const LIVE = fx("pacific-rent-live.html");
const MISSING = fx("pacific-rent-missing.html");

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log(`✓ ${name}`); }
  catch (e) { fail++; console.log(`✗ ${name}\n    ${e.message}`); }
}
const noSleep = () => Promise.resolve();
function withFetch(impl, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => { globalThis.fetch = orig; });
}
const html = (h) => async () => ({ ok: true, status: 200, text: async () => h });

await t("extractPacificUrl：取描述最後一個官網連結", () => {
  const txt = "物件編號:AD5401497\nhttps://www.houseol.com.tw/Ecatalog.aspx?No=AD5401497\nhttps://www.pacific.com.tw/Object/ObjectRentDetail/?saleID=R3487344";
  assert.equal(extractPacificUrl(txt), "https://www.pacific.com.tw/Object/ObjectRentDetail/?saleID=R3487344");
  assert.equal(extractPacificUrl("沒有連結", ""), "");
  assert.equal(extractPacificUrl("", '<a href="https://www.pacific.com.tw/Object/ObjectRentDetail/?saleID=R1&amp;x=2">a</a>'), "https://www.pacific.com.tw/Object/ObjectRentDetail/?saleID=R1&x=2");
});

await t("parsePacificPage：真實在架頁 → exists＋租金＋坪數", () => {
  const p = parsePacificPage(LIVE);
  assert.equal(p.exists, true);
  assert.equal(p.rent, 23000);
  assert.equal(p.ping, 53.19);
  assert.match(p.title, /長虹天擎/);
});

await t("parsePacificPage：真實不存在頁 → exists:false", () => {
  assert.equal(parsePacificPage(MISSING).exists, false);
});

await t("judgePacific：租金變只提醒、坪數差太多才算 changed", () => {
  const base = { rent: 23000, ping: 53.19 };
  assert.equal(judgePacific(base, { exists: true, rent: 25000, ping: 53.19 }).verdict, "same");
  assert.equal(judgePacific(base, { exists: true, rent: 25000, ping: 53.19 }).notes.length, 1);
  assert.equal(judgePacific(base, { exists: true, rent: 23000, ping: 20 }).verdict, "changed");
  assert.equal(judgePacific(base, { exists: false }).verdict, "gone");
});

const snap = (extra = {}) => ({ capturedDescText: "x\nhttps://www.pacific.com.tw/Object/ObjectRentDetail/?saleID=R3487344", ...extra });

await t("checkPacific：沒連結 → no_link", async () => {
  assert.equal((await checkPacific({ capturedDescText: "沒有" }, { sleep: noSleep })).verdict, "no_link");
});

await t("checkPacific：第一次抓到 → same 並回傳基準", async () => {
  await withFetch(html(LIVE), async () => {
    const r = await checkPacific(snap(), { sleep: noSleep });
    assert.equal(r.verdict, "same");
    assert.equal(r.baseline.ping, 53.19);
  });
});

await t("checkPacific：從沒成功看過（無基準）且頁面空 → never_seen，不下架", async () => {
  await withFetch(html(MISSING), async () => {
    assert.equal((await checkPacific(snap(), { sleep: noSleep })).verdict, "never_seen");
  });
});

await t("checkPacific：已有基準、頁面空了、兩次都空 → delist", async () => {
  await withFetch(html(MISSING), async () => {
    const r = await checkPacific(snap({ pacificBaseline: { rent: 23000, ping: 53.19 } }), { sleep: noSleep });
    assert.equal(r.verdict, "delist");
  });
});

await t("checkPacific：第一次空、第二次恢復 → same（偶發）", async () => {
  let n = 0;
  await withFetch(async () => ({ ok: true, status: 200, text: async () => (n++ === 0 ? MISSING : LIVE) }), async () => {
    const r = await checkPacific(snap({ pacificBaseline: { rent: 23000, ping: 53.19 } }), { sleep: noSleep });
    assert.equal(r.verdict, "same");
  });
});

await t("checkPacific：HTTP 500／斷線 → fetch_failed，絕不判下架", async () => {
  await withFetch(async () => ({ ok: false, status: 500 }), async () => {
    assert.equal((await checkPacific(snap({ pacificBaseline: { ping: 1 } }), { sleep: noSleep })).verdict, "fetch_failed");
  });
  await withFetch(async () => { throw new Error("net"); }, async () => {
    assert.equal((await checkPacific(snap(), { sleep: noSleep })).verdict, "fetch_failed");
  });
});

await t("checkPacific：第一次空、第二次網路掛掉 → fetch_failed 不是 delist", async () => {
  let n = 0;
  await withFetch(async () => (n++ === 0 ? { ok: true, status: 200, text: async () => MISSING } : { ok: false, status: 503 }), async () => {
    const r = await checkPacific(snap({ pacificBaseline: { ping: 53.19 } }), { sleep: noSleep });
    assert.equal(r.verdict, "fetch_failed");
  });
});

console.log(`\n${pass} 通過，${fail} 失敗`);
process.exit(fail ? 1 : 0);
