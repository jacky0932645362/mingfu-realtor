/**
 * 擬真模式（2026-09-18）—— 讓自動發文的「動作節奏」像一個人在用，不像排程器在跑
 *
 * 三件事，全部預設開：
 *   ① 隨機冷卻　　　社團之間的間隔、每一步之間的停頓都是隨機區間，不是固定值
 *   ② 發文時間抖動　開瀏覽器前先隨機等一小段（分鐘級的抖動在後台排程時就決定好，
 *                    存在 fb_task_run.jitter_sec，runner 要等到 run_at＋抖動才撈得到）
 *   ③ 滑鼠軌跡擬人化　點按鈕前先沿彎曲路徑把游標移過去、先快後慢、偶爾衝過頭再修正、
 *                    落點不在正中心、按下與放開之間有停頓；打字分小段、標點後會停一下；
 *                    進到頁面先「看一下」（捲一捲、晃一晃）再動手
 *
 * 🔴 這裡做的全部是「節奏」層面的事：不碰 navigator.webdriver、不改瀏覽器指紋、不換 IP。
 *    那些不是擬真、是偽裝，FB 一升級偵測就整包失效。真正決定帳號安不安全的還是
 *    發文量（FB_MAX_PER_DAY）、同一篇灌幾個社團、內容重複度、社團管理員有沒有檢舉 ——
 *    節奏擬真只是讓「人在用」這件事不要被一眼看穿，不是讓你可以灌更多。
 *
 * 🔴 每一個擬真動作都有「退路」：滑鼠點不到就退回 Playwright 的 locator.click()、
 *    抓不到座標也退回。擬真失敗絕對不能變成「發不出去」。
 *
 * 關掉：FB_HUMANIZE=0。測試用的 FB_FAST=1 也會一起關（假頁面不需要像人）。
 *
 * 可調（都在 card-booking/.env.local，不設就用預設）：
 *   FB_HUMANIZE=0                 整個關掉
 *   FB_GAP_JITTER=0.75-1.25       社團之間的間隔 ＝ FB_GROUP_GAP_MINUTES × 這個區間內的隨機倍數
 *                                 （基準 4 分 → 3～5 分，2026-09-19 本人拍板）
 *   FB_START_JITTER_MAX_SEC=45    runner 認領到工作後、開瀏覽器前先隨機等 0～N 秒
 */

/* ────────────────── 開關與設定 ────────────────── */

/** 擬真有沒有開。FB_FAST（端對端測試打假頁面）時一律關，假頁面不用像人。 */
export function humanizeOn() {
  if (process.env.FB_FAST) return false;
  return process.env.FB_HUMANIZE !== "0";
}

/** 社團之間間隔的隨機倍數區間，預設 0.75～1.25（基準 4 分鐘 → 3～5 分鐘）。 */
export function gapJitterRange() {
  const raw = String(process.env.FB_GAP_JITTER || "0.75-1.25");
  const m = raw.match(/^\s*([\d.]+)\s*[-~]\s*([\d.]+)\s*$/);
  let lo = m ? Number(m[1]) : 0.75;
  let hi = m ? Number(m[2]) : 1.25;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= 0) {
    lo = 0.75;
    hi = 1.25;
  }
  if (hi < lo) [lo, hi] = [hi, lo];
  return { lo, hi };
}

/** runner 開瀏覽器前的抖動上限（秒），預設 45。 */
export function startJitterMaxSec() {
  const n = Number(process.env.FB_START_JITTER_MAX_SEC ?? 45);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 600) : 45;
}

/** 一行字，給 log 用：現在的擬真設定長什麼樣。 */
export function humanizeSummary() {
  if (!humanizeOn()) return "擬真模式：關（FB_HUMANIZE=0 或 FB_FAST）";
  const { lo, hi } = gapJitterRange();
  return `擬真模式：開｜滑鼠曲線＋分段打字＋先看頁面｜社團間隔 ×${lo}～${hi}｜開跑前抖動 0～${startJitterMaxSec()} 秒`;
}

/* ────────────────── 亂數工具（純函式，可測） ────────────────── */

