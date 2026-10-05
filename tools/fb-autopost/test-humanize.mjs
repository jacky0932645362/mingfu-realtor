/**
 * 擬真模式的離線測試（不開瀏覽器、不碰資料庫、不碰 FB）
 *
 * 跑法：node test-humanize.mjs
 *
 * 驗的是「純函式的性質」：區間對不對、切字有沒有把 emoji 切壞、曲線起點終點對不對、
 * 關掉的時候是不是真的退回原本的行為。滑鼠／打字那兩支用假的 page／locator 記下它們呼叫了什麼。
 * 真的在瀏覽器裡跑得動不動，由 test-post-e2e.mjs（假 FB 頁面）順便驗。
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  humanizeOn,
  gapJitterRange,
  startJitterMaxSec,
  humanizeSummary,
  jitterGapMinutes,
  startJitterSec,
  bezierPath,
  easeInOut,
  gaussClamp,
  splitBursts,
  humanClick,
  humanType,
  humanBrowse,
  idle,
  humanMove,
} from "./humanize.mjs";

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${name}${extra ? `　→ ${extra}` : ""}`);
};
const 設環境 = (patch) => {
  for (const k of ["FB_HUMANIZE", "FB_FAST", "FB_GAP_JITTER", "FB_START_JITTER_MAX_SEC"]) delete process.env[k];
  Object.assign(process.env, patch);
};

/* ── ① 開關 ── */
設環境({});
ok("① 預設是開的", humanizeOn() === true);
設環境({ FB_HUMANIZE: "0" });
ok("① FB_HUMANIZE=0 關掉", humanizeOn() === false);
設環境({ FB_FAST: "1" });
ok("① FB_FAST 也關掉（測試用假頁面不用像人）", humanizeOn() === false);
設環境({});
ok("① 摘要講得出開", humanizeSummary().includes("開"));
設環境({ FB_HUMANIZE: "0" });
ok("① 摘要講得出關", humanizeSummary().includes("關"));

/* ── ② 隨機冷卻：社團間隔 ── */
設環境({});
{
  const r = gapJitterRange();
  ok("② 預設倍數 0.75～1.25（基準 4 分 → 3～5 分，本人拍板）", r.lo === 0.75 && r.hi === 1.25, JSON.stringify(r));
  設環境({ FB_GAP_JITTER: "1-2" });
  ok("② 可以用環境變數改", gapJitterRange().lo === 1 && gapJitterRange().hi === 2);
  設環境({ FB_GAP_JITTER: "2-1" });
  ok("② 反過來寫也會自己排好", gapJitterRange().lo === 1 && gapJitterRange().hi === 2);
  設環境({ FB_GAP_JITTER: "亂寫" });
  ok("② 亂寫退回預設", gapJitterRange().lo === 0.75 && gapJitterRange().hi === 1.25);
  設環境({ FB_GAP_JITTER: "0-0" });
  ok("② 0 不合法退回預設", gapJitterRange().lo === 0.75);
  設環境({});

  const 樣本 = Array.from({ length: 500 }, () => jitterGapMinutes(4));
  ok("② 基準 4 分 → 全部落在 3～5 分", 樣本.every((m) => m >= 3 && m <= 5), `${Math.min(...樣本)}～${Math.max(...樣本)}`);
  ok("② 真的有隨機（500 次不會全一樣）", new Set(樣本).size > 10, `只有 ${new Set(樣本).size} 種`);
  ok("② 取到一位小數", 樣本.every((m) => Math.round(m * 10) === m * 10));
  ok("② 有落到 4 以下也有落到 4 以上", 樣本.some((m) => m < 4) && 樣本.some((m) => m > 4));
  ok("② 3 分與 5 分附近都碰得到（不是縮在中間）", 樣本.some((m) => m <= 3.3) && 樣本.some((m) => m >= 4.7));
  ok("② 基準 0（測試環境）永遠 0", jitterGapMinutes(0) === 0);
  設環境({ FB_HUMANIZE: "0" });
  ok("② 關掉就是基準值本身", jitterGapMinutes(8) === 8);
  設環境({});
}

