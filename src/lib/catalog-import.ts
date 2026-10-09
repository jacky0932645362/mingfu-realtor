/**
 * 愛屋不動產電子型錄（es.houseol.com.tw/Ecatalog.aspx）→ 結構化物件資料。
 *
 * 「新增物件」貼公司官網（太平洋房屋走的就是愛屋型錄系統）連結自動帶入表單，2026-09-23。
 *
 * 🔴 這支的解析核心是從 `tools/591-extension/lib/parser.js` + `lib/address.js` 移植過來的
 * ——那支外掛已經拿好幾筆本人真實型錄驗證過，這裡不重新猜一次規則。只搬「型錄頁 HTML → 結構化
 * 資料」需要的部分（парseCatalog／catalogTextFromHtml／照片／地址），不搬 591／樂屋填表格式轉換、
 * 也不搬「自己打的文字」（parseFreeform）那條路徑，這裡永遠是「貼一條型錄頁網址」。
 * ⚠️ 兩邊是分開部署的東西（591 外掛要能單獨當資料夾拷貝／分享），刻意各自一份，不是共用 import。
 * 愛屋改版、或以後在 591-extension 那邊修到解析規則時，這裡要記得對照著改一次
 * （2026-09-23 那次「街名是中文數字（十一街）地址整個抓空」的 bug 兩邊已經同步修好）。
 */

/* ───────── 地址拆解（移植自 tools/591-extension/lib/address.js） ───────── */

export type AddressParts = {
  city: string;
  town: string;
  road: string;
  lane: string;
  alley: string;
  no: string;
  sub: string;
  floor: number | null;
  floorSub: string;
  text: string;
};

function normalizeAddr(a: string): string {
  return String(a || "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[－—–]/g, "-")
    .replace(/\s+/g, "")
    .replace(/臺/g, "台");
}

const CN_DIGIT: Record<string, number> = { 〇: 0, 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnToInt(s: string | null | undefined): number | null {
  if (s == null || s === "") return null;
  if (/^\d+$/.test(s)) return +s;
  if (s === "十") return 10;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^([一二三四五六七八九])十([一二三四五六七八九])?$/))) return CN_DIGIT[m[1]] * 10 + (m[2] ? CN_DIGIT[m[2]] : 0);
  if ((m = s.match(/^十([一二三四五六七八九])$/))) return 10 + CN_DIGIT[m[1]];
  if ((m = s.match(/^([一二三四五六七八九])$/))) return CN_DIGIT[m[1]];
  return null;
}
const FLOOR_NUM = "(\\d+|[一二三四五六七八九]?十[一二三四五六七八九]?|[一二三四五六七八九])";

/** 「三段」「3段」都收；回傳原字串（591 的街道清單通常寫「沙田路三段」） */
export function splitAddress(a: string): AddressParts {
  const r: AddressParts = { city: "", town: "", road: "", lane: "", alley: "", no: "", sub: "", floor: null, floorSub: "", text: "" };
  let s = normalizeAddr(a);
  if (!s) return r;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(.{2}[縣市])/))) {
    r.city = m[1];
    s = s.slice(m[1].length);
  }
  if ((m = s.match(/^(.{1,4}?[區鄉鎮市])/))) {
    r.town = m[1];
    s = s.slice(m[1].length);
  }
  if ((m = s.match(new RegExp(FLOOR_NUM + "\\s*(?:樓|F)(?:之" + FLOOR_NUM + ")?", "i")))) {
    const f = cnToInt(m[1]);
    if (f != null) {
      r.floor = f;
      r.floorSub = m[2] != null ? String(cnToInt(m[2])) : "";
      s = s.slice(0, m.index) + s.slice((m.index ?? 0) + m[0].length);
    }
  }
  if ((m = s.match(/(\d+)巷/))) r.lane = m[1];
  if ((m = s.match(/(\d+)弄/))) r.alley = m[1];
  if ((m = s.match(/(\d+)(?:之|-)(\d+)號/))) {
    r.no = m[1];
    r.sub = m[2];
  } else if ((m = s.match(/(\d+)號(?:之|-)(\d+)/))) {
    r.no = m[1];
    r.sub = m[2];
  } else if ((m = s.match(/(\d+)號/))) {
    r.no = m[1];
  }
  r.road = s.replace(/\d+(?:巷|弄|號|之|-).*$/, "").replace(/[之\-]+$/, "").trim();
  r.text = [r.city, r.town, r.road, r.lane ? `${r.lane}巷` : "", r.alley ? `${r.alley}弄` : "", r.no ? `${r.no}${r.sub ? `之${r.sub}` : ""}號` : ""].join("");
  return r;
}

