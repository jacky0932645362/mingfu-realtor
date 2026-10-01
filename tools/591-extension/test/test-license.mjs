/**
 * license.js 的規則測試（2026-09-12）。license.js 寫成 deps 注入（storage／fetch／now／uuid）
 * 就是為了能在 node 裡測這些規則，不用真的開瀏覽器、不用真的打伺服器。
 *
 * license.js 本身用 `(function (root) {...})(typeof self !== "undefined" ? self : globalThis)` 包起來，
 * 直接 import 會把值掛在 globalThis.P591License，這裡用這招在 node 載入它。
 *
 * 跑法：node test/test-license.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "license.js"), "utf8");
// eslint-disable-next-line no-eval
(0, eval)(src);
const { create } = globalThis.P591License;

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

/** 假的 chrome.storage.local：純物件當後盾 */
function fakeStorage(initial = {}) {
  let data = { ...initial };
  return {
    data: () => data,
    get: async (k) => (Array.isArray(k) ? Object.fromEntries(k.map((x) => [x, data[x]])) : { [k]: data[k] }),
    set: async (o) => {
      data = { ...data, ...o };
    },
  };
}

/** 假的 fetch：behavior 是 (body) => response 或 拋錯 */
function fakeFetch(behavior) {
  const calls = [];
  return {
    calls,
    fn: async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push({ url, body });
      const r = behavior(body);
      if (r instanceof Error) throw r;
      if (typeof r === "number") return { status: r, json: async () => ({}) };
      return { status: 200, json: async () => r };
    },
  };
}

let clock = Date.parse("2026-09-12T00:00:00Z");
const now = () => clock;
const uuid = () => "install-abc-123";

/* ───────── 沒有授權碼 ───────── */
{
  const storage = fakeStorage();
  const fetch = fakeFetch(() => ({ ok: true, name: "test", expiresAt: "2026-12-31" }));
  const lic = create({ storage, fetch: fetch.fn, now, uuid, version: "0.2.0" });
  const r = await lic.check();
  eq("沒設過授權碼：no_key_set，不打伺服器", [r.ok, r.reason, fetch.calls.length], [false, "no_key_set", 0]);
  eq("安裝編號有產生", storage.data()["p591:installId"], "install-abc-123");
}

/* ───────── 正常驗證成功、之後用快取 ───────── */
{
  const storage = fakeStorage({ "p591:licenseKey": "MF-TEST" });
  const fetch = fakeFetch(() => ({ ok: true, name: "測試同事", expiresAt: "2026-12-31", expiresText: "2026-12-31" }));
  const lic = create({ storage, fetch: fetch.fn, now, uuid, version: "0.2.0" });
  const r1 = await lic.check();
  eq("第一次驗證：打了伺服器、成功", [r1.ok, r1.name, fetch.calls.length], [true, "測試同事", 1]);
  eq("送給伺服器的資料只有代碼/安裝編號/版本，沒有物件或個資欄位", Object.keys(fetch.calls[0].body).sort(), ["event", "installId", "key", "version"].sort());
  const r2 = await lic.check();
  eq("6 小時內第二次驗證：吃快取，不再打伺服器", [r2.ok, r2.cached, fetch.calls.length], [true, true, 1]);
  clock += 7 * 60 * 60 * 1000; // 過 7 小時，快取過期
  const r3 = await lic.check();
  eq("超過 6 小時快取：重新打伺服器", fetch.calls.length, 2);
}

/* ───────── event=launch：一定打伺服器，不管快不快取，順便記一次上架 ───────── */
{
  const storage = fakeStorage({ "p591:licenseKey": "MF-TEST" });
  const fetch = fakeFetch(() => ({ ok: true, name: "測試同事", expiresAt: "2026-12-31", expiresText: "2026-12-31" }));
  const lic = create({ storage, fetch: fetch.fn, now, uuid, version: "0.2.0" });
  await lic.check();
  await lic.check(); // 吃快取
  eq("兩次一般檢查只打一次伺服器", fetch.calls.length, 1);
  const r = await lic.check({ event: "launch" });
  eq("event=launch 一定重打，且帶上 event", [fetch.calls.length, fetch.calls[1].body.event, r.ok], [2, "launch", true]);
}

