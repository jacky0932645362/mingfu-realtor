/**
 * 離線測試 lib/price-watch.js（價格變動通知），用 mock-chrome.mjs 頂住 chrome.storage.local。
 * 跑法：node test/test-price-watch.mjs
 */
import assert from "node:assert/strict";
import { installMockChrome } from "./mock-chrome.mjs";

const mock = installMockChrome();
const { newSnapshot } = await import("../lib/snapshot.js");
const { noteRentSeen, upsertPriceChange, trimPriceChanges, markPriceChangeDone, rakuyaEditUrl, priceLinks, recordRentObservation } = await import("../lib/price-watch.js");
const { loadPriceChanges, savePriceChanges } = await import("../lib/store.js");

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log(`✓ ${name}`); }
  catch (e) { fail++; console.log(`✗ ${name}\n    ${e.message}`); }
}

const mkSnap = (extra = {}) =>
  newSnapshot({ listing: { no: "AD1", rent: 23000, regPing: 20 }, catalogUrl: "https://es.houseol.com.tw/Ecatalog.aspx?No=AD1", rakuyaId: "ehid-old", ...extra });

await t("rakuyaEditUrl：用 ehid 組樂屋編輯頁網址；沒有 ehid 就是空字串", () => {
  assert.equal(rakuyaEditUrl("abc123"), "https://member.rakuya.com.tw/rent/post/edit?ehid=abc123");
  assert.equal(rakuyaEditUrl(null), "");
});

await t("noteRentSeen：第一次看到而且沒有基準 → 只記下來，不算變動", () => {
  const s = mkSnap();
  assert.equal(noteRentSeen(s, "pacific", 23000), null);
  assert.equal(s.rentSeen.pacific, 23000);
});

await t("noteRentSeen：第一次看到但有基準、而且跟基準不同 → 算變動", () => {
  const s = mkSnap();
  assert.deepEqual(noteRentSeen(s, "catalog", 22000, 23000), { oldRent: 23000, newRent: 22000 });
  assert.equal(s.rentSeen.catalog, 22000);
});

await t("noteRentSeen：沒變不通知；變過之後同一個價再看到也不再通知", () => {
  const s = mkSnap();
  assert.equal(noteRentSeen(s, "catalog", 23000, 23000), null);
  assert.ok(noteRentSeen(s, "catalog", 22000, 23000));
  assert.equal(noteRentSeen(s, "catalog", 22000, 23000), null);
});

await t("noteRentSeen：租金讀不到（null／0／NaN）不能蓋掉舊基準、也不算變動", () => {
  const s = mkSnap();
  noteRentSeen(s, "pacific", 23000);
  for (const bad of [null, undefined, 0, NaN, -5]) assert.equal(noteRentSeen(s, "pacific", bad, 23000), null);
  assert.equal(s.rentSeen.pacific, 23000);
});

await t("noteRentSeen：兩個來源各比各的，一邊變價不影響另一邊的基準", () => {
  const s = mkSnap();
  noteRentSeen(s, "catalog", 23000);
  noteRentSeen(s, "pacific", 23500); // 兩邊本來就差一點
  assert.equal(noteRentSeen(s, "catalog", 23000), null);
  assert.equal(noteRentSeen(s, "pacific", 23500), null);
  assert.ok(noteRentSeen(s, "catalog", 22000));
  assert.equal(noteRentSeen(s, "pacific", 23500), null);
});

await t("upsertPriceChange：沒有待處理的 → 新增一列，連結用快照現在的值", () => {
  const s = mkSnap({ capturedDescText: "" });
  const r = upsertPriceChange([], { snap: s, title: "漂亮店面", source: "catalog", oldRent: 23000, newRent: 22000 });
  assert.equal(r.status, "added");
  assert.equal(r.list.length, 1);
  assert.equal(r.entry.snapId, s.id);
  assert.deepEqual(r.entry.sources, ["愛屋型錄"]);
  assert.equal(r.entry.links.rakuyaEdit, "https://member.rakuya.com.tw/rent/post/edit?ehid=ehid-old");
  assert.equal(r.entry.done, false);
});

await t("upsertPriceChange：另一個來源看到同樣的新價 → 只補來源，不重複新增", () => {
  const s = mkSnap();
  const a = upsertPriceChange([], { snap: s, source: "catalog", oldRent: 23000, newRent: 22000 });
  const b = upsertPriceChange(a.list, { snap: s, source: "pacific", oldRent: 23000, newRent: 22000 });
  assert.equal(b.status, "merged");
  assert.equal(b.list.length, 1);
  assert.deepEqual(b.entry.sources, ["愛屋型錄", "太平洋官網"]);
});

