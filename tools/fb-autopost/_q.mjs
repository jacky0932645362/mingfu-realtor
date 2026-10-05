/**
 * 一次性：取消覓蜜那筆過期的排程（本人 2026-09-04 拍板取消、之後重發）。
 *
 * 📌 只把「工作」標成 cancelled，**文案（fb_draft）原封不動** ——
 *    之後要重發時直接拿同一篇去排新時間就好，不用重打。
 */
import { loadEnv, registerAliasHooks } from "./_shared.mjs";
loadEnv();
registerAliasHooks();
const { db } = await import("@/lib/db");

const tasks = await db.$queryRawUnsafe(`
  SELECT id, title, run_at, status, draft_id FROM fb_task WHERE status = 'pending'
`);

if (!tasks.length) {
  console.log("沒有 pending 的排程，什麼都沒做。");
  process.exit(0);
}

for (const t of tasks) {
  console.log(`要取消：${t.title}`);
  console.log(`  排定 ${new Date(t.run_at).toLocaleString("zh-TW")}｜目前 ${t.status}`);

  const items = await db.$queryRawUnsafe(
    `SELECT status, COUNT(*) AS n FROM fb_task_item WHERE task_id = ? GROUP BY status`, t.id);
  console.log(`  底下的發送目標：${items.map((i) => `${i.status}×${i.n}`).join("、")}`);

  await db.$executeRawUnsafe(
    `UPDATE fb_task SET status = 'cancelled', updated_at = NOW() WHERE id = ?`, t.id);
  await db.$executeRawUnsafe(
    `UPDATE fb_task_item SET status = 'cancelled', note = '整筆排程取消（2026-09-04 本人決定，之後重發）'
     WHERE task_id = ? AND status = 'pending'`, t.id);
}

console.log("\n--- 取消後的狀態 ---");
const after = await db.$queryRawUnsafe(`
  SELECT status, COUNT(*) AS n FROM fb_task GROUP BY status
`);
after.forEach((r) => console.log(`  fb_task ${r.status}：${r.n} 筆`));

const drafts = await db.$queryRawUnsafe(`
  SELECT title, post_status, CHAR_LENGTH(post_text) AS 字數 FROM fb_draft
  WHERE id IN (${tasks.map(() => "?").join(",")})`, ...tasks.map((t) => t.draft_id));
console.log("\n--- 文案還在（沒動）---");
drafts.forEach((d) => console.log(`  ${d.title}｜${d.post_status}｜${d.字數} 字`));

process.exit(0);
