/**
 * 🔴 這支是從 591-extension/lib/parser.js 複製過來的，不是共用 import——Chrome 外掛
 * 在執行期沒辦法跨到另一個外掛的資料夾讀檔，兩個獨立外掛只能各自帶一份。591-extension
 * 那邊之後修的欄位對照（例如愛屋版面的 points/points_m/points_s 那種坑）不會自動同步
 * 過來，要記得手動比對兩邊。詳見 [[project_樂屋出租循環刊登]]。
 *
 * 解析器：把「愛屋不動產電子型錄」整頁複製的文字（或自己打的物件文字）變成一個結構化物件。
 *
 * 🔴 這支只吃使用者自己 Ctrl+A／Ctrl+C 貼進來的文字。不連愛屋、不連 591 抓任何資料。
 *
 * 三條鐵律（2026-09-11 對著本人真實的租屋型錄寫的）：
 *   1. 一律用「標籤關鍵字」定位，不用「第幾行」。剪貼簿會把標籤和值黏成一行或拆成兩行，靠行號整批會錯。
 *   2. 標籤和值之間最多只准隔「一個換行」。型錄的空欄位（例：面臨路寬）後面緊接著下一個標籤，
 *      寫成 \s* 會吃到隔壁標籤、回一個看起來像值的假資料，而且不會報錯。
 *   3. 抓到的值如果本身就是另一個標籤名 → 這格其實是空的。
 *
 * 這支不碰 DOM、不碰 chrome.*，node 直接 import 得起來（test/test-parser.mjs）。
 */
import { splitAddress } from "./address.js";

/* ───────── 基本工具 ───────── */

