/**
 * 從物件資料庫產一篇 FB 貼文草稿，丟進 posts/
 *
 * 跑法：
 *   npm run draft                 → 列出物件讓你選編號
 *   node new-post.mjs <物件id>     → 指定某一筆
 *   node new-post.mjs --blank      → 產一個空白草稿（純文字貼文、房產知識文用這個）
 *
 * 產完是**草稿**，不會發出去。檔案在 posts/ 底下，可以直接用記事本改內文再發。
 * 貼文內容跟後台之後要加的「產生 FB 貼文」按鈕是同一個函式（src/lib/export-fb.ts），
 * 不會兩邊講不一樣的話。
 */
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  POSTS_DIR,
  PROJECT_ROOT,
  askLine,
  ensureDir,
  loadEnv,
  localTimestamp,
  registerAliasHooks,
  serializePostFile,
} from "./_shared.mjs";

const argv = process.argv.slice(2);
const BLANK = argv.includes("--blank");
let propertyId = argv.find((a) => !a.startsWith("--"));

ensureDir(POSTS_DIR);

/** 明天早上 9 點。海線客群滑 FB 的時段，之後要調就改這裡。 */
function defaultSlot() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return localTimestamp(d);
}

function writeDraft(name, meta, body) {
  const file = path.join(POSTS_DIR, name);
  if (existsSync(file)) {
    console.error(`\n❌ ${name} 已經存在，不覆蓋。要重產先把舊的改名或刪掉。\n`);
    process.exit(1);
  }
  writeFileSync(file, serializePostFile(meta, body), "utf8");
  return file;
}

if (BLANK) {
  const stampName = new Date().toISOString().slice(0, 10);
  const file = writeDraft(
    `${stampName}-手寫.md`,
    { status: "pending", publishAt: defaultSlot(), photos: [] },
    "（把貼文內文寫在這裡。第一行是鉤子 —— 只回答一件事：讀者為什麼不能滑走。）",
  );
  console.log(`\n✅ 空白草稿：${file}`);
  console.log("   用記事本打開改內文，照片網址填進上面的 photos。");
  process.exit(0);
}

loadEnv();
registerAliasHooks();
const base = pathToFileURL(PROJECT_ROOT).href;
const { listProperties, getProperty, statusLabel } = await import(`${base}/src/lib/property.ts`);
const { buildFbPost } = await import(`${base}/src/lib/export-fb.ts`);

if (!propertyId) {
  const rows = await listProperties({ limit: 50 });
  if (!rows.length) {
    console.error("\n❌ 資料庫裡一筆物件都沒有。\n");
    process.exit(1);
  }
  console.log(`\n資料庫裡的物件\n${"─".repeat(60)}`);
  rows.forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(2, " ")}. [${statusLabel(r.status)}] ${r.title}` +
        `${r.price != null ? `　${r.price}萬` : ""}${r.district ? `　${r.district}` : ""}`,
    );
  });
  // 物件 id 是 uuid，叫人從網址列複製一長串進終端機第一次一定貼錯，所以改成選編號
  const pick = Number(await askLine("\n要產哪一筆？輸入編號："));
  const chosen = rows[pick - 1];
  if (!chosen) {
    console.error("\n❌ 沒有這個編號。\n");
    process.exit(1);
  }
  propertyId = chosen.id;
}

const property = await getProperty(propertyId);
if (!property) {
  console.error(`\n❌ 資料庫裡找不到 id=${propertyId}\n`);
  process.exit(1);
}

const pkg = buildFbPost(property);
const file = writeDraft(
  `${new Date().toISOString().slice(0, 10)}-${property.slug}.md`,
  {
    status: "pending",
    publishAt: defaultSlot(),
    source: `property:${property.id}`,
    photos: pkg.photos,
  },
  pkg.body,
);

console.log(`\n✅ 草稿：${file}`);
console.log(`   鉤子：${pkg.hook}`);
console.log(`   內文 ${pkg.body.length} 字、照片 ${pkg.photos.length} 張`);

if (pkg.warnings.length) {
  console.log(`\n⚠️  發之前先看這幾件事：`);
  for (const w of pkg.warnings) console.log(`   ・${w}`);
}

console.log("\n下一步：用記事本打開改一改（尤其第一行的鉤子），然後 `npm run post`。");
process.exit(0);
