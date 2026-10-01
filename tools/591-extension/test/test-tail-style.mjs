/**
 * 固定尾段樣式（lib/tailStyle.js）的純函式測試。跑法：node test/test-tail-style.mjs
 */
import { TAIL_SIZES, TAIL_COLORS, normalizeTailStyle, tailStyleActive, lineStyleCss, tailStartIndex, buildTailDescHtml } from "../lib/tailStyle.js";

let pass = 0;
let fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.log(`❌ ${label}\n   得到 ${JSON.stringify(got)}\n   應該 ${JSON.stringify(want)}`);
  }
}

/* ───────── normalize / active ───────── */
eq("normalize：空值給預設", normalizeTailStyle(null), { size: "", bold: false, underline: false, lines: [] });
eq("normalize：不認得的字級丟掉", normalizeTailStyle({ size: "20px" }).size, "");
eq("normalize：不是 hex 的顏色丟掉", normalizeTailStyle({ lines: [{ color: "red", bg: "#ABCDEF" }] }).lines, [{ color: "", bg: "#abcdef" }]);
eq("normalize：行數上限防呆", normalizeTailStyle({ lines: Array.from({ length: 999 }, () => ({ color: "#000000" })) }).lines.length <= 60, true);
eq("active：什麼都沒設是 false", tailStyleActive(null), false);
eq("active：只設字級也算 active", tailStyleActive({ size: "16px" }), true);
eq("active：只設某一行顏色也算 active", tailStyleActive({ lines: [{}, { color: "#ff0000" }] }), true);

/* ───────── lineStyleCss ───────── */
eq("css：全部沒設是空字串", lineStyleCss(null, 0), "");
eq("css：字級＋粗體＋底線＋這行顏色", lineStyleCss({ size: "18px", bold: true, underline: true, lines: [{ color: "#ff0000", bg: "#ffff00" }] }, 0), "font-size:18px;font-weight:700;text-decoration:underline;color:#ff0000;background-color:#ffff00");
eq("css：沒有這行的設定就只有共用的部分", lineStyleCss({ bold: true, lines: [] }, 3), "font-weight:700");

/* ───────── tailStartIndex ───────── */
{
  const lines = ["☆ 物件特色", "2房2廳｜3樓", "", "✨採光佳", "✨鄰近市場", "", "歡迎來電 0912-345-678"];
  eq("起點：找第一行完全相符", tailStartIndex(lines, "歡迎來電 0912-345-678"), 6);
  eq("起點：找不到第一行 → 退回最後一個 ✨ 行的下一行", tailStartIndex(lines, "找不到的字"), 5);
  eq("起點：連 ✨ 行都沒有 → -1", tailStartIndex(["純文字", "沒有特色行"], "找不到的字"), -1);
  eq("起點：tailFirstLine 是空字串 → 退回 ✨ 規則", tailStartIndex(lines, ""), 5);
}

/**
 * ───────── buildTailDescHtml：整體行為 ─────────
 * 2026-09-24 本人先要求抬頭固定粗體＋18px，本人截圖真的貼進 591 之後又追加：「✨ 特色行也要跟其他
 * 的一樣、一樣大小、要粗體」——原本只有抬頭那一行套固定樣式，現在規則簡化成「不在（生效中的）尾段
 * 範圍內的每一行都套」，✨ 特色行不再是例外。下面幾個「完全沒設尾段樣式」的案例因此從「只有抬頭套
 * 樣式」改成「整篇（抬頭＋特色行）都套樣式，只有尾段那段不生效」。
 */
eq(
  "html：完全沒設尾段樣式 → 整篇（抬頭＋特色行）都固定套粗體18px",
  buildTailDescHtml("☆抬頭\n✨特色\n\n歡迎來電", "歡迎來電", null),
  '<p><span style="font-size:18px"><strong>☆抬頭</strong></span></p><p><span style="font-size:18px"><strong>✨特色</strong></span></p><p><br></p><p><span style="font-size:18px"><strong>歡迎來電</strong></span></p>',
);
eq(
  "html：有設尾段樣式但找不到尾段起點 → 尾段那段沒生效，整篇還是套固定樣式",
  buildTailDescHtml("☆抬頭\n✨特色", "根本沒有這行", { bold: true }),
  '<p><span style="font-size:18px"><strong>☆抬頭</strong></span></p><p><span style="font-size:18px"><strong>✨特色</strong></span></p>',
);
/* 用 ✨ 退回規則才可能出現「找到起點、起點之後卻沒字」：靠 tailFirstLine 直接命中的那一行本身一定有字 */
eq(
  "html：退回 ✨ 規則找到起點，但起點之後全空行 → 尾段沒生效，整篇還是套固定樣式",
  buildTailDescHtml("☆抬頭\n✨特色\n\n", "根本沒有這行", { bold: true }),
  '<p><span style="font-size:18px"><strong>☆抬頭</strong></span></p><p><span style="font-size:18px"><strong>✨特色</strong></span></p><p><br></p><p><br></p>',
);
eq("html：整篇都是空白（trim 完沒字）→ 沒東西可以套、也沒設尾段樣式 → 空字串", buildTailDescHtml("\n\n", "", null), "");