/* ── ③ 開跑前秒級抖動 ── */
{
  ok("③ 預設上限 45 秒", startJitterMaxSec() === 45);
  const 樣本 = Array.from({ length: 300 }, () => startJitterSec());
  ok("③ 全部是 0～45 的整數", 樣本.every((s) => Number.isInteger(s) && s >= 0 && s <= 45));
  ok("③ 不是每次都同一個數", new Set(樣本).size > 10);
  設環境({ FB_START_JITTER_MAX_SEC: "0" });
  ok("③ 上限 0 就不等", startJitterSec() === 0);
  設環境({ FB_START_JITTER_MAX_SEC: "9999" });
  ok("③ 上限最多 600 秒（防手滑打太大）", startJitterMaxSec() === 600);
  設環境({ FB_HUMANIZE: "0" });
  ok("③ 關掉就不等", startJitterSec() === 0);
  設環境({});
}

/* ── ④ 曲線 ── */
{
  ok("④ easeInOut 起點 0 終點 1 中點 0.5", easeInOut(0) === 0 && easeInOut(1) === 1 && Math.abs(easeInOut(0.5) - 0.5) < 1e-9);
  let 單調 = true;
  for (let i = 1; i <= 100; i++) if (easeInOut(i / 100) < easeInOut((i - 1) / 100)) 單調 = false;
  ok("④ easeInOut 單調遞增（不會倒退）", 單調);

  const g = Array.from({ length: 2000 }, () => gaussClamp(0.5, 0.14, 0.2, 0.8));
  ok("④ 落點常態分佈夾在 0.2～0.8", g.every((v) => v >= 0.2 && v <= 0.8));
  const 靠中間 = g.filter((v) => v > 0.35 && v < 0.65).length / g.length;
  ok("④ 落點大多在中間附近（>60%）", 靠中間 > 0.6, String(靠中間));

  const from = { x: 100, y: 100 };
  const to = { x: 700, y: 400 };
  const pts = bezierPath(from, to);
  ok("④ 最後一點剛好是目標（不會點歪）", pts.at(-1).x === to.x && pts.at(-1).y === to.y);
  ok("④ 點數在 6～70 之間", pts.length >= 6 && pts.length <= 70, String(pts.length));
  ok("④ 第一點已經離開起點", pts[0].x !== from.x || pts[0].y !== from.y);
  // 中段真的有彎：找離「直線」最遠的點，至少要偏離幾個像素
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const 偏離 = (p) => Math.abs((to.y - from.y) * p.x - (to.x - from.x) * p.y + to.x * from.y - to.y * from.x) / dist;
  const 最大偏離 = Math.max(...pts.map(偏離));
  ok("④ 不是一條直線（有彎）", 最大偏離 > 3, `最大偏離 ${最大偏離.toFixed(1)}px`);
  ok("④ 也沒有彎到離譜（< 距離的 40%）", 最大偏離 < dist * 0.4, `最大偏離 ${最大偏離.toFixed(1)}px`);
  ok("④ steps 指定幾點就幾點", bezierPath(from, to, { steps: 9 }).length === 9);
  const 短 = bezierPath({ x: 10, y: 10 }, { x: 20, y: 12 });
  ok("④ 很短的距離也至少 6 點、終點對", 短.length >= 6 && 短.at(-1).x === 20 && 短.at(-1).y === 12);
  // 兩條路徑不會一模一樣（每次都重抽控制點）
  const 另一條 = bezierPath(from, to, { steps: pts.length });
  ok("④ 每次路徑不一樣", JSON.stringify(另一條) !== JSON.stringify(pts));
}

