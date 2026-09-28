/**
 * 背景程式（MV3 service worker，ES module——跟 591-extension 的 background.js 不同，
 * 那支是 classic script 用 importScripts()；這支獨立外掛沒有互相依賴的理由，直接用
 * import 比較乾淨）。
 *
 * 做四件事：
 *  ① 裝好之後排一個 chrome.alarms 週期鬧鐘，時間到自己醒來跑一輪（本人 2026-09-26
 *     拍板：獨立 Chrome 外掛＋背景鬧鐘自動觸發，全自動不用人在電腦前按，條件只有
 *     「Chrome 要是開著的」——見 [[project_樂屋出租循環刊登]]）。
 *  ② 存在檢查：抓愛屋型錄頁比對，判斷是否已出租。
 *  ③ 還在租的：開分頁把舊物件「成交/關閉」（固定選「不方便帶看屋」），再開新增物件
 *     頁面填表＋真的送出。
 *  ④ LINE 通知——最重要的一則是「舊的關了但新的沒建成」，物件曝光空窗必須立刻
 *     通知，不能悄悄跳過。
 *
 * ⚠️ 第一版，還沒對真帳號跑過。options.html 有「立即執行一次」按鈕方便本人第一次
 *    校準，不用等鬧鐘時間到。
 */
import { checkExistence, fetchCatalogListing } from "./lib/catalog-check.js";
import { loadSnapshots, saveSnapshots, markChecked, recordRecycled, dueForRecycle, findById, loadSettings, pushDebug, removeSnapshot } from "./lib/store.js";
import { newSnapshot } from "./lib/snapshot.js";
import { derive, buildPayload, buildDescription, cleanTitle } from "./lib/map591.js";
import { buildRakuya } from "./lib/rakuya-map.js";
import { listingNoFromUrl } from "./lib/parser.js";

const ALARM_NAME = "rr:sweep";
const ALARM_PERIOD_MINUTES = 60; // 每小時醒來看一次有沒有到期的，不是「每小時都刪除重刊一次」
const FAIL_STREAK_NOTIFY = 3;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
});

/* 點工具列圖示直接開設定頁，跟 591-extension 點圖示開 app.html 是同一個做法——
   本人反映「選項」連結太難找，chrome://extensions 的詳細資料頁裡才有。 */
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runSweep().catch((e) => console.error("排程執行失敗：", e));
});

/* ───────── LINE 通知：照 tools/rakuya-recycle/notify.mjs 同一套，設定改從 chrome.storage 讀 ───────── */

