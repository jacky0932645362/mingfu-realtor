/**
 * 內容腳本：掛在按下「儲存」送出之後跳轉到的成功頁
 * （my.rakuya.com.tw/pay/item_carry/success?ehid=...）。把 captureListing.js
 * 換頁前存好的愛屋連結撿回來，交給 background 完成登記。
 */
(() => {
  const DEBUG_KEY = "rr:debug";
  function dbg(message) {
    chrome.storage.local.get(DEBUG_KEY, (o) => {
      const list = Array.isArray(o[DEBUG_KEY]) ? o[DEBUG_KEY] : [];
      list.push({ at: new Date().toISOString(), from: "captureSuccess", message: String(message).slice(0, 1000) });
      chrome.storage.local.set({ [DEBUG_KEY]: list.slice(-80) });
    });
  }

  dbg(`載入，網址=${location.href}`);
  const ehid = new URL(location.href).searchParams.get("ehid");
  if (!ehid) { dbg("網址裡沒有 ehid 參數，放棄"); return; }

  // 跟 captureListing.js 同一個修正：改用 chrome.storage.local，session 不准內容腳本存取
  chrome.storage.local.get(
    ["rr:pending-catalog-url", "rr:pending-desc-html", "rr:pending-desc-text", "rr:pending-cover-photo", "rr:pending-form-fields"],
    (o) => {
      const catalogUrl = o["rr:pending-catalog-url"];
      if (!catalogUrl) { dbg("chrome.storage.local 裡沒有暫存的連結，放棄（可能上一頁沒存到）"); return; }
      const descHtml = o["rr:pending-desc-html"] || "";
      const descText = o["rr:pending-desc-text"] || "";
      const coverPhotoDataUrl = o["rr:pending-cover-photo"] || "";
      const formFields = o["rr:pending-form-fields"] || {};
      dbg(
        `撿到暫存連結：${catalogUrl}，ehid=${ehid}，描述長度=${descText.length}，封面照片=${coverPhotoDataUrl ? `${coverPhotoDataUrl.length} 字元` : "沒存到"}，表單欄位=${Object.keys(formFields).length} 個，通知 background 登記`,
      );
      chrome.storage.local.remove(["rr:pending-catalog-url", "rr:pending-desc-html", "rr:pending-desc-text", "rr:pending-cover-photo", "rr:pending-form-fields"]);
      chrome.runtime.sendMessage(
        { type: "rr:register-listing", catalogUrl, rakuyaId: ehid, rakuyaUrl: location.href, descHtml, descText, coverPhotoDataUrl, formFields },
        (r) => dbg(`background 回覆：${JSON.stringify(r)}${chrome.runtime.lastError ? " / 錯誤：" + chrome.runtime.lastError.message : ""}`),
      );
    },
  );
})();