/* ── ⑤ 切字 ── */
{
  const 行 = "梧棲 698 萬，買得到 2房2廳1衛＋平面車位？📍 民族路，🚗 平車";
  const chunks = splitBursts(行);
  ok("⑤ 拼回去一模一樣", chunks.join("") === 行);
  ok("⑤ 每段 2～6 個字（最後一段可以更短）", chunks.slice(0, -1).every((c) => Array.from(c).length >= 2 && Array.from(c).length <= 6), chunks.map((c) => Array.from(c).length).join(","));
  ok("⑤ 真的有切成好幾段", chunks.length >= 5, String(chunks.length));

  const 家庭 = "看房👨‍👩‍👧全家一起來看看吧";
  let 沒切壞 = true;
  for (let i = 0; i < 200; i++) {
    const cs = splitBursts(家庭);
    if (cs.join("") !== 家庭) 沒切壞 = false;
    if (!cs.some((c) => c.includes("👨‍👩‍👧"))) 沒切壞 = false; // 整個組合 emoji 要在同一段
  }
  ok("⑤ 組合 emoji（ZWJ）不會被切成兩坨", 沒切壞);

  const 國旗 = "台灣🇹🇼海線的房子";
  let 旗沒切壞 = true;
  for (let i = 0; i < 200; i++) {
    const cs = splitBursts(國旗);
    if (!cs.some((c) => c.includes("🇹🇼"))) 旗沒切壞 = false;
  }
  ok("⑤ 國旗（兩個區域指示符）不會被切成兩半", 旗沒切壞);

  const 愛心 = "喜歡就❤️留言";
  let 心沒切壞 = true;
  for (let i = 0; i < 200; i++) {
    const cs = splitBursts(愛心);
    if (!cs.some((c) => c.includes("❤️"))) 心沒切壞 = false;
  }
  ok("⑤ 變體選擇子（❤️）不會被切開", 心沒切壞);

  ok("⑤ 空字串 → 空陣列", splitBursts("").length === 0);
  ok("⑤ 一個字 → 一段", splitBursts("好").length === 1 && splitBursts("好")[0] === "好");
}

/* ── ⑥ 打字（假鍵盤） ── */
function 假page() {
  const 紀錄 = [];
  return {
    紀錄,
    viewportSize: () => ({ width: 1200, height: 800 }),
    keyboard: {
      press: async (k) => 紀錄.push(["press", k]),
      insertText: async (t) => 紀錄.push(["insert", t]),
    },
    mouse: {
      move: async (x, y) => 紀錄.push(["move", x, y]),
      click: async (x, y, o) => 紀錄.push(["click", x, y, o]),
      wheel: async (dx, dy) => 紀錄.push(["wheel", dx, dy]),
    },
  };
}
{
  const 內文 = "梧棲 698 萬買得到高樓海景兩房平車？\n\n第三行，內容比較長一點，才切得出好幾段。\n最後一行也要有點長度才對";
  設環境({ FB_HUMANIZE: "0" });
  let page = 假page();
  await humanType(page, 內文);
  const 關 = page.紀錄;
  ok("⑥ 關掉時：一行一次 insertText（跟原本一樣）", 關.filter((r) => r[0] === "insert").length === 3, JSON.stringify(關));
  ok("⑥ 關掉時：Shift+Enter 換行 3 次（含空行）", 關.filter((r) => r[0] === "press" && r[1] === "Shift+Enter").length === 3);
  ok("⑥ 關掉時：拼回去等於原文", 關.filter((r) => r[0] === "insert").map((r) => r[1]).join("") === 內文.replace(/\n/g, ""));

  設環境({});
  page = 假page();
  const t0 = Date.now();
  await humanType(page, 內文);
  const 開 = page.紀錄;
  ok("⑥ 開著時：切成很多小段", 開.filter((r) => r[0] === "insert").length >= 5, String(開.filter((r) => r[0] === "insert").length));
  ok("⑥ 開著時：拼回去還是原文", 開.filter((r) => r[0] === "insert").map((r) => r[1]).join("") === 內文.replace(/\n/g, ""));
  ok("⑥ 開著時：換行次數一樣是 3", 開.filter((r) => r[0] === "press").length === 3);
  ok("⑥ 開著時：真的有節奏（不是零秒打完）", Date.now() - t0 >= 300, `${Date.now() - t0}ms`);
}

