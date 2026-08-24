/**
 * 極小的 Markdown 渲染器（2026-08-24）—— 只支援寫文章真的會用到的語法。
 *
 * 為什麼不裝 marked / react-markdown：
 *   文章內容是本人自己在後台打的，不是網友投稿，用不到完整規格；
 *   而完整的 Markdown 套件加上一定要配的 sanitizer（不配就是 XSS 破口）
 *   會替一個只有幾篇文章的功能多背兩個相依套件與其後續的版本維護。
 *
 * 🔴 安全做法：**先把整份原文的 HTML 特殊字元 escape 掉，再套 Markdown 規則**。
 *    順序反過來（先產 HTML 再 escape）會把自己產的標籤也吃掉；
 *    而完全不 escape 的話，文章裡打一段 <script> 就會被瀏覽器執行。
 *    因為 escape 在前，原文裡的 HTML 一律變成純文字顯示，不會生效 —— 這是刻意的。
 *
 * 支援：## / ### 標題、段落、- 清單、1. 有序清單、> 引言、| 表格 |、
 *      **粗體**、`行內程式碼`、[文字](網址)、--- 分隔線
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 行內語法。輸入必須是**已經 escape 過**的文字。
 *
 * 連結只放行 http(s) 與站內相對路徑：`javascript:` 這種偽協議如果放行，
 * 等於在文章裡開一個點擊即執行的洞。
 */
function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, text: string, href: string) => {
      const safe = /^(https?:\/\/|\/)/i.test(href);
      if (!safe) return whole;
      const external = /^https?:\/\//i.test(href);
      const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : "";
      return `<a href="${href}"${attrs}>${text}</a>`;
    });
}

/** 表格的一行 `| a | b |` 拆成儲存格，去掉頭尾的空欄。 */
function cells(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

const isTableSep = (line: string) => /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/.test(line) && line.includes("-");

export function renderMarkdown(src: string): string {
  const lines = escapeHtml(src.replace(/\r\n/g, "\n")).split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行：純粹的區塊分隔，不產生任何東西
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // 分隔線
    if (/^\s*---+\s*$/.test(line)) {
      out.push("<hr />");
      i += 1;
      continue;
    }

    // 標題（只開放 h2/h3；h1 留給頁面的文章標題，一頁只該有一個 h1）
    const heading = line.match(/^(#{2,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    // 表格：至少要有表頭 + 分隔列，否則當成一般段落
    if (line.trim().startsWith("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        body.push(cells(lines[i]));
        i += 1;
      }
      const thead = `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${body
        .map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody>`;
      out.push(`<div class="mdTableWrap"><table>${thead}${tbody}</table></div>`);
      continue;
    }

    // 引言（連續的 > 併成同一段）
    if (/^\s*&gt;\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*&gt;\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // 有序清單
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(`<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`);
        i += 1;
      }
      out.push(`<ol>${buf.join("")}</ol>`);
      continue;
    }

    // 無序清單
    if (/^\s*[-*]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        buf.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i += 1;
      }
      out.push(`<ul>${buf.join("")}</ul>`);
      continue;
    }

    // 段落：連續的非空行合成一段，單一換行不另起新段（跟一般 Markdown 一致）
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{2,3})\s/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*&gt;\s?/.test(lines[i]) &&
      !lines[i].trim().startsWith("|") &&
      !/^\s*---+\s*$/.test(lines[i])
    ) {
      buf.push(lines[i].trim());
      i += 1;
    }
    if (buf.length) out.push(`<p>${inline(buf.join(""))}</p>`);
  }

  return out.join("\n");
}

/**
 * 估閱讀時間。中文以每分鐘 350 字計（一般成人中文閱讀速度 300～400 字／分）。
 * 只是給讀者一個心理準備，不用精準，但至少要有下限 1 分鐘。
 */
export function readMinutes(src: string): number {
  const plain = src.replace(/[#*>`|_\-[\]()]/g, "").replace(/\s+/g, "");
  return Math.max(1, Math.round(plain.length / 350));
}

/** 沒填摘要時，從內文自動抓前面一段當摘要（列表頁與 SEO description 用）。 */
export function autoExcerpt(src: string, max = 110): string {
  const plain = src
    .replace(/^\s*#{1,6}\s+.*$/gm, "")
    .replace(/^\s*\|.*$/gm, "")
    .replace(/[#*>`|]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}