/* ───────── 基本工具（移植自 tools/591-extension/lib/parser.js） ───────── */

export const toNum = (s: string | null | undefined): number | null => {
  if (s == null || s === "") return null;
  const n = parseFloat(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

function normalizeText(t: string | null | undefined): string {
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

function stripMarkdownLinks(t: string | null | undefined): { text: string; urls: string[] } {
  const urls: string[] = [];
  const text = String(t || "").replace(/\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => {
    urls.push(url);
    return label;
  });
  return { text, urls };
}

const LABELS = [
  "委託總價", "租 ?金", "押 ?金", "登記坪數", "含車位坪", "含車位面積", "建物面積", "主 ?\\+ ?附屬", "主建物坪", "附屬建物",
  "公設建坪", "公設比", "每坪單價", "土地登記", "主地坪", "公設地坪", "使用分區", "總基地坪", "樓別", "房 ?/ ?廳",
  "車位型式", "車位 ?/ ?編號", "類別", "類型", "物件座向", "面臨路寬", "社區", "管理費", "竣工日期", "屋 ?齡",
  "建物外觀", "建物結構", "鄰近公園", "鄰近市場", "鄰近學校", "生 ?活 ?圈", "物件編號", "鑰匙", "物件面寬", "物件深度",
  "邊 ?間", "電梯總數", "補充說明", "環境特色", "經紀人員", "電話", "地圖", "街景", "更多照片", "成交行情",
];
const LABEL_AT_START = new RegExp("^(?:" + LABELS.join("|") + ")");
const LABEL_LINE = new RegExp("^(?:" + LABELS.join("|") + ")\\s*[:|]?\\s*$");

function grab(text: string, label: string, valueRe: RegExp, anywhere = false): string[] | null {
  const gap = "[ \\t]*[:|]?[ \\t]*\\n?[ \\t]*";
  const lead = anywhere ? "(?:^|[\\n/、,;])[ \\t]*" : "(?:^|\\n)[ \\t]*";
  const re = new RegExp(lead + label + gap + valueRe.source, valueRe.flags.replace("g", ""));
  const m = text.match(re);
  return m ? m.slice(1) : null;
}
const one = (t: string, label: string, re: RegExp, anywhere = false): string => {
  const v = grab(t, label, re, anywhere);
  return v ? String(v[0] || "").trim() : "";
};
const oneText = (t: string, label: string, re: RegExp): string => {
  const v = one(t, label, re);
  return LABEL_AT_START.test(v) ? "" : v;
};

function block(text: string, label: string): string {
  const re = new RegExp("(?:^|\\n)[ \\t]*" + label + "[ \\t]*[:|]?[ \\t]*\\n?");
  const m = text.match(re);
  if (!m) return "";
  const rest = text.slice((m.index ?? 0) + m[0].length);
  const out: string[] = [];
  for (const line of rest.split("\n")) {
    const L = line.trim();
    if (LABEL_LINE.test(L)) break;
    if (/^\*\s*$/.test(L) || /^(?:\[?地圖\]?|地圖 街景)/.test(L) || /^經紀人員/.test(L)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

/**
 * 特色文字逐行拆開、去掉行首的清單符號。
 * 2026-10-07：圈圈數字不只 ①-⑳ ——愛屋型錄常見 ➁➂➃（黑底圈圈）、❶❷（實心）、⓵⓶，
 * 原本只認 ①-⑳，貼出去就會留著一個「➁」開頭很怪；順手跟 591 外掛那邊補的「1. 2.」純數字編號對齊。
 */
const LIST_MARKERS = "\\s✨★☆▪•●◆◇・\\u2460-\\u2473\\u24EA\\u24F5-\\u24FE\\u2776-\\u2793\\u3251-\\u325F\\u32B1-\\u32BF\\-–—*";
const LEADING_MARKERS = new RegExp(`^[${LIST_MARKERS}]+`);
export function splitFeatureLines(text: string | null | undefined): string[] {
  return String(text || "")
    .split("\n")
    .map((L) => L.replace(LEADING_MARKERS, "").replace(/^\d+[.、)]\s*/, "").replace(LEADING_MARKERS, "").trim())
    .filter((L) => L.length > 0)
    .filter((L) => !/^\[?(?:地圖|街景|更多照片|成交行情)\]?(?:[\s\[\]()]|$)/.test(L) && !/^地圖\s+街景/.test(L));
}

/* ───────── 照片與型錄頁網址 ───────── */

export function picstrUrls(text: string | null | undefined): string[] {
  const out: string[] = [];
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
      if (/^https?:\/\//.test(s) && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
    }
  }
  return out;
}

/** 這條是不是愛屋型錄頁本身（Ecatalog.aspx） */
export function isCatalogPage(url: string): boolean {
  return /^https?:\/\/[^/]*houseol\.com\.tw\/[^?#]*\.aspx/i.test(url) && !/picstr=/i.test(url);
}

/** 型錄頁網址補上 showaddr=1：有「顯示門牌」功能的型錄，這個參數才會把完整地址（含門牌）交出來 */
export function withShowAddr(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("showaddr", "1");
    return u.toString();
  } catch {
    return url;
  }
}

const HTML_ENTITY_MAP: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " " };
export function decodeHtmlEntities(s: string | null | undefined): string {
  return String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const key = e.toLowerCase();
    return key in HTML_ENTITY_MAP ? HTML_ENTITY_MAP[key] : m;
  });
}

const stripTags = (s: string | null | undefined): string =>
  decodeHtmlEntities(String(s ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();

/** 這份 HTML 是不是愛屋的型錄頁 */
export function isCatalogHtml(html: string | null | undefined): boolean {
  const h = String(html || "");
  return /class=["']t-t[hd]["']/.test(h) && /不動產電子型錄|showaddrBnt|id=["']showaddr["']|Ecatalog\.aspx|列印本頁/.test(h);
}

/** 型錄頁 HTML → 跟手動 Ctrl+A/Ctrl+C 貼過來一樣格式的文字，讓 parseCatalog() 原封不動吃下去 */
export function catalogTextFromHtml(html: string | null | undefined): string {
  const h = String(html || "");
  const out: string[] = ["不動產電子型錄"];

  const titleM = h.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleM ? stripTags(titleM[1]) : "";
  if (title) out.push(title);

  const showaddrTagM = h.match(/<[^>]*\bid=["']showaddr["'][^>]*>/i);
  const altM = showaddrTagM ? showaddrTagM[0].match(/\balt=["']([^"']*)["']/i) : null;
  const captionM = h.match(/<div class=["']caption["']>([\s\S]*?)<\/div>/i);
  const addr = altM ? decodeHtmlEntities(altM[1]).trim() : captionM ? stripTags(captionM[1]) : "";
  // 2026-10-07：地址行加上「地址:」標籤。HTML 裡這一行的位置是確定的（caption），不該靠「這行有沒有數字」去猜——
  // 「梧棲區民族路」「梧棲區文心街」這種街名沒有任何數字、門牌又沒登錄的，原本會整行被當成不是地址（連區、路名都丟了）。
  if (addr) out.push(`地址:${addr}`);

  const fieldRe = /<div class=["']t-th["']>([^<]*)<\/div>\s*<div class=["']t-td["']>\s*<div class=["']title["']>([^<]*)<\/div>\s*<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  for (const m of h.matchAll(fieldRe)) {
    const label = stripTags(m[1]) || stripTags(m[2]);
    if (label) out.push(label, stripTags(m[3]));
  }

  const points = [...h.matchAll(/<div class=['"]points\w*['"]>([\s\S]*?)<\/div>/gi)].map((m) => stripTags(m[1])).filter(Boolean);
  if (points.length) out.push("環境特色", ...points);

  const picM = h.match(/href=["']([^"']*picstr=[^"']+)["']/i);
  if (picM) out.push(`地圖 街景 更多照片 成交行情 ${decodeHtmlEntities(picM[1])}`);

  const agentM = h.match(/經紀人員[：:]\s*([^<\n]{1,20})/i);
  if (agentM) out.push(`經紀人員：${stripTags(agentM[1])}`);
  const phoneM = h.match(/電話[：:]\s*(09\d{2}[- ]?\d{3}[- ]?\d{3}|0\d{1,2}[- ]?\d{6,8})/i);
  if (phoneM) out.push(`電話：${phoneM[1].replace(/[- ]/g, "")}`);

  return out.join("\n");
}

/** 型錄頁網址裡的物件編號（No=AD5358801），用來過濾頁面上的照片、排掉公司 logo */
export function listingNoFromUrl(url: string | null | undefined): string | null {
  const m = String(url || "").match(/[?&]No=([A-Za-z]{1,3}\d{5,})/i);
  return m ? m[1].toUpperCase() : null;
}

/** 從型錄頁的 HTML 撈出這一戶的照片 */
export function photosFromCatalogHtml(html: string | null | undefined, listingNo: string | null): string[] {
  const out: string[] = [];
  for (const m of String(html || "").matchAll(/(?:https?:)?\/\/hq\.houseol\.com\.tw\/images\/pictures\/[^"'\s<>)]+?\.(?:jpe?g|png)/gi)) {
    const u = m[0].startsWith("//") ? "https:" + m[0] : m[0];
    const file = u.slice(u.lastIndexOf("/") + 1).toUpperCase();
    if (listingNo ? !file.includes(listingNo.toUpperCase()) : /_/.test(file)) continue;
    if (!out.some((x) => x.toLowerCase() === u.toLowerCase())) out.push(u);
  }
  return out;
}

/* ───────── 結構 ───────── */

/**
 * 型錄 `<title>` 結尾會接「空白＋價格」（「專售近中科靜宜沙鹿雙車美墅 1880萬」）——頁面上看到的標題沒有這段，
 * 價格在文案裡自己有一行。只拿「結尾、前面隔著空白」的價格；沒隔空白或不在結尾的是本人自己打的字，不動
 * （跟 591 外掛 cleanTitle() 同一個規則，2026-10-02 修過同一個坑）。
 */
export function cleanCatalogTitle(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/\s+[\d,.]+\s*(?:萬|億|元)(?:\s*\/\s*月)?\s*$/, "")
    .trim();
}

export type CatalogListing = {
  deal: "sale" | "rent";
  no: string;
  rawTitle: string;
  /** rawTitle 拿掉結尾的價格尾巴。要當標題用請用這個。 */
  title: string;
  addr: string;
  addrParts: AddressParts;
  price: number | null;
  rent: number | null;
  regPing: number | null;
  /** 型錄「主 +附屬」那格（主建物＋附屬建物合計坪數）。 */
  mainAttPing: number | null;
  mainPing: number | null;
  attPing: number | null;
  landPing: number | null;
  floorRaw: string;
  floor: number | null;
  floorSub: string;
  total: number | null;
  room: number | null;
  hall: number | null;
  bath: number | null;
  parkType: string;
  usage: string;
  kind: string;
  community: string;
  y: number | null;
  m: number | null;
  dd: number | null;
  ageText: string;
  facing: string;
  agent: string;
  agentPhone: string;
  features: string[];
  photos: string[];
  warnings: string[];
};

function emptyListing(): CatalogListing {
  return {
    deal: "sale",
    no: "",
    rawTitle: "",
    title: "",
    addr: "",
    addrParts: splitAddress(""),
    price: null,
    rent: null,
    regPing: null,
    mainAttPing: null,
    mainPing: null,
    attPing: null,
    landPing: null,
    floorRaw: "",
    floor: null,
    floorSub: "",
    total: null,
    room: null,
    hall: null,
    bath: null,
    parkType: "",
    usage: "",
    kind: "",
    community: "",
    y: null,
    m: null,
    dd: null,
    ageText: "",
    facing: "",
    agent: "",
    agentPhone: "",
    features: [],
    photos: [],
    warnings: [],
  };
}

/**
 * 型錄文字（來自 catalogTextFromHtml()）→ 結構化物件資料。
 * 三條鐵律（跟 591-extension/lib/parser.js 同一套，移植時原樣照搬）：
 *   1. 一律用「標籤關鍵字」定位，不用「第幾行」。
 *   2. 標籤和值之間最多只准隔一個換行。
 *   3. 抓到的值如果本身就是另一個標籤名 → 這格其實是空的。
 */
export function parseCatalog(raw: string): CatalogListing {
  const d = emptyListing();
  const { text: noLinks, urls } = stripMarkdownLinks(raw);
  let t = normalizeText(noLinks);

  const head = t.indexOf("不動產電子型錄");
  if (head > -1) t = t.slice(head + "不動產電子型錄".length);
  const tail = t.search(/\n\s*(僅供參考詳細內容以謄本記載為準|經紀證照:|免費簡訊通知)/);
  const body = tail > -1 ? t.slice(0, tail) : t;

  d.rawTitle = (body.match(/^\s*\n?\s*([^\n]{2,60})/) || [, ""])[1]!.trim();
  if (/^地址:/.test(d.rawTitle)) d.rawTitle = ""; // 型錄沒有標題時，第一行會是我們自己標的地址行，不是標題

  /*
    地址行：一定同時有「區/鄉/鎮」與「路/街/大道/段/巷/弄/號」，而且落在最前面幾行。
    2026-09-23 真實案例（沙鹿區平等十一街，門牌被隱藏）：街名本身用中文數字「十一」，
    只認阿拉伯數字會整行判定失敗，連區、路名都抓不到——這裡也認中文數字。
  */
  // 優先用 catalogTextFromHtml() 標好的「地址:」那行（位置確定，不用猜）；沒有（貼上的純文字）才退回下面的猜法
  const labeledAddr = body.match(/(?:^|\n)地址:([^\n]+)/);
  const addrLine = labeledAddr
    ? labeledAddr[1]
    : body
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
  d.addr = parts.text;
  if (parts.floor != null) {
    d.floor = parts.floor;
    d.floorRaw = String(parts.floor);
    d.floorSub = parts.floorSub || "";
  }

  d.no = one(body, "物件編號", /([A-Z]{1,3}\d{5,})/);
  d.price = toNum(one(body, "委託總價", /([\d,]+(?:\.\d+)?)\s*萬/));

  const rentM = grab(body, "租 ?金", /([\d,]+(?:\.\d+)?)\s*(萬|元)?/);
  if (rentM && rentM[0]) {
    const n = toNum(rentM[0]);
    d.rent = n == null ? null : rentM[1] === "萬" || (rentM[1] !== "元" && n < 1000) ? Math.round(n * 10000) : n;
  }
  if (/^租\s*[-－—]/.test(d.rawTitle) || d.rent != null) d.deal = "rent";

  d.title = cleanCatalogTitle(d.rawTitle);

  d.regPing = toNum(one(body, "登記坪數", /([\d.]+)\s*坪/));
  d.mainAttPing = toNum(one(body, "主 ?\\+ ?附屬", /([\d.]+)\s*坪/));
  d.mainPing = toNum(one(body, "主建物坪", /([\d.]+)\s*坪/));
  d.attPing = toNum(one(body, "附屬建物", /([\d.]+)\s*坪/));
  d.landPing = toNum(one(body, "土地登記", /([\d.]+)\s*坪/));

  const fl = grab(body, "樓別\\s*/\\s*樓高", /(\d{1,3}(?:\s*[-~]\s*\d{1,3})?|全棟|整棟|全)\s*\/\s*(\d{1,3})/);
  if (fl) {
    const left = fl[0].replace(/\s/g, "");
    if (!d.floorRaw) d.floorRaw = left;
    if (d.floor == null && /^\d+$/.test(left)) d.floor = +left;
    d.total = +fl[1];
  }

  const rm = grab(body, "房\\s*/\\s*廳\\s*/\\s*衛", /(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
  if (rm) {
    d.room = +rm[0];
    d.hall = +rm[1];
    d.bath = +rm[2];
  }

  d.parkType = oneText(body, "車位型式", /([^\n]{1,20})/);
  d.usage = oneText(body, "類別\\s*/\\s*謄本用途", /([^\n]{1,24})/);
  d.kind = oneText(body, "類型\\s*/\\s*現況", /([^\n]{1,24})/);

  const kindAt = body.indexOf("類型");
  d.community = oneText(kindAt > -1 ? body.slice(kindAt) : body, "社區", /([^\n]{1,24})/);

  const dt = grab(body, "竣工日期", /(\d{4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/);
  if (dt) {
    d.y = +dt[0];
    d.m = +dt[1];
    d.dd = +dt[2];
  }

  d.facing = oneText(body, "物件座向", /([^\n]{0,14})/);
  d.ageText = oneText(body, "屋 ?齡", /([^\n]{0,12})/);
  d.agent = oneText(body, "經紀人員", /([^\n]{1,12})/);
  d.agentPhone = one(body, "電話", /(09\d{2}[- ]?\d{3}[- ]?\d{3}|0\d{1,2}[- ]?\d{6,8})/).replace(/[- ]/g, "");

  d.features = splitFeatureLines(block(body, "環境特色"));

  d.photos = picstrUrls(raw + "\n" + urls.join("\n"));

  const rent = d.deal === "rent";
  if (!d.addr) d.warnings.push("沒抓到地址（型錄頁要先把地址旁的「顯示」點開再複製）");
  else if (!parts.no) d.warnings.push("地址沒有「號」（門牌被隱藏了），要自己補");
  if (!d.total) d.warnings.push("樓別/樓高沒抓到，總樓層要自己填");
  if (rent ? d.rent == null : !d.price) d.warnings.push(rent ? "租金沒抓到" : "總價沒抓到");
  if (!d.regPing) d.warnings.push("登記坪數沒抓到");
  if (!d.room) d.warnings.push("房/廳/衛沒抓到");

  return d;
}

/* ───────── 型錄欄位 → 「新增物件」表單欄位的對照 ───────── */

/** 型錄「類型/現況」欄位的自由文字 → PROPERTY_TYPES 的 key。抓不到就回 null，交給表單退回「其他類型」文字框。 */
const KIND_TO_PROPERTY_TYPE: Array<[RegExp, string]> = [
  [/透天/, "house"],
  [/別墅/, "villa"],
  [/公寓/, "apartment"],
  [/套房/, "studio"],
  [/店面|店舖/, "shop"],
  [/辦公/, "office"],
  [/廠房|工廠/, "factory"],
  [/土地|素地/, "land"],
  [/華廈|大樓|電梯/, "building"],
];
export function guessPropertyType(kind: string): string | null {
  const hit = KIND_TO_PROPERTY_TYPE.find(([re]) => re.test(kind));
  return hit ? hit[1] : null;
}

/** 型錄地址拆出來的「鄉鎮市區」（例：沙鹿區）→ DISTRICTS 選項用的短名（沙鹿）。不在清單內就回 null。 */
export function guessDistrict(town: string, districts: readonly string[]): string | null {
  const short = town.replace(/[區鄉鎮市]$/, "");
  return districts.includes(short) ? short : null;
}
