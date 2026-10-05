#!/usr/bin/env node
/**
 * 把 config/groups.json 裡抓好的社團，整理成後台「社團清單」能一次貼進去的格式（2026-09-03）。
 *
 *   node import-groups.mjs            只輸出「啟用: true」的（預設，多半是你要的）
 *   node import-groups.mjs --all      152 個全部輸出
 *   node import-groups.mjs --taichung 只輸出名稱裡有台中／海線關鍵字的
 *
 * ⭐ 刻意**不直接寫進資料庫**。
 *    多開一條「可以批次寫入社團清單」的 API 就多一個要顧的攻擊面，
 *    而這件事一輩子只做一次 —— 產出一個文字檔、你自己貼進後台的表格，
 *    貼之前還能順手挑掉不想發的。這是划算的取捨。
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);

const FILE = path.join(import.meta.dirname, "config", "groups.json");
const OUT = path.join(import.meta.dirname, "config", "groups-for-paste.txt");

/** 海線為主。跟 property.ts 的 DISTRICTS 同一個取向：本人的主戰場在前面。 */
const 台中關鍵字 = [
  "台中", "臺中", "海線", "梧棲", "清水", "沙鹿", "龍井", "大甲", "大安", "外埔",
  "后里", "神岡", "大雅", "西屯", "南屯", "北屯", "豐原", "大肚",
];

let raw;
try {
  raw = JSON.parse(readFileSync(FILE, "utf8"));
} catch (e) {
  console.error(`\n❌ 讀不到 ${FILE}\n   ${e.message}`);
  console.error("   先跑 `npm run groups` 把你加入的社團抓進來。\n");
  process.exit(1);
}

const 全部 = Array.isArray(raw.社團) ? raw.社團 : [];
if (全部.length === 0) {
  console.error("\n❌ groups.json 裡一個社團都沒有。先跑 `npm run groups`。\n");
  process.exit(1);
}

let 選中 = 全部;
let 說明 = `全部 ${全部.length} 個`;

if (flag("taichung")) {
  選中 = 全部.filter((g) => 台中關鍵字.some((k) => String(g.名稱 || "").includes(k)));
  說明 = `名稱含台中／海線關鍵字的 ${選中.length} 個`;
} else if (!flag("all")) {
  選中 = 全部.filter((g) => g.啟用 === true);
  說明 = `已啟用的 ${選中.length} 個`;
  if (選中.length === 0) {
    console.log(`\n⚠ groups.json 裡 152 個社團目前**全部都是「啟用: false」**，所以這樣跑會是空的。`);
    console.log("   三個選擇：");
    console.log("     node import-groups.mjs --taichung   ← 建議，先挑台中／海線的");
    console.log("     node import-groups.mjs --all        全部 152 個");
    console.log("     先去 config/groups.json 把要發的改成 true，再跑一次\n");
    process.exit(0);
  }
}

// 「名字 | 網址」就是後台那個文字框吃的格式。
// 名稱裡如果有 `|` 會把格式拆壞（後台是用第一個 | 切的），先換成全形。
const lines = 選中.map((g) => `${String(g.名稱 || "").replace(/\|/g, "｜").trim()} | ${g.網址}`);

writeFileSync(OUT, `${lines.join("\n")}\n`, "utf8");

console.log(`\n✅ ${說明} 已經寫進：\n   ${OUT}\n`);
console.log("接下來：");
console.log("  ① 用記事本打開那個檔，全選複製（Ctrl+A → Ctrl+C）");
console.log("  ② 後台 → FB 貼文工廠 → 社團清單 → 貼進「新增社團」的框");
console.log("  ③ 選「這批社團收哪一種文」跟冷卻天數 → 加進清單\n");
console.log("前 5 行長這樣：");
for (const l of lines.slice(0, 5)) console.log(`  ${l}`);
if (lines.length > 5) console.log(`  …還有 ${lines.length - 5} 行\n`);
