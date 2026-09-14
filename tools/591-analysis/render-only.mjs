/**
 * 只重排報告，不開 591：讀 analyze.mjs 存下來的 <報告>.json，用目前的 render-report.mjs
 * 重新產生 HTML（覆蓋同名的 .html）。改報告文字或版面時用這支，省下再打一次 591。
 *
 * 跑法：node render-only.mjs reports/2026-09-14T03-14-12_聯悦臻.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { renderReport } from "./render-report.mjs";
import { loadOwner } from "./_shared.mjs";

const jsonPath = process.argv[2];
if (!jsonPath || !jsonPath.endsWith(".json")) {
  console.error("用法：node render-only.mjs <reports/某份報告.json>");
  process.exit(1);
}

const data = JSON.parse(readFileSync(jsonPath, "utf8"));
const html = renderReport(data, await loadOwner());
const outFile = jsonPath.replace(/\.json$/, ".html");
writeFileSync(outFile, html, "utf8");
console.log(`已重排：${outFile}`);
