/**
 * 外掛自己的操作頁：貼資料 → 解析 → 每一格 → 標題描述 → 照片 → 上架。
 *
 * 不連任何伺服器。個人資料（姓名／手機／LINE／落款／尾段）存 chrome.storage.local，只在使用者自己的 Chrome 裡。
 * 解析與對應規則在 lib/（純函式，node 測得起來）；這支只做畫面與存取。
 *
 * 貼上時會偷看剪貼簿的 text/html：從型錄頁 Ctrl+C 帶著的 <a href> 裡撈「更多照片」與型錄頁網址，
 * 使用者就不用再右鍵複製連結。textarea 本身只收純文字，所以要在 paste 事件裡讀。
 */
import { parseListing, photoLinkReport, photosFromCatalogHtml, listingNoFromUrl, isCatalogPage, soleCatalogUrl, isCatalogHtml, catalogTextFromHtml, withShowAddr, photoUrlKey } from "./lib/parser.js";
import { derive, buildRows, buildPayload, titleCheck, cleanTitle, suggestTitle, applyTitlePrefix, buildDescription, descRisks, DEFAULTS, fillTail } from "./lib/map591.js";
import { findMarkdown } from "./lib/risk.js";
import { buildRakuya, RAKUYA_TITLE_MAX } from "./lib/rakuya-map.js";
import { TAIL_COLORS, normalizeTailStyle, tailStyleActive, lineStyleCss, tailStartIndex, HEAD_FONT_SIZE } from "./lib/tailStyle.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const hasChrome = typeof chrome !== "undefined" && !!(chrome.runtime && chrome.runtime.sendMessage);
const SETTINGS_KEY = "listing:settings";

/* ───────── 我的資料 ───────── */
const DEFAULT_SETTINGS = { name: "", phone: "", line: "", company: "", contract: DEFAULTS.contract, descHead: DEFAULTS.descHead, titlePrefix: "", tail: "", tailStyle: normalizeTailStyle(null), coverSticker: null };
let settings = { ...DEFAULT_SETTINGS, tailStyle: normalizeTailStyle(DEFAULT_SETTINGS.tailStyle) }; // tailStyle 是巢狀物件，spread 只會複製參照，這裡另外複製一份避免共用到同一份 lines[]

async function loadSettings() {
  try {
    if (hasChrome && chrome.storage && chrome.storage.local) {
      const o = await chrome.storage.local.get([SETTINGS_KEY, LICENSE_KEY]);
      if (o[SETTINGS_KEY]) settings = { ...DEFAULT_SETTINGS, ...o[SETTINGS_KEY] };
      $("s-key").value = o[LICENSE_KEY] || "";
    } else {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    /* 讀不到就用預設 */
  }
  settings.tailStyle = normalizeTailStyle(settings.tailStyle);
  renderSettings();
}
function renderSettings() {
  $("s-name").value = settings.name;
  $("s-phone").value = settings.phone;
  $("s-line").value = settings.line;
  $("s-company").value = settings.company;
  $("s-contract").value = settings.contract;
  $("s-head").value = settings.descHead;
  $("s-title-prefix").value = settings.titlePrefix;
  $("s-tail").value = settings.tail;
  $("ts-size").value = settings.tailStyle.size;
  $("ts-bold").checked = settings.tailStyle.bold;
  $("ts-underline").checked = settings.tailStyle.underline;
  renderTailLines();
  renderCoverSticker();
}

/**
 * ───────── 封面貼圖（2026-09-24 本人要求）─────────
 * 本人先在官網「批次貼圖」（/admin/sticker）那頁測，覺得「還要另外開一頁、丟圖、下載」太麻煩，
 * 問「物件上架助手」能不能自動——這裡整合進外掛本身：存一張貼圖（去背人像＋落款帶那種），貼型錄
 * 解析完會自動把它合成到「第一張照片」（591 封面）上，滿版寬、貼齊底部，跟批次貼圖工具那邊「封面
 * 貼圖」的定位邏輯一樣（本人已經在那邊驗證過這個位置對）。只存一張（不是像批次貼圖工具那樣一整個
 * 貼圖庫可以切換）——這裡的使用情境是「我固定用這張落款帶」，要換人就直接在這裡重新上傳蓋掉，
 * 不需要多張互相切換那麼複雜；真的要多套版型，還是去用批次貼圖工具本身。
 * 存在 chrome.storage.local 的 settings 裡（跟姓名電話同一份、同樣只在這台 Chrome），上傳時先縮到
 * 最長邊 800px（COVER_STICKER_MAX_PX）避免塞爆 storage 額度（沒有 unlimitedStorage 權限，quota 上限
 * 10MB，其他設定+授權碼快取也共用這個額度）。
 */
const COVER_STICKER_MAX_PX = 800;
function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("圖片讀取失敗"));
    img.src = src;
  });
}
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("檔案讀取失敗"));
    r.readAsDataURL(file);
  });
}
async function downscaleStickerFile(file, maxDim = COVER_STICKER_MAX_PX) {
  const raw = await fileToDataURL(file);
  const img = await loadImageEl(raw);
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  return { src: canvas.toDataURL("image/png"), w, h }; // PNG 保留透明背景，去背人像才不會帶白色色塊
}
function renderCoverSticker() {
  const has = !!(settings.coverSticker && settings.coverSticker.src);
  $("cs-preview-row").hidden = !has;
  $("cs-remove").hidden = !has;
  if (has) $("cs-preview").src = settings.coverSticker.src;
}
$("cs-file").addEventListener("change", async (e) => {
  const file = (e.target.files || [])[0];
  e.target.value = "";
  if (!file) return;
  try {
    const { src, w, h } = await downscaleStickerFile(file);
    settings.coverSticker = { src, naturalW: w, naturalH: h };
    renderCoverSticker();
    flash($("cs-msg"), "已選好，記得按下面「儲存」才會真的存起來", "warn");
  } catch (err) {
    flash($("cs-msg"), `讀取失敗：${err.message}`, "bad");
  }
});
$("cs-remove").addEventListener("click", () => {
  settings.coverSticker = null;
  renderCoverSticker();
  flash($("cs-msg"), "已移除，記得按下面「儲存」", "warn");
});

