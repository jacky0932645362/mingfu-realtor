/**
 * 格局圖偵測規則（2026-09-23）。
 *
 * 愛屋的型錄頁 HTML 完全沒有標記哪一張照片是格局圖——本人自己重新核對過兩戶真實型錄的 HTML
 * （test/fixtures/catalog-real-page.html、catalog-real-page-cn-numeral-street.html）確認了這件事：
 * 兩戶的照片檔名序號剛好都缺一張（a,b,d,e… 沒有 c），猜測那正是「格局圖有上傳才會占用的號碼」，
 * 但這兩戶剛好都沒有格局圖，沒辦法直接核對格局圖的真實像素長什麼樣。只能像同事黃瑋凱那套一樣，
 * 用「長相」猜：格局圖通常是白底＋純黑/灰線稿，一般室內照片有木地板、油漆、家具、膚色等彩色，
 * 白色比例與灰階（低彩度）比例會低很多。
 *
 * ⚠️ 下面的門檻是照這個常識自己抓的起始值，不是照抄同業的門檻數字（也不能，見 README／
 * project_591上架外掛.md 的「拍板的事」：程式碼不抄，591／愛屋的表單事實可以用）。還沒有本人真實
 * 含格局圖的物件驗證過，門檻很可能要調——background.js 回傳每張的原始比例給 app.js 顯示，誤判時
 * 本人不用開 DevTools，把數字回報就知道要往哪個方向調。
 *
 * 這支要給 background.js（MV3 service worker，classic script 不是 ES module）用 importScripts()
 * 載入，所以跟 license.js 同一招包成 (function(root){...})(...)；純函式部分（不碰真的圖檔解碼）
 * 用 node 的 eval 就測得到，見 test/test-floorplan.mjs。
 */
(function (root) {
  const SAMPLE_MIN_PIXELS = 16; // 取樣圖太小（寬高幾乎是 0）時比例雜訊太大，不判斷，一律當「不像」
  const WHITE_MIN = 235; // R/G/B 都 ≥ 這個值才算「白」（0~255）
  const GRAY_SPREAD_MAX = 18; // max(R,G,B) - min(R,G,B) ≤ 這個值才算「灰階／無彩色」（線稿的黑/灰線也算）
  const WHITE_RATIO_MIN = 0.5; // 白色像素至少要占一半以上
  const GRAY_RATIO_MIN = 0.82; // 灰階像素比例至少要這麼高——一般室內照片的木地板/油漆/家具很少讓整體比例衝這麼高

  /** imageData：{width, height, data}（data 是 RGBA 排列的陣列，跟瀏覽器 ImageData 的 .data 同格式） */
  function statsFromImageData(imageData) {
    const width = (imageData && imageData.width) || 0;
    const height = (imageData && imageData.height) || 0;
    const data = (imageData && imageData.data) || [];
    const n = width * height;
    if (!n) return { width, height, whiteRatio: 0, grayRatio: 0 };
    let white = 0;
    let gray = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r >= WHITE_MIN && g >= WHITE_MIN && b >= WHITE_MIN) white++;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx - mn <= GRAY_SPREAD_MAX) gray++;
    }
    return { width, height, whiteRatio: white / n, grayRatio: gray / n };
  }

  /** stats：{width, height, whiteRatio, grayRatio}（statsFromImageData 的回傳，或帶著同樣欄位的物件） */
  function looksLikeFloorPlan(stats) {
    if (!stats) return false;
    if ((stats.width || 0) * (stats.height || 0) < SAMPLE_MIN_PIXELS) return false;
    return stats.whiteRatio >= WHITE_RATIO_MIN && stats.grayRatio >= GRAY_RATIO_MIN;
  }

  /**
   * items：[{url, whiteRatio, grayRatio, error?}, …]（error 存在代表這張抓/解碼失敗，直接跳過）。
   * 只在「有候選」時才挑，候選裡白色+灰階分數加總最高的一張贏；沒有候選就回 null，不硬猜。
   */
  function pickFloorPlan(items) {
    const candidates = (items || []).filter((it) => it && !it.error && looksLikeFloorPlan(it));
    if (!candidates.length) return null;
    return candidates.slice().sort((a, b) => b.whiteRatio + b.grayRatio - (a.whiteRatio + a.grayRatio))[0];
  }

  /**
   * 不管有沒有過門檻，單純分數（白+灰）最高的一張——給「沒偵測到」時當診斷用：最接近的是哪張、
   * 差多少。跟 pickFloorPlan 分開，是因為 pickFloorPlan 沒有候選就該回 null（不硬猜），但診斷訊息
   * 想知道「最接近的一張長怎樣」，兩個目的不一樣。錯誤（抓圖失敗）的一樣跳過。
   */
  function bestCandidate(items) {
    const ok = (items || []).filter((it) => it && !it.error);
    if (!ok.length) return null;
    return ok.slice().sort((a, b) => b.whiteRatio + b.grayRatio - (a.whiteRatio + a.grayRatio))[0];
  }

  root.P591FloorPlan = {
    statsFromImageData,
    looksLikeFloorPlan,
    pickFloorPlan,
    bestCandidate,
    THRESHOLDS: { SAMPLE_MIN_PIXELS, WHITE_MIN, GRAY_SPREAD_MAX, WHITE_RATIO_MIN, GRAY_RATIO_MIN },
  };
})(typeof self !== "undefined" ? self : globalThis);
