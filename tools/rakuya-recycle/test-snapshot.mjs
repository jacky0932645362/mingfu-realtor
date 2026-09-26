/**
 * 離線測試 snapshot.mjs（純函式，不碰檔案不碰瀏覽器）。跑法：node test-snapshot.mjs
 *
 * compareListing() 的測試資料取自本人真實提供的樂屋連結
 * （https://community.rakuya.com.tw/60120/rent/0b6e2934847693b，
 * 遠雄幸福成/遠雄之星9，21.41坪／12樓／28層／3房2廳2衛），不是編的數字。
 */
import assert from "node:assert/strict";
import { newSnapshot, compareListing, COMPARE_FIELDS } from "./snapshot.mjs";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log(`✓ ${name}`); }
  catch (e) { fail++; console.log(`✗ ${name}\n    ${e.message}`); }
}

const REAL_LISTING = {
  no: "AD5358836",
  catalogUrl: "https://www.pacific.com.tw/some/Ecatalog.aspx?No=AD5358836",
  regPing: 21.41,
  floor: 12,
  total: 28,
  room: 3,
  hall: 2,
  bath: 2,
  community: "遠雄幸福成/遠雄之星9",
  photos: ["https://hq.houseol.com.tw/images/pictures/AD5358836_1.jpg"],
};

// ── newSnapshot()：形狀與時間欄位 ───────────
t("newSnapshot：帶出 no／catalogUrl／listing，狀態預設 active", () => {
  const s = newSnapshot({ listing: REAL_LISTING });
  assert.equal(s.no, "AD5358836");
  assert.equal(s.catalogUrl, REAL_LISTING.catalogUrl);
  assert.equal(s.status, "active");
  assert.deepEqual(s.listing, REAL_LISTING);
  assert.equal(s.rakuyaUrl, null);
  assert.equal(s.cycleCount, 0);
});

t("newSnapshot：no／catalogUrl 沒明講就從 listing 帶出來", () => {
  const s = newSnapshot({ listing: REAL_LISTING });
  assert.equal(s.no, REAL_LISTING.no);
});

t("newSnapshot：nextRecycleAt 預設是 5 天後", () => {
  const s = newSnapshot({ listing: REAL_LISTING });
  const days = (new Date(s.nextRecycleAt) - new Date(s.postedAt)) / 86400000;
  assert.equal(Math.round(days), 5);
});

t("newSnapshot：cycleDays 可以自訂", () => {
  const s = newSnapshot({ listing: REAL_LISTING, cycleDays: 3 });
  const days = (new Date(s.nextRecycleAt) - new Date(s.postedAt)) / 86400000;
  assert.equal(Math.round(days), 3);
});

t("newSnapshot：給一個假的 id 也應該是隨機的 8 碼", () => {
  const a = newSnapshot({ listing: REAL_LISTING });
  const b = newSnapshot({ listing: REAL_LISTING });
  assert.notEqual(a.id, b.id);
  assert.equal(a.id.length, 8);
});

// ── compareListing()：本人原話「只要圖文不符，就必須要下架」───────────
t("compareListing：完全一樣 → same", () => {
  const r = compareListing(REAL_LISTING, { ...REAL_LISTING });
  assert.equal(r.verdict, "same");
  assert.deepEqual(r.mismatchedFields, []);
  assert.equal(r.comparedFields.length, COMPARE_FIELDS.length);
});

t("compareListing：坪數差 0.3（四捨五入誤差內）→ 還算 same", () => {
  const r = compareListing(REAL_LISTING, { ...REAL_LISTING, regPing: 21.11 });
  assert.equal(r.verdict, "same");
});

t("compareListing：坪數差很多（換成別戶）→ different", () => {
  const r = compareListing(REAL_LISTING, { ...REAL_LISTING, regPing: 35.6 });
  assert.equal(r.verdict, "different");
  assert.deepEqual(r.mismatchedFields, ["regPing"]);
});

t("compareListing：樓層對不起來（本人舉的例子）→ different", () => {
  const r = compareListing(REAL_LISTING, { ...REAL_LISTING, floor: 5, total: 15 });
  assert.equal(r.verdict, "different");
  assert.deepEqual(r.mismatchedFields, ["floor", "total"]);
});

t("compareListing：只要有一個關鍵欄位不符就算 different，不用湊多個", () => {
  const r = compareListing(REAL_LISTING, { ...REAL_LISTING, room: 2 });
  assert.equal(r.verdict, "different");
});

t("compareListing：兩邊都缺資料（一個能比對的欄位都沒有）→ inconclusive，不誤判已出租", () => {
  const r = compareListing({}, {});
  assert.equal(r.verdict, "inconclusive");
  assert.deepEqual(r.comparedFields, []);
});

t("compareListing：新抓到的頁面某欄位是 null（可能沒解析到）→ 那個欄位不算數，其餘照比對", () => {
  const r = compareListing(REAL_LISTING, { ...REAL_LISTING, community: null, floor: null });
  assert.equal(r.verdict, "same");
  assert.ok(!r.comparedFields.includes("floor"));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