/* ── ⑦ 點擊（假 locator） ── */
function 假locator({ box = { x: 100, y: 200, width: 200, height: 40 }, 打得到 = true } = {}) {
  const 紀錄 = [];
  return {
    紀錄,
    scrollIntoViewIfNeeded: async () => 紀錄.push(["scroll"]),
    boundingBox: async () => box,
    evaluate: async () => 打得到,
    click: async (o) => 紀錄.push(["locator.click", o]),
  };
}
{
  設環境({ FB_HUMANIZE: "0" });
  let page = 假page();
  let loc = 假locator();
  let r = await humanClick(page, loc, { timeout: 1234 });
  ok("⑦ 關掉時：直接 locator.click，帶原本的 timeout", r === "fallback" && loc.紀錄.some((x) => x[0] === "locator.click" && x[1]?.timeout === 1234));
  ok("⑦ 關掉時：完全不動滑鼠", page.紀錄.length === 0);

  設環境({});
  page = 假page();
  loc = 假locator();
  r = await humanClick(page, loc);
  const moves = page.紀錄.filter((x) => x[0] === "move");
  const clicks = page.紀錄.filter((x) => x[0] === "click");
  ok("⑦ 開著時：回 human", r === "human");
  ok("⑦ 開著時：滑鼠移了好幾步才點", moves.length >= 6, String(moves.length));
  ok("⑦ 開著時：只點一下", clicks.length === 1);
  ok("⑦ 開著時：落點在按鈕外框裡（不貼邊）", clicks[0][1] >= 140 && clicks[0][1] <= 260 && clicks[0][2] >= 208 && clicks[0][2] <= 232, `(${clicks[0][1]}, ${clicks[0][2]})`);
  ok("⑦ 開著時：按下與放開之間有停頓", clicks[0][3]?.delay >= 45 && clicks[0][3]?.delay <= 130);
  ok("⑦ 開著時：最後一步 move 就是點的位置", moves.at(-1)[1] === clicks[0][1] && moves.at(-1)[2] === clicks[0][2]);
  ok("⑦ 開著時：沒有退回 locator.click", !loc.紀錄.some((x) => x[0] === "locator.click"));

  page = 假page();
  loc = 假locator({ 打得到: false });
  r = await humanClick(page, loc);
  ok("⑦ 落點被蓋住 → 退回 locator.click", r === "fallback" && loc.紀錄.some((x) => x[0] === "locator.click"));

  page = 假page();
  loc = 假locator({ box: null });
  r = await humanClick(page, loc);
  ok("⑦ 抓不到外框 → 退回 locator.click", r === "fallback" && loc.紀錄.some((x) => x[0] === "locator.click"));

  page = 假page();
  loc = 假locator();
  loc.boundingBox = async () => {
    throw new Error("炸");
  };
  r = await humanClick(page, loc);
  ok("⑦ 中間任何一步炸掉 → 退回 locator.click，不會把錯誤丟出去", r === "fallback" && loc.紀錄.some((x) => x[0] === "locator.click"));

  // 衝過頭：跑很多次，至少有幾次的 move 會超過目標再回來
  let 有衝過頭 = 0;
  for (let i = 0; i < 60; i++) {
    const p = 假page();
    await humanMove(p, 900, 300);
    const xs = p.紀錄.filter((x) => x[0] === "move").map((x) => x[1]);
    if (Math.max(...xs) > 900.5) 有衝過頭++;
  }
  ok("⑦ 偶爾會衝過頭再拉回來（60 次裡至少 5 次）", 有衝過頭 >= 5, String(有衝過頭));
}

/* ── ⑧ 看頁面／等待時晃一晃 ── */
{
  設環境({ FB_HUMANIZE: "0" });
  let page = 假page();
  await humanBrowse(page);
  ok("⑧ 關掉時：進頁面不捲不晃", page.紀錄.length === 0);
  const t0 = Date.now();
  await idle(page, 120, 120);
  ok("⑧ 關掉時：idle 就只是等", page.紀錄.length === 0 && Date.now() - t0 >= 100);

  設環境({});
  page = 假page();
  await humanBrowse(page);
  const wheels = page.紀錄.filter((x) => x[0] === "wheel");
  ok("⑧ 開著時：往下捲 1～2 次再捲回來", wheels.length >= 2 && wheels.length <= 3, String(wheels.length));
  const 往下 = wheels.slice(0, -1).reduce((a, w) => a + w[2], 0);
  ok("⑧ 開著時：最後一次往上捲得比往下的總和多（保證回到頂）", wheels.at(-1)[2] < 0 && -wheels.at(-1)[2] > 往下);
  ok("⑧ 開著時：捲之前先把游標晃進畫面", page.紀錄.findIndex((x) => x[0] === "move") < page.紀錄.findIndex((x) => x[0] === "wheel"));
}