await t("upsertPriceChange：又變成別的價 → 保留最早的舊價、更新新價", () => {
  const s = mkSnap();
  const a = upsertPriceChange([], { snap: s, source: "catalog", oldRent: 23000, newRent: 22000 });
  const b = upsertPriceChange(a.list, { snap: s, source: "catalog", oldRent: 22000, newRent: 21000 });
  assert.equal(b.status, "updated");
  assert.equal(b.list.length, 1);
  assert.equal(b.entry.oldRent, 23000);
  assert.equal(b.entry.newRent, 21000);
});

await t("upsertPriceChange：價格改回原本的舊價 → 這列自動消掉", () => {
  const s = mkSnap();
  const a = upsertPriceChange([], { snap: s, source: "catalog", oldRent: 23000, newRent: 22000 });
  const b = upsertPriceChange(a.list, { snap: s, source: "catalog", oldRent: 22000, newRent: 23000 });
  assert.equal(b.status, "resolved");
  assert.equal(b.list.length, 0);
});

await t("upsertPriceChange：不同物件各自一列；已處理過的不擋住之後的新變動", () => {
  const s1 = mkSnap();
  const s2 = mkSnap();
  let list = upsertPriceChange([], { snap: s1, source: "catalog", oldRent: 23000, newRent: 22000 }).list;
  list = upsertPriceChange(list, { snap: s2, source: "catalog", oldRent: 18000, newRent: 17000 }).list;
  assert.equal(list.length, 2);
  list = markPriceChangeDone(list, list[0].id);
  const again = upsertPriceChange(list, { snap: s1, source: "catalog", oldRent: 22000, newRent: 21000 });
  assert.equal(again.status, "added");
  assert.equal(again.list.length, 3);
});

await t("markPriceChangeDone：id 找不到要丟錯", () => {
  assert.throws(() => markPriceChangeDone([], "沒有這個id"));
});

await t("trimPriceChanges：太長時擠掉最舊的已處理，待處理的一筆都不能丟", () => {
  const mk = (i, done) => ({ id: `e${i}`, snapId: `s${i}`, done, doneAt: done ? `2026-10-${String(i % 28 + 1).padStart(2, "0")}` : null });
  const list = [mk(1, true), mk(2, false), mk(3, true), mk(4, false), mk(5, true)];
  const out = trimPriceChanges(list, 3);
  assert.equal(out.length, 3);
  assert.deepEqual(out.filter((e) => !e.done).map((e) => e.id), ["e2", "e4"]);
});

await t("priceLinks：樂屋重刊換了 rakuyaId 之後，連結跟著新的走", () => {
  const s = mkSnap({ rakuyaId: "ehid-old" });
  s.rakuyaId = "ehid-new";
  s.pacificUrl = "https://www.pacific.com.tw/detail/R123";
  const l = priceLinks(s);
  assert.equal(l.rakuyaEdit, "https://member.rakuya.com.tw/rent/post/edit?ehid=ehid-new");
  assert.equal(l.pacific, "https://www.pacific.com.tw/detail/R123");
  assert.equal(l.catalog, "https://es.houseol.com.tw/Ecatalog.aspx?No=AD1");
});

await t("recordRentObservation：愛屋先看到降價 → 新增一列；官網看到同樣的新價 → 合併，儲存裡只有一列", async () => {
  mock.reset();
  const s = mkSnap();
  const first = await recordRentObservation(s, { source: "catalog", nowRent: 22000, baselineRent: s.listing.rent, title: "漂亮店面" });
  assert.equal(first.status, "added");
  const second = await recordRentObservation(s, { source: "pacific", nowRent: 22000, baselineRent: 23000, title: "漂亮店面" });
  assert.equal(second.status, "merged");
  const saved = await loadPriceChanges();
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].sources, ["愛屋型錄", "太平洋官網"]);
  assert.equal(saved[0].oldRent, 23000);
  assert.equal(saved[0].newRent, 22000);
});

await t("recordRentObservation：租金沒變 → 'none'，不寫任何東西", async () => {
  mock.reset();
  const s = mkSnap();
  const r = await recordRentObservation(s, { source: "catalog", nowRent: 23000, baselineRent: 23000 });
  assert.equal(r.status, "none");
  assert.deepEqual(await loadPriceChanges(), []);
});

await t("recordRentObservation：同一個價格檢查第二次 → 'none'，不會重複通知", async () => {
  mock.reset();
  const s = mkSnap();
  assert.equal((await recordRentObservation(s, { source: "catalog", nowRent: 22000, baselineRent: 23000 })).status, "added");
  assert.equal((await recordRentObservation(s, { source: "catalog", nowRent: 22000, baselineRent: 23000 })).status, "none");
  assert.equal((await loadPriceChanges()).length, 1);
});

await t("store：loadPriceChanges 一開始是空陣列；save → load 一致", async () => {
  mock.reset();
  assert.deepEqual(await loadPriceChanges(), []);
  await savePriceChanges([{ id: "x" }]);
  assert.deepEqual(await loadPriceChanges(), [{ id: "x" }]);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
