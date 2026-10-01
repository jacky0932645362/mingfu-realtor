/**
 * 固定尾段的樣式：字級／粗體／底線整段共用，文字顏色／底色一行（一段）一組，各自選。
 * 只套在「固定尾段」那幾行；型錄的 ✨ 特色行與抬頭、規格摘要維持純文字。純函式，不碰 DOM。
 *
 * 事實依據（跟 [[learning_591刊登表單實測事實]] 一樣的來源：對著真表單測出來的，不是猜的）：
 * 591 現況特色描述是 ProseMirror，貼上事件帶 text/html 時吃得住 <span style="color/background-color/font-size">
 * 與 <strong>，但會把 text-decoration:underline 整個丟掉；樂屋是 Summernote（純 contenteditable），
 * innerHTML 塞什麼都留得住，底線在樂屋看得到。這裡照樣把底線寫進 HTML——591 用不到是 591 的限制，
 * 不是這裡少做；巢狀順序固定「底色 > 字級 > 顏色 > 粗體 > 底線」（外到內），這個順序貼上 591 才留得住格式。
 */

/** 跟 591 編輯器自己的字級選單一樣只有兩級；"" = 不設定，吃預設字級 */
export const TAIL_SIZES = ["", "16px", "18px"];

/** 591 編輯器的 11 色標準色盤 + 白（白色是深底色要配白字時用，不是 591 選單裡的） */
export const TAIL_COLORS = ["#000000", "#c00000", "#ff0000", "#ffc000", "#ffff00", "#92d050", "#00b050", "#00b0f0", "#0070c0", "#002060", "#7030a0", "#ffffff"];

/** 固定尾段不會有人寫到這麼多行，純粹防呆用的上限 */
export const TAIL_MAX_LINES = 60;

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v) => {
  const t = String(v || "").trim();
  return HEX.test(t) ? t.toLowerCase() : "";
};

/** 一段（一行）自己的顏色：文字顏色／底色，兩個都可以空著（維持預設） */
export function normalizeLineStyle(line) {
  const o = line && typeof line === "object" ? line : {};
  return { color: hex(o.color), bg: hex(o.bg) };
}

export function normalizeTailStyle(style) {
  const o = style && typeof style === "object" ? style : {};
  return {
    size: TAIL_SIZES.includes(o.size) ? o.size : "",
    bold: !!o.bold,
    underline: !!o.underline,
    lines: Array.isArray(o.lines) ? o.lines.slice(0, TAIL_MAX_LINES).map(normalizeLineStyle) : [],
  };
}

/** 完全沒設過任何樣式就回 false，呼叫端可以直接跳過、照舊貼純文字 */
export function tailStyleActive(style) {
  const s = normalizeTailStyle(style);
  return !!(s.size || s.bold || s.underline || s.lines.some((l) => l.color || l.bg));
}

/** 第 k 個有字的行（從 0 起算，空行不算）目前的樣式，給操作頁即時預覽用的 inline CSS */
export function lineStyleCss(style, k) {
  const s = normalizeTailStyle(style);
  const l = s.lines[k] || { color: "", bg: "" };
  const parts = [];
  if (s.size) parts.push(`font-size:${s.size}`);
  if (s.bold) parts.push("font-weight:700");
  if (s.underline) parts.push("text-decoration:underline");
  if (l.color) parts.push(`color:${l.color}`);
  if (l.bg) parts.push(`background-color:${l.bg}`);
  return parts.join(";");
}

export const escapeHtml = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * 描述最前面的「抬頭」（預設「☆ 物件特色」）固定粗體＋18px（2026-09-24 本人直接開口要的固定樣式）。
 * 跟尾段不一樣：不能自訂顏色／底色，也沒有開關可以關掉——只要描述有字，第一行就套。操作頁預覽
 * （app.js，瀏覽器 CSS）跟真的要貼進 591／樂屋的 HTML（buildTailDescHtml，591 認得的 <span>/<strong>
 * 標籤）兩處都要用到同一個「18px」，數字只在這裡出現一次，不要兩邊各寫一份、以後改了漏改一邊。
 */
export const HEAD_FONT_SIZE = "18px";

