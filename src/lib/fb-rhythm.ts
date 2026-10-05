/**
 * FB 貼文工廠 —— 節奏保護的「純判斷」（2026-09-19）
 *
 * 起因：本人問「一般貼文跟 Marketplace 不小心排到同一時間會怎樣？」查下去發現兩個洞：
 *   ① post.mjs 自己的「兩篇隔 90 分」「一天最多 N 次」是看 posts/*.md 算的，但 runner 每做完
 *      一份工作就把 task-xxxx.md 刪掉 → 做完的那些它就看不到了，等於 runner 模式下這兩條
 *      只在「同一份工作裡」有效。
 *   ② Marketplace 根本不在 posts/ 那本帳裡：一般貼文剛發完，Marketplace 立刻接著刊登，
 *      反過來也一樣，中間零間隔。
 * 所以在「認領」那一步用資料庫再擋一次（資料層在 fb-factory.ts 的 rhythmSnapshot／claimHoldReason，
 * 這裡只放不碰資料庫的判斷，測試不用連 DB）：
 *   ・一般貼文 ↔ 一般貼文（不同任務）：至少隔 FB_MIN_GAP_MINUTES（預設 90）
 *   ・一般貼文 ↔ Marketplace（跨通路）：至少隔 FB_CHANNEL_GAP_MINUTES（預設 0 ＝ 不管）
 *   ・今天發到的地方（動態＋社團）≥ FB_MAX_PER_DAY → 今天不再認領（預設 0 ＝ 不設限）
 *   ・Marketplace 本身不受任何間隔／上限管 —— 2026-09-19 本人拍板：「Marketplace 就一次上架即可，
 *     本來就可以勾 20 個社團做一次性的上架」。它只跟其他工作排隊（一次一個瀏覽器），不等間隔。
 * 同一份工作接著發剩下的社團不受這裡管（那是 post.mjs 裡的 GROUP_GAP，3～5 分）。
 *
 * 2026-09-19 本人拍板後的預設：每日上限 0（不設限）、跨通路 0（不管）；只剩「兩篇不同文案隔 90 分」還在。
 * 擋住時任務維持「等時間到」，下一輪（5 分鐘後）再看 —— 不會失敗、不會消失、不會同時開兩個瀏覽器。
 *
 * 同一時間到期時誰先：runner 一輪固定順序「一般貼文 → Marketplace → 刪文」，所以平手是一般貼文先。
 */

