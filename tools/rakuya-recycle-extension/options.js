import { loadSettings, saveSettings, loadSnapshots, loadDebug, clearDebug } from "./lib/store.js";

const $ = (id) => document.getElementById(id);

/**
 * 🔴 2026-09-28 本人重刊測到最後一個問題：原本第一張照片有貼人像貼圖，
 * 樂屋伺服器存的原圖卻沒有——跟「物件上架助手」外掛的「封面貼圖」
 * 同一個概念（存一張貼圖，重刊時自動合成到封面照最下面、滿版寬），但
 * chrome.storage 是每個外掛各自獨立，沒辦法直接讀那邊存的貼圖，只能
 * 在這支外掛自己的設定頁再存一份。合成邏輯（downscaleStickerFile／
 * loadImageEl／compositeCoverSticker 同款數學）照抄 591-extension 的
 * app.js，只存一張不做整個貼圖庫，跟那邊「固定用這張落款帶」的取捨一致。
 */
const COVER_STICKER_MAX_PX = 800;
let coverSticker = null;

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
  const has = !!(coverSticker && coverSticker.src);
  $("cs-preview-row").hidden = !has;
  if (has) $("cs-preview").src = coverSticker.src;
}
$("cs-file").addEventListener("change", async (e) => {
  const file = (e.target.files || [])[0];
  e.target.value = "";
  if (!file) return;
  try {
    const { src, w, h } = await downscaleStickerFile(file);
    coverSticker = { src, naturalW: w, naturalH: h };
    renderCoverSticker();
    $("cs-msg").textContent = "已選好，記得按下面「儲存設定」才會真的存起來";
  } catch (err) {
    $("cs-msg").textContent = `讀取失敗：${err.message}`;
  }
});
$("cs-remove").addEventListener("click", () => {
  coverSticker = null;
  renderCoverSticker();
  $("cs-msg").textContent = "已移除，記得按下面「儲存設定」";
});

