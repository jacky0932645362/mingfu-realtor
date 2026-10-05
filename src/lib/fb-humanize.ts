/**
 * FB 貼文工廠 —— 擬真模式，後台這一半（2026-09-18）
 *
 * 桌機那一半（滑鼠曲線、分段打字、社團間隔隨機、開跑前秒級抖動）在 tools/fb-autopost/humanize.mjs。
 * 這裡是「排程時就決定好」的兩件事：
 *   ① 發文時間抖動：排程當下抽一個 0～上限 的秒數存進 fb_task_run.jitter_sec，
 *      runner 要等到 run_at ＋ 抖動 才撈得到 —— 「每天 10:00 準時發」在 FB 眼裡會變成 10:03、10:17、10:09……
 *      存進資料庫而不是 runner 現場抽，是為了讓排程頁能把「大約幾點開始」講清楚，
 *      也讓 5 分鐘一輪的工作排程器不用自己 sleep。「立即發佈」一律不抖。
 *   ② 社團冷卻天數隨機加碼：冷卻 7 天不是剛好 7 天，是 7～10 天，每次貼完重抽
 *      （用「社團 id ＋ 上次貼的時間」決定，頁面重整不會跳）。同一個社團永遠剛好每 7 天一篇，
 *      跟排程器沒兩樣；人不會這麼準。
 *
 * 刻意不 import 資料庫 —— 全是純函式，測試不用連 DB。
 *
 * 可調（.env.local；線上要在 Vercel 設）：
 *   FB_JITTER_MAX_MINUTES=0       排程時間抖動上限（分）。🔴 預設 0＝關（2026-09-19 本人拍板：
 *                                 「我自己設定好時間去規劃發布」，排定幾點就幾點，不要多出時間）。
 *                                 想要抖動再自己設，例如 20。
 *   FB_COOLDOWN_JITTER_RATIO=0.5  冷卻加碼比例，0 = 關
 */

function envNumber(name: string, fallback: number, lo: number, hi: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

/**
 * 排程時間抖動上限（分鐘）。**預設 0 ＝ 關。**
 * 2026-09-19 本人看到排程列「11:40 · 擬真 +13 分（約 11:52 開始）」之後拍板：他自己規劃發布時間，
 * 排定幾點就幾點，不要程式多加時間。程式碼全部留著（欄位、認領 SQL、顯示都在），
 * 想開再在 .env.local 設 FB_JITTER_MAX_MINUTES=20 就回來。
 */
export const JITTER_MAX_MINUTES = envNumber("FB_JITTER_MAX_MINUTES", 0, 0, 180);

/** 社團冷卻天數的隨機加碼比例。0 = 關。 */
export const COOLDOWN_JITTER_RATIO = envNumber("FB_COOLDOWN_JITTER_RATIO", 0.5, 0, 2);

/** 抽一個抖動秒數（0 ～ 上限分鐘 × 60）。上限 0 就永遠 0。 */
export function rollJitterSec(maxMinutes: number = JITTER_MAX_MINUTES): number {
  if (!(maxMinutes > 0)) return 0;
  return Math.floor(Math.random() * maxMinutes * 60);
}

/** FNV-1a 32 位元雜湊。決定性的「隨機」用：同樣的輸入永遠同一個數，頁面重整不會變。 */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 這個社團「這一輪」實際要冷卻幾天：設定值 ＋ 決定性的隨機加碼（0 ～ ceil(設定值 × 比例)）。
 * 沒貼過、冷卻 0 天、比例 0 → 就是設定值本身。
 */
export function effectiveCooldownDays(
  groupId: string,
  cooldownDays: number,
  lastPosted: Date | undefined,
  ratio: number = COOLDOWN_JITTER_RATIO,
): number {
  if (!(cooldownDays > 0) || !lastPosted || !(ratio > 0)) return cooldownDays;
  const extraMax = Math.ceil(cooldownDays * ratio);
  const extra = hash32(`${groupId}|${lastPosted.getTime()}`) % (extraMax + 1);
  return cooldownDays + extra;
}

/** 排程頁／訊息用：「10:00～10:20 之間開始」這種說法。上限 0 就回空字串。 */
export function jitterWindowLabel(runAt: Date, maxMinutes: number = JITTER_MAX_MINUTES): string {
  if (!(maxMinutes > 0)) return "";
  const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const end = new Date(runAt.getTime() + maxMinutes * 60_000);
  return `${hm(runAt)}～${hm(end)} 之間開始`;
}