async function pushLine(text) {
  const { lineToken, lineTarget } = await loadSettings();
  if (!lineToken || !lineTarget) return { skipped: true };
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lineToken}` },
      body: JSON.stringify({ to: lineTarget, messages: [{ type: "text", text: String(text).slice(0, 4900) }] }),
    });
    return { skipped: false, ok: res.ok };
  } catch (e) {
    return { skipped: false, ok: false, error: String(e) };
  }
}

const nowTaipei = () =>
  new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date());

const label = (snap) => snap.no || snap.listing?.title || snap.listing?.rawTitle || "（沒有標題）";
/**
 * 🔴 2026-09-27 本人第一次真測抓到的真bug：關閉舊物件時拿 snap.no（AD5359456
 * 這種內部物件編號）去「出租物件管理」列表裡比對文字，但那個編號根本不會顯示
 * 在那個畫面上（畫面顯示的是物件標題）——等於永遠比對不到，`closeListing.js`
 * 100% 會回報「列表裡找不到這一列」。matchText 要用畫面上真的看得到的標題，
 * 不能用 label(snap)（那個也是 no 優先，同一個問題）。
 */
/**
 * 🔴 2026-09-27 修完上面那個又測到第二層：rawTitle 是愛屋型錄原始格式，
 * 「標題文字」跟「價格」黏在同一行（例如「全新兩房雙衛浴 1.5萬」），但樂屋
 * 「出租物件管理」列表畫面上的標題本身不含價格（價格是分開的欄位），整串
 * 比對當然還是找不到。把常見的「數字+萬/元」尾巴切掉，只留標題本身。
 */
const titleOf = (snap) => (snap.listing?.rawTitle || snap.listing?.title || label(snap)).replace(/\s*[\d,.]+\s*(萬|元)\s*$/, "").trim();

function renderRecycleFailed(snap, error) {
  return `🔴 樂屋重刊失敗，物件已關閉但新的沒建立成功，需要你手動處理！\n\n${label(snap)}\n原因：${String(error).slice(0, 200)}\n舊刊登：${snap.rakuyaUrl || "（沒有記錄）"}\n⏱ ${nowTaipei()}`;
}
function renderRecycled(snap) {
  return `🔄 樂屋物件已重新上架\n\n${label(snap)}\n第 ${snap.cycleCount} 次重刊\n🔗 ${snap.rakuyaUrl}\n⏱ ${nowTaipei()}`;
}
function renderRentedOut(snap, mismatchedFields) {
  return `⚫️ 判定已出租，停止重刊\n\n${label(snap)}\n對不起來的欄位：${mismatchedFields.join("、")}\n⏱ ${nowTaipei()}`;
}
function renderCheckFailing(snap, failStreak) {
  return `⚠️ 存在檢查連續 ${failStreak} 次抓不到\n\n${label(snap)}\n愛屋連結：${snap.catalogUrl}\n找時間自己點開看一下是不是連結失效了。\n⏱ ${nowTaipei()}`;
}

/* ───────── 開分頁 → 注入內容腳本 → 呼叫它 → 拿結果 → 關分頁 ───────── */

async function runInTab(tabId, file, func, args) {
  await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return result;
}

/**
 * 🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-28 本人直接截圖
 * 給了真正的答案：手動點「關閉中物件」的「修改」，網址列顯示
 * `member.rakuya.com.tw/rent/post/edit?ehid={ehid}`——`ehid` 就是
 * `snap.rakuyaId`，本來就已經存在快照裡！不用再在管理頁上找「修改」
 * 連結（上一版一直失敗的真正原因：那支物件這時候已經在「關閉中物件」
 * 分頁，根本不在「上架中物件」，`findByText` 當然找不到，不是找法本身
 * 猜錯標籤），直接組這個網址開分頁最直接可靠——不管物件現在是上架中
 * 還是已關閉，這個網址都打得開（本人就是從「關閉中物件」點進去的）。
 */
async function scrapeCurrentListingState(rakuyaId) {
  if (!rakuyaId) return { ok: false, error: "這筆快照沒有記錄 rakuyaId，沒辦法直接開編輯頁" };
  const editUrl = `https://member.rakuya.com.tw/rent/post/edit?ehid=${encodeURIComponent(rakuyaId)}`;
  // 2026-09-28 全自動重刊整條路線已確認端到端跑通，改回背景執行——
  // 排程全自動時不該讓分頁跳出來搶走本人的視窗焦點。
  const tab = await chrome.tabs.create({ url: editUrl, active: false });
  await waitForTabLoad(tab.id);
  let scraped;
  try {
    scraped = await runInTab(tab.id, "content/scrapeListing.js", () => window.__rrScrapeListing__(), []);
  } catch (e) {
    scraped = { ok: false, error: `注入編輯頁擷取腳本失敗：${String(e && e.message ? e.message : e)}` };
  }
  await chrome.tabs.remove(tab.id).catch(() => {});
  return scraped;
}