export const toNum = (s) => {
  if (s == null || s === "") return null;
  const n = parseFloat(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * 排版統一：全形英數→半形、／：（）→ / : ( )、全形空白→半形、\r\n→\n、連續空白壓成一個。
 * 中文標點（，。、）刻意不動 —— 文案會原樣進 591，改成半形逗號很難看。
 */
export function normalizeText(t) {
  return String(t || "")
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/／/g, "/")
    .replace(/：/g, ":")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/　/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ");
}

/**
 * 有些地方（例如 Claude 桌面版）貼上時會把網頁的連結轉成 `[文字](網址)`。
 * 型錄文字的解析要看「文字」，照片與型錄頁網址要看「網址」，所以兩邊都留下來。
 */
export function stripMarkdownLinks(t) {
  const urls = [];
  const text = String(t || "").replace(/\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => {
    urls.push(url);
    return label;
  });
  return { text, urls };
}

/** 型錄上所有欄位標籤（正規式片段）。用來擋「值抓到隔壁欄位的標籤」 */
const LABELS = [
  "委託總價", "租 ?金", "押 ?金", "登記坪數", "含車位坪", "含車位面積", "建物面積", "主 ?\\+ ?附屬", "主建物坪", "附屬建物",
  "公設建坪", "公設比", "每坪單價", "土地登記", "主地坪", "公設地坪", "使用分區", "總基地坪", "樓別", "房 ?/ ?廳",
  "車位型式", "車位 ?/ ?編號", "類別", "類型", "物件座向", "面臨路寬", "社區", "管理費", "竣工日期", "屋 ?齡",
  "建物外觀", "建物結構", "鄰近公園", "鄰近市場", "鄰近學校", "生 ?活 ?圈", "物件編號", "鑰匙", "物件面寬", "物件深度",
  "邊 ?間", "電梯總數", "補充說明", "環境特色", "經紀人員", "電話", "地圖", "街景", "更多照片", "成交行情",
];
const LABEL_AT_START = new RegExp("^(?:" + LABELS.join("|") + ")");
const LABEL_LINE = new RegExp("^(?:" + LABELS.join("|") + ")\\s*[:|]?\\s*$");

/**
 * 取一個欄位：`標籤 [冒號或直線] [最多一個換行] 值`。回傳正規式的擷取群組陣列，抓不到回 null。
 * label 是正規式片段；valueRe 是值的正規式（flags 會被拿掉 g）。
 */
function grab(text, label, valueRe, anywhere = false) {
  const gap = "[ \\t]*[:|]?[ \\t]*\\n?[ \\t]*";
  /* 型錄：標籤一定在行首。自己打的文字：標籤可能在一行中間（「總建坪:51坪/主建:40坪/公設:10坪」） */
  const lead = anywhere ? "(?:^|[\\n/、,;])[ \\t]*" : "(?:^|\\n)[ \\t]*";
  const re = new RegExp(lead + label + gap + valueRe.source, valueRe.flags.replace("g", ""));
  const m = text.match(re);
  return m ? m.slice(1) : null;
}
const one = (t, label, re, anywhere = false) => {
  const v = grab(t, label, re, anywhere);
  return v ? String(v[0] || "").trim() : "";
};
/** 文字欄位：值若本身是個標籤（空欄位吃到隔壁），視為空 */
const oneText = (t, label, re) => {
  const v = one(t, label, re);
  return LABEL_AT_START.test(v) ? "" : v;
};

/**
 * 多行欄位（環境特色／補充說明）：從標籤下一行起，一直到下一個「整行就是標籤」或已知的區塊結尾為止。
 */
function block(text, label) {
  const re = new RegExp("(?:^|\\n)[ \\t]*" + label + "[ \\t]*[:|]?[ \\t]*\\n?");
  const m = text.match(re);
  if (!m) return "";
  const rest = text.slice(m.index + m[0].length);
  const out = [];
  for (const line of rest.split("\n")) {
    const L = line.trim();
    if (LABEL_LINE.test(L)) break;
    if (/^\*\s*$/.test(L) || /^(?:\[?地圖\]?|地圖 街景)/.test(L) || /^經紀人員/.test(L)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

/**
 * 特色文字逐行拆開：去掉 ✨ ★ ① ▪ • 這些開頭符號、「1.」「2.」這種純數字編號、與空行，
 * 並丟掉「地圖 街景 更多照片 成交行情」那排按鈕文字（複製型錄時會混進來）。
 * 2026-09-25 加了數字編號：本人一戶真實物件的環境特色是純數字「1.兩房車位…」不是圈圈數字，
 * 不拿掉的話會變成「✨1.兩房車位…」，跟我們自己統一加的 ✨ 疊在一起很怪。
 */
export function splitFeatureLines(text) {
  return String(text || "")
    .split("\n")
    .map((L) =>
      L.replace(/^[\s✨★☆▪•●◆◇①-⑳\-–—*]+/, "")
        .replace(/^\d+[.、)]\s*/, "")
        .trim(),
    )
    .filter((L) => L.length > 0)
    .filter((L) => !/^\[?(?:地圖|街景|更多照片|成交行情)\]?(?:[\s\[\]()]|$)/.test(L) && !/^地圖\s+街景/.test(L));
}

/* ───────── 照片與型錄頁網址 ───────── */

/**
 * 判斷「是不是同一張照片」不能只比對整串網址逐字——愛屋的圖檔網址常帶 `?Rnd=NNN` 這種快取用的
 * 隨機參數，2026-09-25 本人回報樂屋抓到的照片有重複，直接對同一戶真實型錄頁分開抓兩次驗證過：
 * 同一張封面照，第一次抓到 `?Rnd=233`、第二次抓到 `?Rnd=279`，網址本身不一樣但根本是同一個檔案。
 * 逐字比對會把同一張圖誤判成兩張不同的，重複貼進上傳框。判斷「同不同一張」只看網域＋路徑，不看
 * query string、不分大小寫；但實際拿去抓／上傳的還是用原始完整網址（含 Rnd），這支只給比對用。
 */
export function photoUrlKey(u) {
  const s = String(u || "").trim();
  const qIdx = s.indexOf("?");
  return (qIdx >= 0 ? s.slice(0, qIdx) : s).toLowerCase();
}

/** 「更多照片」連結的 picstr= 參數裡藏著照片網址（逗號分隔；可能不只一條連結；可能 URL 編碼過） */
export function picstrUrls(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/picstr=([^&)\s\]"']+)/g)) {
    let v = m[1];
    if (/%[0-9A-Fa-f]{2}/.test(v)) {
      try {
        v = decodeURIComponent(v);
      } catch {
        /* 解不開就用原字串 */
      }
    }
    for (const u of v.split(",")) {
      const s = u.trim();
      if (/^https?:\/\//.test(s) && !out.some((x) => photoUrlKey(x) === photoUrlKey(s))) out.push(s);
    }
  }
  return out;
}

/** 直接貼進來的圖片網址（愛屋圖檔主機、或 Cloudinary 這類直連） */
export function directImageUrls(text) {
  return (String(text || "").match(/https?:\/\/(?:hq\.houseol\.com\.tw\/images\/pictures\/|res\.cloudinary\.com\/)[^\s,"'<>)\]]+?\.(?:jpe?g|png|webp)(?:\?[^\s,"'<>)\]]*)?/gi) || []).filter(
    (u, i, a) => a.findIndex((x) => photoUrlKey(x) === photoUrlKey(u)) === i,
  );
}

/** 這條是不是愛屋型錄頁本身（Ecatalog.aspx）—— 頁面上嵌的照片要把網頁抓回來才看得到 */
export function isCatalogPage(url) {
  return /^https?:\/\/[^/]*houseol\.com\.tw\/[^?#]*\.aspx/i.test(url) && !/picstr=/i.test(url);
}

/** 貼進「①貼上資料」的整段內容，本身就只是一條型錄頁網址（不是複製的型錄文字）→ 走「貼網址自動解析」那條路 */
export function soleCatalogUrl(raw) {
  const t = String(raw || "").trim();
  return /^https?:\/\/\S+$/.test(t) && isCatalogPage(t) ? t : null;
}

/**
 * 型錄頁網址補上 `showaddr=1`：2026-09-16 本人實測，貼網址自動抓回來的門牌整個是空的（縣市靠
 * DEFAULTS.defaultCity 兜底，鄉鎮/街道/號全空）——手動 Ctrl+A/Ctrl+C 抓得到，前提是「先把門牌
 * 『顯示』點開」；本人自己整理的型錄頁網址（`test/fixtures/catalog-rent-markdown.txt` 第 3 行）
 * 本來就帶著 `&showaddr=1`。這裡不管原網址有沒有問號、有沒有已經帶別的參數都用 URL API 正確接上。
 */
export function withShowAddr(url) {
  try {
    const u = new URL(url);
    u.searchParams.set("showaddr", "1");
    return u.toString();
  } catch {
    return url;
  }
}

const HTML_ENTITY_MAP = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " " };
/** 型錄頁 HTML 裡常見的字元實體（含數字實體）解成真正的字，標籤／值才比對得對 */
export function decodeHtmlEntities(s) {
  return String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const key = e.toLowerCase();
    return key in HTML_ENTITY_MAP ? HTML_ENTITY_MAP[key] : m;
  });
}

/** 標籤／值都是「一段 HTML → 純文字」：<br> 當換行，其餘標籤拿掉，空白壓一個 */
const stripTags = (s) =>
  decodeHtmlEntities(String(s ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();

/**
 * 這份 HTML 是不是愛屋的型錄頁：不能只認「不動產電子型錄」幾個字（型錄改過版，抬頭可能換成圖片，
 * 那幾個字就不見了）——認版面本身（t-th／t-td 那張表）＋任一個型錄頁專屬記號才夠穩。
 */
export function isCatalogHtml(html) {
  const h = String(html || "");
  return /class=["']t-t[hd]["']/.test(h) && /不動產電子型錄|showaddrBnt|id=["']showaddr["']|Ecatalog\.aspx|列印本頁/.test(h);
}

/**
 * 型錄頁 HTML → 跟使用者手動 Ctrl+A/Ctrl+C 貼過來一樣格式的文字，讓既有的 parseCatalog() 原封不動吃下去
 * （不重寫一份新的欄位辨識規則，兩種來源共用同一套、同一批測試）。
 * 2026-09-15 對著本人真實一戶型錄頁 fetch 回來的 HTML 核對過（`test/fixtures/catalog-real-page.html`）：
 *   - 標題：`<title>網頁標題</title>` 就是型錄標題。
 *   - 地址：多數型錄 `<div class="caption">路名</div>` 就是看到的文字（可能沒有門牌號）；有「顯示」
 *     門牌功能的型錄，caption 裡是 `<span id='addr'>路名</span><span id='showaddr' alt='完整地址（含門牌）'
 *     fla='路名（不含門牌）'>顯示</span>`——**完整地址固定在 `alt`，`fla` 是不帶門牌的短版**（2026-09-16
 *     本人截圖對過真實型錄核對確認）。門牌數字是全形（「７１８號」），交給 parseCatalog() 自己的
 *     normalizeText() 轉半形，這裡不用轉。
 *   - 每一格是 `<div class="t-th">標籤</div><div class="t-td"><div class="title">(另一種標籤，備用)
 *     </div><p>值</p></div>`——標籤優先用 `t-th`（這樣抓出來的字才跟本人手動複製貼上的文字對得起來，
 *     例如「類別/謄本用途」；`t-td` 裡的 `title` 有時字不一樣，只有 `t-th` 抓不到字時才退回用它）。
 *   - 環境特色不是這個形狀，值在 `<div class='points'><strong>…</strong></div>` 一條一條列。
 *   - 「更多照片」連結 `href="…EInfos.aspx?...picstr=…"` 原樣留著，讓既有的 `picstrUrls()` 撈得到。
 *   - 經紀人員／電話：一段話「經紀人員：姓名」「電話：號碼」。
 * ⚠️ 只驗證過本人這一筆型錄，愛屋常常換版；遇到抓不到的欄位以外掛面板紅字為準，不要照這裡的假設硬猜。
 */
export function catalogTextFromHtml(html) {
  const h = String(html || "");
  const out = ["不動產電子型錄"];

  const titleM = h.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleM ? stripTags(titleM[1]) : "";
  if (title) out.push(title);

  /* 🔴 先框出 #showaddr 這顆元素自己的開始標籤（在第一個 > 結束），再從裡面找 alt——
     以前用 (?:alt|fla) 交給正規式挑，[^>]* 貪婪比對會回溯去吃到「最後一個」符合的屬性，
     這顆元素剛好 alt 在前 fla 在後，結果每次都抓成 fla（不含門牌的短版），這才是真正抓不到門牌的原因。 */
  const showaddrTagM = h.match(/<[^>]*\bid=["']showaddr["'][^>]*>/i);
  const altM = showaddrTagM ? showaddrTagM[0].match(/\balt=["']([^"']*)["']/i) : null;
  const captionM = h.match(/<div class=["']caption["']>([\s\S]*?)<\/div>/i);
  const addr = altM ? decodeHtmlEntities(altM[1]).trim() : captionM ? stripTags(captionM[1]) : "";
  if (addr) out.push(addr);

  const fieldRe = /<div class=["']t-th["']>([^<]*)<\/div>\s*<div class=["']t-td["']>\s*<div class=["']title["']>([^<]*)<\/div>\s*<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  for (const m of h.matchAll(fieldRe)) {
    const label = stripTags(m[1]) || stripTags(m[2]);
    if (label) out.push(label, stripTags(m[3]));
  }

  /*
   * 2026-09-25 本人回報某戶完全沒抓到環境特色，591／樂屋都是空的——拿真實網址查證，那份型錄頁的
   * class 是 'points_m'，不是本來就有的 fixture 用的 'points'，先放寬成只接受這兩種。**本人緊接著
   * 拿另一筆物件測，還是沒有**，再查一次真實 HTML，這次是第三種 'points_s'——短短兩輪就冒出三種
   * class 名稱（points／points_m／points_s），代表愛屋的型錄頁版面種類比想像中多，逐一加白名單
   * 追不完、永遠慢一步。改成只要求開頭是 "points"、後面接不接底線加字母都放行（`points\w*`），
   * 不再列舉固定的後綴——這裡沒有反過來對到別的東西的風險：這一整份型錄頁裡，"points" 這個字只有
   * 環境特色這個區塊會用到，t-th／t-td／caption 那些欄位都是各自獨立的 class 名稱。
   * 編號風格（有的是圈圈數字「①」，有的是純數字「1.」）本來就靠 splitFeatureLines() 統一拿掉换成
   * ✨，不用在這裡處理；同一個 <div> 裡用純換行分隔好幾條（例如 points_s 那份第 5～7 點擠在同一個
   * <div> 裡，用實際的換行字元隔開，不是各自獨立的 <div>）也不用特別處理，stripTags() 保留原始換行，
   * 後面 splitFeatureLines() 的 split("\n") 自然會切開成一行一條。
   */
  const points = [...h.matchAll(/<div class=['"]points\w*['"]>([\s\S]*?)<\/div>/gi)].map((m) => stripTags(m[1])).filter(Boolean);
  if (points.length) out.push("環境特色", ...points);

  /* 「地圖 街景」開頭是 block() 認得的「環境特色到此結束」記號，跟手動複製貼上時這排按鈕文字連在一起一樣；
     沒有這個開頭，更多照片的網址會被當成環境特色最後一條吃掉。 */
  const picM = h.match(/href=["']([^"']*picstr=[^"']+)["']/i);
  if (picM) out.push(`地圖 街景 更多照片 成交行情 ${decodeHtmlEntities(picM[1])}`);

  const agentM = h.match(/經紀人員[：:]\s*([^<\n]{1,20})/i);
  if (agentM) out.push(`經紀人員：${stripTags(agentM[1])}`);
  const phoneM = h.match(/電話[：:]\s*(09\d{2}[- ]?\d{3}[- ]?\d{3}|0\d{1,2}[- ]?\d{6,8})/i);
  if (phoneM) out.push(`電話：${phoneM[1].replace(/[- ]/g, "")}`);

  return out.join("\n");
}

/** 型錄頁網址裡的物件編號（No=AD5358801），用來過濾頁面上的照片、排掉公司 logo */
export function listingNoFromUrl(url) {
  const m = String(url || "").match(/[?&]No=([A-Za-z]{1,3}\d{5,})/i);
  return m ? m[1].toUpperCase() : null;
}

/** 縮圖 <img src="...images/pictures/...jpg"> 專門認 src 屬性，不會撈到 href／picstr 那些不是縮圖本身的網址 */
function galleryImgUrls(html) {
  const out = [];
  for (const m of String(html || "").matchAll(/<img\b[^>]*\bsrc=["'](?:https?:)?(\/\/hq\.houseol\.com\.tw\/images\/pictures\/[^"']+?\.(?:jpe?g|png))(?:\?[^"']*)?["']/gi)) {
    out.push("https:" + m[1]);
  }
  return out;
}

/**
 * 從型錄頁的 HTML 撈出這一戶的照片：hq.houseol.com.tw/images/pictures/ 底下、檔名含物件編號的圖。
 * 沒給編號時退而求其次：排掉檔名帶底線的（公司 logo 長得像 4817_3.jpg）。
 *
 * 🔴 2026-09-23 順序有真實的坑：本人「兩房兩衛拎包入住」那戶的真實 HTML（fixtures/catalog-real-page.html）
 * 裡，「更多照片」那顆連結（menu 選單、帶 picstr= 的 e~i）在原始碼裡出現在縮圖 <ul><li><img></li></ul>（a/b/d）
 * 的**前面**——原本整份 HTML 從頭到尾用一個正規式掃、照文字出現順序收集，會把 e~i 排到 a/b/d 前面
 * （[a,e,f,g,h,i,b,d]），跟本人在愛屋頁面上實際看到的順序（縮圖在前接著更多照片：[a,b,d,e,f,g,h,i]）兜不起來——
 * 591 拿第一張當封面，順序錯了很可能連封面都選錯張。改成分開抓：縮圖只認 <img src>（galleryImgUrls），
 * 「更多照片」只認 picstr= 參數（既有的 picstrUrls，同一批已測過的規則），縮圖固定排在前面、更多照片接在後面，
 * 不管兩者在原始 HTML 裡誰先出現。
 */
export function photosFromCatalogHtml(html, listingNo) {
  const h = String(html || "");
  const out = [];
  const push = (u) => {
    const file = u.slice(u.lastIndexOf("/") + 1).toUpperCase();
    if (listingNo ? !file.includes(listingNo.toUpperCase()) : /_/.test(file)) return;
    if (!out.some((x) => photoUrlKey(x) === photoUrlKey(u))) out.push(u);
  };
  galleryImgUrls(h).forEach(push);
  picstrUrls(h).forEach(push);
  return out;
}

/** 把一串文字切成一條條頂層連結（picstr 裡逗號接的照片網址不算頂層） */
export function splitLinks(text) {
  return String(text || "")
    .split(/(?<![=,])(?=https?:\/\/)/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//.test(s));
}

/**
 * 使用者在「照片連結」那格貼的東西 → 照片清單（照貼的順序、去重）。
 * scanned：型錄頁連結 → 該頁掃出來的照片（由外掛背景程式抓網頁後算出，這裡只是查表）。
 */
export function collectPhotos(text, scanned = {}) {
  const out = [];
  const push = (u) => {
    if (!out.some((x) => photoUrlKey(x) === photoUrlKey(u))) out.push(u);
  };
  for (const l of splitLinks(text)) {
    if (isCatalogPage(l)) (scanned[l] || []).forEach(push);
    else {
      picstrUrls(l).forEach(push);
      directImageUrls(l).forEach(push);
    }
  }
  return out;
}

/** 給介面顯示：貼了幾條、每條各幾張、哪幾條是要去掃的型錄頁 */
export function photoLinkReport(text, scanned = {}) {
  const links = splitLinks(text);
  const perLink = links.map((l) => (isCatalogPage(l) ? (scanned[l] || []).length : collectPhotos(l).length));
  return { links, perLink, pages: links.filter(isCatalogPage), photos: collectPhotos(text, scanned) };
}

/* ───────── 結構 ───────── */

export function emptyListing(source) {
  return {
    source, // "catalog"（愛屋型錄）| "freeform"（自己打的文字）
    deal: "sale", // "sale" | "rent"
    no: "", // 物件編號
    rawTitle: "",
    addr: "", // 到「號」為止的地址（樓層另外放）
    addrParts: splitAddress(""),
    price: null, // 萬
    rent: null, // 元／月
    deposit: "", // 型錄原文（「2個月」「免押」…）
    regPing: null, // 登記（權狀）坪數
    buildingPing: null, // 建物面積（型錄有時另列）
    parkPing: null, // 含車位坪
    mainAttPing: null, // 主＋附屬
    mainPing: null,
    attPing: null,
    pubPing: null,
    landPing: null,
    floorRaw: "", // 樓別原文（「4」「全棟」「1-2」）
    floor: null, // 單層樓層數字
    floorSub: "", // 「之 N」
    total: null, // 總樓高
    room: null,
    hall: null,
    bath: null,
    parkType: "", // 車位型式原文
    parkNo: "", // 車位／編號原文
    usage: "", // 類別／謄本用途原文
    kind: "", // 類型／現況原文
    community: "",
    communityGuessed: false,
    fee: null, // 管理費（元）
    feeCycle: "月繳",
    y: null, // 竣工 西元年
    m: null,
    dd: null,
    ageYears: null, // 只知道屋齡時
    facing: "",
    zone: "",
    lifeArea: "",
    ageText: "",
    struct: "",
    exterior: "",
    width: "",
    depth: "",
    households: null,
    school: "",
    park: "",
    market: "",
    keyNote: "", // 鑰匙／帶看
    extraNote: "", // 補充說明（型錄）
    features: [], // 環境特色，一行一條
    rentCond: { noPets: null, cook: null, feeIncluded: false, parkIncluded: false, noSmoking: false, noAltar: false, motorbike: false },
    photos: [],
    catalogUrl: "", // 型錄頁網址（貼上的內容裡若帶連結）
    agent: "", // 型錄上的經紀人員（給「我的資料」當預設）
    agentPhone: "",
    warnings: [],
  };
}

/** 貼進來的是愛屋型錄還是自己打的文字 */
export function detectSource(raw) {
  return /不動產電子型錄|委託總價|登記坪數|樓別\s*[\/／]\s*樓高|(?:^|\n)\s*租[\s　]*金/.test(String(raw || "")) ? "catalog" : "freeform";
}

/**
 * 出租條件：只認明寫的字，沒寫就 null（交給對應層的預設值）。
 * 「禁寵」「禁神明廳」「租金含管理費」「附機車位」都是本人型錄上真的出現過的寫法。
 * ⚠️ 「機車位」不算車位：附機車位 ≠ 含汽車車位。
 */
export function readRentCond(text) {
  const t = String(text || "").replace(/\s+/g, "");
  const noPets = /禁[^\n]{0,4}寵|不可養?寵|不能養?寵|謝絕寵物|不接受寵物|勿養寵/.test(t) ? true : /可養?寵|寵物可|接受寵物|歡迎寵物|可帶寵/.test(t) ? false : null;
  const cook = /不可開伙|不能開伙|禁開伙|禁止開伙|不開伙/.test(t) ? false : /可開伙|能開伙|開伙可/.test(t) ? true : null;
  const noMotor = t.replace(/機車位|機車停車位|機車格/g, "");
  return {
    noPets,
    cook,
    feeIncluded: /含管(?:理費)?|管理費含|含管理|管理費(?:已)?包含/.test(t),
    parkIncluded: /含車(?:位)?|車位含|附車位|含停車|附汽車位/.test(noMotor),
    noSmoking: /禁菸|禁煙|不可抽菸|勿抽菸/.test(t),
    noAltar: /禁神明|不可安神|禁設神明/.test(t),
    motorbike: /機車位|機車停車位|機車格/.test(t),
  };
}

/* ───────── 愛屋型錄 ───────── */

export function parseCatalog(raw) {
  const d = emptyListing("catalog");
  const { text: noLinks, urls } = stripMarkdownLinks(raw);
  let t = normalizeText(noLinks);

  /* 列印頁最上面是一整排同事名字（個資），從「不動產電子型錄」之後才是內容 */
  const head = t.indexOf("不動產電子型錄");
  if (head > -1) t = t.slice(head + "不動產電子型錄".length);
  /* 尾巴的註腳（經紀證照那行、免費簡訊那行）不要 */
  const tail = t.search(/\n\s*(僅供參考詳細內容以謄本記載為準|經紀證照:|免費簡訊通知)/);
  const body = tail > -1 ? t.slice(0, tail) : t;

  /* 標題：「不動產電子型錄」後第一行有字的 */
  d.rawTitle = (body.match(/^\s*\n?\s*([^\n]{2,60})/) || [, ""])[1].trim();

  /*
    地址行：一定同時有「區/鄉/鎮」與「路/街/大道/段/巷/弄/號」，而且落在最前面幾行。
    只認「區」會誤抓標題（「學區」）。行尾的「顯示／隱藏」是型錄上的按鈕字，不是地址。
    2026-09-23 真實案例（沙鹿區平等十一街，門牌被隱藏）：街名本身用中文數字「十一」，
    原本只認阿拉伯數字，整行連「有沒有數字」都判定失敗，地址欄整個抓空（不只號碼，
    連區、路名都沒了）——跟 address.js 的中文數字樓層是同一種坑，這裡也要收。
  */
  const addrLine =
    body
      .split("\n")
      .slice(0, 12)
      .find(
        (L) =>
          /[區鄉鎮市]/.test(L) &&
          /[路街道段巷弄號]/.test(L) &&
          /[\d〇零一二三四五六七八九十]/.test(L) &&
          L.replace(/\s/g, "").length <= 40,
      ) || "";
  const addrFull = addrLine.replace(/(顯示門牌|隱藏門牌|顯示|隱藏)\s*$/, "").trim();
  const parts = splitAddress(addrFull);
  d.addrParts = parts;
  d.addr = parts.text; // 到「號」為止
  if (parts.floor != null) {
    d.floor = parts.floor;
    d.floorRaw = String(parts.floor);
    d.floorSub = parts.floorSub || "";
  }

  d.no = one(body, "物件編號", /([A-Z]{1,3}\d{5,})/);
  d.price = toNum(one(body, "委託總價", /([\d,]+(?:\.\d+)?)\s*萬/));

  /* 出租型錄：沒有委託總價，改成「租 金 1.5萬」「押 金 2個月」；租金可能寫「2.5萬」或「25,000元」 */
  const rentM = grab(body, "租 ?金", /([\d,]+(?:\.\d+)?)\s*(萬|元)?/);
  if (rentM && rentM[0]) {
    const n = toNum(rentM[0]);
    d.rent = n == null ? null : rentM[1] === "萬" || (rentM[1] !== "元" && n < 1000) ? Math.round(n * 10000) : n;
  }
  d.deposit = oneText(body, "押 ?金", /([^\n]{1,12})/);
  if (/^租\s*[-－—]/.test(d.rawTitle) || d.rent != null) d.deal = "rent";

  d.regPing = toNum(one(body, "登記坪數", /([\d.]+)\s*坪/));
  d.buildingPing = toNum(one(body, "建物面積", /([\d.]+)\s*坪/));
  d.parkPing = toNum(one(body, "含車位(?:坪|面積)", /([\d.]+)\s*坪/));
  d.mainAttPing = toNum(one(body, "主 ?\\+ ?附屬", /([\d.]+)\s*坪/));
  d.mainPing = toNum(one(body, "主建物坪", /([\d.]+)\s*坪/));
  d.attPing = toNum(one(body, "附屬建物", /([\d.]+)\s*坪/));
  d.pubPing = toNum(one(body, "公設建坪", /([\d.]+)\s*坪/));
  d.landPing = toNum(one(body, "土地登記", /([\d.]+)\s*坪/));

  /*
    樓別/樓高：一定有「/」。左邊不保證是數字（透天寫「全棟/4」「1-2/2」），右邊（總樓高）一定是數字。
  */
  const fl = grab(body, "樓別\\s*/\\s*樓高", /(\d{1,3}(?:\s*[-~]\s*\d{1,3})?|全棟|整棟|全)\s*\/\s*(\d{1,3})/);
  if (fl) {
    const left = fl[0].replace(/\s/g, "");
    if (!d.floorRaw) d.floorRaw = left;
    if (d.floor == null && /^\d+$/.test(left)) d.floor = +left;
    else if (d.floor != null && /^\d+$/.test(left) && +left !== d.floor) d.warnings.push(`地址寫 ${d.floor} 樓、樓別欄寫 ${left} 樓，兩邊不一樣，出售／出租樓層請自己確認`);
    d.total = +fl[1];
  }

  /* 房廳衛三個一起出現才算（避免抓到標題的「大2房」） */
  const rm = grab(body, "房\\s*/\\s*廳\\s*/\\s*衛", /(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
  if (rm) {
    d.room = +rm[0];
    d.hall = +rm[1];
    d.bath = +rm[2];
  }

  d.parkType = oneText(body, "車位型式", /([^\n]{1,20})/);
  d.parkNo = oneText(body, "車位\\s*/\\s*編號", /([^\n]{1,24})/);
  d.usage = oneText(body, "類別\\s*/\\s*謄本用途", /([^\n]{1,24})/);
  d.kind = oneText(body, "類型\\s*/\\s*現況", /([^\n]{1,24})/);

  /* 社區：只在「類型」那格之後找（標題也常以「社區」開頭） */
  const kindAt = body.indexOf("類型");
  d.community = oneText(kindAt > -1 ? body.slice(kindAt) : body, "社區", /([^\n]{1,24})/);

  /*
   * 管理費（標籤可能是「管理費|車位管理費」；非貪婪，否則回溯會只抓到一個數字）。
   * 2026-09-23：本人兩戶真實型錄的管理費都是空的（值是「| /」，見 fixtures/catalog-real-page*.html），
   * 沒有真實「有值」的樣本可以核對格式——「2342元/月繳 | 500元/月繳」是本人自己編的合成樣本，不是
   * confirmed 的真實格式。「元」與「/月繳」這段放寬成選填：真實資料如果比合成樣本簡單（只有數字、
   * 沒有「元」、沒寫週期）也抓得到；週期抓不到就維持 emptyListing() 給的預設「月繳」，不要覆蓋成 undefined。
   * feeLineRaw 留給下面警告區：抓不到金額但「管理費」這幾個字確實有出現時，把原文一小段印出來，
   * 抓錯了本人不用開 DevTools，警告文字複製回報就知道要怎麼調規則（同 debugCatalogHtml 的做法）。
   */
  const mf = grab(body, "管理費[^\\n]*?", /([\d,]+)\s*元?(?:\s*\/\s*(月繳|季繳|半年繳|年繳))?/);
  if (mf) {
    d.fee = toNum(mf[0]);
    if (mf[1]) d.feeCycle = mf[1];
  }
  const feeLineRaw = (body.match(/管理費[^\n]*(?:\n[^\n]*)?/) || [""])[0].replace(/\s+/g, " ").trim();

  const dt = grab(body, "竣工日期", /(\d{4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/);
  if (dt) {
    d.y = +dt[0];
    d.m = +dt[1];
    d.dd = +dt[2];
  }

  d.school = oneText(body, "鄰近學校", /([^\n]{0,40})/);
  d.park = oneText(body, "鄰近公園", /([^\n]{0,40})/);
  d.market = oneText(body, "鄰近市場", /([^\n]{0,40})/);
  d.facing = oneText(body, "物件座向", /([^\n]{0,14})/);
  d.zone = oneText(body, "使用分區", /([^\n]{0,20})/);
  d.lifeArea = oneText(body, "生 ?活 ?圈", /([^\n]{0,24})/);
  d.ageText = oneText(body, "屋 ?齡", /([^\n]{0,12})/);
  d.struct = oneText(body, "建物結構", /([^\n]{0,16})/);
  d.exterior = oneText(body, "建物外觀", /([^\n]{0,16})/);
  d.width = oneText(body, "物件面寬", /([^\n]{0,12})/);
  d.depth = oneText(body, "物件深度", /([^\n]{0,12})/);
  d.keyNote = oneText(body, "鑰匙\\s*/\\s*帶看", /([^\n]{0,24})/);
  d.agent = oneText(body, "經紀人員", /([^\n]{1,12})/);
  d.agentPhone = one(body, "電話", /(09\d{2}[- ]?\d{3}[- ]?\d{3}|0\d{1,2}[- ]?\d{6,8})/).replace(/[- ]/g, "");

  d.extraNote = block(body, "補充說明");
  d.features = splitFeatureLines(block(body, "環境特色"));

  /* 照片：貼上的文字裡若帶著「更多照片」連結就直接有；型錄頁本身的網址也記下來（外掛可以抓那一頁找嵌在頁面上的照片） */
  d.photos = picstrUrls(raw + "\n" + urls.join("\n"));
  d.catalogUrl = urls.find((u) => isCatalogPage(u) && /No=/i.test(u)) || urls.find(isCatalogPage) || "";

  if (d.deal === "rent") d.rentCond = readRentCond([d.rawTitle, d.extraNote, ...d.features].join("\n"));

  /* 提醒 */
  const rent = d.deal === "rent";
  if (!d.addr) d.warnings.push("沒抓到地址（型錄頁要先把地址旁的「顯示」點開再複製）");
  else if (!parts.no) d.warnings.push("地址沒有「號」（門牌被隱藏了），591 的「號」要自己填");
  if (!d.total) d.warnings.push("樓別/樓高沒抓到，總樓層要自己填");
  if (rent ? d.rent == null : !d.price) d.warnings.push(rent ? "租金沒抓到" : "委託總價沒抓到");
  if (!d.regPing) d.warnings.push("登記坪數沒抓到");
  if (!d.room) d.warnings.push("房/廳/衛沒抓到");
  if (!d.y) d.warnings.push(rent ? "型錄沒有竣工日期：591 出租會點「屋齡不詳」，知道完工年的話自己改" : "竣工日期沒抓到，完工年（民國）要自己填");
  if (!rent && !/\/\s*\S/.test(d.usage)) d.warnings.push("類別/謄本用途的斜線後面是空的，法定用途先給「住家用」，請照謄本確認");
  if (!rent && d.fee == null && feeLineRaw) d.warnings.push(`「管理費」有出現但沒抓到金額（原文：「${feeLineRaw.slice(0, 40)}」），591 要選有／無、金額自己填——這行字複製回報就能知道要怎麼調規則`);
  return d;
}

/* ───────── 自己打的物件文字（LINE 那種） ───────── */

/**
 * 支援「標籤：值」一行一個的寫法，標籤不分全半形冒號：
 *   「廣告標題」或第一行當標題
 *   地址：台中市梧棲區四維路71巷2號12樓之1
 *   售價：868萬　　（或 總價／開價；出租寫 租金：25,000 或 租金：2.5萬、押金：2個月）
 *   格局：4房2廳2衛（或 4房/2廳/2衛）
 *   坪數／權狀／總建坪：51.16坪　主建：40.08坪　附屬：0.9坪　公設：10.18坪　土地：xx坪
 *   樓層：12/15（或 12樓/15樓）　屋齡：33年　社區：XX　管理費：2,000元　車位：平面　朝向：坐北朝南
 *   ✨ 或 • 開頭的行 = 特色行
 * 沒寫的就是沒有，交給人補；這裡不猜數字。
 */
export function parseFreeform(raw) {
  const d = emptyListing("freeform");
  const { text: noLinks, urls } = stripMarkdownLinks(raw);
  const t = normalizeText(noLinks);
  const lines = t.split("\n").map((s) => s.trim()).filter(Boolean);

  const q = t.match(/[「『"]([^」』"\n]{4,60})[」』"]/);
  d.rawTitle = q ? q[1].trim() : "";
  if (!d.rawTitle) {
    /* 第一行不是「標籤:值」也不是特色行 → 當標題 */
    const first = lines.find((L) => !/^[^:\n]{1,6}:/.test(L) && !/^[✨★☆▪•●◆◇]/.test(L));
    if (first && first.length <= 40) d.rawTitle = first;
  }

  const ad = t.match(/(?:^|\n)\s*(?:地址|門牌)\s*:?\s*([^\n]+)/);
  if (ad) {
    const parts = splitAddress(ad[1]);
    d.addrParts = parts;
    d.addr = parts.text;
    if (parts.floor != null) {
      d.floor = parts.floor;
      d.floorRaw = String(parts.floor);
      d.floorSub = parts.floorSub || "";
    }
  }

  d.price = toNum(one(t, "(?:售價|開價|總價|委託總價)", /([\d,]+(?:\.\d+)?)\s*萬/, true));
  const rentM = grab(t, "(?:月租金|月租|租金)", /([\d,]+(?:\.\d+)?)\s*(萬|元)?/, true);
  if (rentM && rentM[0]) {
    const n = toNum(rentM[0]);
    d.rent = n == null ? null : rentM[1] === "萬" || (rentM[1] !== "元" && n < 1000) ? Math.round(n * 10000) : n;
    d.deal = "rent";
  }
  d.deposit = one(t, "押金", /([^\n]{1,12})/, true);

  const lay = t.match(/(\d+)\s*房\s*[\/、,]?\s*(\d+)\s*廳\s*[\/、,]?\s*(\d+)\s*衛/);
  if (lay) {
    d.room = +lay[1];
    d.hall = +lay[2];
    d.bath = +lay[3];
  }
  d.regPing = toNum(one(t, "(?:總建坪|權狀坪?數?|登記坪數|建坪|坪數)", /([\d.]+)\s*坪/, true));
  d.mainPing = toNum(one(t, "主建(?:物)?(?:坪)?(?:數)?", /([\d.]+)\s*坪/, true));
  d.attPing = toNum(one(t, "附屬(?:建物)?(?:坪)?", /([\d.]+)\s*坪/, true));
  d.pubPing = toNum(one(t, "公設(?:建坪|坪)?(?:數)?", /([\d.]+)\s*坪/, true));
  d.landPing = toNum(one(t, "(?:土地|地坪)(?:坪)?(?:數)?", /([\d.]+)\s*坪/, true));
  d.parkPing = toNum(one(t, "車位(?:坪|面積)", /([\d.]+)\s*坪/, true));
  d.ageYears = toNum(one(t, "屋齡", /([\d.]+)\s*年/, true));

  /* 樓層：「12/15」「12樓/15樓」「12F/15F」，或「總樓層：15」 */
  const flo = t.match(/(?:^|\n)\s*樓層\s*:?\s*(\d{1,3})\s*(?:樓|F)?\s*\/\s*(\d{1,3})/i);
  if (flo) {
    if (d.floor == null) {
      d.floor = +flo[1];
      d.floorRaw = flo[1];
    }
    d.total = +flo[2];
  }
  if (d.total == null) d.total = toNum(one(t, "(?:總樓層|樓高|總樓高)", /(\d{1,3})/, true));

  const mf = t.match(/管理費[^\n]*?([\d,]+)\s*元/);
  if (mf) d.fee = toNum(mf[1]);
  const hh = t.match(/總戶數\s*:?\s*([\d,]+)\s*戶/);
  if (hh) d.households = toNum(hh[1]);
  d.community = one(t, "社區", /([^\n]{1,24})/, true);
  d.facing = one(t, "(?:朝向|座向|坐向)", /([^\n]{1,10})/, true);
  d.usage = one(t, "(?:謄本用途|法定用途|用途)", /([^\n]{1,16})/, true);

  d.features = lines.filter((L) => /^[✨★☆▪•●◆◇]/.test(L)).map((L) => L.replace(/^[✨★☆▪•●◆◇\s]+/, "").trim()).filter(Boolean);

  if (/透天/.test(t)) d.kind = "透天";
  else if (/別墅/.test(t)) d.kind = "別墅";
  else if (/公寓/.test(t)) d.kind = "公寓";
  else if (/華廈/.test(t)) d.kind = "華廈";
  else if (/套房/.test(t)) d.kind = "套房";
  else if (d.floor != null || /大樓|社區/.test(t)) d.kind = "大樓";

  const pk = t.match(/(?:^|\n)\s*車位\s*:?\s*([^\n]{1,20})/);
  if (pk) d.parkType = pk[1].trim();
  else {
    const pk2 = t.match(/(坡道|升降|機械|平面|塔式)[^\n]{0,6}車位|車位[^\n]{0,6}(坡道|升降|機械|平面|塔式)/);
    if (pk2) d.parkType = pk2[0];
    else if (/無車位|沒有車位|不含車位/.test(t)) d.parkType = "無";
  }

  d.photos = picstrUrls(raw + "\n" + urls.join("\n")).concat(directImageUrls(raw));
  d.photos = d.photos.filter((u, i, a) => a.findIndex((x) => photoUrlKey(x) === photoUrlKey(u)) === i);
  if (d.deal === "rent") d.rentCond = readRentCond([d.rawTitle, ...d.features, t].join("\n"));

  const rent = d.deal === "rent";
  if (!d.rawTitle) d.warnings.push("沒看到標題（用「」包起來，或放第一行）");
  if (!d.addr) d.warnings.push("沒看到「地址：」");
  if (!d.total) d.warnings.push("沒寫總樓層（例：樓層：12/15），要自己填");
  if (rent ? d.rent == null : !d.price) d.warnings.push(rent ? "沒看到租金" : "沒看到售價");
  if (!d.regPing) d.warnings.push("沒看到坪數／權狀坪數");
  if (!d.room) d.warnings.push("沒看到格局（例：3房2廳2衛）");
  if (d.ageYears == null && !d.y) d.warnings.push(rent ? "沒寫屋齡也沒竣工日，591 出租會點「屋齡不詳」" : "沒寫屋齡也沒竣工日，完工年要自己填");
  if (!rent && d.fee == null) d.warnings.push("沒寫管理費，591 要選有／無");
  if (!rent && !d.usage) d.warnings.push("沒寫謄本用途，法定用途先給「住家用」，請照謄本確認");
  return d;
}

/** 自動判斷來源後解析 */
export function parseListing(raw) {
  return detectSource(raw) === "catalog" ? parseCatalog(raw) : parseFreeform(raw);
}