export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

export function rand(min, max) {
  return min + Math.random() * (max - min);
}

export function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

/** 常態分佈（Box-Muller）再夾在 [lo, hi]。點按鈕落點用：大多在中間、偶爾偏一點，但不會點到邊緣外。 */
export function gaussClamp(mean, sd, lo, hi) {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(hi, Math.max(lo, mean + z * sd));
}

/** 先加速後減速（人移滑鼠就是這樣，不是等速）。 */
export function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/* ────────────────── ① 隨機冷卻 ────────────────── */

/**
 * 社團之間要隔幾分鐘：基準 × 隨機倍數，取一位小數。
 * 基準 0（測試）就永遠 0；擬真關掉就回基準值本身。
 */
export function jitterGapMinutes(baseMinutes) {
  const base = Number(baseMinutes) || 0;
  if (base <= 0 || !humanizeOn()) return base;
  const { lo, hi } = gapJitterRange();
  return Math.round(base * rand(lo, hi) * 10) / 10;
}

/* ────────────────── ② 發文時間抖動（runner 端那半） ────────────────── */

/** runner 認領到工作後，開瀏覽器前先等幾秒。擬真關掉或上限 0 就不等。 */
export function startJitterSec() {
  if (!humanizeOn()) return 0;
  const max = startJitterMaxSec();
  return max > 0 ? randInt(0, max) : 0;
}

/* ────────────────── ③ 滑鼠軌跡 ────────────────── */

/** 每個 page 的「游標現在在哪」。Playwright 不會告訴你，只能自己記。 */
const 游標位置 = new WeakMap();

function 目前位置(page) {
  let p = 游標位置.get(page);
  if (!p) {
    const vp = page.viewportSize?.() || { width: 1280, height: 800 };
    p = { x: rand(vp.width * 0.3, vp.width * 0.7), y: rand(vp.height * 0.3, vp.height * 0.7) };
    游標位置.set(page, p);
  }
  return p;
}

function cubic(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
  };
}

/**
 * 從 from 到 to 的一條彎曲路徑（三次貝茲曲線＋手抖），回傳一串座標點。
 * 純函式：不碰瀏覽器，測試直接驗「起點對、終點對、點數合理、中段真的有彎」。
 *
 * - 兩個控制點沿路徑 25～45％、55～80％ 處，往垂直方向偏一段（越遠偏越多）
 * - 點與點之間先密後疏再密（easeInOut）＝ 先加速後減速
 * - 中段加 ±1.5px 的手抖，越接近終點抖越小，最後一點強制等於目標（不然會點歪）
 */
export function bezierPath(from, to, { steps, wobble = 1 } = {}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const n = steps ?? Math.min(70, Math.max(6, Math.round(dist / rand(7, 12))));
  const len = dist || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const off1 = rand(-0.25, 0.25) * dist * wobble;
  const off2 = rand(-0.2, 0.2) * dist * wobble;
  const t1 = rand(0.25, 0.45);
  const t2 = rand(0.55, 0.8);
  const c1 = { x: from.x + dx * t1 + nx * off1, y: from.y + dy * t1 + ny * off1 };
  const c2 = { x: from.x + dx * t2 + nx * off2, y: from.y + dy * t2 + ny * off2 };

  const pts = [];
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const p = cubic(from, c1, c2, to, easeInOut(u));
    const shake = (1 - u) * 1.5;
    pts.push({ x: p.x + rand(-shake, shake), y: p.y + rand(-shake, shake) });
  }
  pts[pts.length - 1] = { x: to.x, y: to.y };
  return pts;
}

/**
 * 把游標沿曲線移到 (x, y)。三成機率會衝過頭 3～8px 再拉回來（人常這樣）。
 * 每一步之間睡幾毫秒，接近終點放慢。
 */
