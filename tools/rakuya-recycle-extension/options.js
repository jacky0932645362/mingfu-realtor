import { loadSettings, saveSettings, loadSnapshots } from "./lib/store.js";

const $ = (id) => document.getElementById(id);

async function render() {
  const s = await loadSettings();
  $("manageUrl").value = s.manageUrl;
  $("postUrl").value = s.postUrl;
  $("cycleDays").value = s.cycleDays;
  $("lineToken").value = s.lineToken;
  $("lineTarget").value = s.lineTarget;

  const list = await loadSnapshots();
  const tbody = document.querySelector("#snapTable tbody");
  tbody.innerHTML = list.length
    ? list.map((x) => `<tr><td>${esc(x.no || x.listing?.title || x.id)}</td><td>${esc(x.status)}</td><td>${esc(fmt(x.nextRecycleAt))}</td><td>${x.cycleCount}</td></tr>`).join("")
    : `<tr><td colspan="4">目前沒有追蹤中的物件——在樂屋貼文的描述裡放太平洋房屋連結、按下上架，就會自動開始追蹤。</td></tr>`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
function fmt(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}

$("save").addEventListener("click", async () => {
  await saveSettings({
    manageUrl: $("manageUrl").value.trim(),
    postUrl: $("postUrl").value.trim(),
    cycleDays: Number($("cycleDays").value) || 5,
    lineToken: $("lineToken").value.trim(),
    lineTarget: $("lineTarget").value.trim(),
  });
  $("status").textContent = "已儲存";
  setTimeout(() => ($("status").textContent = ""), 2000);
});

$("runNow").addEventListener("click", () => {
  $("status").textContent = "執行中…";
  chrome.runtime.sendMessage({ type: "rr:run-now" }, (r) => {
    $("status").textContent = r?.ok ? `完成，處理了 ${r.processed} 筆` : `失敗：${r?.error || "沒有回應"}`;
    render();
  });
});

render();
