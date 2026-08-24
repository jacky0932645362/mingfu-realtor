/**
 * 第 2 步：把 591 刊登表單的欄位抄下來
 *
 * 跑法：npm run inspect
 *
 * 為什麼需要這一步？
 *   我（Claude）沒有 591 的帳號，看不到刊登表單長什麼樣，
 *   而「不知道就不要猜」是這個專案的硬規矩 —— 猜錯選擇器的結果是填錯格子，
 *   填錯格子的結果是上架錯資料。所以改成讓程式自己去問那一頁：
 *   把頁面上每一個輸入框的 id／name／placeholder／旁邊的標籤文字全部 dump 出來，
 *   再照著那份清單填 config/selectors.json。
 *
 * 產出：
 *   config/form-dump.json  ← 整頁欄位清單（拿這個去填 selectors.json）
 *   shots/inspect-*.png    ← 當下的整頁截圖
 */
import { chromium } from "playwright";
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { AUTH_FILE, SHOTS_DIR, SITE_591, ensureDir, stamp, waitForEnter } from "./_shared.mjs";

if (!existsSync(AUTH_FILE)) {
  console.error(`找不到登入狀態 ${AUTH_FILE}\n先跑：npm run login`);
  process.exit(1);
}

const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--start-maximized"] });
const context = await browser.newContext({ storageState: AUTH_FILE, viewport: null });
const page = await context.newPage();

await page.goto(SITE_591, { waitUntil: "domcontentloaded" });

await waitForEnter(
  [
    "─".repeat(60),
    "請在瀏覽器裡自己導航到「刊登物件／新增物件」那一頁，",
    "把表單開到你平常填的那個畫面（如果分好幾步，先停在第一步）。",
    "",
    "到位之後回來按 Enter，我會把這一頁的所有欄位抄下來。",
    "─".repeat(60),
  ].join("\n"),
);

const url = page.url();
console.log(`\n正在抄這一頁的欄位：${url}`);

/**
 * 在頁面裡跑，把每個可填的元素連同「人看得懂的標籤」一起挖出來。
 * 標籤用四種方式找，因為表單的寫法各家不同：
 *   ① <label for="id">  ② 包在 <label> 裡面  ③ aria-label  ④ 前面最近的文字節點
 */
const fields = await page.evaluate(() => {
  function labelFor(el) {
    if (el.id) {
      const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (byFor?.innerText.trim()) return byFor.innerText.trim();
    }
    const wrapper = el.closest("label");
    if (wrapper?.innerText.trim()) return wrapper.innerText.trim();
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label").trim();

    // 往上找三層，取這一列裡第一段看起來像標籤的文字
    let node = el.parentElement;
    for (let i = 0; i < 3 && node; i += 1) {
      const text = Array.from(node.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent.trim())
        .filter(Boolean)
        .join(" ");
      if (text) return text.slice(0, 40);
      node = node.parentElement;
    }
    return "";
  }

  function cssPath(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.className && typeof node.className === "string") {
        const cls = node.className.trim().split(/\s+/).slice(0, 2).map((c) => `.${CSS.escape(c)}`).join("");
        part += cls;
      }
      const siblings = node.parentElement ? Array.from(node.parentElement.children).filter((c) => c.tagName === node.tagName) : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  const out = [];
  const nodes = document.querySelectorAll("input, select, textarea, [contenteditable='true']");
  for (const el of nodes) {
    const type = (el.getAttribute("type") || el.tagName).toLowerCase();
    if (type === "hidden") continue;

    const rect = el.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";

    out.push({
      tag: el.tagName.toLowerCase(),
      type,
      id: el.id || null,
      name: el.getAttribute("name") || null,
      placeholder: el.getAttribute("placeholder") || null,
      label: labelFor(el),
      selector: cssPath(el),
      visible,
      currentValue: el.value ? String(el.value).slice(0, 40) : null,
      options:
        el.tagName === "SELECT"
          ? Array.from(el.options).slice(0, 60).map((o) => ({ value: o.value, text: o.text.trim() }))
          : undefined,
    });
  }
  return out;
});

/** 有些表單用 div 假扮下拉，光看 input 會漏掉，所以順手把看起來像下拉的東西也記下來 */
const pseudoSelects = await page.evaluate(() => {
  const out = [];
  const candidates = document.querySelectorAll(
    "[class*='select'], [class*='dropdown'], [role='combobox'], [role='listbox']",
  );
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const text = el.innerText?.trim().slice(0, 30) || "";
    if (!text) continue;
    out.push({
      text,
      className: typeof el.className === "string" ? el.className.slice(0, 80) : "",
      role: el.getAttribute("role") || null,
    });
  }
  return out.slice(0, 40);
});

ensureDir(path.dirname(path.join(import.meta.dirname, "config", "x")));
ensureDir(SHOTS_DIR);

const dumpFile = path.join(import.meta.dirname, "config", "form-dump.json");
writeFileSync(
  dumpFile,
  JSON.stringify({ url, capturedAt: new Date().toISOString(), fields, pseudoSelects }, null, 2),
  "utf8",
);

const shot = path.join(SHOTS_DIR, `inspect-${stamp()}.png`);
await page.screenshot({ path: shot, fullPage: true });

const visible = fields.filter((f) => f.visible);
console.log(`\n✅ 抄到 ${fields.length} 個欄位（其中 ${visible.length} 個看得見）`);
console.log(`   清單：${dumpFile}`);
console.log(`   截圖：${shot}`);
console.log("\n看得見的欄位：");
for (const f of visible) {
  const opts = f.options ? `  [下拉 ${f.options.length} 個選項]` : "";
  console.log(`  ${(f.label || "(沒有標籤)").padEnd(16)} ${f.type.padEnd(10)} ${f.selector}${opts}`);
}

console.log(
  [
    "",
    "─".repeat(60),
    "下一步：把 config/form-dump.json 這個檔貼回對話裡給我，",
    "我照它填好 config/selectors.json，你就可以跑 npm run fill 了。",
    "（591 改版之後表單會變，那時候重跑這支 inspect 再給我一次就好）",
    "─".repeat(60),
  ].join("\n"),
);

await browser.close();
process.exit(0);