async function closeOldListing(manageUrl, matchText) {
  const tab = await chrome.tabs.create({ url: manageUrl, active: false });
  await waitForTabLoad(tab.id);
  let result;
  try {
    result = await runInTab(tab.id, "content/closeListing.js", (matchText) => window.__rrCloseListing__({ matchText }), [matchText]);
  } catch (e) {
    /**
     * 🔴🔴🔴🔴🔴🔴 2026-09-27 本人實測抓到的真實例外文字：
     * 「Frame with ID 0 was removed.」——點擊真正的送出控制項會觸發某種
     * 讓這個分頁腳本執行環境中斷的動作（跟 createListing.js 按下「儲存」
     * 跨網域跳轉是同一類問題，那邊已經是「不等、不讀返回值、交給外部
     * 觀察」的處理方式）。但這裡不能照抄同一招直接假設「中斷=成功」——
     * 這是本人真實在租的物件，關閉這個動作沒有像建立新物件那樣有一個
     * 固定的「成功頁網址」可以從外部觀察，錯判成功或錯判失敗都有實際
     * 後果（該關的物件誤判失敗又跑一次、或沒真的關掉卻誤判成功導致
     * 接下來建立新物件時舊的還留著）。等頁面穩定下來後，重新整理同一個
     * 分頁，用真實畫面狀態（這筆物件還在不在「上架中物件」列表）驗證
     * 結果，不猜例外訊息本身代表成功還是失敗。
     */
    await waitForTabLoad(tab.id, 8000);
    /**
     * 🔴🔴🔴🔴🔴🔴🔴 2026-09-27 本人實測：中斷後重新檢查，物件仍在上架中
     * 物件列表——代表點擊本身沒有真的送出成功，不是「中斷=成功」那種
     * 情況。`__rrStillListed__` 現在會一併撈回點擊前搶先存好的診斷資訊
     * （點的是哪個元素、用哪種方法找到的、當下 `.reason` 可見元素的 id），
     * 塞進錯誤訊息裡，下次本人截圖除錯紀錄就能看到真正點到的是什麼，
     * 不用再靠猜。
     */
    const check = await runInTab(tab.id, "content/closeListing.js", (matchText) => window.__rrStillListed__(matchText), [matchText]).catch(() => null);
    await chrome.tabs.remove(tab.id).catch(() => {});
    const exceptionText = String(e && e.message ? e.message : e);
    const debugSuffix = check?.preSubmitDebug ? `，點擊前資訊：${JSON.stringify(check.preSubmitDebug)}` : "";
    if (check?.stillListed === false) return { ok: true, note: `點擊後腳本執行環境中斷（${exceptionText}），重新檢查確認已經不在上架中物件列表，判定成功${debugSuffix}` };
    if (check?.stillListed === true) return { ok: false, error: `點擊後腳本執行環境中斷，重新檢查後物件仍在上架中物件列表，判定失敗${debugSuffix}` };
    return { ok: false, error: `點擊後腳本執行環境中斷（${exceptionText}），重新檢查也失敗，無法判斷是否成功，需要人工到樂屋後台確認${debugSuffix}`, needsManualCheck: true };
  }
  await chrome.tabs.remove(tab.id).catch(() => {});
  return result;
}

const SUCCESS_URL_RE = /^https:\/\/my\.rakuya\.com\.tw\/pay\/item_carry\/success/i;

/**
 * 2026-09-27 本人截圖實測確認：按下「儲存」送出後會整個跳轉到不同網域
 * （member.rakuya.com.tw → my.rakuya.com.tw），填表腳本自己的執行環境會被導航
 * 直接砍斷，`executeScript` 那個呼叫的 promise 極可能因此丟例外或拿不到回傳值——
 * 這是**預期中的正常現象**，不能當作失敗。真正可靠的成功依據改成用
 * `chrome.tabs.onUpdated` 從外面觀察分頁網址有沒有跳到成功頁，不管填表腳本
 * 自己回報了什麼都以這個為準。
 */
/**
 * 🔴🔴 2026-09-27 本人真帳號第一次測到「建立新物件」這一步，抓到真正病灶：這裡原本
 * 直接把快照存的原始 listing（parser.js 的扁平格式，floor／total 是直接數字欄位）丟給
 * createListing.js，但 createListing.js 的欄位對映是照抄 591-extension 的
 * fillRakuya.js，期待的其實是 derive()→buildPayload()→buildRakuya() 組出來的巢狀格式
 * （floor.sell／floor.total 這種）——591 那邊一直是先轉換過再餵給 fillRakuya.js，這個
 * 轉換步驟這次搬過來的時候漏掉了，導致總樓層等好幾格永遠是空的（真帳號畫面驗證：
 * 紅字「總樓層必須填入資料」）。改成在這裡補上完整的轉換鏈，跟 591-extension/app.js
 * 的 rakuyaVariant() 同一套邏輯組出 payload（含倒數第二行物件編號、最後一行愛屋連結，
 * 給 captureListing.js 認得繼續追蹤這筆新物件）。
 *
 * ⚠️ 已知簡化：settings 傳空物件——本人在 591 那邊設定的固定尾段簽名檔／字級顏色樣式
 * 不會套用到自動重刊的物件，重刊出來的描述會有物件特色但沒有簽名檔，跟本人原本手動
 * PO 的樣子不完全一樣。這是刻意的取捨（先求能送出成功），之後如果在意這點差異可以
 * 再回頭處理，見 [[project_樂屋出租循環刊登]]。
 *
 * 🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-27 本人真帳號實測抓到：重刊出來的「特色描述」不是他
 * 原本貼的內容——因為這裡原本每次都用 `buildDescription()` 從型錄資料重新組一份，
 * 但型錄資料只是「原始素材」，本人貼文時常常會手動調整、增減內容，型錄現在長什麼
 * 樣子不等於本人當初實際貼出去的是什麼樣子。`captureListing.js` 現在會在本人按下
 * 送出的那一刻，把描述編輯器當下的 innerHTML／文字都存進快照（`capturedDescHtml`／
 * `capturedDescText`）——這裡改成優先使用這份「本人真的貼過的內容」，只有舊快照
 * 沒有這個欄位（這個修法之前建立的）才退回用型錄資料重新組一份。
 */
