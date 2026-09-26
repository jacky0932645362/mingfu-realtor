/**
 * 離線測試 recycleOne() 的分支邏輯（存在檢查結果 →該做什麼），不開真的瀏覽器
 * ——用假的 actions.closeListing/createListing 跟假的 context/page 物件。
 * 真的會點畫面的 rakuya-actions.mjs 沒有自動測試（不能真的對本人帳號跑），
 * 所以這裡把「決策邏輯」跟「真的點擊」分開測，至少決策邏輯有把關。
 *
 * 跑法：node test-recycle-runner.mjs
 */
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./_shared.mjs";
import { newSnapshot } from "./snapshot.mjs";
import { saveSnapshots, loadSnapshots } from "./store.mjs";
import { recycleOne } from "./recycle-runner.mjs";

function cleanup() {
  for (const f of ["snapshots.json", "snapshots.json.bak", "history.jsonl"]) {
    try { rmSync(path.join(DATA_DIR, f)); } catch { /* 本來就不存在 */ }
  }
}

function mockFetchOnce(impl) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = orig; };
}

/** 最小可用的假 page／context——只提供 recycleOne 真的會呼叫到的那幾個方法 */
function fakePage(finalUrl) {
  return {
    goto: async () => {},
    waitForURL: async () => {},
    url: () => finalUrl,
    close: async () => {},
  };
}
function fakeContext(page) {
  return { newPage: async () => page };
}

const listing = { no: "AD9999999", catalogUrl: "https://example.com/cat", regPing: 20, floor: 5, total: 12, room: 2, hall: 1, bath: 1 };

/** 造一份 catalogTextFromHtml() 認得的最小型錄頁 HTML（t-th/t-td 那套版面），不是真的貼上文字 */
function fakeCatalogHtml({ regPing, floor, total, room, hall, bath }) {
  const field = (label, value) => `<div class="t-th">${label}</div><div class="t-td"><div class="title"></div><p>${value}</p></div>`;
  return `<html><body>${
    field("登記坪數", `${regPing} 坪`) +
    field("樓別/樓高", `${floor} /${total}`) +
    field("房/廳/衛", `${room}/ ${hall}/ ${bath}`)
  }</body></html>`;
}

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log(`✓ ${name}`); }
  catch (e) { fail++; console.log(`✗ ${name}\n    ${e.message}`); }
}

cleanup();
try {
  await t("fetch_failed：不關閉不建立，只累加失敗次數", async () => {
    const restore = mockFetchOnce(async () => { throw new Error("timeout"); });
    try {
      const snap = newSnapshot({ listing });
      saveSnapshots([snap]);
      const list = loadSnapshots();
      let closeCalled = false, createCalled = false;
      const r = await recycleOne(fakeContext(fakePage("x")), list, snap, {
        manageUrl: "m", postUrl: "p",
        actions: { closeListing: async () => { closeCalled = true; }, createListing: async () => { createCalled = true; } },
      });
      assert.equal(r.outcome, "fetch_failed");
      assert.equal(closeCalled, false);
      assert.equal(createCalled, false);
    } finally { restore(); }
  });

  await t("different（已出租）：不關閉不建立，狀態轉 rented_out", async () => {
    const restore = mockFetchOnce(async () => ({
      ok: true, status: 200,
      text: async () => fakeCatalogHtml({ regPing: 99.9, floor: 1, total: 1, room: 1, hall: 1, bath: 1 }),
    }));
    try {
      const snap = newSnapshot({ listing });
      saveSnapshots([snap]);
      const list = loadSnapshots();
      let closeCalled = false;
      const r = await recycleOne(fakeContext(fakePage("x")), list, snap, {
        manageUrl: "m", postUrl: "p",
        actions: { closeListing: async () => { closeCalled = true; }, createListing: async () => {} },
      });
      assert.equal(r.outcome, "rented_out");
      assert.equal(closeCalled, false);
      assert.equal(list.find((x) => x.id === snap.id).status, "rented_out");
    } finally { restore(); }
  });

  await t("same（還在租）：關閉+建立都呼叫到，成功後 recordRecycled", async () => {
    const restore = mockFetchOnce(async () => ({
      ok: true, status: 200,
      text: async () => fakeCatalogHtml(listing),
    }));
    try {
      const snap = newSnapshot({ listing, cycleDays: -1 });
      saveSnapshots([snap]);
      const list = loadSnapshots();
      const calls = [];
      const r = await recycleOne(fakeContext(fakePage("https://community.rakuya.com.tw/60120/rent/abc123")), list, snap, {
        manageUrl: "m", postUrl: "p",
        actions: {
          closeListing: async () => calls.push("close"),
          createListing: async () => calls.push("create"),
        },
      });
      assert.equal(r.outcome, "recycled");
      assert.deepEqual(calls, ["close", "create"]);
      const item = list.find((x) => x.id === snap.id);
      assert.equal(item.rakuyaUrl, "https://community.rakuya.com.tw/60120/rent/abc123");
      assert.equal(item.rakuyaId, "abc123");
      assert.equal(item.cycleCount, 1);
    } finally { restore(); }
  });

  await t("關閉成功但建立失敗：最壞情況，status 轉 error 且回報 closedButNotRecreated", async () => {
    const restore = mockFetchOnce(async () => ({
      ok: true, status: 200,
      text: async () => fakeCatalogHtml(listing),
    }));
    try {
      const snap = newSnapshot({ listing, cycleDays: -1 });
      saveSnapshots([snap]);
      const list = loadSnapshots();
      const r = await recycleOne(fakeContext(fakePage("x")), list, snap, {
        manageUrl: "m", postUrl: "p",
        actions: {
          closeListing: async () => {},
          createListing: async () => { throw new Error("找不到上架按鈕（版面改了？）"); },
        },
      });
      assert.equal(r.outcome, "error");
      assert.equal(r.closedButNotRecreated, true);
      assert.equal(list.find((x) => x.id === snap.id).status, "error");
    } finally { restore(); }
  });

  await t("關閉本身就失敗：closedButNotRecreated 是 false（舊的還在，沒有曝光空窗）", async () => {
    const restore = mockFetchOnce(async () => ({
      ok: true, status: 200,
      text: async () => fakeCatalogHtml(listing),
    }));
    try {
      const snap = newSnapshot({ listing, cycleDays: -1 });
      saveSnapshots([snap]);
      const list = loadSnapshots();
      const r = await recycleOne(fakeContext(fakePage("x")), list, snap, {
        manageUrl: "m", postUrl: "p",
        actions: {
          closeListing: async () => { throw new Error("找不到成交/關閉按鈕"); },
          createListing: async () => {},
        },
      });
      assert.equal(r.outcome, "error");
      assert.equal(r.closedButNotRecreated, false);
    } finally { restore(); }
  });
} finally {
  cleanup();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
