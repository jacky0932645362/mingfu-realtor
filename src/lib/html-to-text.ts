/**
 * HTML → 純文字（2026-07-10）— 給所有 email 自動補 multipart 的純文字版,降垃圾信分數。
 *
 * 用途:`sendMail` 若呼叫端沒帶 `text`,底層用這支從 html 生一份純文字版一起送。
 *   multipart（html + text）的信 spam 分數明顯低於「只有 html」的信 → 揪團付款信 / 確認信不再進垃圾信。
 * 保守實作:不依賴外部套件、不 throw、盡量保留連結 URL 與段落換行。品質夠用即可(重點是「有 text」)。
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  let t = String(html);

  // 1. 整塊移除 script / style（含內容）
  t = t.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");

  // 2. <a href="url">label</a> → 「label (url)」保留可點連結
  t = t.replace(/<a\s[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, url, inner) => {
    const label = String(inner).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!label) return String(url);
    if (label === url || label.includes(url)) return label;
    return `${label} (${url})`;
  });

  // 3. 區塊 / 換行元素 → 換行
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<\/(p|div|tr|h[1-6]|li|table|section|header|footer|blockquote)>/gi, "\n");

  // 4. 其餘標籤全去掉
  t = t.replace(/<[^>]+>/g, "");

  // 5. 常見 HTML entity 還原
  t = t
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => {
      const code = Number(n);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    });

  // 6. 收斂空白:行內多空白 → 1 個;連續空行 → 最多 1 個空行;去頭尾空白
  t = t
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return t;
}