function buildRecreatePayload(snap) {
  const listing = snap.listing;
  const o = derive(listing);
  const title = cleanTitle(listing.rawTitle);
  const settings = {};
  let desc;
  let descHtmlOverride = "";
  if (snap.capturedDescText) {
    desc = snap.capturedDescText;
    descHtmlOverride = snap.capturedDescHtml || "";
  } else {
    desc = buildDescription(listing, o, settings);
    if (listing.deal === "rent" && listing.catalogUrl) {
      const listingNo = listingNoFromUrl(listing.catalogUrl);
      desc = `${desc}\n${listingNo ? `${listingNo}\n${listing.catalogUrl}` : listing.catalogUrl}`;
    }
  }
  const payload = buildPayload(listing, o, [], title, desc, settings);
  if (descHtmlOverride) payload.descHtml = descHtmlOverride;
  /**
   * 🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-27 本人追問：第一張照片本人常會另外貼「封面
   * 貼圖」，型錄原始照片是沒貼過的版本。跟描述同一個道理——`payload.photos`
   * 目前是型錄網址（`d.photos.slice()`），換成本人送出當下真正上傳的那個檔案
   * （`capturedCoverPhotoDataUrl`，createListing.js 的 uploadPhotos() 認得
   * data: URL 會直接解碼，不用跨網域抓圖那套）。只換第一張，其餘照片繼續用
   * 型錄網址（本人這次問題只提到第一張封面）。
   */
  if (snap.capturedCoverPhotoDataUrl) {
    payload.photos = [snap.capturedCoverPhotoDataUrl, ...payload.photos.slice(1)];
  }
  payload.rakuya = buildRakuya(listing, o, payload);
  /**
   * 🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-27 本人確認的通解：本人平常貼文
   * 本來就會在自動填表跑完之後手動調整補充（這次真帳號撞到的「隔間材質」是
   * 樂屋有、591 沒有對應欄位，591-extension 那套對映天生不會涵蓋），不是只有
   * 描述跟封面貼圖兩處可能被手動調整過。`capturedFormFields` 帶著本人送出
   * 當下整張表單的欄位快照，掛在 payload 上讓 createListing.js 在結構性填表
   * 結束後整批套用、蓋掉/補上結構性填表沒處理到的欄位。
   */
  if (snap.capturedFormFields) payload.capturedFormFields = snap.capturedFormFields;
  return payload;
}

async function createNewListing(postUrl, snap) {
  const payload = buildRecreatePayload(snap);
  // 2026-09-28 全自動重刊整條路線已確認端到端跑通（街道/社區/門牌/
  // 描述/封面貼圖全部正確），改回背景執行——排程全自動時不該讓分頁
  // 跳出來搶走本人的視窗焦點。
  const tab = await chrome.tabs.create({ url: postUrl, active: false });
  await waitForTabLoad(tab.id);
  let fillResult = null;
  try {
    fillResult = await runInTab(tab.id, "content/createListing.js", (payload) => window.__rrCreateListing__(payload), [payload]);
  } catch {
    // 吞掉——可能只是導航把腳本執行環境砍斷，不代表真的失敗，交給下面的網址觀察判斷
  }
  /**
   * 🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-27 本人真帳號實測抓到：這裡原本完全沒接住
   * `runInTab()` 的回傳值——createListing.js 新加的「送出前檢查必填欄位」明明
   * 會老實回報「隔間材質」這種還空著的欄位，但這個回傳值直接被丟掉，程式照樣
   * 傻等 90 秒逾時，最後只留下沒有實際內容的「等不到成功頁面出現」，本人只能
   * 自己一個一個截圖找紅字。填表腳本沒有被導航中斷（沒丟例外）又明確回報
   * ok:false 的情況，代表它是「正常執行完、確實知道自己沒送出成功」（例如必填
   * 欄位檢查擋下來、找不到送出按鈕），這種情況不用等成功頁，直接把這個明確的
   * 錯誤內容回報回去，不要讓它被之後的逾時訊息蓋掉。
   */
  if (fillResult && fillResult.ok === false) {
    return fillResult;
  }
  const successUrl = await waitForSuccessUrl(tab.id);
  if (!successUrl) {
    // 沒等到成功頁：不主動關分頁，讓本人自己看畫面診斷是卡在哪一步
    return { ok: false, error: "按了送出，但等不到成功頁面出現，不確定是不是真的送出成功" };
  }
  await chrome.tabs.remove(tab.id).catch(() => {});
  return { ok: true, finalUrl: successUrl };
}

