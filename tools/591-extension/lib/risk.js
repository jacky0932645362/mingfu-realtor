/**
 * 文案敏感字：標出來，不刪、不改。說得出根據（實登截圖、核定公告、租約）就能寫，決定在刊登人。
 *
 * 依據：公平交易法 §21（虛偽不實／引人錯誤廣告）、不動產經紀業管理條例 §21（廣告要註明經紀業名稱）、
 * 以及本人自己的規矩（TOP 1 不准加「全台」）。
 *
 * 不碰 DOM、不碰 chrome.*。
 */

export const RISK_RULES = [
  { re: /保證|絕對|穩賺|包賺|必漲|零風險/, word: "保證／絕對", why: "對品質或報酬打包票，做不到就是廣告不實。改成可查證的具體事實。" },
  { re: /最便宜|最低價|最高級|最大|最快|最好|最強|第一名|全台第一|唯一|首選|No\.?\s*1/i, word: "最高級用語", why: "「最／第一／唯一」要有公開可查的來源，否則不能寫。" },
  { re: /賠售|虧本|認賠/, word: "賠售", why: "宣稱屋主虧本賣是事實主張，要說得出根據（原始取得價）。" },
  { re: /未來.{0,6}捷運|捷運.{0,4}(?:規劃|興建中|預定|即將)|即將通車|藍線/, word: "未通車捷運", why: "捷運藍線還沒通車：可以提，但要寫明「規劃中／興建中」，不能當已通車的賣點。" },
  { re: /增值|翻倍|漲幅|保值|投資報酬|投報|收益率/, word: "增值／投報", why: "對未來房價或收益的預測，容易被認定為誘使交易的不實廣告；租金收益要拿得出租約。" },
  { re: /明星學區|名校|第一志願/, word: "明星學區", why: "主觀評價，591「明星學區」標籤也建議別勾。" },
  { re: /低於實登|實登.{0,4}(?:便宜|以下)/, word: "低於實登", why: "跟實登比價要附得出來源與期間，否則是引人錯誤。" },
  { re: /住辦合一|可登記公司|可設籍公司/, word: "住辦合一", why: "法定用途若是「住家用」，寫住辦要對得上謄本，買方會拿謄本問。" },
];

/** 本人規矩：戰績只能寫「連續三年年度 TOP 1」，加了全台／全國／冠軍就是不實廣告 */
function top1Rule(hay) {
  return /TOP\s*1/i.test(hay) && /(全台|全國|冠軍)/.test(hay) ? { word: "TOP 1＋全台", why: "戰績措辭只能寫「連續三年年度 TOP 1」，不准加「全台」「全國」「冠軍」。" } : null;
}

/** 掃一段或多段文字，回傳命中的風險字（同一個字只回一次） */
export function findRisks(...texts) {
  const hay = texts.filter(Boolean).join("\n");
  if (!hay) return [];
  const hits = [];
  for (const r of RISK_RULES) if (r.re.test(hay) && !hits.some((h) => h.word === r.word)) hits.push({ word: r.word, why: r.why });
  const t = top1Rule(hay);
  if (t) hits.push(t);
  return hits;
}

/** Markdown 語法：591 的編輯器不吃，會原樣印出 ** # 這些符號 */
export function findMarkdown(text) {
  const out = [];
  String(text || "")
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (/\*\*[^*\n]+\*\*/.test(line)) out.push({ line: i + 1, kind: "粗體 **" });
      if (/^\s{0,3}#{1,6}\s+\S/.test(line)) out.push({ line: i + 1, kind: "標題 #" });
      if (/\[[^\]\n]+\]\([^)\n]+\)/.test(line)) out.push({ line: i + 1, kind: "連結 [文字](網址)" });
      if (/`[^`\n]+`/.test(line)) out.push({ line: i + 1, kind: "程式碼 `" });
    });
  return out;
}
