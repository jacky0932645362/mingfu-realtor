import { loadEnv, registerAliasHooks } from "./_shared.mjs";
loadEnv();
registerAliasHooks();
const { db } = await import("@/lib/db");

const rows = await db.$queryRawUnsafe(`
  SELECT t.id, t.title, t.status, t.run_at, t.channel,
         r.expires_at, r.auto_publish, r.attempts, r.claimed_by, r.claimed_at
  FROM fb_task t LEFT JOIN fb_task_run r ON r.task_id = t.id
  WHERE t.title LIKE '%覓蜜%' ORDER BY t.created_at DESC LIMIT 3
`);

console.log(`現在（伺服器眼中的時間）：${new Date().toISOString()}　本地：${new Date().toLocaleString("zh-TW")}`);
console.log("");
for (const r of rows) {
  console.log(`任務：${r.title}`);
  console.log(`  status=${r.status}  channel=${r.channel}`);
  console.log(`  run_at=${r.run_at}（${new Date(r.run_at).toLocaleString("zh-TW")}）`);
  console.log(`  expires_at=${r.expires_at}（${r.expires_at ? new Date(r.expires_at).toLocaleString("zh-TW") : "-"}）`);
  console.log(`  auto_publish=${r.auto_publish}  attempts=${r.attempts}  claimed_by=${r.claimed_by || "-"}`);
  console.log(`  已到期了嗎（run_at <= 現在）：${new Date(r.run_at) <= new Date() ? "✅ 是" : "❌ 還沒到"}`);
  console.log(`  過期了嗎（expires_at <= 現在）：${r.expires_at && new Date(r.expires_at) <= new Date() ? "🔴 過期了" : "沒過期"}`);

  const items = await db.$queryRawUnsafe(
    `SELECT channel, status, note FROM fb_task_item WHERE task_id = ?`, r.id);
  console.log(`  目標：${items.map((i) => `${i.channel}=${i.status}`).join("、")}`);
  console.log("");
}
process.exit(0);