/**
 * 🔴 2026-09-27 本人第一次真的測「只重刊這一筆」：除錯紀錄證實分頁確實跳到了
 * 全新的成功頁（captureSuccess.js 自己獨立偵測到、還嘗試登記，只是因為連結
 * 已追蹤中才被擋掉），但最後狀態卻是 error——代表這支等待邏輯本身逾時了，
 * 不是流程真的失敗。填表（尤其是照片一張一張上傳，每批還有 2.5 秒的
 * sleep）加上送出跳轉，實際花的時間顯然比原本 30 秒抓得緊。改成三重保險：
 * ①逾時拉長到 90 秒 ②onUpdated 除了看 tab.url 也看 changeInfo.url（Chrome
 * 有時候這個欄位比 tab.url 更早/更準）③額外加一個每 2 秒的輪詢當保底，
 * 就算前兩種事件真的漏接，最多 2 秒內也會被這個補上。
 */
function waitForSuccessUrl(tabId, timeout = 90000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (url) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      clearInterval(poll);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(url);
    };
    const t = setTimeout(() => finish(null), timeout);
    function listener(id, info, tab) {
      if (id !== tabId) return;
      if ((info && info.url && SUCCESS_URL_RE.test(info.url)) || (tab && tab.url && SUCCESS_URL_RE.test(tab.url))) finish(info?.url || tab.url);
    }
    chrome.tabs.onUpdated.addListener(listener);
    const poll = setInterval(() => {
      chrome.tabs.get(tabId).then((tab) => { if (tab.url && SUCCESS_URL_RE.test(tab.url)) finish(tab.url); }).catch(() => finish(null));
    }, 2000);
    // 立刻查一次，不要錯過「掛上監聽器之前就已經到達」的情況
    chrome.tabs.get(tabId).then((tab) => { if (tab.url && SUCCESS_URL_RE.test(tab.url)) finish(tab.url); }).catch(() => {});
  });
}

function waitForTabLoad(tabId, timeout = 20000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, timeout);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(t);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 500); // 給樂屋前端一點時間把表單元件畫出來
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/* ───────── 排程主邏輯：一筆一筆處理，一筆出事不拖垮整批 ───────── */

