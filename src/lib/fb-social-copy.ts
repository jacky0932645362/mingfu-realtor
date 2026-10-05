/**
 * IG／Threads 版本的文案 —— 從同一則 fb_draft 的一般貼文（post_text）長出來。
 *
 * 為什麼不另外寫一套產生器：本人的工作流是「一則文案 → 發到很多地方」，
 * IG／Threads 只是多兩個地方，不該逼他再寫兩篇。所以預設值一律**從 post_text 推導**，
 * 他在貼文庫想改再改（改過就存進 fb_draft.social_json，之後不再被推導值蓋掉）。
 *
 * 兩個平台的硬限制（2026-09-21 對官方文件查證）：
 *   ・IG 說明文字上限 2,200 字、hashtag 最多 30 個；圖片 JPEG only。
 *   ・Threads 內文上限 500 字；圖片 JPEG／PNG。
 * IG 的說明文字裡網址不能點，所以帶網址的那幾行拿掉（官網物件頁那行就是）。
 */
import { OWNER } from "@/config/owner";
import type { DraftFacts } from "@/lib/fb-factory";

export const IG_CAPTION_LIMIT = 2200;
export const IG_HASHTAG_LIMIT = 30;
export const THREADS_TEXT_LIMIT = 500;

const URL_RE = /https?:\/\/\S+/i;
const HASHTAG_LINE_RE = /^\s*#\S/;

/** 文字長度：用 UTF-16 長度算（emoji 算 2），比平台的算法保守，寧可少算不要超。 */
export function socialLength(s: string): number {
  return s.length;
}

function squash(s: string): string {
  return s.replace(/\s+/g, "");
}

function hasCompanyName(body: string): boolean {
  return squash(body).includes(squash(OWNER.company));
}

/** 從 post_text 抽出 hashtag（照出現順序、去重）。 */
export function extractHashtags(postText: string): string[] {
  const out: string[] = [];
  for (const m of postText.matchAll(/#([^\s#]+)/g)) {
    const tag = m[1];
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** 在「段落」邊界把文字切到 limit 以內，切了就補「…」。 */
function cutAtParagraph(text: string, limit: number): string {
  if (socialLength(text) <= limit) return text;
  const paras = text.split(/\n\n+/);
  let out = "";
  for (const p of paras) {
    const next = out ? `${out}\n\n${p}` : p;
    if (socialLength(next) > limit - 1) break;
    out = next;
  }
  if (!out) out = text.slice(0, Math.max(0, limit - 1));
  return `${out}…`;
}

/**
 * IG 說明文字：一般貼文拿掉帶網址的行（IG 不能點連結）、hashtag 最多 30 個、總長 ≤ 2,200。
 * 其他一字不動 —— 本人的 CTA、聯賣聯絡、經紀業落款都保留。
 */
export function deriveIgCaption(postText: string): string {
  const lines = (postText || "").split(/\r?\n/).filter((l) => !URL_RE.test(l));
  let body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // hashtag 只留前 30 個（多的 IG 會整篇拒登）
  const tags = extractHashtags(body);
  if (tags.length > IG_HASHTAG_LIMIT) {
    const drop = new Set(tags.slice(IG_HASHTAG_LIMIT));
    body = body
      .split(/\r?\n/)
      .map((l) =>
        HASHTAG_LINE_RE.test(l)
          ? l
              .split(/\s+/)
              .filter((w) => !(w.startsWith("#") && drop.has(w.slice(1))))
              .join(" ")
          : l,
      )
      .join("\n");
  }

  if (!hasCompanyName(body)) body = `${body}\n\n${OWNER.name}｜${OWNER.company}`;
  return cutAtParagraph(body, IG_CAPTION_LIMIT);
}

/**
 * Threads 內文（≤ 500 字）：鉤子一行 ＋ 規格幾行 ＋ 最多兩個亮點 ＋ CTA ＋ 經紀業名稱 ＋ 最多 3 個 hashtag。
 * 塞不下就照「亮點 → hashtag → 規格（從下往上）」的順序丟，鉤子、CTA、公司名永遠留著
 * （不動產經紀業管理條例 §21：廣告要註明經紀業名稱，Threads 一樣是廣告）。
 * 沒有結構化事實的手動文案：直接照 post_text 一行一行往下裝，裝到 500 字為止。
 */
export function deriveThreadsText(postText: string, facts: DraftFacts | null | undefined): string {
  const text = (postText || "").trim();
  const firstLine =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !URL_RE.test(l) && !HASHTAG_LINE_RE.test(l)) || "";
  const hook = firstLine.replace(/^🏠\s*/, "");
  const cta = `想看屋或問細節 → 私訊我，或打 ${OWNER.phone}（電話／LINE 同號）`;
  const sign = `${OWNER.name}｜${OWNER.company}`;
  const tags = extractHashtags(text).slice(0, 3);

  const f = facts || {};
  const hasFacts = Boolean(f.totalPriceWan || f.layout || f.areaPing || f.district);

  if (!hasFacts) {
    // 手動文案：照原文一行一行裝，公司名的位置先保留
    const budget = THREADS_TEXT_LIMIT - (hasCompanyName(text) ? 0 : socialLength(sign) + 2) - 1;
    const kept: string[] = [];
    let used = 0;
    for (const raw of text.split(/\r?\n/)) {
      const l = raw.trimEnd();
      if (URL_RE.test(l)) continue;
      const cost = socialLength(l) + (kept.length ? 1 : 0);
      if (used + cost > budget) break;
      kept.push(l);
      used += cost;
    }
    let out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!hasCompanyName(out)) out = `${out}\n\n${sign}`;
    return out;
  }

  const specs: string[] = [];
  const where = f.address || (f.district ? `${f.city || "台中市"}${f.district}` : "");
  if (where) specs.push(`📍 ${where}`);
  if (f.totalPriceWan) specs.push(`💰 ${f.totalPriceWan} 萬`);
  if (f.layout) specs.push(`🛏 ${f.layout}`);
  if (f.areaPing) specs.push(`📐 ${f.areaPing} 坪`);
  if (f.parking) specs.push(`🚗 ${f.parking}`);
  if (f.floorInfo) specs.push(`🏢 ${f.floorInfo}${f.buildingType ? `・${f.buildingType}` : ""}`);
  const feats = (f.features || []).slice(0, 2).map((x) => `・${x}`);

  const assemble = (s: string[], fe: string[], tg: string[]) =>
    [hook, s.join("\n"), fe.join("\n"), cta, sign, tg.map((t) => `#${t}`).join(" ")]
      .filter((b) => b && b.trim())
      .join("\n\n");

  let out = assemble(specs, feats, tags);
  if (socialLength(out) > THREADS_TEXT_LIMIT) out = assemble(specs, [], tags);
  if (socialLength(out) > THREADS_TEXT_LIMIT) out = assemble(specs, [], []);
  let s = [...specs];
  while (socialLength(out) > THREADS_TEXT_LIMIT && s.length) {
    s = s.slice(0, -1);
    out = assemble(s, [], []);
  }
  if (socialLength(out) > THREADS_TEXT_LIMIT) {
    // 連鉤子都太長 —— 把鉤子切短
    const fixed = socialLength([cta, sign].join("\n\n")) + 4;
    out = `${hook.slice(0, Math.max(10, THREADS_TEXT_LIMIT - fixed - 1))}…\n\n${cta}\n\n${sign}`;
  }
  return out;
}
