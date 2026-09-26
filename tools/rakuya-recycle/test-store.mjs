/**
 * 離線測試 store.mjs 的檔案讀寫。跑法：node test-store.mjs
 *
 * 會真的在 data/ 底下寫測試檔案，跑完（不管成功失敗）一律清乾淨，
 * 不留垃圾、也不影響之後真正累積的快照資料。
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./_shared.mjs";
import { newSnapshot } from "./snapshot.mjs";
import {
  loadSnapshots, saveSnapshots, appendHistory, loadHistory,
  findById, attachRakuyaUrl, markChecked, dueForRecycle, recordRecycled,
} from "./store.mjs";

const TEST_FILES = ["snapshots.json", "snapshots.json.bak", "history.jsonl"].map((f) => path.join(DATA_DIR, f));
function cleanup() {
  for (const f of TEST_FILES) { try { rmSync(f); } catch { /* 本來就不存在 */ } }
}

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log(`✓ ${name}`); }
  catch (e) { fail++; console.log(`✗ ${name}\n    ${e.message}`); }
}

cleanup();
try {
  t("loadSnapshots：檔案不存在時回傳空陣列，不報錯", () => {
    assert.deepEqual(loadSnapshots(), []);
  });

  const listing = { no: "AD5358836", catalogUrl: "https://example.com/cat", regPing: 21.41, floor: 12, total: 28, room: 3, hall: 2, bath: 2 };
  const s1 = newSnapshot({ listing });

  t("saveSnapshots → loadSnapshots：存進去讀出來要一樣", () => {
    saveSnapshots([s1]);
    const loaded = loadSnapshots();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, s1.id);
    assert.equal(loaded[0].no, "AD5358836");
  });

  t("saveSnapshots：第二次寫入前會把舊檔備份成 .bak", () => {
    saveSnapshots([s1, newSnapshot({ listing })]);
    assert.ok(existsSync(path.join(DATA_DIR, "snapshots.json.bak")));
    assert.equal(loadSnapshots().length, 2);
  });

  t("findById：找得到／找不到", () => {
    const list = loadSnapshots();
    assert.equal(findById(list, s1.id).id, s1.id);
    assert.equal(findById(list, "沒有這個id"), null);
  });

  t("attachRakuyaUrl：補上刊登網址，寫進 history", () => {
    const list = loadSnapshots();
    attachRakuyaUrl(list, s1.id, { rakuyaUrl: "https://community.rakuya.com.tw/60120/rent/abc", rakuyaId: "abc" });
    saveSnapshots(list);
    assert.equal(loadSnapshots().find((x) => x.id === s1.id).rakuyaUrl, "https://community.rakuya.com.tw/60120/rent/abc");
    const hist = loadHistory();
    assert.ok(hist.some((h) => h.kind === "rakuya_url_attached" && h.id === s1.id));
  });

  t("attachRakuyaUrl：id 找不到要丟錯，不能默默略過", () => {
    assert.throws(() => attachRakuyaUrl(loadSnapshots(), "不存在", { rakuyaUrl: "x", rakuyaId: "x" }));
  });

  t("markChecked：same → 保持 active，failStreak 歸零", () => {
    const list = loadSnapshots();
    markChecked(list, s1.id, { verdict: "same", comparedFields: ["regPing"], mismatchedFields: [] });
    saveSnapshots(list);
    const item = loadSnapshots().find((x) => x.id === s1.id);
    assert.equal(item.status, "active");
    assert.equal(item.lastCheckResult, "ok");
    assert.equal(item.failStreak, 0);
  });

  t("markChecked：different → 轉成 rented_out，不會再被排進重刊", () => {
    const list = loadSnapshots();
    markChecked(list, s1.id, { verdict: "different", comparedFields: ["floor"], mismatchedFields: ["floor"] });
    saveSnapshots(list);
    const item = loadSnapshots().find((x) => x.id === s1.id);
    assert.equal(item.status, "rented_out");
    assert.equal(item.lastCheckResult, "mismatch");
    const hist = loadHistory();
    assert.ok(hist.some((h) => h.kind === "rented_out" && h.id === s1.id));
  });

  t("markChecked：fetch_failed 累加 failStreak，不改變 active 狀態（不推假通知）", () => {
    const list = loadSnapshots();
    const other = list.find((x) => x.id !== s1.id);
    markChecked(list, other.id, { verdict: "fetch_failed" });
    markChecked(list, other.id, { verdict: "fetch_failed" });
    saveSnapshots(list);
    const item = loadSnapshots().find((x) => x.id === other.id);
    assert.equal(item.status, "active");
    assert.equal(item.failStreak, 2);
  });

  t("recordRecycled：原地更新同一筆快照，cycleCount 累加、排下一次時間", () => {
    const list = loadSnapshots();
    const other = list.find((x) => x.id !== s1.id && x.cycleCount === 0);
    const before = { ...other };
    recordRecycled(list, other.id, { rakuyaUrl: "https://community.rakuya.com.tw/60120/rent/new123", rakuyaId: "new123", cycleDays: 5 });
    saveSnapshots(list);
    const item = loadSnapshots().find((x) => x.id === other.id);
    assert.equal(item.rakuyaUrl, "https://community.rakuya.com.tw/60120/rent/new123");
    assert.equal(item.cycleCount, before.cycleCount + 1);
    assert.equal(item.status, "active");
    assert.ok(new Date(item.nextRecycleAt) > new Date(item.postedAt));
    const hist = loadHistory();
    assert.ok(hist.some((h) => h.kind === "recycled" && h.id === other.id));
  });

  t("dueForRecycle：只挑 active 且到期的，rented_out 不會被排進去", () => {
    const list = loadSnapshots();
    const past = newSnapshot({ listing, cycleDays: -1 }); // 已經過期
    const future = newSnapshot({ listing, cycleDays: 30 });
    saveSnapshots([...list, past, future]);
    const due = dueForRecycle(loadSnapshots());
    const dueIds = due.map((x) => x.id);
    assert.ok(dueIds.includes(past.id));
    assert.ok(!dueIds.includes(future.id));
    assert.ok(!dueIds.includes(s1.id)); // 剛被上一個測試改成 rented_out 了
  });
} finally {
  cleanup();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