async function recycleOne(list, snap, settings) {
  await pushDebug("recycleOne", `開始處理 ${snap.no || snap.id}，先跑存在檢查`);
  const check = await checkExistence(snap);
  await pushDebug("recycleOne", `存在檢查結果：verdict=${check.verdict}${check.error ? ` error=${check.error}` : ""}${check.mismatchedFields ? ` 對不起來的欄位=${check.mismatchedFields.join(",")}` : ""}`);
  await markChecked(list, snap.id, check);
  await saveSnapshots(list); // 每筆處理完就存一次，中途中斷不會整批丟（同 property-watch 的原則）

  if (check.verdict === "fetch_failed") {
    const item = findById(list, snap.id);
    if (item.failStreak >= FAIL_STREAK_NOTIFY) await pushLine(renderCheckFailing(item, item.failStreak));
    return { outcome: "fetch_failed" };
  }
  if (check.verdict === "different") {
    await pushLine(renderRentedOut(snap, check.mismatchedFields));
    return { outcome: "rented_out" };
  }

  // verdict "same"：還在租，照排程繼續刪除重刊
  const matchText = titleOf(snap);

  /**
   * 🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-28 本人直接截圖
   * 給了真正的答案：手動點「關閉中物件」的「修改」，網址列顯示
   * `member.rakuya.com.tw/rent/post/edit?ehid={ehid}`——直接用
   * `snap.rakuyaId` 組網址開分頁，不用在管理頁上找「修改」連結（上一版
   * 一直失敗的真正原因：那支物件這時候已經在「關閉中物件」分頁，根本
   * 不在「上架中物件」，在管理頁上搜尋當然找不到）。這個網址不管物件
   * 現在是上架中還是已關閉都打得開，本人就是從「關閉中物件」點進去的。
   * 掃描失敗不影響整批流程——退回用原本已經存的（可能是空的）
   * capturedFormFields 或型錄資料，不會讓這筆物件卡住不處理。
   */
  const scraped = await scrapeCurrentListingState(snap.rakuyaId);
  await pushDebug(
    "recycleOne",
    scraped?.ok
      ? `編輯頁掃描成功：表單欄位=${scraped.formFieldCount} 個，描述長度=${scraped.descText.length}，照片=${scraped.photoImgCount} 張（選第一張當封面，網址=${scraped.coverPhotoSrc || "(沒選到)"}，封面貼圖=${scraped.coverStickerDebug}），街道欄位=${scraped.addrRoadDebug}`
      : `編輯頁掃描失敗（不影響流程，退回用已有的快照資料）：${scraped?.error || "沒有回應"}`,
  );
  if (scraped?.ok) {
    const item = findById(list, snap.id);
    item.capturedDescHtml = scraped.descHtml;
    item.capturedDescText = scraped.descText;
    if (scraped.coverPhotoDataUrl) item.capturedCoverPhotoDataUrl = scraped.coverPhotoDataUrl;
    if (scraped.formFieldCount) item.capturedFormFields = scraped.formFields;
    item.updatedAt = new Date().toISOString();
    await saveSnapshots(list);
  }

  await pushDebug("recycleOne", `還在租，開始關閉舊物件（manageUrl=${settings.manageUrl}，比對文字=${matchText}）`);
  /**
   * 🔴🔴🔴🔴🔴 2026-09-27 本人連續兩次實測：分頁很快閃一下就消失（符合正常
   * 流程的速度），但「關閉結果」這行除錯紀錄從來沒有出現過——代表
   * `closeOldListing()` 丟出例外，而這裡完全沒有 try/catch 接住，例外整個
   * 往上消失不見，連紀錄都來不及寫。最可能的原因：這次 `findSubmitByOnclick`
   * 真的找到並點到了畫面上「真正的」送出控制項（跟前幾輪每次都安全回報
   * 「找不到」不一樣），而點下去觸發了某種讓腳本執行環境中斷的動作（跟
   * `createListing.js` 那邊按下「儲存」跨網域跳轉砍斷腳本是同一類問題，
   * 見下面 `createNewListing()` 的處理方式）。用 try/catch 接住，至少能把
   * 真正的例外內容記下來，不要再讓它憑空消失。
   */
  let closeResult;
  try {
    closeResult = await closeOldListing(settings.manageUrl, matchText);
  } catch (e) {
    closeResult = { ok: false, error: `closeOldListing 拋出例外：${String(e && e.message ? e.message : e)}` };
  }
  await pushDebug("recycleOne", `關閉結果：${JSON.stringify(closeResult)}`);
  /**
   * 🔴🔴🔴🔴🔴🔴🔴 2026-09-27 本人真實撞上這個情境：上一次關閉其實成功了
   * （見上面「Frame with ID 0 was removed」那次），但當時被誤判成失敗，
   * 流程就停在這裡沒有繼續建立新物件——物件曝光空窗，本人自己到樂屋後台
   * 手動處理才發現。根本原因：`findCloseLinkForRow` 找不到列（"列表裡
   * 找不到...這一列的成交/關閉連結"）只可能是因為物件本來就已經不在
   * 「上架中物件」列表——不管是這支程式上次真的關閉成功、還是本人自己
   * 手動關過——這種情況應該視為「關閉這一步已經完成」，直接繼續建立
   * 新物件，不能整批當成錯誤就停住不動，那樣只會讓物件繼續空在那裡。
   */
  const alreadyNotListed = !closeResult?.ok && /列表裡找不到/.test(closeResult?.error || "");
  if (alreadyNotListed) {
    await pushDebug("recycleOne", "判斷物件已經不在上架中物件列表（可能上次已關閉成功但沒建成新物件，或本人自己手動關過），視為關閉已完成，繼續建立新物件");
  }
  if (!closeResult || (!closeResult.ok && !alreadyNotListed)) {
    const item = findById(list, snap.id);
    item.status = "error";
    item.updatedAt = new Date().toISOString();
    await saveSnapshots(list);
    return { outcome: "error", error: closeResult?.error, closedButNotRecreated: false };
  }

  await pushDebug("recycleOne", `關閉成功，開始建立新物件（postUrl=${settings.postUrl}）`);
  const createResult = await createNewListing(settings.postUrl, snap);
  await pushDebug("recycleOne", `建立結果：${JSON.stringify(createResult)}`);
  if (!createResult || !createResult.ok) {
    const item = findById(list, snap.id);
    item.status = "error";
    item.updatedAt = new Date().toISOString();
    await saveSnapshots(list);
    // 🔴 最壞情況：舊的關了、新的沒建成——這戶現在完全沒曝光，一定要通知，不能悄悄跳過
    await pushLine(renderRecycleFailed(item, createResult?.error || "未知錯誤"));
    return { outcome: "error", error: createResult?.error, closedButNotRecreated: true };
  }

  // 2026-09-27 本人截圖實測確認的真實成功頁網址格式：my.rakuya.com.tw/pay/item_carry/success?ehid=...
  const rakuyaId = new URL(createResult.finalUrl || "https://x/").searchParams.get("ehid");
  const updated = await recordRecycled(list, snap.id, { rakuyaUrl: createResult.finalUrl, rakuyaId, cycleDays: settings.cycleDays });
  await saveSnapshots(list);
  await pushDebug("recycleOne", `全部完成，新網址=${createResult.finalUrl}，rakuyaId=${rakuyaId}`);
  await pushLine(renderRecycled(updated));
  return { outcome: "recycled" };
}

