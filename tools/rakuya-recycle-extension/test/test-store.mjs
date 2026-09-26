/**
 * 離線測試 lib/store.js，用 mock-chrome.mjs 頂住 chrome.storage.local（沒有真的瀏覽器）。
 * 跑法：node test/test-store.mjs
 */
import assert from "node:assert/strict";
import { installMockChrome } from "./mock-chrome.mjs";

const mock = installMockChrome();
const { newSnapshot } = await import("../lib/snapshot.js");
const {
  loadSnapshots, saveSnapshots, loadHistory, findById,
  attachRakuyaUrl, markChecked, recordRecycled, dueForRecycle,
  loadSettings, saveSettings,
} = await import("../lib/store.js");

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log(`✓ ${name}`); }
  catch (e) { fail++; console.log(`✗ ${name}\n    ${e.message}`); }
}

const listing = { no: "AD9999999", catalogUrl: "https://example.com/cat", regPing: 20, floor: 5, total: 12, room: 2, hall: 1, bath: 1 };

await t("loadSnapshots：一開始是空陣列", async () => {
  assert.deepEqual(await loadSnapshots(), []);
});

const s1 = newSnapshot({ listing });
await t("saveSnapshots → loadSnapshots：存進去讀出來要一樣", async () => {
  await saveSnapshots([s1]);
  const loaded = await loadSnapshots();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, s1.id);
});

await t("attachRakuyaUrl：補上刊登網址並寫進 history", async () => {
  const list = await loadSnapshots();
  await attachRakuyaUrl(list, s1.id, { rakuyaUrl: "https://community.rakuya.com.tw/60120/rent/abc", rakuyaId: "abc" });
  await saveSnapshots(list);
  assert.equal((await loadSnapshots()).find((x) => x.id === s1.id).rakuyaUrl, "https://community.rakuya.com.tw/60120/rent/abc");
  assert.ok((await loadHistory()).some((h) => h.kind === "rakuya_url_attached"));
});

await t("attachRakuyaUrl：id 找不到要丟錯", async () => {
  await assert.rejects(() => attachRakuyaUrl([], "沒有這個id", { rakuyaUrl: "x", rakuyaId: "x" }));
});

await t("markChecked：same → 保持 active、failStreak 歸零", async () => {
  const list = await loadSnapshots();
  await markChecked(list, s1.id, { verdict: "same", comparedFields: ["regPing"], mismatchedFields: [] });
  await saveSnapshots(list);
  const item = (await loadSnapshots()).find((x) => x.id === s1.id);
  assert.equal(item.status, "active");
  assert.equal(item.lastCheckResult, "ok");
});

await t("markChecked：different → 轉成 rented_out", async () => {
  const list = await loadSnapshots();
  await markChecked(list, s1.id, { verdict: "different", mismatchedFields: ["floor"] });
  await saveSnapshots(list);
  assert.equal((await loadSnapshots()).find((x) => x.id === s1.id).status, "rented_out");
});

await t("markChecked：fetch_failed 累加 failStreak，不改變狀態", async () => {
  const s2 = newSnapshot({ listing });
  const list = [...(await loadSnapshots()), s2];
  await markChecked(list, s2.id, { verdict: "fetch_failed" });
  await markChecked(list, s2.id, { verdict: "fetch_failed" });
  await saveSnapshots(list);
  const item = (await loadSnapshots()).find((x) => x.id === s2.id);
  assert.equal(item.status, "active");
  assert.equal(item.failStreak, 2);
});

await t("recordRecycled：原地更新，cycleCount 累加、排下一次時間", async () => {
  const list = await loadSnapshots();
  const target = list.find((x) => x.cycleCount === 0);
  await recordRecycled(list, target.id, { rakuyaUrl: "https://community.rakuya.com.tw/60120/rent/new1", rakuyaId: "new1", cycleDays: 5 });
  await saveSnapshots(list);
  const item = (await loadSnapshots()).find((x) => x.id === target.id);
  assert.equal(item.cycleCount, 1);
  assert.equal(item.status, "active");
  assert.ok(new Date(item.nextRecycleAt) > new Date(item.postedAt));
});

await t("dueForRecycle：只挑 active 且到期的", async () => {
  const list = await loadSnapshots();
  const past = newSnapshot({ listing, cycleDays: -1 });
  const future = newSnapshot({ listing, cycleDays: 30 });
  await saveSnapshots([...list, past, future]);
  const due = (dueForRecycle(await loadSnapshots())).map((x) => x.id);
  assert.ok(due.includes(past.id));
  assert.ok(!due.includes(future.id));
});

await t("loadSettings：沒存過時給預設值", async () => {
  mock.reset();
  const s = await loadSettings();
  assert.equal(s.manageUrl, "");
  assert.equal(s.cycleDays, 5);
});

await t("saveSettings → loadSettings：存讀一致", async () => {
  await saveSettings({ manageUrl: "https://member.rakuya.com.tw/x", postUrl: "https://member.rakuya.com.tw/rent/post/add", cycleDays: 7 });
  const s = await loadSettings();
  assert.equal(s.manageUrl, "https://member.rakuya.com.tw/x");
  assert.equal(s.cycleDays, 7);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