/* ───────── 伺服器說授權碼不對／已停用／已到期／額滿 ───────── */
{
  for (const reason of ["no_key", "revoked", "seat_limit"]) {
    const storage = fakeStorage({ "p591:licenseKey": "MF-BAD" });
    const fetch = fakeFetch(() => ({ ok: false, reason }));
    const lic = create({ storage, fetch: fetch.fn, now, uuid, version: "0.2.0" });
    const r = await lic.check();
    eq(`伺服器回 ${reason}：check() 忠實回傳、不快取成功`, [r.ok, r.reason], [false, reason]);
  }
}

/* ───────── 到期：本機記住上次的到期日，過了就算離線也擋 ───────── */
{
  const storage = fakeStorage({ "p591:licenseKey": "MF-EXP" });
  let serverUp = true;
  const fetch = fakeFetch(() => (serverUp ? { ok: true, name: "測試", expiresAt: "2026-09-12", expiresText: "2026-09-12" } : new Error("network down")));
  const lic = create({ storage, fetch: fetch.fn, now, uuid, version: "0.2.0" });
  const r1 = await lic.check({ force: true });
  eq("先驗到有效、到期日是今天", r1.ok, true);
  clock += 2 * 24 * 60 * 60 * 1000; // 過兩天，超過到期日
  serverUp = false; // 這時剛好連不上伺服器
  const r2 = await lic.check({ force: true });
  eq("到期日已過＋連不上伺服器：擋（不是「離線先放行」）", [r2.ok, r2.reason], [false, "expired"]);
}

/* ───────── 離線但還沒到期：3 天內給通融 ───────── */
{
  const storage = fakeStorage({ "p591:licenseKey": "MF-OK" });
  let serverUp = true;
  const fetch = fakeFetch(() => (serverUp ? { ok: true, name: "測試", expiresAt: "2027-01-01", expiresText: "2027-01-01" } : new Error("network down")));
  const lic = create({ storage, fetch: fetch.fn, now, uuid, version: "0.2.0" });
  await lic.check({ force: true });
  serverUp = false;
  clock += 2 * 24 * 60 * 60 * 1000; // 離線兩天，還在 3 天通融內、也還沒到期
  const r = await lic.check({ event: "launch" }); // event 一定會嘗試打伺服器，打不到才走離線通融
  eq("離線 2 天內、還沒到期：先放行（標記 offline）", [r.ok, r.offline], [true, true]);
  clock += 2 * 24 * 60 * 60 * 1000; // 再過 2 天，離線超過 3 天通融
  const r2 = await lic.check({ event: "launch" });
  eq("離線超過 3 天：擋", [r2.ok, r2.reason], [false, "offline"]);
}

/* ───────── setKey：清快取、立刻重驗 ───────── */
{
  const storage = fakeStorage();
  let key = "";
  const fetch = fakeFetch((body) => {
    key = body.key;
    return { ok: true, name: "新代碼", expiresAt: "2026-12-31", expiresText: "2026-12-31" };
  });
  const lic = create({ storage, fetch: fetch.fn, now, uuid, version: "0.2.0" });
  const r = await lic.setKey(" mf-newkey ");
  eq("setKey 會 trim、立刻驗一次", [r.ok, key, fetch.calls.length], [true, "mf-newkey", 1]);
  eq("授權碼原樣存起來（不強制轉大寫，伺服器那邊處理）", storage.data()["p591:licenseKey"], "mf-newkey");
}

/* ───────── message()：把結果變成看得懂的一句話 ───────── */
{
  const { message } = globalThis.P591License;
  eq("ok 時沒有訊息", message({ ok: true }), "");
  eq("no_key_set 有明確指引", /授權碼/.test(message({ ok: false, reason: "no_key_set" })), true);
  eq("expired 附上日期", message({ ok: false, reason: "expired", expiresText: "2026-01-01" }), "授權已於 2026-01-01 到期，請找提供授權碼的人延長。");
  eq("未知原因也有話講、不是空字串", message({ ok: false, reason: "something_weird" }).length > 0, true);
}

console.log(`\nlicense.js 規則測試：${pass} 過、${fail} 錯`);
process.exit(fail ? 1 : 0);
