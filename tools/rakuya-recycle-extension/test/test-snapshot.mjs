/**
 * 離線測試 lib/snapshot.js（純函式）。跑法：node test/test-snapshot.mjs
 * 跟 tools/rakuya-recycle/test-snapshot.mjs 是同一套邏輯的外掛版，測試內容照抄。
 */
import assert from "node:assert/strict";
import { newSnapshot, compareListing, COMPARE_FIELDS } from "../lib/snapshot.js";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log(`✓ ${name}`); }
  catch (e) { fail++; console.log(`✗ ${name}\n    ${e.message}`); }
}

const REAL_LISTING = {
  no: "AD5358836",
  catalogUrl: "https://www.pacific.com.tw/some/Ecatalog.aspx?No=AD5358836",
  regPing: 21.41, floor: 12, total: 28, room: 3, hall: 2, bath: 2,
  community: "遠雄幸福成/遠雄之星9",
};

t("newSnapshot：帶出 no／catalogUrl／listing，狀態預設 active", () => {
  const s = newSnapshot({ listing: REAL_LISTING });
  assert.equal(s.no, "AD5358836");
  assert.equal(s.status, "active");
  assert.equal(s.rakuyaUrl, null);
  assert.equal(s.cycleCount, 0);
});

t("newSnapshot：nextRecycleAt 預設是 5 天後、cycleDays 可自訂", () => {
  const s = newSnapshot({ listing: REAL_LISTING, cycleDays: 3 });
  const days = (new Date(s.nextRecycleAt) - new Date(s.postedAt)) / 86400000;
  assert.equal(Math.round(days), 3);
});

t("newSnapshot：id 是隨機 8 碼", () => {
  const a = newSnapshot({ listing: REAL_LISTING });
  const b = newSnapshot({ listing: REAL_LISTING });
  assert.notEqual(a.id, b.id);
  assert.equal(a.id.length, 8);
});

t("compareListing：完全一樣 → same", () => {
  const r = compareListing(REAL_LISTING, { ...REAL_LISTING });
  assert.equal(r.verdict, "same");
  assert.equal(r.comparedFields.length, COMPARE_FIELDS.length);
});

t("compareListing：坪數差 0.3（誤差內）→ 還算 same", () => {
  assert.equal(compareListing(REAL_LISTING, { ...REAL_LISTING, regPing: 21.11 }).verdict, "same");
});

t("compareListing：坪數差很多（換成別戶）→ different", () => {
  const r = compareListing(REAL_LISTING, { ...REAL_LISTING, regPing: 35.6 });
  assert.equal(r.verdict, "different");
  assert.deepEqual(r.mismatchedFields, ["regPing"]);
});

t("compareListing：只要一個關鍵欄位不符就算 different，不用湊多個", () => {
  assert.equal(compareListing(REAL_LISTING, { ...REAL_LISTING, room: 2 }).verdict, "different");
});

t("compareListing：兩邊都缺資料 → inconclusive，不誤判已出租", () => {
  const r = compareListing({}, {});
  assert.equal(r.verdict, "inconclusive");
  assert.deepEqual(r.comparedFields, []);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
