/**
 * 節奏保護（跨任務、跨通路）的離線測試 —— 直接讀後台的 src/lib/fb-rhythm.ts（純函式，不連資料庫）
 *
 * 跑法：node test-rhythm.mjs
 *
 * 驗的是 2026-09-19 本人問「一般貼文跟 Marketplace 排到同一時間會怎樣」之後補的規則：
 *   ・同一時間 → 一般貼文先、Marketplace 排隊，且要隔滿跨通路間隔
 *   ・兩篇（不同任務）隔 90 分；同一份工作續發剩下的社團不算另一篇
 *   ・一天上限用資料庫算（runner 刪掉 task-*.md 之後 post.mjs 自己那本帳看不到）
 */
import { pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
for (const k of ["FB_MAX_PER_DAY", "FB_MIN_GAP_MINUTES", "FB_CHANNEL_GAP_MINUTES"]) delete process.env[k]; // 用程式預設值驗
// 2026-09-19 本人拍板後的預設：每日上限 0（不設限）、跨通路 0（不管）、兩篇不同文案隔 90。
// 下面要驗「規則本身對不對」的地方，用 limits 參數把上限／跨通路明確打開。
const 開 = { minGap: 90, channelGap: 30, maxPerDay: 6 };
const { rhythmHold, describeClash, clashNoteFor, MIN_GAP_MINUTES, CHANNEL_GAP_MINUTES, MAX_PER_DAY } = await import(
  `${pathToFileURL(ROOT).href}/src/lib/fb-rhythm.ts`
);

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${name}${extra ? `　→ ${extra}` : ""}`);
};

const now = new Date("2026-09-19T12:00:00");
const 分鐘前 = (m) => new Date(now.getTime() - m * 60_000);
const 空 = { lastFeedAt: null, lastFeedTaskId: null, lastMarketplaceAt: null, postedToday: 0 };

/* ── ① 預設值 ── */
ok("① 兩篇不同文案隔 90 分", MIN_GAP_MINUTES === 90, String(MIN_GAP_MINUTES));
ok("① 跨通路預設 0＝不管（本人拍板 Marketplace 一次上架）", CHANNEL_GAP_MINUTES === 0, String(CHANNEL_GAP_MINUTES));
ok("① 一天上限預設 0＝不設限（本人拍板）", MAX_PER_DAY === 0, String(MAX_PER_DAY));

/* ── ①b 預設值下：Marketplace 完全不受管、一般貼文只剩 90 分那條 ── */
{
  const 剛剛都發過 = { lastFeedAt: 分鐘前(1), lastFeedTaskId: "t1", lastMarketplaceAt: 分鐘前(1), postedToday: 50 };
  ok("①b 預設：Marketplace 剛發完一般貼文也照刊、不算次數", rhythmHold("marketplace", 剛剛都發過, "m9", now) === null);
  ok("①b 預設：一般貼文不受每日上限、不等 Marketplace，只擋 90 分", (rhythmHold("post", 剛剛都發過, "t2", now) || "").includes("兩篇至少隔 90"));
  ok("①b 預設：同一份工作續發不擋", rhythmHold("post", 剛剛都發過, "t1", now) === null);
}

/* ── ② 什麼都沒發過 → 兩個通路都能認領 ── */
ok("② 空帳本：一般貼文可認領", rhythmHold("post", 空, "t1", now) === null);
ok("② 空帳本：Marketplace 可認領", rhythmHold("marketplace", 空, "m1", now) === null);

/* ── ③ 跨通路：一般貼文 ↔ Marketplace ── */
{
  const 剛刊登 = { ...空, lastMarketplaceAt: 分鐘前(10) };
  const r = rhythmHold("post", 剛刊登, "t1", now, 開);
  ok("③ Marketplace 10 分前才刊登 → 一般貼文擋住", r != null && r.includes("跨通路"), r);
  ok("③ 訊息講得出還要等幾分（20）", r != null && r.includes("還要等約 20 分"), r);
  ok("③ Marketplace 31 分前刊登 → 一般貼文放行", rhythmHold("post", { ...空, lastMarketplaceAt: 分鐘前(31) }, "t1", now, 開) === null);

  const 剛發文 = { ...空, lastFeedAt: 分鐘前(5), lastFeedTaskId: "t1" };
  const m = rhythmHold("marketplace", 剛發文, "m1", now, 開);
  ok("③ 一般貼文 5 分前才發 → Marketplace 擋住", m != null && m.includes("跨通路"), m);
  ok("③ 一般貼文 30 分前發 → Marketplace 放行（剛好隔滿）", rhythmHold("marketplace", { ...空, lastFeedAt: 分鐘前(30), lastFeedTaskId: "t1" }, "m1", now, 開) === null);
  ok("③ 同一份工作續發，但 Marketplace 5 分前刊登 → 還是擋（跨通路不看任務）", rhythmHold("post", { ...剛刊登, lastMarketplaceAt: 分鐘前(5), lastFeedAt: 分鐘前(3), lastFeedTaskId: "t1" }, "t1", now, 開) != null);
}

/* ── ④ 同通路：兩篇隔 90 分；同一份工作續發不算 ── */
{
  const 上一篇 = { ...空, lastFeedAt: 分鐘前(30), lastFeedTaskId: "t1" };
  const r = rhythmHold("post", 上一篇, "t2", now);
  ok("④ 另一篇 30 分前發 → 擋住", r != null && r.includes("兩篇至少隔 90"), r);
  ok("④ 還要等 60 分", r != null && r.includes("還要等約 60 分"), r);
  ok("④ 同一份工作（t1）接著發剩下的社團 → 放行", rhythmHold("post", 上一篇, "t1", now) === null);
  ok("④ 另一篇 90 分前發 → 放行", rhythmHold("post", { ...空, lastFeedAt: 分鐘前(90), lastFeedTaskId: "t1" }, "t2", now) === null);
  ok("④ 另一篇 89.5 分前發 → 還是擋", rhythmHold("post", { ...空, lastFeedAt: 分鐘前(89.5), lastFeedTaskId: "t1" }, "t2", now) != null);

  const 上一筆MP = { ...空, lastMarketplaceAt: 分鐘前(1) };
  ok("④ 兩筆 Marketplace 之間不等（一次上架，就算把規則全開也不等）", rhythmHold("marketplace", 上一筆MP, "m2", now, 開) === null);
}

/* ── ⑤ 一天上限（資料庫算） ── */
{
  const 滿了 = { ...空, lastFeedAt: 分鐘前(200), lastFeedTaskId: "t1", postedToday: 6 };
  ok("⑤ 設了上限 6、今天 6 個地方 → 一般貼文擋", (rhythmHold("post", 滿了, "t2", now, 開) || "").includes("一天上限 6"));
  ok("⑤ 上限對 Marketplace 不算（一次上架）", rhythmHold("marketplace", 滿了, "m1", now, 開) === null);
  ok("⑤ 同一份工作續發也一樣擋（上限就是上限）", rhythmHold("post", { ...滿了, lastFeedAt: 分鐘前(3) }, "t1", now, 開) != null);
  ok("⑤ 今天 5 個 → 放行", rhythmHold("post", { ...滿了, postedToday: 5 }, "t2", now, 開) === null);
  ok("⑤ 上限 0 = 不擋（預設）", rhythmHold("post", { ...滿了, postedToday: 999 }, "t2", now) === null);
}

/* ── ⑥ limits 可覆寫（環境變數的效果） ── */
{
  ok("⑥ 跨通路改 0 → 不擋", rhythmHold("post", { ...空, lastMarketplaceAt: 分鐘前(1) }, "t1", now, { channelGap: 0 }) === null);
  ok("⑥ 兩篇改 10 分 → 30 分前的放行", rhythmHold("post", { ...空, lastFeedAt: 分鐘前(30), lastFeedTaskId: "t1" }, "t2", now, { minGap: 10 }) === null);
}

/* ── ⑦ 排程時的撞時段提示 ── */
{
  const at = (h, m) => new Date(2026, 8, 20, h, m);
  const 貼文 = { id: "p", title: "覓蜜", channel: "post", runAt: at(11, 40) };
  const 商品 = { id: "m", title: "覓蜜 MP", channel: "marketplace", runAt: at(11, 40) };
  ok("⑦ 預設（跨通路 0）：同一時間的 Marketplace 不提示（它就排在後面，不用等）", describeClash(商品, 貼文) === null);
  ok("⑦ 若開了跨通路 30 分：同一時間 Marketplace 那筆拿到提示", (describeClash(商品, 貼文, 開) || "").includes("一次只發一件"), describeClash(商品, 貼文, 開));
  ok("⑦ 同一時間：一般貼文那筆不吵（它先跑）", describeClash(貼文, 商品, 開) === null);
  ok("⑦ 提示裡有對方的名字與時間", (describeClash(商品, 貼文, 開) || "").includes("「覓蜜」") && (describeClash(商品, 貼文, 開) || "").includes("11:40"));

  const 商品早 = { ...商品, runAt: at(11, 0) };
  const 貼文晚 = { ...貼文, runAt: at(11, 20) };
  ok("⑦ 開了跨通路：Marketplace 11:00、一般貼文 11:20（差 20 < 30）→ 一般貼文那筆拿到提示", describeClash(貼文晚, 商品早, 開) != null);
  ok("⑦ 差 30 分（剛好隔滿）→ 不提示", describeClash({ ...貼文, runAt: at(11, 30) }, 商品早, 開) === null);
  const 商品2 = { id: "m2", title: "禾盛 MP", channel: "marketplace", runAt: at(11, 5) };
  ok("⑦ 兩筆 Marketplace 差 5 分也不提示（一次上架、不等）", describeClash(商品2, 商品, 開) === null);

  const 另一篇 = { id: "p2", title: "禾盛", channel: "post", runAt: at(12, 40) };
  ok("⑦ 兩篇一般貼文差 60（< 90）→ 後面那篇拿到提示", (describeClash(另一篇, 貼文) || "").includes("兩篇至少隔 90"));
  ok("⑦ 前面那篇不吵", describeClash(貼文, 另一篇) === null);
  ok("⑦ 差 100 分 → 不提示", describeClash({ ...另一篇, runAt: at(13, 20) }, 貼文) === null);
  ok("⑦ 自己跟自己不算", describeClash(貼文, { ...貼文 }) === null);

  const 更近 = { id: "p3", title: "更近的", channel: "post", runAt: at(12, 30) };
  const note = clashNoteFor(另一篇, [貼文, 更近, 商品]);
  ok("⑦ clashNoteFor 挑最近的那筆", note != null && note.includes("更近的"), note);
  ok("⑦ 沒撞回 null", clashNoteFor({ ...另一篇, runAt: at(18, 0) }, [貼文, 商品]) === null);
}

console.log(`\n${"─".repeat(60)}`);
console.log(`節奏保護測試：${pass} 過${fails.length ? `、${fails.length} 失敗` : ""}`);
for (const f of fails) console.log(`  ❌ ${f}`);
console.log("─".repeat(60));
// 不用 process.exit()：Node 24 在 Windows 上讀 .ts（type stripping）之後直接 exit 會踩到 libuv 的
// UV_HANDLE_CLOSING 斷言（離開碼變 3、npm test 會被誤判成失敗）。設 exitCode 讓它自然結束就好。
process.exitCode = fails.length ? 1 : 0;
