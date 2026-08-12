/**
 * 檢查資料庫連線與資料表 —— 換資料庫之後跑這個確認有沒有接上。
 *
 * 用法：node --env-file=.env.local scripts/check-db.mjs
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const url = process.env.DATABASE_URL || "";
const host = url.split("@")[1]?.split("/")[0] || "(讀不到)";
console.log("連線目標：" + host);

const rows = await db.$queryRawUnsafe("SHOW TABLES");
const names = rows.map((r) => Object.values(r)[0]).sort();

console.log("資料表數量：" + names.length);
for (const n of names) {
  const c = await db.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM \`${n}\``);
  console.log("  " + n.padEnd(34) + String(c[0].n) + " 筆");
}

await db.$disconnect();