{
  const desc = "☆ 物件特色\n\n✨採光佳\n✨邊間\n\n歡迎來電 0912-345-678\nLINE：abc123";
  const style = { size: "18px", bold: true, underline: true, lines: [{ color: "#c00000", bg: "" }, { color: "", bg: "#ffff00" }] };
  const html = buildTailDescHtml(desc, "歡迎來電 0912-345-678", style);
  eq(
    "html：抬頭、✨ 特色行都套固定粗體18px（不套尾段那組可自訂顏色）",
    html.startsWith(
      '<p><span style="font-size:18px"><strong>☆ 物件特色</strong></span></p><p><br></p><p><span style="font-size:18px"><strong>✨採光佳</strong></span></p><p><span style="font-size:18px"><strong>✨邊間</strong></span></p><p><br></p>',
    ),
    true,
  );
  eq("html：尾段第 1 行＝底色>字級>顏色>粗體>底線（外到內）", html.includes('<span style="font-size:18px"><span style="color:#c00000"><strong><u>歡迎來電 0912-345-678</u></strong></span></span>'), true);
  eq("html：尾段第 2 行套的是 lines[1]（沒有顏色時，底色包在字級外面）", html.includes('<span style="background-color:#ffff00"><span style="font-size:18px"><strong><u>LINE：abc123</u></strong></span></span>'), true);
  eq("html：591 用不到底線，但 HTML 還是要寫（樂屋看得到，591 貼上自己會丟掉）", html.includes("<u>"), true);
}

{
  /* 抬頭剛好緊接在尾段前面（沒有 ✨ 特色行）：抬頭跟尾段是不同行，兩邊各自套各自的樣式，不衝突 */
  const html = buildTailDescHtml("☆ 物件特色\n歡迎來電", "歡迎來電", { bold: true, lines: [{ color: "#ff0000", bg: "" }] });
  eq("html：抬頭與尾段緊鄰時，兩邊分開套各自的樣式", html, '<p><span style="font-size:18px"><strong>☆ 物件特色</strong></span></p><p><span style="color:#ff0000"><strong>歡迎來電</strong></span></p>');
}
{
  /* 抬頭剛好「就是」尾段起點那一行（整篇只有尾段，没有抬頭跟特色行）：不要疊兩次樣式，交給尾段那段處理 */
  const html = buildTailDescHtml("歡迎來電", "歡迎來電", { bold: true, lines: [{ color: "#ff0000", bg: "" }] });
  eq("html：抬頭跟尾段起點是同一行 → 只套尾段樣式，不疊加 18px", html, '<p><span style="color:#ff0000"><strong>歡迎來電</strong></span></p>');
}

/* ───────── 整行是網址 → 包成真的 <a href> 連結 ─────────
 * 2026-09-26 本人截圖示範：純文字網址貼進 591／樂屋看起來像連結，其實不是，要手動
 * 反白、按編輯器的插入連結鈕，網址變藍色才算成功。改成自動判斷「整行只有網址」就
 * 包 <a href>，樣式維持套在裡面，不用本人每次手動補這一步。 */
{
  const html = buildTailDescHtml("☆ 物件特色\nhttps://es.houseol.com.tw/Ecatalog.aspx?No=AD1", "根本沒有這行", null);
  eq(
    "html：抬頭區塊裡整行是網址 → 包 <a href>，粗體18px樣式維持在裡面",
    html,
    '<p><span style="font-size:18px"><strong>☆ 物件特色</strong></span></p><p><a href="https://es.houseol.com.tw/Ecatalog.aspx?No=AD1" target="_blank" rel="noopener"><span style="font-size:18px"><strong>https://es.houseol.com.tw/Ecatalog.aspx?No=AD1</strong></span></a></p>',
  );
}
{
  const html = buildTailDescHtml("歡迎來電\nhttps://es.houseol.com.tw/x", "歡迎來電", { bold: true, lines: [{ color: "#ff0000", bg: "" }, {}] });
  eq(
    "html：尾段裡整行是網址 → 包 <a href>，尾段自訂樣式（顏色/粗體）維持在裡面",
    html,
    '<p><span style="color:#ff0000"><strong>歡迎來電</strong></span></p><p><a href="https://es.houseol.com.tw/x" target="_blank" rel="noopener"><strong>https://es.houseol.com.tw/x</strong></a></p>',
  );
}
eq(
  "html：網址帶 & 查詢字串，href 屬性正確跳脫成 &amp;，不會把 HTML 弄壞",
  buildTailDescHtml("https://x.com/a?b=1&c=2", "沒有這行", null),
  '<p><a href="https://x.com/a?b=1&amp;c=2" target="_blank" rel="noopener"><span style="font-size:18px"><strong>https://x.com/a?b=1&amp;c=2</strong></span></a></p>',
);
eq(
  "html：整行不是「只有」網址（前後夾雜文字）→ 不誤判成連結，維持一般文字",
  /<a /.test(buildTailDescHtml("詳情請看 https://x.com/a 謝謝", "沒有這行", null)),
  false,
);

/* ───────── 色盤／字級常數：形狀檢查，避免手滑打錯格式 ───────── */
eq("字級只有三個選項", TAIL_SIZES, ["", "16px", "18px"]);
eq("色盤都是合法 6 碼 hex", TAIL_COLORS.every((c) => /^#[0-9a-f]{6}$/.test(c)), true);

console.log(`\n${pass} 過、${fail} 沒過`);
if (fail) process.exit(1);
