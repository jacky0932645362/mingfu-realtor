/**
 * 【測試用】整條填表流程的實測 —— 用一張假的 591 表單。
 * 跑法：node test-fill-e2e.mjs
 *
 * 為什麼要有這支：
 *   我沒有 591 帳號，接不到真的表單。但「主迴圈會不會動」不能等到真的接上去
 *   那天才發現 —— 那時候人已經對著 591 後台，出錯就是在正式環境出錯。
 *   所以這裡自己蓋一張假表單（欄位型態照 591 常見的樣子：文字框、下拉、textarea），
 *   讓真正的 fill.mjs 去填它，再把填進去的值讀回來對答案。
 *
 * 驗的是這幾件事：
 *   ① 讀資料庫 → 產生上架包 → 逐格填 → 收尾報告，整條走得完
 *   ② 填進去的值真的是對的（不是「有填就算過」）
 *   ③ 數字欄位有去掉單位（591 的坪數格不吃「32.55 坪」）
 *   ④ selector 找不到時要記成失敗、不能整支掛掉
 *   ⑤ 資料庫沒值的欄位要記成跳過、不能填空字串進去
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PROPERTY_ID = "2002450b-6a82-40fc-9d88-351b17de29a6";
const work = mkdtempSync(path.join(tmpdir(), "fill-e2e-"));

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}`);
  }
}

/* ────────── ① 蓋一張假的 591 表單 ────────── */

const formFile = path.join(work, "fake-591-form.html");
writeFileSync(
  formFile,
  `<!doctype html><meta charset="utf-8"><title>假的 591 刊登表單</title>
<body style="font-family:sans-serif;padding:20px;max-width:640px">
<h1>假的 591 刊登表單（測試用）</h1>
<label>標題 <input id="f-title"></label><br>
<label>售價 <input id="f-price"></label><br>
<label>類型 <select id="f-type"><option value="">請選擇</option><option>電梯大樓</option><option>透天厝</option></select></label><br>
<label>縣市 <select id="f-city"><option value="">請選擇</option><option>台中市</option><option>台北市</option></select></label><br>
<label>行政區 <select id="f-dist"><option value="">請選擇</option><option>梧棲區</option><option>清水區</option></select></label><br>
<label>地址 <input id="f-addr"></label><br>
<label>社區 <input id="f-community"></label><br>
<label>房 <select id="f-room"><option value="">-</option><option>1</option><option>2</option><option>3</option></select></label>
<label>廳 <select id="f-hall"><option value="">-</option><option>1</option><option>2</option></select></label>
<label>衛 <select id="f-bath"><option value="">-</option><option>1</option><option>2</option></select></label><br>
<label>建物坪數 <input id="f-size"></label><br>
<label>主建物坪數 <input id="f-main"></label><br>
<label>土地坪數 <input id="f-land"></label><br>
<label>樓層 <input id="f-floor"></label><br>
<label>總樓層 <input id="f-total"></label><br>
<label>屋齡 <input id="f-age"></label><br>
<label>朝向 <select id="f-dir"><option value="">-</option><option>座北朝南</option></select></label><br>
<label>車位 <input id="f-parking"></label><br>
<label>描述 <textarea id="f-desc" rows="6" cols="60"></textarea></label>
</body>`,
  "utf8",
);

/* ────────── ② 對映到假表單，外加兩個刻意的壞欄位 ────────── */

const selectorsFile = path.join(work, "selectors.json");
writeFileSync(
  selectorsFile,
  JSON.stringify(
    {
      formUrl: pathToFileURL(formFile).href,
      fields: {
        標題: { selector: "#f-title", action: "fill", from: "@title" },
        售價: { selector: "#f-price", action: "fill", from: "售價（萬元）", transform: "number" },
        物件類型: { selector: "#f-type", action: "select", from: "物件類型" },
        縣市: { selector: "#f-city", action: "select", from: "縣市" },
        行政區: { selector: "#f-dist", action: "select", from: "行政區" },
        地址: { selector: "#f-addr", action: "fill", from: "地址" },
        社區名稱: { selector: "#f-community", action: "fill", from: "社區名稱" },
        房: { selector: "#f-room", action: "select", from: "@layout.rooms" },
        廳: { selector: "#f-hall", action: "select", from: "@layout.halls" },
        衛: { selector: "#f-bath", action: "select", from: "@layout.baths" },
        建物坪數: { selector: "#f-size", action: "fill", from: "建物坪數", transform: "number" },
        主建物坪數: { selector: "#f-main", action: "fill", from: "主建物坪數", transform: "number" },
        土地坪數: { selector: "#f-land", action: "fill", from: "土地坪數", transform: "number" },
        樓層: { selector: "#f-floor", action: "fill", from: "@floor.floor", transform: "int" },
        總樓層: { selector: "#f-total", action: "fill", from: "@floor.total", transform: "int" },
        屋齡: { selector: "#f-age", action: "fill", from: "屋齡", transform: "number" },
        朝向: { selector: "#f-dir", action: "select", from: "朝向" },
        車位: { selector: "#f-parking", action: "fill", from: "車位" },
        物件描述: { selector: "#f-desc", action: "fill", from: "@description" },

        // 刻意的壞資料，驗證兩種失敗模式不會讓整支掛掉：
        找不到的欄位: { selector: "#這格不存在", action: "fill", from: "社區名稱", timeout: 1200 },
        資料庫沒值的欄位: { selector: "#f-title", action: "fill", from: "這個標籤不存在" },
      },
    },
    null,
    2,
  ),
  "utf8",
);

