/**
 * FB 貼文工廠 — 文案產生（2026-09-03）
 *
 * 純函式：進來一筆 PropertyRow，出去 fb_draft 需要的三塊（facts / post_text / marketplace）。
 * 不碰資料庫、不碰 React（測得起來，而且「後台看到的」＝「真的發出去的」）。
 *
 * ⚠️ 另一台已經有一套產生器（facts_json → post_text）。這台的產生器**輸出格式對齊**
 *    另一台既有 fb_draft 的長相（emoji 分段、hashtag 收尾、經紀業署名），
 *    但多做一件另一台沒做的事：**發出去之前掃一次外洩與 Markdown**。
 *
 * 🚫 不准捏造。缺的資料留成看得見的空格讓本人自己填。
 */
import type { PropertyRow } from "@/lib/property";
import { propertyTypeLabel } from "@/lib/property";
import { OWNER } from "@/config/owner";
import type { DraftFacts, MarketplacePayload } from "@/lib/fb-factory";

/* ────────────────── 情境 ────────────────── */

export const SCENARIOS = [
  { key: "new", label: "新物件開價", hint: "第一次曝光，主打價格與條件" },
  { key: "repost", label: "再推一次（換角度）", hint: "同一間房隔一陣子再發" },
  { key: "open_house", label: "週末開放看屋", hint: "揪看屋，時間要自己填" },
  { key: "price_cut", label: "降價通知", hint: "原價要自己填" },
  { key: "sold", label: "成交報喜", hint: "只報喜不報價" },
] as const;

export type ScenarioKey = (typeof SCENARIOS)[number]["key"];

export function scenarioLabel(key: string): string {
  return SCENARIOS.find((s) => s.key === key)?.label || key;
}

const 待填 = (what: string) => `（${what}）`;