/* ── ⑨ 後台那一半（fb-humanize.ts，純函式，用 node 直接讀 .ts） ── */
{
  const ROOT = path.resolve(import.meta.dirname, "../..");
  const mod = await import(`${pathToFileURL(ROOT).href}/src/lib/fb-humanize.ts`);
  const { rollJitterSec, effectiveCooldownDays, jitterWindowLabel, hash32, JITTER_MAX_MINUTES } = mod;

  ok("⑨ 抖動上限預設 0（2026-09-19 本人拍板：排定幾點就幾點）", JITTER_MAX_MINUTES === 0, String(JITTER_MAX_MINUTES));
  ok("⑨ 預設不帶參數 → 永遠 0", rollJitterSec() === 0 && jitterWindowLabel(new Date()) === "");
  const 樣本 = Array.from({ length: 500 }, () => rollJitterSec(20));
  ok("⑨ 抖動秒數 0～1199 的整數", 樣本.every((s) => Number.isInteger(s) && s >= 0 && s < 1200));
  ok("⑨ 抖動真的隨機", new Set(樣本).size > 50);
  ok("⑨ 上限 0 → 永遠 0", rollJitterSec(0) === 0);
  ok("⑨ 上限負的／NaN → 0", rollJitterSec(-5) === 0 && rollJitterSec(NaN) === 0);

  ok("⑨ hash32 決定性", hash32("abc") === hash32("abc") && hash32("abc") !== hash32("abd"));

  const last = new Date("2026-09-10T10:00:00");
  const e1 = effectiveCooldownDays("g1", 7, last, 0.5);
  ok("⑨ 冷卻 7 天 × 0.5 → 7～11 天", e1 >= 7 && e1 <= 11, String(e1));
  ok("⑨ 同一個社團＋同一個上次時間 → 永遠同一個數（頁面重整不會跳）", effectiveCooldownDays("g1", 7, last, 0.5) === e1);
  ok("⑨ 換一個上次時間 → 可能不一樣（多抽幾次至少一次不同）",
    [1, 2, 3, 4, 5, 6, 7, 8].some((d) => effectiveCooldownDays("g1", 7, new Date(last.getTime() + d * 86_400_000), 0.5) !== e1));
  ok("⑨ 沒貼過 → 就是設定值", effectiveCooldownDays("g1", 7, undefined, 0.5) === 7);
  ok("⑨ 冷卻 0 天 → 0", effectiveCooldownDays("g1", 0, last, 0.5) === 0);
  ok("⑨ 比例 0 → 設定值", effectiveCooldownDays("g1", 7, last, 0) === 7);
  // 分佈：很多社團平均下來，加碼要真的分散在 0～4 之間
  const 加碼 = new Set();
  for (let i = 0; i < 200; i++) 加碼.add(effectiveCooldownDays(`g${i}`, 7, last, 0.5) - 7);
  ok("⑨ 加碼真的分散（0～4 都出現過）", [0, 1, 2, 3, 4].every((d) => 加碼.has(d)), [...加碼].join(","));

  const at = new Date("2026-09-20T10:00:00");
  ok("⑨ 視窗文字：10:00～10:20 之間開始", jitterWindowLabel(at, 20) === "10:00～10:20 之間開始", jitterWindowLabel(at, 20));
  ok("⑨ 跨小時：23:50～00:10", jitterWindowLabel(new Date("2026-09-20T23:50:00"), 20) === "23:50～00:10 之間開始");
  ok("⑨ 上限 0 → 空字串", jitterWindowLabel(at, 0) === "");
}

/* ── 結果 ── */
console.log(`\n${"─".repeat(60)}`);
console.log(`擬真模式測試：${pass} 過${fails.length ? `、${fails.length} 失敗` : ""}`);
for (const f of fails) console.log(`  ❌ ${f}`);
console.log("─".repeat(60));
process.exitCode = fails.length ? 1 : 0; // 同 test-rhythm.mjs：讀過 .ts 之後不要直接 process.exit()
