/**
 * 樂屋描述最後加一行「太平洋房屋官網」公開物件頁連結（2026-10-01 本人要求自動化，原本只手動測試）。
 * 純函式（真的打 API／fetch 留在 background.js，service worker 才有 fetch，這裡只管比對邏輯）。
 *
 * 背景：太平洋官網（pacific.com.tw）跟愛屋型錄（houseol.com.tw）是太平洋集團底下兩套不同系統，
 * 標題文字不保證一字不差，也不保證同步時間一致（本人真實案例：同一戶愛屋上架當天，官網還沒同步，
 * 搜不到任何結果，過一陣子才會出現）。單純比對標題文字風險更高：本人另一戶「昇祐ONE PLUS」用
 * 寬鬆關鍵字「昇祐」搜尋，同一棟樓就跳出 10 筆類似名稱的不同樓層／坪數／租金單位——這種情況貿然
 * 挑一筆塞進客戶看得到的描述，等於放錯連結，比完全不加這行還糟。
 *
 * 真正可靠的作法：pacific.com.tw 的 /api/ObjectAPI/SearchObject2（本人要求後，直接在瀏覽器
 * console 對正式站打過、真的驗證過的事實，不是猜的）回傳的每一筆資料裡，`pic` 欄位（封面縮圖
 * 網址）對太平洋自己上架的物件（company==="Smart"）常常還是愛屋圖檔主機的原始檔名，例如
 * `https://hq.houseol.com.tw/images/pictures/H229AD5401497a.jpg`——檔名裡原封不動藏著愛屋的
 * 物件編號（AD5401497，大小寫都有看過）。用標題關鍵字先縮小候選範圍，真正判斷「是不是同一戶」
 * 改成比對這個編號有沒有出現在 pic 檔名裡，剛好命中一筆才算數；0 筆或 2 筆以上一律不猜、回
 * null，呼叫端就當作沒有這個連結可以加（跟現在完全沒有這個功能的行為一樣），不會塞錯連結。
 *
 * 這支要給 background.js（MV3 service worker，classic script 不是 ES module）用 importScripts()
 * 載入，跟 license.js／lib/floorplan.js 同一招包成 (function(root){...})(...)；app.js 這邊不需要
 * 比對邏輯本身（只送 rawTitle／listingNo 給 background 問，背景回傳結果或 null），所以沒有另外
 * export 成 ES module——跟 floorplan.js 現在的做法一致。
 */
(function (root) {
  /** 愛屋型錄頁的 rawTitle 常帶著「 2.3萬」這種價格尾巴，但 pacific.com.tw 存的 objectName
   *  沒有——跟 rakuya-recycle-extension 的 recycleOne() 比對「關閉中物件」列表用的是同一條規則，
   *  直接複用同一個正規式字面量，不用另外猜格式。 */
  function pacificSearchKeyword(rawTitle) {
    return String(rawTitle || "")
      .replace(/\s*[\d,.]+\s*(萬|元)\s*$/, "")
      .trim();
  }

  /**
   * searchResponse 是 SearchObject2 回傳的 JSON（{lstData:[...]}）。只信任 company==="Smart"
   * （太平洋自己這個品牌的資料來源，SearchObject2 同一次回應裡還混了別家仲介公司的物件，
   * 例如本人實測看到的 company:"HB"，那些的 pic 是別的圖檔主機，不會有愛屋編號，但還是
   * 用 company 擋一層，不要只靠 pic 字串剛好對不對得上）且 pic 檔名裡找得到這個愛屋編號的
   * 那幾筆；剛好一筆才回傳 saleID，不是「挑第一筆」或「挑最像的一筆」。
   */
  function matchPacificListing(searchResponse, listingNo) {
    const needle = String(listingNo || "").trim().toUpperCase();
    if (!needle) return null;
    const items = searchResponse && Array.isArray(searchResponse.lstData) ? searchResponse.lstData : [];
    const hits = items.filter((it) => it && it.company === "Smart" && typeof it.pic === "string" && it.pic.toUpperCase().includes(needle) && it.saleID);
    return hits.length === 1 ? hits[0].saleID : null;
  }

  /** rent=true → 出租詳情頁（ObjectRentDetail）；rent=false → 出售詳情頁（ObjectDetail）。
   *  ⚠️ 出售這條只是照出租頁面的網址規律推算，還沒有真實出售物件驗證過搜尋本身能不能用。 */
  function pacificDetailUrl(saleID, { rent = true } = {}) {
    if (!saleID) return "";
    const path = rent ? "ObjectRentDetail" : "ObjectDetail";
    return `https://www.pacific.com.tw/Object/${path}/?saleID=${encodeURIComponent(saleID)}`;
  }

  root.P591Pacific = { pacificSearchKeyword, matchPacificListing, pacificDetailUrl };
})(typeof self !== "undefined" ? self : globalThis);
