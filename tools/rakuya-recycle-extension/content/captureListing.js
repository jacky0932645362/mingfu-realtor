/**
 * 內容腳本：怎麼讓一筆新貼的樂屋出租物件「被這個外掛知道」，開始追蹤。
 *
 * 刻意不去跟 591-extension 要資料（不共用 import、不設定 externally_connectable，
 * 兩個外掛完全獨立——本人 2026-09-26 拍板「要做成獨立程式」的精神）。做法是：這支
 * 掛在跟 fillRakuya.js 一樣的網址（member.rakuya.com.tw/rent/post/*），不管物件是
 * 本人自己手動填的還是樂屋助手自動填的，只要看到本人按下「上架」，就從畫面上讀出
 * 描述欄裡的太平洋房屋連結，交給 background 重新抓一次愛屋型錄頁（背景會拿到完整、
 * 當下最新的資料，不用在這裡費工夫從表單欄位一格一格反推）。
 *
 * 找不到連結就安靜放棄（很可能是這筆物件本人還沒手動貼連結，或還沒套用自動塞連結
 * 那個功能）——這支絕對不能擋到本人正常的手動貼文流程，觀察失敗也不能讓上架卡住。
 */
(() => {
  const path = location.pathname;
  if (!/^\/rent\/post\//.test(path)) return;

  // 太平洋房屋官網連結（愛屋型錄）的樣子，跟 591-extension/lib/parser.js 的 isCatalogPage() 認的是同一種
  const CATALOG_URL_RE = /https?:\/\/[^\s"'<>]*houseol\.com\.tw\/[^\s"'<>]*\.aspx[^\s"'<>]*/i;

  function findCatalogUrlInDescription() {
    const ed = document.querySelector(".note-editable");
    if (!ed) return null;
    const m = (ed.innerText || ed.textContent || "").match(CATALOG_URL_RE);
    return m ? m[0] : null;
  }

  // capture 階段：在按鈕真正觸發表單送出、頁面可能跳轉之前，先讀到畫面上的資料
  document.addEventListener(
    "click",
    (ev) => {
      const btn = ev.target.closest("button");
      if (!btn || btn.textContent.replace(/\s+/g, "").trim() !== "上架") return;
      const catalogUrl = findCatalogUrlInDescription();
      if (!catalogUrl) return; // 沒貼連結就不追蹤，不擋本人的正常上架流程
      chrome.runtime.sendMessage({ type: "rr:register-listing", catalogUrl }, () => void chrome.runtime.lastError);
    },
    true,
  );
})();
