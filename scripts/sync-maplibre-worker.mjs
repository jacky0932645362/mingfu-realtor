/**
 * 把 maplibre-gl 的背景工作程式(worker)複製到 public/maplibre/
 *
 * 為什麼需要這一步：
 *   maplibre-gl 6.x 是純 ESM，靠 `import.meta.url` 自己推算 worker 檔案的位置。
 *   經過 Next.js / Turbopack 打包後那個值不是 http 網址，推算結果會變成空字串，
 *   worker 於是去抓網頁本身、拿到 HTML 而不是 JS，底圖就永遠停在「載入中」。
 *   把 worker 放到 public/ 當靜態檔，再用 setWorkerUrl() 明確指路，就能繞過。
 *
 * 什麼時候要重跑：升級或重裝 maplibre-gl 之後。
 * 已掛在 package.json 的 predev / prebuild，平常不用自己執行。
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "maplibre-gl", "dist");
const to = join(root, "public", "maplibre");

// worker 會 import 同目錄的 shared，兩個都要複製
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

if (!existsSync(from)) {
  console.warn("[maplibre] 找不到 node_modules/maplibre-gl，略過複製");
  process.exit(0);
}

mkdirSync(to, { recursive: true });
for (const f of FILES) {
  copyFileSync(join(from, f), join(to, f));
}
console.log(`[maplibre] 已複製 ${FILES.length} 個 worker 檔到 public/maplibre/`);
