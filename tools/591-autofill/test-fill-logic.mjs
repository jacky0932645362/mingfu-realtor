/**
 * 【測試用】591 自動填表的取值邏輯。
 * 跑法：node test-fill-logic.mjs
 *
 * 真正會出事的不是「按鈕點不點得到」，是「填錯值」——
 * 591 的格局跟樓層是下拉選單，猜一個數字選下去就是上架錯資料，
 * 而且填完會停在草稿讓人以為只要看一眼就好。所以這裡把取值邏輯全部釘死：
 *   ① 拆不出來的一律回空字串（要跳過，不准猜）
 *   ② 數字欄位不能帶單位
 *   ③ 出廠骨架（selector 全空）必須報錯，不能安靜地一路跳過
 */
import { resolveValue, applyTransform, loadSelectors, SELECTORS_FILE } from "./_shared.mjs";

let pass = 0;
let fail = 0;

function eq(actual, expected, label) {
  if (actual === expected) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}\n      期待：${JSON.stringify(expected)}\n      實得：${JSON.stringify(actual)}`);
  }
}

function ok(cond, label) {
  eq(Boolean(cond), true, label);
}

/** 一包典型的 591 上架包（欄位標籤跟 src/lib/export-591.ts 產生的一致） */
const pkg = {
  title: "698萬買得到高樓海景？",
  titleFull: "698萬買得到高樓海景？",
  description: "總價 698 萬｜含車位｜2房2廳1衛\n\n【這間的重點】\n・高樓層無遮蔽",
  fields: [
    { label: "售價（萬元）", value: "698" },
    { label: "物件類型", value: "電梯大樓" },
    { label: "縣市", value: "台中市" },
    { label: "行政區", value: "梧棲區" },
    { label: "地址", value: "台中市梧棲區文化路二段123號12樓" },
    { label: "社區名稱", value: "海悅觀邸" },
    { label: "格局", value: "2 房 2 廳 1 衛" },
    { label: "建物坪數", value: "32.55 坪" },
    { label: "主建物坪數", value: "22.1 坪" },
    { label: "土地坪數", value: "5.2 坪" },
    { label: "樓層", value: "12" },
    { label: "總樓層", value: "15" },
    { label: "屋齡", value: "8 年" },
    { label: "朝向", value: "座北朝南" },
    { label: "車位", value: "平面式車位" },
    { label: "建設公司", value: "海悅建設" },
  ],
};

console.log("\n[特殊來源 @]");
eq(resolveValue("@title", pkg), "698萬買得到高樓海景？", "@title");
eq(resolveValue("@titleShort", pkg), "698萬買得到高樓海景？", "@titleShort");
ok(resolveValue("@description", pkg).startsWith("總價 698 萬"), "@description");

console.log("\n[格局拆成三個下拉]");
eq(resolveValue("@layout.rooms", pkg), "2", "房");
eq(resolveValue("@layout.halls", pkg), "2", "廳");
eq(resolveValue("@layout.baths", pkg), "1", "衛");

console.log("\n[樓層拆成兩格]");
eq(resolveValue("@floor.floor", pkg), "12", "第幾樓");
eq(resolveValue("@floor.total", pkg), "15", "共幾樓");

console.log("\n[照標籤取值]");
eq(resolveValue("售價（萬元）", pkg), "698", "售價");
eq(resolveValue("物件類型", pkg), "電梯大樓", "物件類型");
eq(resolveValue("地址", pkg), "台中市梧棲區文化路二段123號12樓", "地址（591 必填的完整門牌）");
eq(resolveValue("車位", pkg), "平面式車位", "車位");

console.log("\n[🚫 拆不出來一律回空字串，不准猜]");
const weird = { ...pkg, fields: pkg.fields.map((f) => (f.label === "格局" ? { ...f, value: "開放式套房" } : f)) };
eq(resolveValue("@layout.rooms", weird), "", "格局是「開放式套房」→ 房數回空，不要猜 1");
eq(resolveValue("@layout.halls", weird), "", "廳數回空");
eq(resolveValue("@layout.baths", weird), "", "衛數回空");

const cn = { ...pkg, fields: pkg.fields.map((f) => (f.label === "格局" ? { ...f, value: "兩房一廳" } : f)) };
eq(resolveValue("@layout.rooms", cn), "", "中文數字「兩房一廳」→ 回空，不要猜 2");

const noFloor = { ...pkg, fields: pkg.fields.map((f) => (f.label === "樓層" ? { ...f, value: "" } : f)) };
eq(resolveValue("@floor.floor", noFloor), "", "樓層空 → 回空");

eq(resolveValue("這個標籤不存在", pkg), "", "找不到的標籤回空字串");
eq(resolveValue("@根本沒這個", pkg), "", "不認識的 @ 來源回空字串");
eq(resolveValue("", pkg), "", "from 是空的回空字串");
eq(resolveValue(undefined, pkg), "", "from 是 undefined 不要爆炸");

console.log("\n[數字欄位不能帶單位]");
eq(applyTransform("32.55 坪", "number"), "32.55", "「32.55 坪」→ 32.55");
eq(applyTransform("22.1 坪", "number"), "22.1", "「22.1 坪」→ 22.1");
eq(applyTransform("8 年", "number"), "8", "「8 年」→ 8");
eq(applyTransform("698", "number"), "698", "純數字不變");
eq(applyTransform("12", "int"), "12", "int：純數字");
eq(applyTransform("12樓/15樓", "int"), "12", "int：只取第一個數字");
eq(applyTransform("32.55 坪", "int"), "32", "int：小數截斷成整數部分");
eq(applyTransform("平面式車位", "number"), "", "沒有數字 → 空字串（會被記成跳過）");
eq(applyTransform("座北朝南", undefined), "座北朝南", "沒指定 transform 就原樣");
eq(applyTransform("", "number"), "", "空字串進、空字串出");

console.log("\n[整條路徑：selectors.json 的每個 from 都取得到值]");
import("node:fs").then(() => {});
const { readFileSync } = await import("node:fs");
const cfg = JSON.parse(readFileSync(SELECTORS_FILE, "utf8"));
const noValue = [];
for (const [name, spec] of Object.entries(cfg.fields)) {
  const v = applyTransform(resolveValue(spec.from, pkg), spec.transform);
  if (!v) noValue.push(`${name}（from=${spec.from}）`);
}
eq(
  noValue.length,
  0,
  noValue.length ? `這幾欄取不到值：${noValue.join("、")}` : "骨架裡 19 個欄位的 from 全部對得到資料",
);

console.log("\n[出廠骨架必須擋下來]");
let threw = "";
try {
  loadSelectors();
} catch (err) {
  threw = err.message;
}
ok(threw.includes("selector 都還是空的"), "selector 全空時要報錯，不能安靜地全部跳過");
ok(threw.includes("npm run inspect"), "報錯要講下一步做什麼");

console.log(`\n${"─".repeat(46)}`);
console.log(fail === 0 ? `✅ 全數通過（${pass} 項）` : `❌ ${fail} 項失敗（通過 ${pass} 項）`);
process.exit(fail === 0 ? 0 : 1);