export async function humanMove(page, x, y) {
  const from = 目前位置(page);
  const to = { x, y };
  const dist = Math.hypot(to.x - from.x, to.y - from.y);

  // 太近就不用演了，直接過去
  if (dist < 3) {
    await page.mouse.move(to.x, to.y);
    游標位置.set(page, to);
    return;
  }

  let 終點 = to;
  let 衝過頭 = null;
  if (dist > 60 && Math.random() < 0.3) {
    const k = rand(3, 8) / dist;
    衝過頭 = { x: to.x + (to.x - from.x) * k, y: to.y + (to.y - from.y) * k };
    終點 = 衝過頭;
  }

  const pts = bezierPath(from, 終點);
  for (const [i, p] of pts.entries()) {
    await page.mouse.move(p.x, p.y);
    const 尾段 = i / pts.length > 0.8;
    await sleep(rand(4, 12) * (尾段 ? 1.8 : 1));
  }
  if (衝過頭) {
    await sleep(rand(30, 90));
    for (const p of bezierPath(衝過頭, to, { steps: randInt(3, 6), wobble: 0.3 })) {
      await page.mouse.move(p.x, p.y);
      await sleep(rand(8, 18));
    }
  }
  游標位置.set(page, to);
}

/**
 * 像人一樣點一個元素：捲到看得見 → 抓外框 → 落點常態分佈在中間附近 → 曲線移過去 →
 * 停一下 → 按下、停 45～130ms、放開。
 *
 * 回傳 "human"（真的用滑鼠點的）或 "fallback"（退回 Playwright 的 click）。
 * 退回的情況：擬真關掉、抓不到外框、外框太小、落點被別的東西蓋住（elementFromPoint
 * 不是這個元素）、任何一步出錯。🔴 退回是常態設計，不是錯誤 —— 擬真絕不能害貼文發不出去。
 */
export async function humanClick(page, locator, { timeout = 30000 } = {}) {
  if (!humanizeOn()) {
    await locator.click({ timeout });
    return "fallback";
  }
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: Math.min(timeout, 4000) }).catch(() => {});
    await sleep(rand(80, 260));
    const box = await locator.boundingBox({ timeout: 2000 }).catch(() => null);
    if (!box || box.width < 2 || box.height < 2) {
      await locator.click({ timeout });
      return "fallback";
    }
    const x = box.x + box.width * gaussClamp(0.5, 0.14, 0.2, 0.8);
    const y = box.y + box.height * gaussClamp(0.5, 0.14, 0.2, 0.8);

    await humanMove(page, x, y);

    // 落點要真的打得到這個元素（不是被浮層／別的按鈕蓋住）。打不到就交給 Playwright，
    // 它會自己處理捲動、等穩定、重試那些事。
    // 只認「就是它或它的子孫」—— 打到祖先（例如整個 dialog）代表這一點其實不在它身上。
    const 打得到 = await locator
      .evaluate(
        (el, pt) => {
          const hit = document.elementFromPoint(pt.x, pt.y);
          return Boolean(hit) && (hit === el || el.contains(hit));
        },
        { x, y },
      )
      .catch(() => false);
    if (!打得到) {
      await locator.click({ timeout });
      return "fallback";
    }

    await sleep(rand(60, 220));
    await page.mouse.click(x, y, { delay: randInt(45, 130) });
    return "human";
  } catch {
    await locator.click({ timeout });
    return "fallback";
  }
}

/* ────────────────── ③ 打字 ────────────────── */

/** 不能在這種字元前面切段：切了 emoji 會暫時變成兩坨（最後結果一樣，但不像人）。 */
const 黏著字元 = (cp) =>
  cp === 0x200d || // ZWJ（👨‍👩‍👧 那種組合 emoji 的黏著劑）
  cp === 0xfe0f || // 變體選擇子
  (cp >= 0x1f3fb && cp <= 0x1f3ff) || // 膚色
  (cp >= 0x0300 && cp <= 0x036f) || // 組合用變音符號
  (cp >= 0xe0020 && cp <= 0xe007f); // tag 序列（🏴 那類旗幟）

const 區域指示 = (cp) => cp >= 0x1f1e6 && cp <= 0x1f1ff; // 🇹🇼 是兩個區域指示符

/**
 * 把一行字切成「一次打 2～6 個字」的小段（純函式，可測）。
 * 不會把 emoji 的組合序列切開、不會把國旗切成兩半。
 */