/**
 * 固定尾段從描述的第幾行開始：先找跟 tailFirstLine 一樣的那一行（使用者在 ④ 改過描述文字，
 * 尾段第一行通常還在）；找不到就從最後一個 ✨ 開頭的特色行的下一行起算；連 ✨ 行都沒有回 -1
 * （代表整篇都不是尾段，維持純文字）。上架時組 HTML、操作頁畫預覽，兩邊都要用同一條規則算，
 * 不然使用者看到的預覽會跟真的貼上去的不一樣。
 */
export function tailStartIndex(lines, tailFirstLine) {
  const first = String(tailFirstLine || "").trim();
  const byFirst = first ? lines.findIndex((l) => l.trim() === first) : -1;
  if (byFirst >= 0) return byFirst;
  let last = -1;
  lines.forEach((l, i) => {
    if (/^\s*✨/.test(l)) last = i;
  });
  return last < 0 ? -1 : last + 1;
}

/**
 * 整篇描述 → 591／樂屋都吃的 HTML。
 * 2026-09-24 本人追加要求：型錄抓下來的 ✨ 特色行本來維持純文字，本人截圖真的貼進 591 看到
 * 「☆物件特色」抬頭跟下面尾段（蕭茗馥／陸家清兩塊）都是粗體大字，中間的特色行卻是 591 預設的小字、
 * 沒有粗體，「文字可以跟其他的都一樣，大小一樣，要粗體字」——不是只有抬頭要套固定樣式，是抬頭到
 * 尾段之間所有的內容都要。簡化成一條規則：**不在（生效中的）尾段範圍內的每一行，都固定套粗體＋
 * 18px（HEAD_FONT_SIZE）**；尾段那幾行維持原本可自訂顏色／底色的樣式。不能自訂、沒有開關，
 * 跟抬頭那次的規矩一樣。一行一個 <p>，空行 <p><br></p>（空行不佔一個「段」，不消耗 lines[] 的
 * 顏色格）。整篇都是空白 → 回空字串，呼叫端照舊貼純文字（不變）。
 */
/** 這一行是不是「整行就是一條網址」（前後可以有空白，但不能夾雜其他文字） */
const BARE_URL_LINE = /^https?:\/\/\S+$/i;

export function buildTailDescHtml(desc, tailFirstLine, style) {
  const s = normalizeTailStyle(style);
  const lines = String(desc || "").replace(/\r/g, "").split("\n");
  const start = tailStartIndex(lines, tailFirstLine);
  const tailOn = tailStyleActive(s) && start >= 0 && lines.slice(start).some((l) => l.trim());
  if (!lines.some((l) => l.trim())) return "";
  let k = 0;
  return lines
    .map((line, i) => {
      const t = line.trim();
      if (!t) return "<p><br></p>";
      let inner = escapeHtml(t);
      if (tailOn && i >= start) {
        const l = s.lines[k++] || { color: "", bg: "" };
        if (s.underline) inner = `<u>${inner}</u>`;
        if (s.bold) inner = `<strong>${inner}</strong>`;
        if (l.color) inner = `<span style="color:${l.color}">${inner}</span>`;
        if (s.size) inner = `<span style="font-size:${s.size}">${inner}</span>`;
        if (l.bg) inner = `<span style="background-color:${l.bg}">${inner}</span>`;
      } else {
        inner = `<span style="font-size:${HEAD_FONT_SIZE}"><strong>${inner}</strong></span>`;
      }
      /*
       * 整行就是一條網址 → 包成真的 <a href> 連結（2026-09-26 本人截圖示範：純文字網址
       * 貼進 591／樂屋看起來像連結，其實不是，要手動反白、按編輯器的插入連結鈕，網址
       * 變藍色才算成功）。只在「整行只有網址」才套，不會誤動到夾雜文字的一般描述行；
       * 樣式（粗體／字級／顏色）維持套在 <a> 裡面，跟本人示範的「先反白已排版好的文字
       * 再插入連結」順序一致，不會因為變連結而掉色。
       */
      if (BARE_URL_LINE.test(t)) inner = `<a href="${escapeHtml(t)}" target="_blank" rel="noopener">${inner}</a>`;
      return `<p>${inner}</p>`;
    })
    .join("");
}