function envNumber(name: string, fallback: number, lo: number, hi: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

/** 兩個「不同任務」的一般貼文（或兩筆 Marketplace）之間至少隔幾分鐘。跟 post.mjs 讀同一個環境變數。 */
export const MIN_GAP_MINUTES = envNumber("FB_MIN_GAP_MINUTES", 90, 0, 1440);
/** 一般貼文 ↔ Marketplace 之間至少隔幾分鐘。預設 0 ＝ 不管（本人拍板 Marketplace 一次上架、獨立看待）。 */
export const CHANNEL_GAP_MINUTES = envNumber("FB_CHANNEL_GAP_MINUTES", 0, 0, 1440);
/** 一天最多發到幾個地方（動態、每個社團各算一次）。預設 0 ＝ 不設限（本人拍板）。跟 post.mjs 讀同一個環境變數。 */
export const MAX_PER_DAY = envNumber("FB_MAX_PER_DAY", 0, 0, 1000);

export type RhythmChannel = "post" | "marketplace";

/** 資料庫抓回來的「最近發生了什麼」。 */
export type RhythmSnapshot = {
  /** 最近一次真的發到動態／社團（fb_task_item.done_at）。 */
  lastFeedAt: Date | null;
  /** 那一次是哪份工作 —— 同一份工作接著發剩下的社團不算「另一篇」。 */
  lastFeedTaskId: string | null;
  /** 最近一次 Marketplace 刊登完成（fb_task_run.finished_at）。 */
  lastMarketplaceAt: Date | null;
  /** 今天已經發到幾個地方。 */
  postedToday: number;
};

const 分鐘前 = (d: Date | null, now: Date) => (d ? (now.getTime() - d.getTime()) / 60_000 : Infinity);
const 還要等 = (need: number, ago: number) => `還要等約 ${Math.max(1, Math.ceil(need - ago))} 分`;

/**
 * 這個通路現在能不能認領。能 → null；不能 → 一句人看得懂的原因（runner 會印出來、排程頁也用）。
 * taskId 是候選任務：同一份工作接著發剩下的社團，不套「兩篇隔 90 分」。
 */
export function rhythmHold(
  channel: RhythmChannel,
  snap: RhythmSnapshot,
  taskId: string | null,
  now: Date = new Date(),
  limits: { minGap?: number; channelGap?: number; maxPerDay?: number } = {},
): string | null {
  const minGap = limits.minGap ?? MIN_GAP_MINUTES;
  const channelGap = limits.channelGap ?? CHANNEL_GAP_MINUTES;
  const maxPerDay = limits.maxPerDay ?? MAX_PER_DAY;

  const feedAgo = 分鐘前(snap.lastFeedAt, now);
  const mpAgo = 分鐘前(snap.lastMarketplaceAt, now);

  // Marketplace：一次上架，不算次數、不等 90 分；只有本人另外設了跨通路間隔才等一般貼文
  if (channel === "marketplace") {
    if (channelGap > 0 && feedAgo < channelGap) {
      return `一般貼文 ${Math.round(feedAgo)} 分鐘前才發，跨通路至少隔 ${channelGap} 分（FB_CHANNEL_GAP_MINUTES），${還要等(channelGap, feedAgo)}`;
    }
    return null;
  }

  const 同一份工作在續發 = taskId != null && snap.lastFeedTaskId === taskId;

  // 一天上限（0 ＝ 不設限）。設了就對「續發剩下的社團」也一樣算：上限就是上限
  if (maxPerDay > 0 && snap.postedToday >= maxPerDay) {
    return `今天已經發到 ${snap.postedToday} 個地方，到一天上限 ${maxPerDay}（FB_MAX_PER_DAY）了，明天再繼續`;
  }
  if (channelGap > 0 && mpAgo < channelGap) {
    return `Marketplace ${Math.round(mpAgo)} 分鐘前才刊登，跨通路至少隔 ${channelGap} 分（FB_CHANNEL_GAP_MINUTES），${還要等(channelGap, mpAgo)}`;
  }
  if (minGap > 0 && !同一份工作在續發 && feedAgo < minGap) {
    return `上一篇 ${Math.round(feedAgo)} 分鐘前才發，兩篇至少隔 ${minGap} 分（FB_MIN_GAP_MINUTES），${還要等(minGap, feedAgo)}`;
  }
  return null;
}

export type ScheduledLite = { id: string; title: string; channel: string; runAt: Date };

/**
 * 排程時的「撞時段」提示：me 跟 other 排得太近時，回一句給 me 看的說明；沒撞就 null。
 * 只提示「會被排在後面」的那一筆（先跑的那筆不用被吵）。誰先：時間早的先；同時 → 一般貼文先。
 */
export function describeClash(
  me: ScheduledLite,
  other: ScheduledLite,
  limits: { minGap?: number; channelGap?: number } = {},
): string | null {
  if (me.id === other.id) return null;
  const minGap = limits.minGap ?? MIN_GAP_MINUTES;
  const channelGap = limits.channelGap ?? CHANNEL_GAP_MINUTES;
  const diff = Math.abs(me.runAt.getTime() - other.runAt.getTime()) / 60_000;
  const 跨通路 = me.channel !== other.channel;
  // 兩筆 Marketplace 之間不等間隔（一次上架），所以同通路只有一般貼文對一般貼文會提示
  if (!跨通路 && me.channel === "marketplace") return null;
  const gap = 跨通路 ? channelGap : minGap;
  if (!(gap > 0) || diff >= gap) return null;

  // 我是不是排在後面的那個
  const 我後面 =
    me.runAt.getTime() > other.runAt.getTime() ||
    (me.runAt.getTime() === other.runAt.getTime() && me.channel === "marketplace" && other.channel === "post");
  if (!我後面) return null;

  const hm = `${String(other.runAt.getHours()).padStart(2, "0")}:${String(other.runAt.getMinutes()).padStart(2, "0")}`;
  const 他 = `「${other.title}」（${other.channel === "post" ? "一般貼文" : "Marketplace"} ${hm}）`;
  return 跨通路
    ? `跟 ${他} 只差 ${Math.round(diff)} 分：桌機一次只發一件，這筆會等它發完、再隔滿 ${channelGap} 分才發`
    : `跟 ${他} 只差 ${Math.round(diff)} 分：兩篇至少隔 ${minGap} 分，這筆會等它發完、隔滿 ${minGap} 分才發`;
}

/** 對一群待跑的任務，找出 me 的撞時段說明（最多回最近的一筆）。 */
export function clashNoteFor(me: ScheduledLite, others: ScheduledLite[]): string | null {
  let best: { diff: number; note: string } | null = null;
  for (const o of others) {
    const note = describeClash(me, o);
    if (!note) continue;
    const diff = Math.abs(me.runAt.getTime() - o.runAt.getTime());
    if (!best || diff < best.diff) best = { diff, note };
  }
  return best?.note ?? null;
}