export function splitBursts(line, { min = 2, max = 6 } = {}) {
  const cps = Array.from(String(line));
  const out = [];
  let i = 0;
  while (i < cps.length) {
    let n = randInt(min, max);
    let end = Math.min(cps.length, i + n);
    // 往後延到一個「安全的切點」
    while (end < cps.length) {
      const prev = cps[end - 1].codePointAt(0);
      const next = cps[end].codePointAt(0);
      const 不能切 = 黏著字元(next) || prev === 0x200d || (區域指示(prev) && 區域指示(next));
      if (!不能切) break;
      end++;
    }
    out.push(cps.slice(i, end).join(""));
    i = end;
  }
  return out;
}

/**
 * 像人一樣把多行內文打進「已經點進去、有焦點」的輸入框。
 *
 * 換行用 Shift+Enter（跟原本 post.mjs 一樣：FB 的 Lexical 編輯器 Enter 會直接送出）。
 * 每一小段用 keyboard.insertText —— 跟原本每行一次的做法是同一種事件，只是切細＋有停頓，
 * FB 需要的 beforeinput／input 事件一樣會觸發。標點後停久一點、偶爾整行打完停下來想一下。
 *
 * 擬真關掉時退回原本的「一行一次」做法，速度跟以前一樣。
 */
export async function humanType(page, text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const on = humanizeOn();
  for (const [i, line] of lines.entries()) {
    if (i > 0) {
      await page.keyboard.press("Shift+Enter");
      await sleep(on ? rand(120, 420) : rand(60, 160));
    }
    if (!line) continue;
    if (!on) {
      await page.keyboard.insertText(line);
      await sleep(rand(60, 160));
      continue;
    }
    for (const chunk of splitBursts(line)) {
      await page.keyboard.insertText(chunk);
      await sleep(rand(45, 150));
      if (/[，。！？、；：,.!?;:]$/u.test(chunk)) await sleep(rand(180, 550));
    }
    if (Math.random() < 0.2) await sleep(rand(400, 1200)); // 偶爾停下來想一下
  }
}

/* ────────────────── ③ 進頁面先看一下、等東西時晃一晃 ────────────────── */

/**
 * 剛進到一個頁面時「看一下」：游標晃到畫面裡、往下捲一兩次、停一下、再捲回最上面。
 * 人不會一進社團零點幾秒就開始打字。擬真關掉就什麼都不做。
 */
export async function humanBrowse(page) {
  if (!humanizeOn()) return;
  try {
    const vp = page.viewportSize?.() || { width: 1280, height: 800 };
    await humanMove(page, rand(vp.width * 0.3, vp.width * 0.7), rand(vp.height * 0.3, vp.height * 0.7));
    await sleep(rand(300, 900));
    let total = 0;
    const 次數 = randInt(1, 2);
    for (let i = 0; i < 次數; i++) {
      const dy = randInt(180, 520);
      await page.mouse.wheel(0, dy);
      total += dy;
      await sleep(rand(700, 1800));
    }
    await sleep(rand(300, 900));
    await page.mouse.wheel(0, -(total + 300)); // 多捲一點，保證回到最上面
    await sleep(rand(500, 1100));
  } catch {
    // 看一下失敗（例如假頁面不能捲）沒關係，不影響發文
  }
}

/**
 * 等一段時間（min～max 毫秒），等的時候偶爾把游標小幅晃一下 —— 上傳照片、等視窗出現
 * 這種時候人不會把手放開完全不動。擬真關掉就單純等。
 */
export async function idle(page, minMs, maxMs = minMs) {
  const total = rand(minMs, maxMs);
  if (!humanizeOn()) return sleep(total);
  const end = Date.now() + total;
  while (Date.now() < end) {
    await sleep(Math.min(end - Date.now(), rand(300, 900)));
    if (Math.random() < 0.5) {
      try {
        const p = 目前位置(page);
        await humanMove(page, p.x + rand(-60, 60), p.y + rand(-40, 40));
      } catch {
        // 晃不動就算了
      }
    }
  }
}