/**
 * force=true（設定頁「立即執行一次」按的就是這個）：不管 nextRecycleAt 到了沒，
 * 只要還是 active 就處理——這顆按鈕本來就是「測試用，不用等排程」，本人不該
 * 還要先改循環天數、等時間到才測得到關閉/重刊那段。真正排程觸發的 chrome.alarms
 * 還是照 dueForRecycle() 的日期走，不受影響。
 *
 * onlyId：2026-09-27 本人第一次要真的測關閉/重刊，要求「先測一筆」——force=true
 * 原本會把所有 active 的一次全部處理，這台這台只要追蹤清單裡還有別筆也是 active，
 * 按下去就會連那幾筆一起真的關閉+重刊，不是只測一筆。給 onlyId 就只處理那一筆，
 * 其他 active 的物件完全不受這次執行影響。
 *
 * 🔴 onlyId 刻意不要求 status==="active"：第一次真測到的那筆因為 waitForSuccessUrl
 * 逾時判定太嚴格被標成 error（見上面那段修正），如果「只重刊這一筆」還是只認
 * active，標成 error 的物件永遠沒辦法從畫面上重試，本人會卡住。onlyId 是本人
 * 點名要處理的「這一筆」，只排除已經確認判定「已出租」的（那個是刻意的終止
 * 狀態，不該被手動按鈕繞過）。
 */
export async function runSweep({ force = false, onlyId = null } = {}) {
  const settings = await loadSettings();
  const list = await loadSnapshots();
  const due = onlyId
    ? list.filter((s) => s.id === onlyId && s.status !== "rented_out")
    : force
      ? list.filter((s) => s.status === "active")
      : dueForRecycle(list);
  if (!due.length) return { processed: 0 };
  if (!settings.manageUrl || !settings.postUrl) {
    console.warn("manageUrl／postUrl 還沒在設定頁填，這輪先跳過");
    return { processed: 0, skipped: "no_urls" };
  }

  const results = [];
  for (const snap of due) {
    const r = await recycleOne(list, snap, settings);
    results.push({ id: snap.id, no: snap.no, ...r });
  }
  return { processed: results.length, results };
}

/* ───────── 一筆新物件被本人貼出去（不管手動還是樂屋助手）→ 開始追蹤 ───────── */

