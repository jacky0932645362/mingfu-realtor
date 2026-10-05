/**
 * 一次性：排一份安全的測試工作，讓 --attended 撈得到東西。
 *
 * 用同一份已修好價格（768萬）的覓蜜文案，只發個人主頁、不勾社團、
 * 不自動發佈（attended 模式本來就要人按那一下），時間設現在。
 */
import { loadEnv, registerAliasHooks } from "./_shared.mjs";
loadEnv();
registerAliasHooks();
const { db } = await import("@/lib/db");
const { createFbTask } = await import("@/lib/fb-factory");

const drafts = await db.$queryRawUnsafe(`
  SELECT id, title FROM fb_draft WHERE title LIKE '%覓蜜%' ORDER BY updated_at DESC LIMIT 1
`);
if (!drafts[0]) {
  console.log("找不到覓蜜那份草稿，什麼都沒做。");
  process.exit(1);
}

const taskId = await createFbTask({
  draftId: drafts[0].id,
  title: drafts[0].title,
  channel: "post",
  runAt: new Date(),
  postToTimeline: true, // 個人主頁
  groups: [], // 不碰社團
  autoPublish: false, // attended 模式本來就要人按發佈，這裡求穩
});

console.log(`✅ 排好了：${drafts[0].title}`);
console.log(`   task id: ${taskId}`);
console.log(`   目標：個人主頁（不含任何社團）`);
console.log(`   模式：手動（發佈那一下你自己按）`);
console.log(`\n下一步：桌面點 FB-Runner.bat → 選 1`);
process.exit(0);
