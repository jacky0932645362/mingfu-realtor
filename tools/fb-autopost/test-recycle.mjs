// 自動重新曝光（src/lib/fb-recycle.ts）的純函式測試：到期日、挑哪些社團、白天時間窗。不連網、不碰資料庫。
// 跑法：node test-recycle.mjs
import { registerAliasHooks } from "./_shared.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";

registerAliasHooks();
const ROOT = path.resolve(import.meta.dirname, "../..");
const R = await import(`${pathToFileURL(ROOT).href}/src/lib/fb-recycle.ts`);

let pass = 0;
let fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`❌ ${name}\n   得到 ${JSON.stringify(got)}\n   應該 ${JSON.stringify(want)}`);
  }
}

const DAY = 86_400_000;
const now = new Date("2026-10-05T04:00:00Z"); // 台灣 12:00
const g = (id, daysAgo, extra = {}) => ({
  id,
  name: id,
  url: `https://www.facebook.com/groups/${id}`,
  lastAt: new Date(+now - daysAgo * DAY),
  cooldownDays: 7,
  usable: true,
  ...extra,
});

// ── 到期日：最近一次發到社團＋7 天 ──
eq("沒有社團貼文＝沒有到期日", R.recycleDueAt([]), null);
eq("取最近一次", R.recycleDueAt([g("a", 10), g("b", 3)], 7)?.toISOString(), new Date(+now + 4 * DAY).toISOString());

// ── 挑社團 ──
eq("滿 7 天的才挑", R.pickRecycleGroups([g("a", 8), g("b", 6)], now, 7).map((x) => x.id), ["a"]);
eq("剛好 7 天也算到期", R.pickRecycleGroups([g("a", 7)], now, 7).map((x) => x.id), ["a"]);
eq("社團冷卻 14 天比 7 天長 → 這輪不碰", R.pickRecycleGroups([g("a", 10, { cooldownDays: 14 })], now, 7).length, 0);
eq("社團停用／封存 → 不碰", R.pickRecycleGroups([g("a", 30, { usable: false })], now, 7).length, 0);
eq("冷卻比 N 短時以 N 為準", R.pickRecycleGroups([g("a", 5, { cooldownDays: 3 })], now, 7).length, 0);

// ── 白天時間窗（台灣時間 9～21 點） ──
eq("台灣 12:00 可以", R.inRecycleWindow(new Date("2026-10-05T04:00:00Z")), true);
eq("台灣 09:00 可以", R.inRecycleWindow(new Date("2026-10-05T01:00:00Z")), true);
eq("台灣 08:59 不行", R.inRecycleWindow(new Date("2026-10-05T00:59:00Z")), false);
eq("台灣 21:00 不行", R.inRecycleWindow(new Date("2026-10-05T13:00:00Z")), false);
eq("台灣 03:00 不行", R.inRecycleWindow(new Date("2026-10-04T19:00:00Z")), false);

console.log(`\n${fail ? "❌" : "✅"} ${pass} 項通過、${fail} 項失敗`);
process.exit(fail ? 1 : 0);
