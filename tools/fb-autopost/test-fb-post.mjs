/**
 * 離線測試：貼文佇列 + 貼文文案產生器
 *
 * 跑法：node test-fb-post.mjs
 *
 * 這裡驗的是「沒有 FB 帳號也驗得到的部分」—— 佇列怎麼排、文案怎麼組。
 * 瀏覽器那段要等本人跑過 login/inspect 才驗得了，但那段壞掉最多是沒發出去；
 * 這段壞掉會發出「內容是錯的」貼文，所以先擋住的是這裡。
 */
import { pathToFileURL } from "node:url";
import {
  PROJECT_ROOT,
  parsePostFile,
  serializePostFile,
  parseLocalDateTime,
  pickDuePost,
  minutesSinceLastPost,
  localTimestamp,
  registerAliasHooks,
} from "./_shared.mjs";

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${name}${extra ? `　→ ${extra}` : ""}`);
};

/* ────────────────── 佇列檔的解析 ────────────────── */

const SAMPLE = `---
status: pending
publishAt: 2026-08-26 09:00
photos:
  - https://example.com/a.jpg
  - https://example.com/b.jpg
source: property:abc-123
---
第一行鉤子

第二段內文`;

const parsed = parsePostFile(SAMPLE);
ok("front matter：status", parsed.meta.status === "pending", parsed.meta.status);
ok("front matter：publishAt", parsed.meta.publishAt === "2026-08-26 09:00");
ok("front matter：photos 是陣列", Array.isArray(parsed.meta.photos));
ok("front matter：photos 兩張", parsed.meta.photos?.length === 2, String(parsed.meta.photos?.length));
ok("front matter：source", parsed.meta.source === "property:abc-123");
ok("內文保留空行", parsed.body === "第一行鉤子\n\n第二段內文", JSON.stringify(parsed.body));

const round = parsePostFile(serializePostFile(parsed.meta, parsed.body));
ok("寫出去再讀回來：內文一樣", round.body === parsed.body);
ok("寫出去再讀回來：照片一樣", JSON.stringify(round.meta.photos) === JSON.stringify(parsed.meta.photos));
ok("寫出去再讀回來：時間一樣", round.meta.publishAt === parsed.meta.publishAt);

// 內文含「---」不該把檔案切壞（房仲文案很愛用分隔線）
const dashy = parsePostFile(`---\nstatus: pending\n---\n上面\n---\n下面`);
ok("內文裡的 --- 不會被當成 front matter 結尾", dashy.body === "上面\n---\n下面", JSON.stringify(dashy.body));

// 沒有 front matter 的純文字檔也要能讀
const bare = parsePostFile("就只有內文");
ok("沒有 front matter 也讀得到內文", bare.body === "就只有內文");
ok("沒有 front matter 時 meta 是空的", Object.keys(bare.meta).length === 0);

/* ────────────────── 時間（差 8 小時就是發錯時段）────────────────── */

const d = parseLocalDateTime("2026-08-26 09:00");
ok("時間：年", d?.getFullYear() === 2026);
ok("時間：月", d?.getMonth() === 7);
ok("時間：日", d?.getDate() === 26);
ok("時間：時＝本地 9 點不是 UTC 9 點", d?.getHours() === 9, String(d?.getHours()));
ok("時間：只有日期時補 00:00", parseLocalDateTime("2026-08-26")?.getHours() === 0);
ok("時間：亂填回 null", parseLocalDateTime("下禮拜一") === null);
ok("時間：空值回 null", parseLocalDateTime("") === null);

const nowStr = localTimestamp(new Date(2026, 7, 26, 9, 5));
ok("localTimestamp 格式", nowStr === "2026-08-26 09:05", nowStr);
ok("localTimestamp 轉回去對得上", parseLocalDateTime(nowStr)?.getHours() === 9);

/* ────────────────── 該發哪一篇 ────────────────── */

const NOW = new Date(2026, 7, 26, 10, 0);
const mk = (file, status, publishAt, postedAt) => ({
  file,
  status,
  publishAt: parseLocalDateTime(publishAt),
  meta: { publishAt, postedAt },
  body: "x",
  photos: [],
});

const queue = [
  mk("a.md", "posted", "2026-08-26 08:00", "2026-08-26 08:01"),
  mk("b.md", "pending", "2026-08-26 09:00"),
  mk("c.md", "pending", "2026-08-26 09:30"),
  mk("d.md", "pending", "2026-08-27 09:00"),
];

ok("挑最早那篇該發的", pickDuePost(queue, NOW)?.file === "b.md", pickDuePost(queue, NOW)?.file);
ok("已發過的不會再被挑", pickDuePost(queue, NOW)?.status === "pending");
ok(
  "還沒到時間的不挑",
  pickDuePost([mk("z.md", "pending", "2026-08-27 09:00")], NOW) === null,
);
ok(
  "沒排時間的視為隨時可發",
  pickDuePost([{ file: "n.md", status: "pending", publishAt: null, meta: {}, body: "x", photos: [] }], NOW)
    ?.file === "n.md",
);
ok("全部發完回 null", pickDuePost([mk("a.md", "posted", "2026-08-26 08:00", "2026-08-26 08:01")], NOW) === null);
ok("failed 的不會自己重試", pickDuePost([mk("f.md", "failed", "2026-08-26 08:00")], NOW) === null);

ok("沒發過時間隔是 Infinity", minutesSinceLastPost([mk("b.md", "pending", "2026-08-26 09:00")]) === Infinity);
{
  const twoHoursAgo = localTimestamp(new Date(Date.now() - 120 * 60000));
  const gap = minutesSinceLastPost([mk("a.md", "posted", twoHoursAgo, twoHoursAgo)]);
  ok("兩小時前發的算得出約 120 分", gap > 118 && gap < 122, String(Math.round(gap)));
}

/* ────────────────── 文案 ────────────────── */

registerAliasHooks();
const base = pathToFileURL(PROJECT_ROOT).href;
const { buildFbPost, buildFbHook, buildFbHashtags } = await import(`${base}/src/lib/export-fb.ts`);

const FULL = {
  id: "p1",
  slug: "wuqi-698",
  title: "梧棲高樓海景兩房",
  headline: null,
  status: "published",
  price: 698,
  price_note: null,
  property_type: "apartment",
  property_type_other: null,
  layout: "2房2廳1衛",
  size_ping: "32.55",
  main_building_ping: "22.10",
  land_ping: null,
  floor_info: "12樓/15樓",
  age_years: 5,
  parking: "平面車位一個",
  direction: "朝南",
  district: "梧棲",
  address: "台中市梧棲區中華路一段100號",
  address_public: "台中市梧棲區中華路一段",
  community: "海灣賞",
  builder: "某某建設",
  highlights: "高樓層看得到海\n平面車位免倒車",
  description: "室內採光好，客廳採光面朝南。",
  suitable_for: "小家庭、首次購屋",
  life_info: "步行五分鐘到市場",
  transport_info: "近台61線",
  cover_url: "https://example.com/cover.jpg",
  photo_urls: "https://example.com/1.jpg\nhttps://example.com/2.jpg",
  video_urls: null,
  seller_id: null,
  internal_note: "屋主底價 680",
  sort_order: 0,
  view_count: 0,
  published_at: null,
  created_at: new Date(),
  updated_at: null,
};

const pkg = buildFbPost(FULL);

ok("鉤子第一行就是鉤子", pkg.body.startsWith(pkg.hook), pkg.body.slice(0, 30));
ok("鉤子有總價", pkg.hook.includes("698"), pkg.hook);
ok("鉤子有平面車位（最強條件）", pkg.hook.includes("平面車位"), pkg.hook);
ok("有帶到格局", pkg.body.includes("2房2廳1衛"));
ok("有帶到社區", pkg.body.includes("海灣賞"));
ok("有把主建物換算成客戶聽得懂的話", pkg.body.includes("22.1 坪") || pkg.body.includes("22.10 坪"), "找不到主建物換算");
ok("有 CTA 電話", pkg.body.includes("0932-645-362"));
ok("有署名房仲蕭邦", pkg.body.includes("房仲蕭邦"));
ok("有太平洋房屋店名", pkg.body.includes("太平洋房屋 梧棲新市鎮加盟店"));

/* 🔴 不准外洩的東西 */
ok("🔴 不外洩完整門牌", !pkg.body.includes("100號"), "門牌跑出去了");
ok("🔴 不外洩內部備註（屋主底價）", !pkg.body.includes("680") && !pkg.body.includes("底價"), "底價跑出去了");
ok("🔴 不外洩 Email", !pkg.body.includes("@gmail"), "Email 跑出去了");
/* 🔴 TOP1 措辭禁忌 */
ok("🔴 TOP1 不准寫全台／全國／冠軍", !/全台|全國|冠軍/.test(pkg.body), "措辭踩線");

/* 照片 */
ok("封面排第一張", pkg.photos[0] === "https://example.com/cover.jpg", pkg.photos[0]);
ok("照片共三張", pkg.photos.length === 3, String(pkg.photos.length));
ok("照片不重複", new Set(pkg.photos).size === pkg.photos.length);

/* hashtag 只能從真的有的資料長出來 */
const tags = buildFbHashtags(FULL);
ok("hashtag 有行政區", tags.includes("梧棲房屋"), tags.join(","));
ok("hashtag 有社區", tags.includes("海灣賞"));
ok("hashtag 有平面車位", tags.includes("平面車位"));
ok("hashtag 不捏造沒有的條件", !tags.some((t) => /學區|海景|捷運/.test(t)), tags.join(","));

/* headline 優先 */
ok(
  "本人自己寫的主標優先於自動組的",
  buildFbHook({ ...FULL, headline: "這間房最大的問題不是價格" }) === "這間房最大的問題不是價格",
);

/* 空物件不能爆掉，也不能生出假資料 */
const EMPTY = {
  ...FULL,
  headline: null,
  price: null,
  layout: null,
  size_ping: null,
  main_building_ping: null,
  floor_info: null,
  parking: null,
  community: null,
  builder: null,
  highlights: null,
  description: null,
  suitable_for: null,
  life_info: null,
  transport_info: null,
  cover_url: null,
  photo_urls: null,
  age_years: null,
  direction: null,
  address_public: null,
  status: "draft",
};
const emptyPkg = buildFbPost(EMPTY);
ok("空物件不會爆掉", typeof emptyPkg.body === "string" && emptyPkg.body.length > 0);
ok("空物件仍有 CTA", emptyPkg.body.includes("0932-645-362"));
ok("空物件不生出假的坪數說明", !emptyPkg.body.includes("坪，真正走得到"));
ok("沒照片會警告", emptyPkg.warnings.some((w) => w.includes("照片")), emptyPkg.warnings.join("|"));
ok("沒填主標會提醒自己寫", emptyPkg.warnings.some((w) => w.includes("主標")));
ok("draft 狀態會警告", emptyPkg.warnings.some((w) => w.includes("draft")), emptyPkg.warnings.join("|"));
ok("published 的物件不該有狀態警告", !pkg.warnings.some((w) => w.includes("published")));

/* ────────────────── 結果 ────────────────── */

console.log(`\n${"─".repeat(60)}`);
if (fails.length === 0) {
  console.log(`✅ ${pass} 項全過`);
  process.exit(0);
}
console.log(`❌ ${pass} 過、${fails.length} 失敗：`);
for (const f of fails) console.log(`   ・${f}`);
process.exit(1);
