/**
 * 一次性：把卡在 status=running 的覓蜜工作解開。
 * 用的是正式的 releaseTask()，跟程式正常運作時同一條路，不是繞過去改資料庫。
 */
import { loadEnv, registerAliasHooks } from "./_shared.mjs";
loadEnv();
registerAliasHooks();
const { db } = await import("@/lib/db");
const { releaseTask } = await import("@/lib/fb-factory");

const rows = await db.$queryRawUnsafe(`
  SELECT id, title FROM fb_task WHERE status = 'running' AND title LIKE '%覓蜜%' LIMIT 1
`);
if (!rows[0]) {
  console.log("沒有卡住的覓蜜工作，可能已經解開了。");
  process.exit(0);
}

await releaseTask(rows[0].id, "手動解開：之前的認領沒有正常收尾，卡在 running（已修 claimNextTask 的查詢條件，之後會自動解）");
console.log(`✅ 已解開：${rows[0].title}`);

const check = await db.$queryRawUnsafe(`SELECT status FROM fb_task WHERE id = ?`, rows[0].id);
console.log(`目前狀態：${check[0].status}`);
process.exit(0);
