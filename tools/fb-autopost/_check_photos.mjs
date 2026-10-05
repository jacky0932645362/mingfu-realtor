import { loadEnv, registerAliasHooks } from "./_shared.mjs";
loadEnv();
registerAliasHooks();
const { db } = await import("@/lib/db");
const { getProperty } = await import("@/lib/property");

const drafts = await db.$queryRawUnsafe(`
  SELECT id, title, source_property_id, property_url FROM fb_draft
  WHERE title LIKE '%覓蜜%' ORDER BY updated_at DESC LIMIT 1
`);
const d = drafts[0];
if (!d) {
  console.log("找不到覓蜜草稿");
  process.exit(1);
}
console.log(`草稿：${d.title}`);
console.log(`連結的物件 id：${d.source_property_id || "（沒有連結，這就是照片是空的原因）"}`);

if (d.source_property_id) {
  const prop = await getProperty(d.source_property_id);
  if (!prop) {
    console.log(`🔴 連結的物件 id 在物件庫裡找不到（可能被刪了或 id 對不上）`);
  } else {
    console.log(`物件標題：${prop.title}｜status：${prop.status}`);
    console.log(`封面：${prop.cover_url || "（沒有）"}`);
    console.log(`photo_urls 原始值：${String(prop.photo_urls).slice(0, 200)}`);
  }
}
process.exit(0);