function clean(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function pingNum(value: string | number | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pingText(value: string | number | null): string {
  const n = pingNum(value);
  if (n == null) return "";
  return `${Number.isInteger(n) ? n : Number(n.toFixed(2))} 坪`;
}

function splitFeatures(raw: string | null): string[] {
  return clean(raw)
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * FB 貼文的地址只到路名。
 *
 * 🔴 貼到公開社團的文案不該出現門牌號 —— 就算物件的 address_public 欄位裡有
 *    （本人有時會把號碼填進去），FB 這條通路一律砍掉「N號」與後面的樓層段。
 *    memory：完整門牌是內部欄位，不會出現在貼到 FB 的文案裡。
 */
export function roadLevelAddress(raw: string | null | undefined): string {
  const s = clean(raw);
  if (!s) return "";
  // 砍掉第一個「號」（全形/半形數字都算）以及後面全部
  const cut = s.replace(/[０-９0-9一二三四五六七八九十百]+號.*$/, "").trim();
  // 沒有「號」但有「巷/弄/N之N」也砍
  return cut.replace(/[０-９0-9]+(?:巷|弄|之[０-９0-9]+).*$/, "").trim() || cut || s;
}

/* ────────────────── facts_json ────────────────── */

/** 從物件抽出結構化事實，格式對齊另一台既有 fb_draft.facts_json 的欄位名。 */
export function buildFacts(p: PropertyRow): DraftFacts {
  const size = pingNum(p.size_ping);
  const main = pingNum(p.main_building_ping);
  const price = p.price ?? null;
  return {
    title: clean(p.headline) || clean(p.title) || null,
    communityName: clean(p.community) || null,
    city: "台中市",
    district: clean(p.district) ? `${p.district}區` : null,
    // 🔴 FB 通路一律只到路名。門牌號連 address_public 裡的都砍掉。
    address: roadLevelAddress(p.address_public) || null,
    totalPriceWan: price,
    unitPriceWan: price && size ? Number((price / size).toFixed(2)) : null,
    areaPing: size,
    mainAreaPing: main,
    layout: clean(p.layout) || null,
    floorInfo: clean(p.floor_info) || null,
    buildingType: propertyTypeLabel(p) || null,
    ageText: p.age_years != null ? `屋齡${p.age_years}年` : null,
    parking: clean(p.parking) || null,
    features: splitFeatures(p.highlights),
    note: null,
  };
}

/* ────────────────── 一般貼文 post_text ────────────────── */

function scenarioLead(p: PropertyRow, scenario: string): { lead: string; warn: string[] } {
  const where = clean(p.district);
  const type = propertyTypeLabel(p);
  switch (scenario) {
    case "price_cut":
      return {
        lead: `🔻 降價通知\n${待填("原價 ___ 萬")} → ${p.price != null ? `${p.price} 萬` : 待填("現價")}`,
        warn: ["降價文的「原價」資料庫裡沒有，程式不會猜。發出去前自己把括號填掉。"],
      };
    case "open_house":
      return {
        lead: `📅 這個週末開放看屋\n時間：${待填("日期")} ${待填("幾點到幾點")}\n不用預約，直接來，我在現場。`,
        warn: ["看屋時間是空格，自己填完再發。"],
      };
    case "sold":
      return {
        lead: `🎉 這間成交了，謝謝屋主與買方的信任。\n${where}${type ? `的${type}` : ""}最近成交速度比想像中快，手上有想賣的可以找我聊聊。`,
        warn: p.status === "sold" ? [] : ["這筆物件狀態不是「已成交」，報喜文發出去前先確認。"],
      };
    default:
      return { lead: "", warn: [] };
  }
}

function hashtags(p: PropertyRow): string[] {
  const tags = new Set<string>(["台中海線", "台中房地產", "太平洋房屋"]);
  const d = clean(p.district);
  if (d) {
    tags.add(`${d}區房屋`);
    tags.add(`${d}區買房`);
  }
  const c = clean(p.community);
  if (c) tags.add(c.replace(/[\s#]/g, ""));
  if (clean(p.parking).match(/平面|平車/)) tags.add("平面車位");
  return [...tags].filter((t) => t.length >= 2 && t.length <= 20);
}

/** CTA／署名／hashtag 這段收尾的起點記號。buildMarketplace() 靠它把這段切掉，兩邊共用同一個常數，不用各存一份怕漏改。 */
const CTA_SEPARATOR = "————————";

/**
 * 一般貼文內文。骨架照 reference_內容產出規格 的要素順序，
 * 對齊另一台既有 fb_draft.post_text 的長相（🏠 開頭、emoji 分段規格欄、CTA、hashtag）。
 */
export function buildPostText(p: PropertyRow, scenario: string): { text: string; warnings: string[] } {
  const { lead, warn } = scenarioLead(p, scenario);
  const blocks: string[] = [];

  if (scenario === "sold") {
    blocks.push(lead);
    const bits = [
      clean(p.district) ? `📍 台中市${p.district}區` : "",
      [clean(p.layout), propertyTypeLabel(p)].filter(Boolean).join("｜"),
      clean(p.community) ? `🏘 ${p.community}` : "",
    ].filter(Boolean);
    if (bits.length) blocks.push(bits.join("\n"));
    blocks.push("同社區、同區域還有想看的，或想知道你家現在值多少，留言或私訊我。");
  } else {
    if (lead) blocks.push(lead);

    const where = roadLevelAddress(p.address_public) || (clean(p.district) ? `台中市${p.district}區` : "");
    const headline = clean(p.headline);
    blocks.push(
      `🏠 ${headline || `【${clean(p.district) || "台中"}│${clean(p.community) || clean(p.title)}】${clean(p.layout)} 新上架`}`,
    );

    const glance: string[] = [];
    if (where) glance.push(`📍 ${where}`);
    if (p.price != null) glance.push(`💰 ${p.price} 萬${clean(p.price_note) ? `｜${p.price_note}` : ""}`);
    if (pingText(p.size_ping)) glance.push(`📐 權狀 ${pingText(p.size_ping)}`);
    if (clean(p.layout)) glance.push(`🛏 ${p.layout}`);
    const floor = [clean(p.floor_info), propertyTypeLabel(p), clean(p.direction)].filter(Boolean).join("・");
    if (floor) glance.push(`🏢 ${floor}`);
    if (clean(p.parking)) glance.push(`🚗 ${p.parking}`);
    if (p.age_years != null) glance.push(`📅 屋齡 ${p.age_years} 年`);
    if (glance.length) blocks.push(glance.join("\n"));

    const feats = splitFeatures(p.highlights);
    if (feats.length) blocks.push(["✨ 本案亮點", ...feats.map((f) => `・${f}`)].join("\n"));

    // 房仲語言 → 客戶語言：登記坪數不等於能用的空間
    const size = pingNum(p.size_ping);
    const main = pingNum(p.main_building_ping);
    if (size && main && main < size) {
      blocks.push(
        `【坪數怎麼看】\n登記 ${size} 坪，真正走得到的室內（主建物）是 ${main} 坪，` +
          `其餘 ${(size - main).toFixed(2)} 坪是陽台、雨遮與公設分攤。`,
      );
    }

    if (clean(p.description)) blocks.push(clean(p.description));
    if (clean(p.suitable_for)) blocks.push(`【適合誰】\n${clean(p.suitable_for)}`);
    if (clean(p.life_info)) blocks.push(`【生活機能】\n${clean(p.life_info)}`);
    if (clean(p.transport_info)) blocks.push(`【交通與重大建設】\n${clean(p.transport_info)}`);
  }

  // CTA
  const cta = [
    CTA_SEPARATOR,
    "想看這間房，或想知道同社區有沒有別的物件，直接留言或私訊我，電話／LINE 也可以。",
    `📞 ${OWNER.phone}（電話／LINE 同號）`,
  ];
  const site = process.env.NEXT_PUBLIC_SITE_URL || "https://mingfu-realtor.vercel.app";
  if (clean(p.slug) && !site.includes("localhost")) {
    cta.push(`🗓 完整照片與影片：${site}/property/${clean(p.slug)}`);
  }
  blocks.push(cta.join("\n"));

  // 署名（§21）
  blocks.push(`${OWNER.name}｜${OWNER.company}`);

  const tags = hashtags(p);
  if (tags.length) blocks.push(tags.map((t) => `#${t}`).join(" "));

  const text = blocks.filter(Boolean).join("\n\n");
  return { text, warnings: [...warn, ...checkCopy(text, p)] };
}

/* ────────────────── Marketplace ────────────────── */

export const MP_TITLE_LIMIT = 60;

export function buildMarketplace(
  p: PropertyRow,
  postText: string,
): { payload: MarketplacePayload; warnings: string[] } {
  const warnings: string[] = [];

  const parts = [
    clean(p.district) ? `${p.district}區` : "",
    clean(p.community),
    clean(p.layout),
    pingText(p.size_ping),
  ].filter(Boolean);
  let title = parts.join(" ");
  if (title.length > MP_TITLE_LIMIT) {
    title = title.slice(0, MP_TITLE_LIMIT);
    warnings.push(`Marketplace 標題超過 ${MP_TITLE_LIMIT} 字已裁短，自己看一下。`);
  }

  // 🔴 資料庫 price 單位是「萬」，Marketplace 價格欄吃「元」。768 萬 → 7680000。
  const priceTwd = p.price != null ? Math.round(p.price * 10_000) : null;
  if (priceTwd == null) warnings.push("沒有價格，Marketplace 價格欄必填，刊不出去。");

  /*
   * 說明沿用一般貼文的物件內容本身，但把收尾那段整段拿掉：CTA（聯絡方式／外部連結）、
   * 署名、hashtag 是系統自動加到一般貼文後面的，2026-09-24 本人明講 Marketplace 不要
   * ——平台本身就有賣家聯絡管道，外部連結跟 hashtag 對 Marketplace 都是多的。
   * 不是只拿掉 hashtag，是連 CTA 那三行、署名都要一起切掉，從分隔線那裡砍，
   * 不額外加任何東西進去；之後本人在畫面上改這欄，也是原樣存檔，不會再被這裡動到。
   */
  const ctaIndex = postText.indexOf(CTA_SEPARATOR);
  const description = (ctaIndex > -1 ? postText.slice(0, ctaIndex) : postText).trim();

  warnings.push("發佈要回桌機跑 FB-Marketplace.bat（會自動填表單、傳照片、勾社團、發佈）。這一頁先把欄位補好，尤其「狀況」沒選桌機會擋。");

  return {
    payload: {
      title: title || p.title,
      priceTwd,
      description,
      location: roadLevelAddress(p.address_public) || (clean(p.district) ? `台中市${p.district}區` : ""),
      fields: {
        propertyType: propertyTypeLabel(p) || null,
        layout: clean(p.layout) || null,
        areaPing: pingNum(p.size_ping),
        floorInfo: clean(p.floor_info) || null,
      },
    },
    warnings,
  };
}

/* ────────────────── 合規檢查 ────────────────── */

/**
 * FB 貼文框沒有 Markdown。寫 `**重點**` 就是原樣印出四個星號 —— 而且發出去才會發現。
 * 只抓「幾乎不可能是故意的」那幾種（破折號、括號、emoji 本人本來就大量在用，誤擋比漏擋煩）。
 */
export function findMarkdownSyntax(body: string): Array<{ line: number; kind: string; text: string }> {
  const out: Array<{ line: number; kind: string; text: string }> = [];
  body.split(/\r?\n/).forEach((text, i) => {
    const line = i + 1;
    if (/\*\*[^*\n]+\*\*/.test(text)) out.push({ line, kind: "粗體 **", text });
    else if (/__[^_\n]+__/.test(text)) out.push({ line, kind: "粗體 __", text });
    if (/^\s{0,3}#{1,6}\s+\S/.test(text)) out.push({ line, kind: "標題 #", text });
    if (/\[[^\]\n]+\]\([^)\n]+\)/.test(text)) out.push({ line, kind: "連結 [文字](網址)", text });
    if (/`[^`\n]+`/.test(text)) out.push({ line, kind: "行內程式碼 `", text });
  });
  return out;
}

/**
 * 外洩檢查。每一條都有真實代價：
 *   完整門牌 → 屋主的家被貼上公開社團
 *   internal_note → 屋主底價，客戶看到就沒得談
 *   Email → 本人明確決定不公開個人 Gmail
 *   TOP1 措辭 → 加「全台」就是不實廣告
 */
export function checkCopy(body: string, p: PropertyRow): string[] {
  const out: string[] = [];

  // 🔴 FB 這條通路的地址一律只到路名。文案裡出現「路名＋N號」「N樓之N」都擋下來。
  //    但「中市字第00887號」這種證照字號、「第3號公園」這種不是門牌 —— 前面帶「第」就放過。
  const bodyForAddr = body.replace(/第\s*[０-９0-9]+\s*號/g, "");
  const houseNo = bodyForAddr.match(/(?:路|街|大道|巷|弄)[^\n，、。]{0,8}?[０-９0-9一二三四五六七八九十百]+號/)?.[0];
  const unitNo = bodyForAddr.match(/[０-９0-9一二三四五六七八九十]+樓之[０-９0-9一二三四五六七八九十]+/)?.[0];
  const leak = unitNo || houseNo;
  if (leak) {
    out.push(`🔴 文案裡出現了「${leak}」—— FB 通路的地址只到路名，門牌號／樓別要拿掉。`);
  }

  const full = clean(p.address);
  if (full && body.includes(full) && !leak) {
    out.push("🔴 文案裡出現了完整門牌。FB 通路只能到路名。");
  }

  const note = clean(p.internal_note);
  if (note && note.length >= 8 && body.includes(note.slice(0, 12))) {
    out.push("🔴 文案裡出現了「內部備註」的內容（通常是屋主底價），檢查一下。");
  }

  if (OWNER.email && body.includes(OWNER.email)) {
    out.push("🔴 文案裡有 Email。對外聯絡方式只有電話／LINE／線上預約。");
  }

  if (/TOP\s*1/i.test(body) && /(全台|全國|冠軍|第一名)/.test(body)) {
    out.push('🔴 戰績措辭只能寫「連續三年年度 TOP 1」，不准加「全台」「全國」「冠軍」。');
  }

  if (findMarkdownSyntax(body).length > 0) {
    out.push("🔴 有 Markdown 語法（** # []() `）。FB 不吃，會原樣印出符號。");
  }

  // 🔴 比對前先把空白拿掉。本人手寫的落款是「太平洋房屋梧棲新市鎮加盟店」（中間沒空格），
  //    設定檔裡是「太平洋房屋 梧棲新市鎮加盟店」（有空格）—— 用 includes() 硬比會判成
  //    「沒帶到經紀業名稱」，但其實有寫，只是排版不一樣。誤報比漏報更煩（每次都要看一次紅字，
  //    看久了就會忽略真的警告）。2026-09-08 覓蜜那則就是這樣被誤報的。
  if (!hasCompanyName(body)) {
    out.push("沒有帶到經紀業名稱。不動產經紀業管理條例 §21 要求廣告要註明經紀業名稱。");
  }

  return out;
}

/** 文案裡有沒有寫到經紀業名稱（忽略空白差異）。 */
export function hasCompanyName(body: string): boolean {
  const squash = (s: string) => s.replace(/\s+/g, "");
  return squash(body).includes(squash(OWNER.company));
}

/* ────────────────── 手動填一筆 ────────────────── */

export function buildManualDraft(input: {
  title: string;
  body: string;
  /** 已經 parseImageList() 過的照片網址（第一張＝封面）。 */
  photos?: string[];
  /** 已經 parseFbVideoLine() 過的影片（網址或桌機路徑，一支）。 */
  video?: string | null;
}): { postText: string; facts: DraftFacts; warnings: string[] } {
  let postText = input.body.trim();
  // 同 checkCopy：忽略空白差異，免得本人自己寫了「太平洋房屋梧棲新市鎮加盟店」（沒空格）
  // 還被自動補上第二個署名。
  if (!hasCompanyName(postText)) {
    postText = `${postText}\n\n${OWNER.name}｜${OWNER.company}`;
  }

  const warnings: string[] = [];
  const md = findMarkdownSyntax(postText);
  for (const m of md) warnings.push(`🔴 第 ${m.line} 行有 ${m.kind}，FB 會原樣印出符號。`);
  if (OWNER.email && postText.includes(OWNER.email)) {
    warnings.push("🔴 文案裡有 Email，對外聯絡方式只有電話／LINE／線上預約。");
  }
  if (/TOP\s*1/i.test(postText) && /(全台|全國|冠軍|第一名)/.test(postText)) {
    warnings.push('🔴 戰績措辭不准加「全台」「全國」「冠軍」。');
  }

  const photos = (input.photos || []).slice(0, 10);
  const video = input.video || null;
  return {
    postText,
    facts: {
      title: input.title,
      note: "手動填的，沒有結構化物件資料",
      ...(photos.length ? { photos } : {}),
      ...(video ? { video } : {}),
    },
    warnings,
  };
}