/* ───────── 固定尾段的樣式：字級／粗體／底線整段共用，文字顏色／底色一行一行各自選 ───────── */
const tailLineTexts = () =>
  String($("s-tail").value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
/** 存檔用：字級／粗體／底線讀畫面目前的值；每行的顏色只存在 settings.tailStyle.lines（沒有對應的 DOM 值可讀） */
const currentTailStyle = () => ({ size: $("ts-size").value, bold: $("ts-bold").checked, underline: $("ts-underline").checked, lines: settings.tailStyle.lines });
function swatchesHtml(selected) {
  const none = `<button type="button" class="ts-swatch none${selected ? "" : " sel"}" data-color="" title="不設定">✕</button>`;
  const rest = TAIL_COLORS.map((c) => `<button type="button" class="ts-swatch${c === selected ? " sel" : ""}" style="background:${c}" data-color="${c}" title="${c}"></button>`).join("");
  return none + rest;
}
function renderTailLines() {
  const texts = tailLineTexts();
  $("ts-empty").hidden = texts.length > 0;
  const box = $("ts-lines");
  box.innerHTML = texts
    .map((t, i) => {
      const cur = settings.tailStyle.lines[i] || { color: "", bg: "" };
      return `<div class="ts-line"><div class="ts-line-text">${esc(t)}</div>
      <div class="ts-swatch-row" data-line="${i}" data-role="color"><span class="ts-swatch-lab">文字</span>${swatchesHtml(cur.color)}</div>
      <div class="ts-swatch-row" data-line="${i}" data-role="bg"><span class="ts-swatch-lab">底色</span>${swatchesHtml(cur.bg)}</div></div>`;
    })
    .join("");
  box.querySelectorAll(".ts-swatch").forEach((btn) => {
    btn.onclick = () => {
      const row = btn.closest(".ts-swatch-row");
      const i = Number(row.dataset.line);
      const role = row.dataset.role;
      while (settings.tailStyle.lines.length <= i) settings.tailStyle.lines.push({ color: "", bg: "" });
      settings.tailStyle.lines[i][role] = btn.dataset.color || "";
      row.querySelectorAll(".ts-swatch").forEach((b) => b.classList.toggle("sel", (b.dataset.color || "") === (btn.dataset.color || "")));
      refreshTailPreview();
    };
  });
  refreshTailPreview();
}
function refreshTailPreview() {
  const texts = tailLineTexts();
  $("ts-preview-row").hidden = !texts.length;
  $("ts-preview").innerHTML = texts.map((t, i) => `<div style="${lineStyleCss(currentTailStyle(), i)}">${esc(t)}</div>`).join("");
  refreshDescPreview(); // 顏色改了 ④ 的「上架時長這樣」也要跟著變，不然會誤以為沒存到（同事實測踩過的誤會）
}
/**
 * ④ 底下「上架時長這樣」：描述照行印出來，固定尾段那幾行套目前（還沒存檔也看得到）的樣式；
 * 尾段範圍以外的每一行（抬頭、✨ 特色行）固定套粗體＋18px（2026-09-24 本人要求：截圖真的貼進
 * 591 看到抬頭跟尾段都是粗體大字，中間的特色行卻是 591 預設小字沒粗體，「文字要跟其他的都一樣」——
 * 不是只有抬頭要套，是尾段以外全部都要。不能自訂、沒有開關。邏輯要跟 lib/tailStyle.js 的
 * buildTailDescHtml() 對到——這裡是給操作頁看的預覽（瀏覽器 CSS），真的貼進 591／樂屋的是另一份
 * HTML（591 認得的 <span>/<strong> 標籤），兩邊分開組但規則要一致，不然預覽會跟真的貼上去的不一樣。
 */
function refreshDescPreview() {
  const desc = $("desc").value.replace(/\r/g, "");
  const style = currentTailStyle();
  const lines = desc.split("\n");
  const start = tailStartIndex(lines, fillTail(settings.tail, settings).split("\n")[0]);
  const tailOn = tailStyleActive(style) && start >= 0 && lines.slice(start).some((l) => l.trim());
  if (!desc.trim()) {
    $("desc-preview").hidden = true;
    $("desc-preview-row").hidden = true;
    return;
  }
  let k = 0;
  $("desc-preview").hidden = false;
  $("desc-preview-row").hidden = false;
  $("desc-preview").innerHTML = lines
    .map((l, i) => {
      const t = l.trim();
      if (!t) return "<div>&nbsp;</div>";
      if (tailOn && i >= start) return `<div style="${lineStyleCss(style, k++)}">${esc(t)}</div>`;
      return `<div style="font-size:${HEAD_FONT_SIZE};font-weight:700">${esc(t)}</div>`;
    })
    .join("");
}
async function saveSettings() {
  const oldTitlePrefix = settings.titlePrefix || "";
  settings = {
    name: $("s-name").value.trim(),
    phone: $("s-phone").value.trim(),
    line: $("s-line").value.trim(),
    company: $("s-company").value.trim(),
    contract: $("s-contract").value,
    descHead: $("s-head").value.trim(),
    titlePrefix: $("s-title-prefix").value.trim(),
    tail: $("s-tail").value,
    tailStyle: normalizeTailStyle(currentTailStyle()),
    coverSticker: settings.coverSticker || null, // 不是表單欄位，是 cs-file/cs-remove 直接改 settings.coverSticker，這裡接住舊值一起存
  };
  try {
    if (hasChrome && chrome.storage && chrome.storage.local) await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    else localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    flash($("s-msg"), "已儲存 ✓", "ok");
  } catch (e) {
    flash($("s-msg"), `存不進去：${e.message}`, "bad");
  }
  // 授權碼交給背景程式存＋立刻驗
  if (hasChrome) await setLicenseKey($("s-key").value.trim());
  if (listing) {
    const c = rows.find((r) => r.label === "聯絡人");
    if (c) c.value = settings.name;
    const k = rows.find((r) => r.label === "委託書");
    if (k) k.value = settings.contract;
    renderRows();
    /* 標題不整個重算（本人可能已經手動改過），只把最前面的舊開頭換成新的；描述原本就是整個重算 */
    $("title").value = applyTitlePrefix($("title").value, settings.titlePrefix, oldTitlePrefix);
    refreshTitle();
    $("desc").value = buildDescription(listing, derived, settings);
    refreshDesc();
  }
}
const settingsReady = () => !!(settings.name && settings.phone);

function flash(el, textContent, cls) {
  el.textContent = textContent;
  el.className = `msg ${cls || ""}`;
  if (cls === "ok") setTimeout(() => (el.textContent === textContent ? (el.textContent = "") : 0), 2500);
}

/* ───────── 授權碼（2026-09-12 起：要發給同事測試用）───────── */
const LICENSE_KEY = "p591:licenseKey"; // 跟 background.js／license.js 同一把（這裡只讀來顯示，改一律經背景程式）
let license = { ok: false, reason: "no_key_set" };

function renderLicense() {
  let text, cls;
  if (!hasChrome) {
    text = "這一頁要從 Chrome 外掛圖示打開，才能驗證授權碼。";
    cls = "bad";
  } else if (license.ok) {
    text = `✅ 授權有效：${license.name || ""}，到 ${license.expiresText || "？"} 為止${license.offline ? "（暫時連不上伺服器，先用上次的驗證結果）" : ""}`;
    cls = "ok";
  } else {
    text = `🔒 ${license.message || "還沒有有效的授權碼"}`;
    cls = "bad";
  }
  for (const id of ["lic-top", "lic-msg"]) {
    $(id).textContent = text;
    $(id).className = `msg ${cls}`;
  }
}
const NO_REPLY = "外掛沒回應，到 chrome://extensions 按 ↻ 重新載入";
async function refreshLicense(force) {
  if (!hasChrome) {
    license = { ok: false, reason: "no_chrome" };
    renderLicense();
    return;
  }
  const r = await bg("listing:license-check", { force: !!force });
  license = r && r.ok && r.license ? { ...r.license, message: r.message } : { ok: false, reason: "offline", message: (r && r.error) || NO_REPLY };
  renderLicense();
}
async function setLicenseKey(key) {
  if (!hasChrome) return;
  const r = await bg("listing:license-set", { key });
  license = r && r.ok && r.license ? { ...r.license, message: r.message } : { ok: false, reason: "offline", message: (r && r.error) || NO_REPLY };
  renderLicense();
}
/**
 * 沒有有效授權：把「我的資料」打開、在 where 顯示原因，回 false。
 * 不在外掛環境（例如直接用瀏覽器分頁預覽這一頁）沒有背景程式可以驗，直接放行——
 * 那種情況下 launch() 自己另外會擋「這一頁要從 Chrome 外掛圖示打開」，不會漏掉。
 */
function requireLicense(where) {
  if (!hasChrome || license.ok) return true;
  renderLicense();
  $("settings").hidden = false;
  $("settings").scrollIntoView({ behavior: "smooth" });
  if (where) flash(where, `🔒 ${license.message || "還沒有有效的授權碼"}`, "bad");
  return false;
}

/* ───────── 背景程式 ───────── */
const bg = (type, extra) =>
  new Promise((resolve) => {
    if (!hasChrome) return resolve({ ok: false, error: "不在外掛環境" });
    try {
      chrome.runtime.sendMessage({ type, ...(extra || {}) }, (r) => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r || { ok: false, error: "背景程式沒回應" }));
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });

/* ───────── 貼上：偷看 text/html 撈連結，貼完直接自動解析（2026-09-24 本人要求：不要手動按解析） ───────── */
let pastedLinks = []; // 這次貼上帶進來的網址（型錄頁、更多照片…）
$("raw").addEventListener("paste", (ev) => {
  const html = ev.clipboardData && ev.clipboardData.getData("text/html");
  if (html) {
    const urls = [];
    for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
      const u = m[1].replace(/&amp;/g, "&").trim();
      if (/^https?:\/\//.test(u) && (isCatalogPage(u) || /picstr=/.test(u)) && !urls.includes(u)) urls.push(u);
    }
    pastedLinks = urls;
  }
  /* paste 事件觸發時，瀏覽器還沒把貼上的內容真的塞進 textarea.value（這裡讀 ev.clipboardData 不受影響，
     但 run() 要讀的是 $("raw").value）——用 setTimeout(0) 排到這一輪事件跑完、瀏覽器完成貼上動作之後再讀值。 */
  setTimeout(() => {
    if ($("raw").value.trim()) run();
  }, 0);
});

/* ───────── 解析結果 ───────── */
let listing = null;
let derived = null;
let rows = [];

/* ───────── 格局圖偵測（2026-09-23）───────── */
let floorPlanUrl = null; // 偵測到「看起來是格局圖」的那張照片網址；null＝沒偵測到或還沒偵測完
let floorPlanRejected = false; // 使用者按了「不是格局圖」
let floorPlanChecking = false;
let floorPlanTimer = null;
let floorPlanItems = []; // 上一次偵測、background.js 回傳的每張照片統計（含抓圖失敗的）——沒偵測到格局圖時用來顯示診斷數字
let floorPlanBest = null; // 上面裡分數最高的一張（不管有沒有過門檻），沒偵測到時顯示「最接近的是哪張」

/* ───────── 封面貼圖合成（2026-09-24）───────── */
let coverCompositeUrl = null; // 合成好的封面照（data: URL）；null＝還沒合成或沒設定封面貼圖
let coverCompositeSourceUrl = null; // 合成用的是哪一張原始照片網址——上架時用來對照現在的第一張照片是不是同一張，對不上就不套
let coverCompositeChecking = false;
let coverCompositeTimer = null;
let coverCompositeError = "";

/**
 * 貼的整段內容若就是「一條型錄頁網址」（不是複製的型錄文字），先幫忙把頁面抓回來、轉成跟手動
 * Ctrl+A/Ctrl+C 一樣的文字，再走原本那一套解析——2026-09-15 對本人真實一戶型錄頁驗證過轉換結果，
 * 但愛屋常常換版，抓失敗或抓到怪東西都會在這裡擋下來、請使用者改用手動複製貼上，不會讓後面帶著
 * 一坨看不懂的 HTML 亂跑。
 *
 * 🔴 2026-09-16 本人實測：貼網址抓回來的地址整個是空的（縣市靠 DEFAULTS.defaultCity 兜底，鄉鎮/街道/號
 * 全空）；手動 Ctrl+A/Ctrl+C 卻抓得到，前提是「先把門牌『顯示』點開」。本人自己整理過的型錄頁網址
 * （`test/fixtures/catalog-rent-markdown.txt` 第 3 行）本來就帶著 `&showaddr=1`——貼網址這條路一直
 * 沒有加這個參數，抓回來的等於是「沒按過顯示」的版本，門牌沒展開。`withShowAddr()`（lib/parser.js）補上。
 */
/**
 * 除錯用：門牌抓不到時，不要只講「抓不到」，把「到底抓回來的 HTML 裡有沒有 showaddr」印出來——
 * 2026-09-16 這條路已經來回猜了好幾次都沒中，靠使用者截圖／描述沒辦法確認到底是「fetch 沒帶到
 * 登入身份」還是「HTML 有但正規式沒抓到」，這裡直接把關鍵字有沒有出現的結果攤在畫面上，
 * 使用者不用開 DevTools，把這行字複製貼過來就能分辨是哪一種。
 */
function debugCatalogHtml(html) {
  const h = String(html || "");
  const captionM = h.match(/<div class=["']caption["']>([\s\S]{0,400}?)<\/div>/);
  return `HTML長度${h.length}／caption內容＝${captionM ? captionM[1] : "找不到 caption 這個 div"}`;
}
async function fetchCatalogText(url) {
  const r = await bg("listing:fetch-page", { url: withShowAddr(url) });
  if (!r.ok) return { ok: false, error: r.error || "未知錯誤" };
  if (!isCatalogHtml(r.html)) return { ok: false, error: "抓回來的內容看起來不是型錄頁（可能要先登入愛屋、或這條網址不對）" };
  scanned[url] = photosFromCatalogHtml(r.html, listingNoFromUrl(url));
  return { ok: true, text: catalogTextFromHtml(r.html), debug: debugCatalogHtml(r.html) };
}

async function run() {
  if (!requireLicense($("parse-msg"))) return;
  let raw = $("raw").value;
  const catalogUrl = soleCatalogUrl(raw);
  let catalogDebug = "";
  if (catalogUrl) {
    if (!hasChrome) {
      flash($("parse-msg"), "貼網址自動解析要從 Chrome 外掛圖示打開的頁面才能用（要跨網域抓型錄頁）；現在只是預覽，改用「Ctrl+A / Ctrl+C」貼型錄文字。", "bad");
      return;
    }
    $("parse").disabled = true;
    flash($("parse-msg"), "正在抓型錄頁…", "");
    const r = await fetchCatalogText(catalogUrl);
    $("parse").disabled = !$("raw").value.trim();
    if (!r.ok) {
      flash($("parse-msg"), `${r.error}。改用「Ctrl+A / Ctrl+C」貼型錄文字試試。`, "bad");
      return;
    }
    raw = r.text;
    catalogDebug = r.debug || "";
  }
  listing = parseListing(raw);
  if (catalogUrl) listing.catalogUrl = catalogUrl;
  derived = derive(listing);
  floorPlanUrl = null;
  floorPlanRejected = false;
  floorPlanItems = [];
  floorPlanBest = null;
  renderFloorPlan();
  coverCompositeUrl = null;
  coverCompositeSourceUrl = null;
  coverCompositeError = "";
  renderCoverComposite();
  rows = buildRows(listing, derived);
  const c = rows.find((r) => r.label === "聯絡人");
  if (c) c.value = settings.name || "";
  const k = rows.find((r) => r.label === "委託書");
  if (k) k.value = settings.contract;

  /* 第一次用：型錄上的經紀人員就是你 → 先幫你填進「我的資料」（沒存，要你自己按儲存） */
  if (!settings.name && listing.agent) {
    $("s-name").value = listing.agent;
    if (!settings.phone && listing.agentPhone) $("s-phone").value = listing.agentPhone.replace(/^(\d{4})(\d{3})(\d{3})$/, "$1-$2-$3");
    $("settings").hidden = false;
    flash($("s-msg"), `型錄上的經紀人員是「${listing.agent}」，已先填進去；確認後按「儲存」。`, "warn");
  }

  $("result").hidden = false;
  $("warn-card").hidden = !listing.warnings.length;
  $("warns").innerHTML = listing.warnings.map((w) => `<li>${esc(w)}</li>`).join("");

  const steps = [derived.adType, derived.legal, derived.status, derived.type].filter(Boolean);
  $("steps").innerHTML = steps.map((s, i) => `${i ? '<span class="arrow">→</span>' : ""}<span class="step">${esc(s)}</span>`).join("");
  $("steps-note").textContent =
    listing.deal === "rent"
      ? `依據：類型「${listing.kind || "—"}」＋樓高 ${listing.total ?? "—"} 層 → 型態「${derived.type}」（出租沒有華廈，算電梯大樓）。認得的組合會直接開 591 第②頁。`
      : `依據：謄本用途「${derived.tengben || "資料沒有，先當住家用"}」→ 法定用途「${derived.legal}」；類型「${listing.kind || "—"}」＋樓高 ${listing.total ?? "—"} 層 → 型態「${derived.type}」。認得的組合會直接開 591 第②頁，不認得的外掛會在第①頁幫你點。`;

  renderRows();
  $("title").value = applyTitlePrefix(cleanTitle(listing.rawTitle), settings.titlePrefix);
  refreshTitle();
  $("desc").value = buildDescription(listing, derived, settings);
  refreshDesc();

  /* 照片：型錄文字裡有的 + 這次貼上帶的連結 + 型錄頁網址（要掃） */
  const links = [];
  if (listing.catalogUrl) links.push(listing.catalogUrl);
  for (const u of pastedLinks) if (!links.includes(u)) links.push(u);
  $("photo-link").value = links.join(" ");
  $("photos-msg").textContent = listing.photos.length ? `型錄文字裡帶了 ${listing.photos.length} 張「更多照片」的網址。` : "型錄文字裡沒有照片網址。";
  refreshPhotoLink();
  $("launch-msg").textContent = "";
  refreshNeed();
  /* 完整門牌是「登入愛屋才看得到」的內容（見 background.js 的 listing:fetch-page），抓不到不代表程式壞了；
     但這件事已經來回猜好幾次都沒中，門牌沒帶到時把除錯字串一起印出來，才知道下一步該改哪裡 */
  if (catalogUrl) {
    const gotNumber = /號/.test(listing.addr || "");
    flash(
      $("parse-msg"),
      gotNumber ? "型錄抓回來了，門牌有帶到。" : `型錄抓回來了，但門牌沒帶到；③ 自己補，或改用「Ctrl+A / Ctrl+C」貼整頁。（除錯：${catalogDebug}）`,
      gotNumber ? "ok" : "warn",
    );
  }
  setTimeout(() => $("result").scrollIntoView({ behavior: "smooth", block: "start" }), 50);
}

function renderRows() {
  const box = $("rows");
  box.innerHTML = "";
  rows.forEach((r, i) => {
    if (r.group) {
      const g = document.createElement("div");
      g.className = "grp";
      g.textContent = r.group;
      box.appendChild(g);
      return;
    }
    const row = document.createElement("div");
    row.className = `row${r.need ? " need" : ""}${r.pick ? " pick" : ""}`;
    const lab = document.createElement("span");
    lab.className = "lab";
    lab.innerHTML = `${r.req ? "<i>*</i>" : ""}${esc(r.label)}`;
    const input = document.createElement("input");
    input.value = r.value;
    input.readOnly = !!r.ref;
    input.addEventListener("input", () => {
      rows[i].value = input.value;
      if (rows[i].need && input.value.trim()) {
        rows[i].need = false;
        row.classList.remove("need");
        refreshNeed();
      }
    });
    const note = document.createElement("span");
    note.className = "note";
    note.textContent = r.note || "";
    row.append(lab, input, note);
    box.appendChild(row);
  });
}
function refreshNeed() {
  const n = rows.filter((r) => r.need).length;
  $("need-msg").textContent = n ? `還有 ${n} 格紅底沒補（不補也能上架，外掛會把它們列在面板上要你自己填）` : "";
}
function refreshTitle() {
  const t = titleCheck($("title").value);
  /* 樂屋「物件名稱」上限只有 25 字（591 是 30），超過的字上樂屋時會被截掉（見 buildRakuya 的
     title25）。以前標題沒有固定開頭，這個差距比較少撞到；加了「物件名稱開頭」之後開頭先佔掉幾個字，
     標題很容易落在 26～30 字之間——591 合格、樂屋卻會被截，所以在這裡先講。只提醒、不擋。 */
  const over = t.len - RAKUYA_TITLE_MAX;
  if (t.ok && over > 0) flash($("title-msg"), `${t.msg}；⚠ 樂屋上限 ${RAKUYA_TITLE_MAX} 字，上樂屋會被截掉最後 ${over} 字`, "warn");
  else flash($("title-msg"), t.msg, t.ok ? "ok" : "bad");
  const sug = listing ? suggestTitle(listing, derived, settings.titlePrefix) : "";
  $("title-suggest").hidden = !sug || sug === $("title").value.trim();
  $("title-suggest-text").textContent = sug;
  refreshRisks();
}
function refreshDesc() {
  const len = [...$("desc").value].length;
  flash($("desc-msg"), `${len} 字／上限 ${DEFAULTS.descMax}`, len > DEFAULTS.descMax ? "bad" : "");
  refreshRisks();
  refreshDescPreview();
}
function refreshRisks() {
  const risks = descRisks($("title").value, $("desc").value);
  const md = findMarkdown($("desc").value);
  const box = $("risks");
  const items = risks.map((r) => `<li><b>${esc(r.word)}</b>：${esc(r.why)}</li>`);
  if (md.length) items.push(`<li><b>Markdown 符號</b>：第 ${md.map((m) => m.line).join("、")} 行有 ${[...new Set(md.map((m) => m.kind))].join("／")}，591 會原樣印出符號。</li>`);
  box.hidden = !items.length;
  box.innerHTML = items.length ? `<b>⚠ 文案提醒（只標不刪，留不留你決定）</b><ul>${items.join("")}</ul>` : "";
}

/* ───────── 照片連結：型錄頁要請 background 抓回來掃 ───────── */
const scanned = {}; // 型錄頁網址 → 掃到的照片
const scanning = new Set();
let scanTimer = null;
async function scanPages(pages) {
  for (const p of pages) {
    if (p in scanned || scanning.has(p)) continue;
    scanning.add(p);
    const r = await bg("listing:fetch-page", { url: p });
    scanned[p] = r.ok ? photosFromCatalogHtml(r.html || "", listingNoFromUrl(p)) : [];
    scanning.delete(p);
  }
  refreshPhotoLink();
}
function allPhotos() {
  const out = [];
  /* 2026-09-25 本人回報樂屋抓到的照片有重複：同一張封面照分兩次抓（例如先貼網址自動解析、
     使用者手動再按一次「解析」重跑），愛屋的網址帶 ?Rnd=NNN 這種每次抓都不同的快取參數
     （已經用本人這筆真實物件驗證過：同一張封面，前後兩次抓分別是 ?Rnd=233 跟 ?Rnd=279），
     逐字比對的舊寫法會把同一張圖當成兩張不同的。改成用 photoUrlKey()（只比對網域＋路徑，
     忽略 query string）判斷去重，這是目前唯一會把「型錄頁掃到的」跟「型錄自己帶的」兩個
     不同來源合併在一起的地方，最容易撞見這個問題。 */
  const push = (u) => {
    if (!out.some((x) => photoUrlKey(x) === photoUrlKey(u))) out.push(u);
  };
  /* 型錄頁嵌的（a～e）在前、「更多照片」（f～）在後：型錄頁掃到的先放 */
  const rep = photoLinkReport($("photo-link").value, scanned);
  rep.photos.forEach(push);
  (listing ? listing.photos : []).forEach(push);
  return out;
}
function refreshPhotoLink() {
  const textValue = $("photo-link").value;
  const r = photoLinkReport(textValue, scanned);
  const pending = r.pages.filter((p) => !(p in scanned));
  if (pending.length && hasChrome) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scanPages(pending), 300);
  }
  const total = allPhotos().length;
  const per = r.links.map((l, i) => `第 ${i + 1} 條 ${r.pages.includes(l) && !(l in scanned) ? (hasChrome ? "掃描中…" : "型錄頁") : `${r.perLink[i]} 張`}`).join("、");
  const msg = r.links.length ? `貼了 ${r.links.length} 條連結（${per}）；上架時會傳 ${total} 張。` : textValue.trim() ? "這裡面沒有連結" : total ? `上架時會傳 ${total} 張。` : "沒有照片：把型錄頁網址或「更多照片」連結貼進來，或上架後自己上傳。";
  flash($("photo-link-msg"), msg, total ? "ok" : textValue.trim() ? "bad" : "");
  scheduleFloorPlanCheck();
  scheduleCoverCompositeCheck();
}

/**
 * ───────── 格局圖偵測（2026-09-23）─────────
 * 愛屋有格局圖的話，591 出售有專屬的「格局圖」那一格，這裡先看一眼照片猜猜哪張是（lib/floorplan.js
 * 的「長相」判斷，跑在 background.js，因為要跨網域把圖抓回來解碼）。掛在 refreshPhotoLink() 尾巴：
 * 不管是剛解析完、型錄頁掃描完才補齊照片、還是使用者自己改了照片連結，photo-link 一有變動最後都會
 * 走到這裡，用同一個入口，不用到處補呼叫。debounce 比 scanPages() 的 300ms 長一點，讓掃描通常先跑完，
 * 第一次偵測就拿得到完整的照片清單。
 */
function scheduleFloorPlanCheck() {
  clearTimeout(floorPlanTimer);
  floorPlanTimer = setTimeout(detectFloorPlan, 500);
}
async function detectFloorPlan() {
  if (!hasChrome || !listing) return;
  const photos = allPhotos();
  if (!photos.length) {
    floorPlanUrl = null;
    renderFloorPlan();
    return;
  }
  floorPlanChecking = true;
  renderFloorPlan();
  const r = await bg("listing:detect-floorplan", { urls: photos });
  floorPlanChecking = false;
  /* 這段等待期間使用者可能又改了照片連結，這次結果跟現在的照片清單對不起來就作廢，不要蓋掉新狀態 */
  if (JSON.stringify(allPhotos()) !== JSON.stringify(photos)) return;
  if (!r || !r.ok) {
    floorPlanItems = [];
    floorPlanBest = null;
    flash($("floorplan-msg"), `格局圖偵測失敗：${(r && r.error) || "外掛沒回應"}`, "bad");
    $("floorplan-box").hidden = false;
    $("floorplan-reject-row").hidden = true;
    return;
  }
  floorPlanUrl = r.floorPlanUrl;
  floorPlanItems = r.items || [];
  floorPlanBest = r.best || null;
  floorPlanRejected = false;
  renderFloorPlan();
}
/** 這則訊息要一直留著讓使用者看到（跟要不要傳到「格局圖」那一格有關），不用 flash()——那個「ok」class
 *  2.5 秒後會自動清空，是給「已儲存 ✓」那種一次性提示用的，這裡不適合。 */
function renderFloorPlan() {
  const box = $("floorplan-box");
  const msgEl = $("floorplan-msg");
  if (!box) return;
  if (floorPlanChecking) {
    box.hidden = false;
    $("floorplan-reject-row").hidden = true;
    msgEl.textContent = "正在看照片裡有沒有格局圖…";
    msgEl.className = "msg";
    return;
  }
  /*
   * 2026-09-24：本人真實測試回報「兩個平台都沒抓到格局圖」，這裡原本沒偵測到就直接把整個區塊藏起來
   * （box.hidden = true），本人完全看不出來是「這批照片真的沒有格局圖」「有格局圖但沒達門檻」還是
   * 「抓圖本身就失敗」——診斷不出來，只能靠截圖來回問。改成偵測跑完只要看過照片，一律顯示結果，
   * 沒判定到就印出「看過幾張、最接近的是第幾張、比例多少」這幾個數字，跟 debugCatalogHtml() 同一個
   * 「印出來讓本人複製回報」的做法，不要再靠猜。
   */
  if (!floorPlanUrl) {
    if (!floorPlanItems.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    $("floorplan-reject-row").hidden = true;
    const errCount = floorPlanItems.filter((it) => it.error).length;
    if (errCount === floorPlanItems.length) {
      msgEl.textContent = `看格局圖：這批 ${floorPlanItems.length} 張照片全部抓取失敗，沒辦法判斷（常見原因：圖檔網址失效，或跟一般照片上傳失敗是同一個原因；第一張的錯誤：${floorPlanItems[0].error}）。`;
    } else if (floorPlanBest) {
      const idx = floorPlanItems.findIndex((it) => it.url === floorPlanBest.url) + 1;
      msgEl.textContent = `看格局圖：看過 ${floorPlanItems.length} 張${errCount ? `（${errCount} 張抓取失敗）` : ""}，沒有一張判定像格局圖——最接近的是第 ${idx} 張：白色 ${Math.round(floorPlanBest.whiteRatio * 100)}%／灰階 ${Math.round(floorPlanBest.grayRatio * 100)}%（門檻要白 ≥50%／灰 ≥82%）。如果這批裡真的有格局圖，把這行數字回報就能調門檻。`;
    } else {
      msgEl.textContent = "看格局圖：這批沒有可以判斷的照片。";
    }
    msgEl.className = "msg warn";
    return;
  }
  box.hidden = false;
  const idx = allPhotos().indexOf(floorPlanUrl) + 1;
  const forSale = !listing || listing.deal !== "rent";
  /* 2026-09-24 本人問「591成功了，為什麼樂屋沒有」——原本這句只區分 591 出售／出租，沒提到樂屋，
     容易讓人以為樂屋也該有專屬欄位。591 出售才有「格局圖」那一格；591 出租、樂屋都沒有這個欄位
     （跟同事的工具行為一致，他的樂屋也一樣沒有），這裡講清楚，不要只提到一半。 */
  msgEl.textContent = floorPlanRejected
    ? "已標記「不是格局圖」，這張會照一般照片一起傳。"
    : `第 ${idx || "？"} 張看起來是格局圖（白底線稿）：${forSale ? "上架 591 出售時會傳到「格局圖」那一格，照片區不放它；591 出租、樂屋都沒有這個欄位，會跟其他照片一起傳。" : "591 出租、樂屋都沒有「格局圖」欄位，會跟其他照片一起傳。"}`;
  msgEl.className = `msg ${floorPlanRejected ? "" : "ok"}`;
  $("floorplan-reject-row").hidden = false;
  $("floorplan-reject").checked = floorPlanRejected;
}

/**
 * ───────── 封面貼圖合成（2026-09-24）─────────
 * 本人在「批次貼圖」工具（/admin/sticker）測完覺得「還要另外開一頁丟圖」太麻煩，問「物件上架助手」
 * 能不能自動——這裡直接整合進解析流程：「⚙ 我的資料」存了封面貼圖，解析完就自動把它合成到抓回來的
 * 第一張照片上（滿版寬、貼齊底部，跟批次貼圖工具「封面貼圖」同一個位置公式，本人已經驗證過這個位置）。
 * 掛在跟格局圖偵測同一個入口（refreshPhotoLink() 尾巴），道理一樣：不管是剛解析完、型錄頁掃描完才
 * 補齊照片、還是使用者自己改了照片連結，都要重新合成一次，用同一個入口才不會到處漏補呼叫。
 */
function scheduleCoverCompositeCheck() {
  clearTimeout(coverCompositeTimer);
  coverCompositeTimer = setTimeout(detectCoverComposite, 500);
}
async function detectCoverComposite() {
  coverCompositeUrl = null;
  coverCompositeSourceUrl = null;
  coverCompositeError = "";
  if (!hasChrome || !listing || !settings.coverSticker || !settings.coverSticker.src) {
    renderCoverComposite();
    return;
  }
  const cover = allPhotos()[0];
  if (!cover) {
    renderCoverComposite();
    return;
  }
  coverCompositeChecking = true;
  renderCoverComposite();
  let result = null;
  let err = "";
  try {
    result = await compositeCoverPhoto(cover, settings.coverSticker);
  } catch (e) {
    err = String((e && e.message) || e);
  }
  coverCompositeChecking = false;
  /* 這段等待期間使用者可能又改了照片連結，這次結果跟現在的第一張照片對不起來就作廢，不要蓋掉新狀態 */
  if (allPhotos()[0] !== cover) return;
  if (result) {
    coverCompositeUrl = result;
    coverCompositeSourceUrl = cover;
  } else {
    coverCompositeError = err || "合成失敗";
  }
  renderCoverComposite();
}
/** 這則訊息要一直留著讓使用者看到（跟上架時第一張照片會不會被換掉有關），不用 flash()。 */
function renderCoverComposite() {
  const box = $("cover-composite-box");
  const msgEl = $("cover-composite-msg");
  if (!box) return;
  if (!settings.coverSticker || !settings.coverSticker.src) {
    box.hidden = true;
    return;
  }
  if (coverCompositeChecking) {
    box.hidden = false;
    msgEl.textContent = "正在把封面貼圖合成到第一張照片…";
    msgEl.className = "msg";
    return;
  }
  if (coverCompositeError) {
    box.hidden = false;
    msgEl.textContent = `封面貼圖合成失敗：${coverCompositeError}（上架時第一張照片會照舊用原圖，不會擋到上架）`;
    msgEl.className = "msg bad";
    return;
  }
  if (!coverCompositeUrl) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  msgEl.innerHTML = `封面貼圖已合成好：上架時第一張照片會換成這張。<br><img src="${coverCompositeUrl}" alt="封面合成預覽" style="max-width:220px;max-height:220px;border-radius:6px;margin-top:6px" />`;
  msgEl.className = "msg ok";
}
/**
 * 封面照（遠端愛屋網址）＋封面貼圖（本機 data URL）合成：封面照透過 background 的
 * listing:fetch-image 抓回 base64（跟格局圖偵測、照片上傳共用同一支，不用另外開權限）；封面貼圖
 * 已經存在本機，直接載入。滿版寬、貼齊底部——不像批次貼圖工具那樣可以手動拖曳調位置，這裡固定
 * 用本人已經驗證過的這個位置，不用另外做一套可調的 UI。
 */
async function compositeCoverPhoto(coverUrl, sticker) {
  const r = await bg("listing:fetch-image", { url: coverUrl });
  if (!r || !r.ok) throw new Error((r && r.error) || "抓封面照失敗");
  const coverImg = await loadImageEl(`data:${r.type};base64,${r.b64}`);
  const stickerImg = await loadImageEl(sticker.src);
  const canvas = document.createElement("canvas");
  canvas.width = coverImg.naturalWidth;
  canvas.height = coverImg.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(coverImg, 0, 0);
  const w = canvas.width;
  const h = w * (stickerImg.naturalHeight / stickerImg.naturalWidth);
  ctx.drawImage(stickerImg, 0, canvas.height - h, w, h);
  return canvas.toDataURL("image/jpeg", 0.92);
}

/* ───────── 上架物件追蹤清單（2026-09-19：集中看連結、來源下架自動轉庫存）───────── */
/**
 * 沒有型錄來源網址（手動打字貼的，不是貼型錄頁網址／Ctrl+A 型錄文字）就不登記——
 * 沒有來源網址，之後也沒辦法自動查「來源還在不在」，登記了也只是後台多一筆看不出用途的紀錄。
 * 失敗（離線、官網部署中）安靜吞掉，不影響上架這個主功能，本人事後可以在後台手動新增補回來。
 */
function registerTracking(target) {
  if (!hasChrome || !listing || !listing.catalogUrl) return;
  bg("listing:register", {
    sourceUrl: listing.catalogUrl,
    title: $("title").value.trim(),
    address: listing.addr || "",
    platform: target,
  }).catch(() => {});
}

/* ───────── 上架 ───────── */
async function launch(target = "591") {
  if (!listing || !derived) return;
  if (!requireLicense($("launch-msg"))) return;
  if (!settingsReady()) {
    $("settings").hidden = false;
    $("settings").scrollIntoView({ behavior: "smooth" });
    flash($("launch-msg"), "先到上面「⚙ 我的資料」填姓名和手機（聯絡人與落款會用到）、按儲存，再按一次。", "bad");
    return;
  }
  const payload = buildPayload(listing, derived, rows, $("title").value.trim(), $("desc").value, settings);
  let photos = allPhotos();
  /* 封面貼圖合成：換掉第一張照片（591／樂屋都適用，跟格局圖不一樣，不是 591 專屬功能）。
     要比對「合成用的來源」跟「現在的第一張照片」是不是同一張——使用者可能在合成跑完之後又手動
     改了照片連結，這時候不該硬套一張跟目前第一張對不起來的舊合成結果。 */
  if (coverCompositeUrl && coverCompositeSourceUrl && photos[0] === coverCompositeSourceUrl) {
    photos = photos.map((u, i) => (i === 0 ? coverCompositeUrl : u));
  }
  payload.photos = photos;
  /* 格局圖：591 出售才有專屬的「格局圖」那一格（出租、樂屋都沒有，見 fill591.js／README）。抽出來的
     那張不進一般照片區，591 那邊的 fill591.js 會另外把它傳到「格局圖」那一格。 */
  const plan = floorPlanUrl && !floorPlanRejected ? floorPlanUrl : null;
  if (plan && listing.deal === "sale" && (target === "591" || target === "both")) {
    payload.floorPlan = plan;
    payload.photos = photos.filter((u) => u !== plan);
  }
  const site = target === "rakuya" ? "樂屋" : target === "both" ? "591＋樂屋" : "591";
  const rakuyaVariant = async (base) => {
    /* 樂屋沒有「格局圖」那一格：不管 591 那份 payload 有沒有抽掉格局圖，樂屋這份一律用完整的 photos、不帶 floorPlan */
    const r = { ...base, target: "rakuya", photos };
    delete r.floorPlan;
    /* 樂屋出租物件：描述最後面自動加兩到三行（2026-09-26／09-27／10-01 本人陸續拍板），給
       [[project_樂屋出租循環刊登]] 外掛之後判斷「還在不在架上」用，也給真人看、點進去的。只加
       樂屋出租，591／出售不動——那套系統只追蹤樂屋出租物件，見該專案記憶檔。desc／descHtml
       要用 buildPayload() 重算一次（不是直接字串接尾），這樣尾段字級／顏色那些既有樣式規則才會
       照樣套用到新加的這幾行，不會兩邊算法各寫一份以後對不起來。
       ① 物件編號（listingNoFromUrl() 從 catalogUrl 抽，跟照片過濾抽的是同一個編號）
       ② 愛屋型錄連結（catalogUrl 本身）
       ③ 太平洋官網公開物件頁連結（2026-10-01 新增，本人原本要求先手動測試，驗證過
         SearchObject2 這支 API＋用 pic 欄位藏的愛屋編號比對能可靠找到剛好一戶之後，
         本人要求直接自動化，不用每戶手動貼——找不到就是找不到，不勉強塞錯的）。
         背景抓太平洋官網要時間，這裡才把 rakuyaVariant 改成 async；找不到（還沒同步、
         API 逾時、listingNo 抽不到）就只加①②兩行，行為跟新增這個功能之前一樣。 */
    if (listing.deal === "rent" && listing.catalogUrl) {
      const listingNo = listingNoFromUrl(listing.catalogUrl);
      const lines = listingNo ? [listingNo, listing.catalogUrl] : [listing.catalogUrl];
      if (listingNo) {
        const pacific = await bg("listing:find-pacific-link", { rawTitle: listing.rawTitle, listingNo, rent: true });
        if (pacific?.ok && pacific.url) lines.push(pacific.url);
      }
      const withLink = buildPayload(listing, derived, rows, $("title").value.trim(), `${$("desc").value}\n${lines.join("\n")}`, settings);
      r.desc = withLink.desc;
      if (withLink.descHtml) r.descHtml = withLink.descHtml;
      else delete r.descHtml;
    }
    r.rakuya = buildRakuya(listing, derived, r);
    return r;
  };
  // 一起上架：591 的資料包帶著樂屋的（chain），背景程式先開 591，591 填完自動開樂屋接著填（見 background.js）
  let send = payload;
  if (target === "rakuya") send = await rakuyaVariant(payload);
  else if (target === "both") send = { ...payload, target: "591", chain: await rakuyaVariant(payload) };
  if (!hasChrome) {
    flash($("launch-msg"), "這一頁要從 Chrome 外掛圖示打開才能上架（現在只是預覽）。", "bad");
    return;
  }
  flash($("launch-msg"), `正在開${site}分頁…`, "");
  const r = await bg("listing:launch", { payload: send });
  if (r && r.ok) registerTracking(target); // 追蹤清單登記：best-effort，不等、不影響下面的訊息
  if (r && r.license && !r.ok) {
    // 背景程式擋下來：沒有有效授權碼（到期、停用、綁在別台電腦已達上限…），把原因亮出來
    license = { ...r.license, message: r.error };
    renderLicense();
    $("settings").hidden = false;
    flash($("launch-msg"), `🔒 ${r.error}`, "bad");
  } else if (!r.ok) flash($("launch-msg"), `外掛沒回應：${r.error || "未知錯誤"}。到 chrome://extensions 按這個外掛的 ↻ 再試。`, "bad");
  else if (target === "both")
    flash($("launch-msg"), "591 分頁已開好，外掛正在填；591 填完後會自動開樂屋分頁接著填。兩邊都等右下角「✅ 填完」、從上往下核對：591 按「保存資料，下一步」、樂屋按「庫存」或「上架」，都是你按。", "ok");
  else
    flash(
      $("launch-msg"),
      `${site}分頁已開，外掛正在填。到那個分頁等右下角「✅ 填完」，從上往下核對，再自己按${target === "rakuya" ? "「庫存」或「上架」" : "「保存資料，下一步」"}。`,
      "ok",
    );
}

/* ───────── 綁事件 ───────── */
$("toggle-settings").onclick = () => ($("settings").hidden = !$("settings").hidden);
$("s-save").onclick = saveSettings;
$("s-tail").addEventListener("input", renderTailLines);
$("ts-size").addEventListener("change", refreshTailPreview);
$("ts-bold").addEventListener("change", refreshTailPreview);
$("ts-underline").addEventListener("change", refreshTailPreview);
$("raw").addEventListener("input", () => ($("parse").disabled = !$("raw").value.trim()));
$("parse").onclick = run;
$("clear").onclick = () => {
  $("raw").value = "";
  $("parse").disabled = true;
  $("result").hidden = true;
  listing = null;
  pastedLinks = [];
  floorPlanUrl = null;
  floorPlanRejected = false;
  floorPlanItems = [];
  floorPlanBest = null;
  renderFloorPlan();
  coverCompositeUrl = null;
  coverCompositeSourceUrl = null;
  coverCompositeError = "";
  renderCoverComposite();
};
$("title").addEventListener("input", refreshTitle);
$("title-apply").onclick = () => {
  $("title").value = $("title-suggest-text").textContent;
  refreshTitle();
};
$("desc").addEventListener("input", refreshDesc);
$("photo-link").addEventListener("input", refreshPhotoLink);
$("floorplan-reject").addEventListener("change", () => {
  floorPlanRejected = $("floorplan-reject").checked;
  renderFloorPlan();
});
$("launch").onclick = () => launch("591");
$("launch-rakuya").onclick = () => launch("rakuya");
$("launch-both").onclick = () => launch("both");

loadSettings().then(async () => {
  await refreshLicense(); // 沒有有效授權碼，解析與上架都不開
  if (!settingsReady() || !license.ok) $("settings").hidden = false; // 第一次用：先貼授權碼、填自己的資料
});
