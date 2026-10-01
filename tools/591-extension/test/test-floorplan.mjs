/**
 * lib/floorplan.js 的規則測試（2026-09-23）。跟 license.js 同一招：這支要給 background.js 用
 * importScripts() 載入（service worker 不是 ES module），寫成 (function(root){...})(...) 的老派
 * 寫法，這裡用 eval 把它讀進 node 測，不用真的開瀏覽器、不用真的抓愛屋的圖（沒有真實含格局圖的
 * 物件可以測，這裡全部用合成的像素資料，見 lib/floorplan.js 開頭的說明）。
 *
 * 跑法：node test/test-floorplan.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "lib", "floorplan.js"), "utf8");
// eslint-disable-next-line no-eval
(0, eval)(src);
const { statsFromImageData, looksLikeFloorPlan, pickFloorPlan, bestCandidate } = globalThis.P591FloorPlan;

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

/** 造一張 w×h 的純色圖 */
function solid(w, h, [r, g, b]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}
/** 造一張大部分白色、混一小撮彩色像素的圖，比較接近真的照片（白底/白牆 + 一塊顏色） */
function mostlyWhiteWith(w, h, colorFraction, color) {
  const data = new Uint8ClampedArray(w * h * 4);
  const n = w * h;
  const colorCount = Math.round(n * colorFraction);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const [r, g, b] = p < colorCount ? color : [255, 255, 255];
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}

/* ───────── statsFromImageData ───────── */
{
  const s = statsFromImageData(solid(8, 8, [255, 255, 255]));
  eq("全白：白色比例 1、灰階比例 1", [s.whiteRatio, s.grayRatio], [1, 1]);
}
{
  const s = statsFromImageData(solid(8, 8, [30, 140, 200]));
  eq("飽和藍色：不算白、不算灰階", [s.whiteRatio, s.grayRatio], [0, 0]);
}
{
  const s = statsFromImageData(solid(8, 8, [80, 80, 80]));
  eq("純灰（R=G=B）：不算白，但算灰階", [s.whiteRatio > 0, s.grayRatio], [false, 1]);
}
{
  const s = statsFromImageData({ width: 0, height: 0, data: new Uint8ClampedArray() });
  eq("空圖（0 像素）不要除以 0 炸掉", [s.whiteRatio, s.grayRatio], [0, 0]);
}

/* ───────── looksLikeFloorPlan：白底線稿 vs 一般室內照片 ───────── */
{
  const plan = mostlyWhiteWith(64, 64, 0.05, [20, 20, 20]); // 95% 白、5% 深灰線條
  eq("白底線稿（95%白+5%深灰線）→ 判定像格局圖", looksLikeFloorPlan(statsFromImageData(plan)), true);
}
{
  const room = mostlyWhiteWith(64, 64, 0.55, [140, 100, 60]); // 55% 木地板棕色、45% 白牆
  eq("一般室內照片（大面積木地板棕色）→ 不判定像格局圖", looksLikeFloorPlan(statsFromImageData(room)), false);
}
{
  const s = statsFromImageData(solid(4, 4, [255, 255, 255])); // 16 像素，剛好卡在門檻
  eq("剛好等於最小取樣門檻（16 像素）→ 照樣判斷", looksLikeFloorPlan(s), true);
}
{
  const tiny = statsFromImageData(solid(2, 2, [255, 255, 255])); // 4 像素，低於門檻
  eq("小於最小取樣門檻 → 不判斷，避免雜訊", looksLikeFloorPlan(tiny), false);
}
{
  eq("沒給 stats（undefined）→ 不判定像格局圖，不炸掉", looksLikeFloorPlan(undefined), false);
}

/* ───────── pickFloorPlan：多張裡面只挑一張，分數最高的贏；沒有候選就回 null ───────── */
{
  const plan = statsFromImageData(mostlyWhiteWith(64, 64, 0.05, [20, 20, 20]));
  const room1 = statsFromImageData(mostlyWhiteWith(64, 64, 0.55, [140, 100, 60]));
  const room2 = statsFromImageData(mostlyWhiteWith(64, 64, 0.6, [80, 150, 90]));
  const items = [
    { url: "a", ...room1 },
    { url: "b", ...plan },
    { url: "c", ...room2 },
  ];
  eq("一批照片裡只有 1 張像格局圖 → 挑中那一張", pickFloorPlan(items).url, "b");
}
{
  const room1 = statsFromImageData(mostlyWhiteWith(64, 64, 0.55, [140, 100, 60]));
  eq("整批都不像格局圖 → 回 null，不硬猜", pickFloorPlan([{ url: "a", ...room1 }]), null);
}
{
  const weaker = statsFromImageData(mostlyWhiteWith(64, 64, 0.05, [20, 20, 20]));
  const stronger = statsFromImageData(mostlyWhiteWith(64, 64, 0.02, [10, 10, 10])); // 更白、線更少
  const pick = pickFloorPlan([
    { url: "weaker", ...weaker },
    { url: "stronger", ...stronger },
  ]);
  eq("兩張都像格局圖 → 挑白色+灰階分數加總較高的那張", pick.url, "stronger");
}
{
  const plan = statsFromImageData(mostlyWhiteWith(64, 64, 0.05, [20, 20, 20]));
  const pick = pickFloorPlan([
    { url: "broken", error: "HTTP 404" },
    { url: "ok", ...plan },
  ]);
  eq("抓圖失敗的那張（有 error）直接跳過，不會被誤選", pick.url, "ok");
}
eq("空陣列 → null", pickFloorPlan([]), null);
eq("沒給陣列（undefined）→ null，不炸掉", pickFloorPlan(undefined), null);

/**
 * ───────── bestCandidate：不管有沒有過門檻，給診斷用的「最接近的一張」（2026-09-24）─────────
 * 本人真實測試回報「兩個平台都沒抓到格局圖」——原本沒偵測到就把整個區塊藏起來，完全看不出原因。
 * 改成一律顯示「看過幾張、最接近的是第幾張、比例多少」，這幾個數字從 bestCandidate 來。
 */
{
  const room1 = statsFromImageData(mostlyWhiteWith(64, 64, 0.55, [140, 100, 60])); // 白44.9%/灰44.9%左右，過不了門檻
  const room2 = statsFromImageData(mostlyWhiteWith(64, 64, 0.7, [80, 150, 90]));
  const pick = bestCandidate([
    { url: "a", ...room2 },
    { url: "b", ...room1 },
  ]);
  eq("整批都不像格局圖 → 還是能挑出分數最高的那張（不是 null）", pick.url, "b");
}
{
  const plan = statsFromImageData(mostlyWhiteWith(64, 64, 0.05, [20, 20, 20]));
  const pick = bestCandidate([
    { url: "broken", error: "HTTP 404" },
    { url: "ok", ...plan },
  ]);
  eq("抓圖失敗的一樣跳過，不會被當成「最接近」", pick.url, "ok");
}
eq("空陣列 → null", bestCandidate([]), null);
eq("全部都抓圖失敗 → null", bestCandidate([{ url: "a", error: "HTTP 404" }]), null);

console.log(`\n${pass} 過、${fail} 沒過`);
if (fail) process.exit(1);