async function registerListing(catalogUrl, { rakuyaId = null, rakuyaUrl = null, descHtml = "", descText = "", coverPhotoDataUrl = "", formFields = null } = {}) {
  await pushDebug(
    "background",
    `registerListing 收到 catalogUrl=${catalogUrl} rakuyaId=${rakuyaId} 描述長度=${descText.length} 封面照片=${coverPhotoDataUrl ? "有" : "沒有"} 表單欄位=${formFields ? Object.keys(formFields).length : 0} 個`,
  );
  const list = await loadSnapshots();
  // 同一條愛屋連結、還在追蹤中的，不要重複建立快照（本人可能同一筆物件按了兩次上架）
  if (list.some((s) => s.catalogUrl === catalogUrl && s.status === "active")) {
    await pushDebug("background", "這條連結已經在追蹤清單裡了，跳過");
    return { ok: false, error: "這條連結已經在追蹤清單裡了" };
  }
  const settings = await loadSettings();
  const fetched = await fetchCatalogListing(catalogUrl);
  if (!fetched.ok) {
    await pushDebug("background", `fetchCatalogListing 失敗：${fetched.error}`);
    return { ok: false, error: fetched.error };
  }
  const snap = newSnapshot({
    listing: fetched.listing,
    catalogUrl,
    rakuyaId,
    rakuyaUrl,
    cycleDays: settings.cycleDays,
    capturedDescHtml: descHtml,
    capturedDescText: descText,
    capturedCoverPhotoDataUrl: coverPhotoDataUrl,
    capturedFormFields: formFields,
  });
  list.push(snap);
  await saveSnapshots(list);
  await pushDebug("background", `建立快照成功，id=${snap.id}`);
  return { ok: true, id: snap.id };
}

/* ───────── 訊息：createListing.js 上傳照片時跨網域抓圖用；captureListing.js 通報新物件 ───────── */

/**
 * 🔴 2026-09-28 本人重測封面貼圖，除錯訊息第一次露出真正原因：
 * 「封面照抓取失敗：Failed to fetch」——這是 CORS／CSP 層級失敗（連
 * HTTP 狀態碼都沒有），不是伺服器拒絕。scrapeListing.js 原本在內容腳本
 * 裡直接對 `static.rakuya.com.tw` 呼叫 `fetch()`，會被編輯頁
 * （member.rakuya.com.tw）自己的 CSP／CORS 規則卡住。這支背景頁的
 * `rr:fetch-image` 中繼（本來就有，給 createListing.js 抓愛屋型錄圖片
 * 用）不受頁面 CSP 限制，只受 host_permissions 管——加入 rakuya.com.tw
 * 讓 scrapeListing.js 也走這條路，不要在內容腳本裡直接 fetch 跨網域圖片。
 */
function allowedImageHost(hostname) {
  return (
    hostname === "houseol.com.tw" ||
    hostname.endsWith(".houseol.com.tw") ||
    hostname === "rakuya.com.tw" ||
    hostname.endsWith(".rakuya.com.tw")
  );
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;

  if (msg.type === "rr:fetch-image") {
    (async () => {
      try {
        const u = new URL(String(msg.url || ""));
        if (!allowedImageHost(u.hostname)) throw new Error("不抓這個網域的圖：" + u.hostname);
        const res = await fetch(u.href, { credentials: "omit" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const bytes = new Uint8Array(await res.arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        sendResponse({ ok: true, b64: btoa(bin), type: res.headers.get("content-type") || "image/jpeg" });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();
    return true; // 非同步回覆
  }

  if (msg.type === "rr:register-listing") {
    registerListing(msg.catalogUrl, { rakuyaId: msg.rakuyaId, rakuyaUrl: msg.rakuyaUrl, descHtml: msg.descHtml, descText: msg.descText, coverPhotoDataUrl: msg.coverPhotoDataUrl, formFields: msg.formFields }).then((r) => sendResponse(r)).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "rr:run-now") {
    runSweep({ force: true }).then((r) => sendResponse({ ok: true, ...r })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "rr:run-one") {
    runSweep({ force: true, onlyId: String(msg.id || "") })
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "rr:remove-listing") {
    (async () => {
      try {
        const list = removeSnapshot(await loadSnapshots(), String(msg.id || ""));
        await saveSnapshots(list);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  return false;
});