async function render() {
  const s = await loadSettings();
  $("manageUrl").value = s.manageUrl;
  $("postUrl").value = s.postUrl;
  $("cycleDays").value = s.cycleDays;
  $("lineToken").value = s.lineToken;
  $("lineTarget").value = s.lineTarget;
  coverSticker = s.coverSticker || null;
  renderCoverSticker();

  const list = await loadSnapshots();
  const tbody = document.querySelector("#snapTable tbody");
  tbody.innerHTML = list.length
    ? list
        .map(
          (x) =>
            // 🔴 2026-09-27：按鈕原本只在 active 才畫出來，但 background.js 的 onlyId
            // 早就放寬成「不是 rented_out 就能重試」——這裡沒跟著放寬，導致本人真的遇到
            // error 狀態時，畫面上連按鈕都看不到、根本點不到，等於後端修好了前端沒露出來。
            `<tr><td>${esc(x.no || x.listing?.title || x.id)}</td><td>${esc(x.status)}</td><td>${esc(fmt(x.nextRecycleAt))}</td><td>${x.cycleCount}</td><td>${
              x.status !== "rented_out" ? `<button class="runOne" data-id="${esc(x.id)}" data-no="${esc(x.no || x.id)}">${x.status === "error" ? "重試這一筆" : "只重刊這一筆"}</button>` : "—"
            } <button class="removeOne" data-id="${esc(x.id)}" data-no="${esc(x.no || x.id)}">刪除追蹤</button></td></tr>`,
        )
        .join("")
    : `<tr><td colspan="5">目前沒有追蹤中的物件——在樂屋貼文的描述裡放太平洋房屋連結、按下上架，就會自動開始追蹤。</td></tr>`;

  const debug = await loadDebug();
  const debugEl = $("debugLog");
  debugEl.textContent = debug.length
    ? debug.map((d) => `[${fmt(d.at)}] (${d.from}) ${d.message}`).join("\n")
    : "（還沒有任何紀錄）";
  // 🔴 2026-09-27 本人截圖回報過一次舊紀錄——這個框沒有自動捲到最下面，
  // 每次重畫都停在捲軸原本的位置（通常是最上面＝最舊的），本人不知道要
  // 自己往下捲，截圖給我的常常是舊資料。改成每次重畫都自動捲到最新一行。
  debugEl.scrollTop = debugEl.scrollHeight;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
function fmt(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}

$("save").addEventListener("click", async () => {
  // 🔴 2026-09-27 抓到真bug：`Number(x) || 5` 這個寫法，只要本人填 0，
  // `0 || 5` 會算成 5——這就是本人設成 0 存檔後、重新整理又變回 5 的真正原因，
  // 不是本人操作錯誤。改用 Number.isFinite 判斷「有沒有填」，0 才留得住。
  const n = Number($("cycleDays").value);
  try {
    // 🔴 2026-09-28 本人上傳封面貼圖存檔後，重刊掃描端還是回報「沒設定」，
    // 但這裡原本沒有 try/catch——如果 chrome.storage.local.set() 失敗
    // （例如貼圖檔案太大），這個按鈕會裝作存好了，本人完全看不出來
    // 其實根本沒存進去。
    await saveSettings({
      manageUrl: $("manageUrl").value.trim(),
      postUrl: $("postUrl").value.trim(),
      cycleDays: Number.isFinite(n) && n >= 0 ? n : 5,
      lineToken: $("lineToken").value.trim(),
      lineTarget: $("lineTarget").value.trim(),
      coverSticker,
    });
    $("status").textContent = "已儲存";
    setTimeout(() => ($("status").textContent = ""), 2000);
  } catch (err) {
    $("status").textContent = `儲存失敗：${err.message}`;
  }
  render();
});

$("runNow").addEventListener("click", () => {
  $("status").textContent = "執行中…";
  chrome.runtime.sendMessage({ type: "rr:run-now" }, (r) => {
    $("status").textContent = r?.ok ? `完成，處理了 ${r.processed} 筆` : `失敗：${r?.error || "沒有回應"}`;
    render();
  });
});

/* 2026-09-27 本人要求「先測一筆」：表格每一列（狀態是 active 才有）多一顆按鈕，只對那一筆
   觸發關閉+重刊，不會連同其他還在追蹤的物件一起處理。表格是 render() 每次重畫，按鈕不是
   一開始就在畫面上，用事件代理掛在 tbody 上才抓得到之後畫出來的按鈕。 */
document.querySelector("#snapTable tbody").addEventListener("click", (ev) => {
  const btn = ev.target.closest(".runOne");
  if (!btn) return;
  const id = btn.dataset.id;
  const no = btn.dataset.no;
  if (!confirm(`確定只重刊「${no}」這一筆嗎？\n\n會真的把這筆物件在樂屋關閉，再用當初存的資料重新上架一筆全新的。這個動作沒辦法復原，其他還在追蹤中的物件不會受影響。`)) return;
  btn.disabled = true;
  btn.textContent = "執行中…";
  chrome.runtime.sendMessage({ type: "rr:run-one", id }, (r) => {
    $("status").textContent = r?.ok ? `「${no}」處理完成（${r.processed} 筆）` : `「${no}」失敗：${r?.error || "沒有回應"}`;
    render();
  });
});

/**
 * 🔴 2026-09-27 本人真實遇到「舊的一筆對應已永久失效的刊登、新的一筆重新開始
 * 追蹤，兩筆同編號」——舊的那筆留著有實際風險（closeOldListing 靠標題文字比對，
 * 誤按舊的可能操作到新的那筆刊登），需要一個明確刪除追蹤資料的入口。只刪這支
 * 程式自己的追蹤紀錄，不會去動樂屋上真正的刊登。
 */
document.querySelector("#snapTable tbody").addEventListener("click", (ev) => {
  const btn = ev.target.closest(".removeOne");
  if (!btn) return;
  const id = btn.dataset.id;
  const no = btn.dataset.no;
  if (!confirm(`確定刪除「${no}」這筆追蹤資料嗎？\n\n只會讓這支程式停止追蹤這一筆，不會去動樂屋上真正的刊登。這個動作沒辦法復原。`)) return;
  btn.disabled = true;
  chrome.runtime.sendMessage({ type: "rr:remove-listing", id }, (r) => {
    $("status").textContent = r?.ok ? `已刪除「${no}」的追蹤資料` : `刪除失敗：${r?.error || "沒有回應"}`;
    render();
  });
});

$("clearDebug").addEventListener("click", async () => {
  await clearDebug();
  render();
});

render();