/* ────────── ③ 假的登入狀態（file:// 用不到 cookie，但 fill.mjs 會檢查檔案在不在）────────── */

const authFile = path.join(work, "auth.json");
writeFileSync(authFile, JSON.stringify({ cookies: [], origins: [] }), "utf8");

/* ────────── ④ 讓真正的 fill.mjs 跑一次 ────────── */

console.log(`\n工作目錄：${work}`);
console.log("跑 fill.mjs（headless，填完自動送 Enter 收尾）…\n");

const dumpFile = path.join(work, "result.json");
let out = "";
try {
  out = execFileSync(process.execPath, ["fill.mjs", PROPERTY_ID], {
    cwd: import.meta.dirname,
    input: "\n", // 收尾的 waitForEnter
    encoding: "utf8",
    timeout: 180000,
    env: {
      ...process.env,
      FILL_SELECTORS_FILE: selectorsFile,
      FILL_AUTH_FILE: authFile,
      FILL_SHOTS_DIR: path.join(work, "shots"),
      FILL_HEADLESS: "1",
      FILL_DUMP_VALUES: dumpFile,
    },
  });
} catch (err) {
  out = `${err.stdout || ""}${err.stderr || ""}`;
  console.log(out);
  console.log("\n❌ fill.mjs 執行失敗");
  process.exit(1);
}

console.log(out.split("\n").filter((l) => l.trim()).join("\n"));

/* ────────── ⑤ 對答案：填進去的值真的對嗎 ────────── */

console.log("\n[填進表單的值]");
const got = JSON.parse(readFileSync(dumpFile, "utf8"));

ok(got["f-title"] === "698萬買得到高樓海景？", `標題 = ${got["f-title"]}`);
ok(got["f-price"] === "698", `售價 = ${got["f-price"]}（去掉「萬」）`);
ok(got["f-type"] === "電梯大樓", `類型 = ${got["f-type"]}（下拉照文字選中）`);
ok(got["f-city"] === "台中市", `縣市 = ${got["f-city"]}`);
ok(got["f-dist"] === "梧棲區", `行政區 = ${got["f-dist"]}`);
ok(got["f-addr"] === "台中市梧棲區文化路二段123號12樓", `地址 = ${got["f-addr"]}`);
ok(got["f-community"] === "海悅觀邸", `社區 = ${got["f-community"]}`);

console.log("\n[格局拆成三個下拉]");
ok(got["f-room"] === "2", `房 = ${got["f-room"]}`);
ok(got["f-hall"] === "2", `廳 = ${got["f-hall"]}`);
ok(got["f-bath"] === "1", `衛 = ${got["f-bath"]}`);

console.log("\n[數字欄位不能帶單位]");
ok(got["f-size"] === "32.55", `建物坪數 = ${got["f-size"]}（不是「32.55 坪」）`);
ok(got["f-main"] === "22.1", `主建物 = ${got["f-main"]}`);
ok(got["f-land"] === "5.2", `土地 = ${got["f-land"]}`);
ok(got["f-age"] === "8", `屋齡 = ${got["f-age"]}（不是「8 年」）`);

console.log("\n[樓層拆成兩格]");
ok(got["f-floor"] === "12", `樓層 = ${got["f-floor"]}`);
ok(got["f-total"] === "15", `總樓層 = ${got["f-total"]}`);

console.log("\n[描述]");
ok(got["f-desc"].startsWith("總價 698 萬"), "描述開頭是總價");
ok(got["f-desc"].includes("【這間的重點】"), "描述含賣點段落");
ok(!got["f-desc"].includes("680"), "🚫 描述不含屋主底價");
ok(!got["f-desc"].includes("123號"), "🚫 描述不含完整門牌");
ok(!/0932|line|http/i.test(got["f-desc"]), "🚫 描述不含聯絡方式與網址");

console.log("\n[兩種失敗模式要被記錄，不能讓整支掛掉]");
ok(/失敗 1 格/.test(out), "找不到的 selector 記成失敗（1 格）");
ok(/找不到的欄位/.test(out), "報告裡點名是哪一格找不到");
ok(/跳過 1 格/.test(out), "資料庫沒值的欄位記成跳過（1 格）");
ok(/填好 19 格/.test(out), "其餘 19 格都填成功");

console.log("\n[收尾]");
ok(/照片要自己拖進去/.test(out), "有印出照片清單（591 不能自動傳檔）");
ok(/01\. https/.test(out), "照片有編號");
ok(/不會幫你按送出/.test(out), "有明講不會自動送出");

console.log(`\n${"─".repeat(46)}`);
console.log(fail === 0 ? `✅ 全數通過（${pass} 項）` : `❌ ${fail} 項失敗（通過 ${pass} 項）`);
console.log(`（假表單與截圖留在 ${work}，看完可以整個資料夾刪掉）`);
process.exit(fail === 0 ? 0 : 1);
