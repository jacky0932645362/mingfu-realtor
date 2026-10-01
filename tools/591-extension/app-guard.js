// 直接雙擊 app.html（file://）打開時，ES module 會被瀏覽器擋掉、按鈕全沒反應；先把提示亮出來。
// 寫成獨立檔而不是 inline：外掛頁面的 CSP 不准 inline script。
if (location.protocol === "file:") document.getElementById("file-warn").hidden = false;
