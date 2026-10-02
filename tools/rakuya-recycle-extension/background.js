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
import { checkPacific } from "./lib/pacific-check.js";
import { recordRentObservation, priceLinks } from "./lib/price-watch.js";

const ALARM_NAME = "rr:sweep";
const ALARM_PERIOD_MINUTES = 60; // 每小時醒來看一次有沒有到期的，不是「每小時都刪除重刊一次」
const FAIL_STREAK_NOTIFY = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
  scheduleDelistAlarm().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  scheduleDelistAlarm().catch(() => {});
});

/* 點工具列圖示直接開設定頁，跟 591-extension 點圖示開 app.html 是同一個做法——
   本人反映「選項」連結太難找，chrome://extensions 的詳細資料頁裡才有。 */
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runExclusive(() => runSweep()).catch((e) => console.error("排程執行失敗：", e));
  if (alarm.name === DELIST_ALARM) {
    // 先排好明天的，再跑這一輪；跑失敗也不影響明天照常觸發
    chrome.storage.local.set({ "rr:delistLastRun": Date.now() }).then(() => scheduleDelistAlarm()).catch(() => {});
    runExclusive(() => runDelistSweep()).catch((e) => console.error("下架檢查失敗：", e));
  }
});

/**
 * 重刊（runSweep）跟下架檢查（runDelistSweep）都會開樂屋後台分頁操作同一個管理頁，
 * 同時跑會互相搶畫面、點到對方的列。用一個簡單的佇列讓它們一次只跑一個。
 */
let exclusiveChain = Promise.resolve();
function runExclusive(fn) {
  const run = exclusiveChain.then(fn, fn);
  exclusiveChain = run.catch(() => {});
  return run;
}

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
/**
 * 🔴 2026-09-28 本人截圖抓到根本原因：關閉步驟一直「列表裡找不到」不是
 * 物件真的不在架上，是比對文字用型錄推算的舊格式（例如「租-有藝仕|全新
 * 2房車位|傢俱電全配|可寵」），但樂屋管理頁畫面上真正顯示的標題是本人
 * 送出當下實際存的格式（例如「【房仲蕭邦】 有藝仕✨全新2房車位✨傢俱
 * 電全配」）——兩種格式對不上，搜尋當然找不到，程式誤判成「已經關閉」
 * 但舊物件其實還活著，導致新物件建立時撞上「物件名稱已被使用」。跟
 * buildRecreatePayload() 的標題同一個道理，優先用擷取到的真實內容。
 */
const titleOf = (snap) => (snap.capturedFormFields?.hname?.value || snap.listing?.rawTitle || snap.listing?.title || label(snap)).replace(/\s*[\d,.]+\s*(萬|元)\s*$/, "").trim();

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

/* ───────── 價格變動通知（邏輯在 lib/price-watch.js）───────── */

const fmtRent = (n) => Number(n).toLocaleString("en-US");

function renderPriceChanged(entry, snap) {
  const delta = entry.newRent - entry.oldRent;
  const links = priceLinks(snap);
  const linkLines = [
    links.rakuyaEdit && `✏️ 樂屋修改：${links.rakuyaEdit}`,
    links.catalog && `🔗 愛屋型錄：${links.catalog}`,
    links.pacific && `🔗 太平洋官網：${links.pacific}`,
  ].filter(Boolean);
  return [
    "💰 租金有變動，樂屋要改價",
    "",
    `${entry.no ? entry.no + " " : ""}${entry.title}`,
    `租金：${fmtRent(entry.oldRent)} → ${fmtRent(entry.newRent)}（${delta > 0 ? "+" : "-"}${fmtRent(Math.abs(delta))}）`,
    `來源：${entry.sources.join("、")}`,
    ...(linkLines.length ? ["", ...linkLines] : []),
    `⏱ ${nowTaipei()}`,
  ].join("\n");
}

/**
 * 檢查物件時順便看租金：有變動就寫進「價格變動通知」清單，新增或又變價才推 LINE。
 * snap 要是 list 裡的同一個物件，rentSeen 才會跟著呼叫端的 saveSnapshots(list) 一起存。
 * notify=false（立即檢查只回報）只記清單、不推 LINE。
 */
async function observeRent(snap, { source, nowRent, baselineRent, notify = true }) {
  const { status, entry } = await recordRentObservation(snap, { source, nowRent, baselineRent, title: titleOf(snap) });
  if (status === "none") return null;
  await pushDebug("price", `${snap.no || snap.id}（${source}）租金 ${fmtRent(entry.oldRent)} → ${fmtRent(entry.newRent)}：${status}`);
  if (notify && (status === "added" || status === "updated")) await pushLine(renderPriceChanged(entry, snap));
  return { status, oldRent: entry.oldRent, newRent: entry.newRent };
}

/* ───────── 開分頁 → 注入內容腳本 → 呼叫它 → 拿結果 → 關分頁 ───────── */

async function runInTab(tabId, file, func, args) {
  await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return result;
}

/**
 * 🔴 2026-09-28 本人截圖抓到：按下儲存時樂屋會跳出瀏覽器原生
 * confirm() 對話框「您已刊登過相同物件...您是否仍要上架此物件？」——
 * 這支工具的本質就是「關閉舊的、重貼幾乎一樣的新的」，全自動重刊很
 * 容易被判定成重複、跳出這個對話框。原生 confirm()／alert() 會整個
 * 卡住網頁的 JS 執行緒直到有人按按鈕，排程全自動跑的時候沒有人在看
 * 畫面按，會整個卡死。`chrome.scripting.executeScript` 預設注入到
 * 隔離世界（isolated world），跟網頁本身的 JS 是兩個獨立的 window，
 * 在隔離世界蓋掉 `window.confirm` 對網頁本身的 confirm() 呼叫沒有
 * 作用——要用 `world: "MAIN"` 才能真的蓋到網頁自己的全域函式。這類
 * 警告本來就是這個情境下的預期行為（跟隔間材質那類必填內容審查不
 * 一樣），自動按「確定」符合本人一路要求的「全自動送出，不留人工
 * 關卡」。alert() 順便一起蓋掉當保險。
 *
 * 🔴🔴 2026-09-28 本人重刊時「關閉舊物件」那一步也撞上「點擊後腳本
 * 執行環境中斷，重新檢查後物件仍在上架中物件列表」——跟建立新物件
 * 當初撞到的原生對話框是同一類症狀，這裡原本只在 createNewListing()
 * 加了這層保護，closeOldListing() 沒有。抽成共用函式兩邊都呼叫，不用
 * 各自維護一份一樣的注入邏輯。
 *
 * MAIN world 沒有 chrome.* API 能直接回報有沒有真的攔到呼叫，跟隔離
 * 世界的內容腳本共用同一顆 document，用自訂事件把證據傳過去，不用只
 * 憑「有沒有卡住」倒推攔截機制到底生效了沒有。
 */
async function suppressNativeDialogs(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        window.confirm = (msg) => {
          document.dispatchEvent(new CustomEvent("rr:native-confirm", { detail: { message: String(msg || "") } }));
          return true;
        };
        window.alert = (msg) => {
          document.dispatchEvent(new CustomEvent("rr:native-alert", { detail: { message: String(msg || "") } }));
        };
      },
    });
  } catch {
    // 蓋不到就算了，不要讓這個保險機制本身擋住整個流程
  }
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
  /**
   * 🔴🔴 2026-09-29 暫時改回 active:true（本人親眼看畫面診斷用）：
   * 建立新物件那邊當初文字/顏色診斷卡關兩輪，換本人直接看畫面才真正
   * 找到「儲存」字樣不是一般文字節點這個關鍵——關閉步驟現在也卡在
   * 「中斷後重新檢查仍在架上」好幾輪，加了重試機制也沒解決，同一招
   * 這次搬過來用。**這是暫時的診斷用改法，問題定位後記得改回
   * active:false**。
   */
  const tab = await chrome.tabs.create({ url: manageUrl, active: true });
  await waitForTabLoad(tab.id);
  await suppressNativeDialogs(tab.id);
  let result;
  try {
    result = await runInTab(tab.id, "content/closeListing.js", (matchText) => window.__rrCloseListing__({ matchText }), [matchText]);
    // 跟 deleteClosedListing() 同一個理由：Chrome 在分頁還不穩定時可能不丟例外、直接給空結果，這裡也補上同一道防線。
    if (!result || typeof result.ok !== "boolean") throw new Error("腳本執行環境異常（沒有拋出例外，但也沒有正常回傳值）");
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
    let check = await runInTab(tab.id, "content/closeListing.js", (matchText) => window.__rrStillListed__(matchText), [matchText]).catch(() => null);
    /**
     * 🔴 2026-09-29 本人反映這步依然常常「中斷、重新檢查仍在架上」，
     * 但本系列先前也遇過「第一次判定失敗、後來重試才確認真的成功」
     * ——懷疑 `doItemDownClose()` 是先觸發關閉的 AJAX、成功後才導頁
     * 重新整理，但伺服器端把這筆關閉真正「寫定」跟這次重新整理讀到的
     * 列表資料之間可能有一段極短的不一致空窗，第一次檢查抓到的剛好是
     * 空窗期還沒更新完的舊狀態。跟 createListing.js 那邊「原本等固定
     * 時間不夠、改成多等一下再看」是同一個道理——第一次看起來還在架上
     * 不要就此死心，重新整理同一個分頁再看幾次，只要有一次看到真的不
     * 在架上就算數；每次都還在架上才是真的失敗。
     *
     * 🔴🔴 2026-09-29 本人重試後這個重試機制沒有解決那次的案例，但最終
     * 錯誤訊息的措辭本身看不出「重試了但每次都還在架上」跟「根本沒有
     * 觸發重試」這兩種完全不同的情況——加一份重試歷程記錄，不用再猜
     * 這次重試機制本身有沒有真的跑過。
     */
    /**
     * 🎯 2026-10-01 本人截圖對照「關閉中物件」真實列表，抓到這個重試
     * 機制本身的真正病灶：那一列的「關閉日」寫 11:41:19，但這次判定
     * 失敗的最終檢查是 11:41:30——伺服器端其實在檢查之前就已經真的
     * 關閉成功了，重試 3 次（含 2 次重新整理）卻每次都誤判「還在上架中
     * 物件列表」。`chrome.tabs.reload()` 沒有加 `{bypassCache:true}`，
     * 很可能每次「重新整理」其實是從瀏覽器快取讀回關閉前的舊頁面，
     * 不是真的重新跟樂屋伺服器要最新資料——這樣不管重試幾次都只是
     * 反覆看同一份舊快照，跟本系列先前「過短的不一致空窗」假說不同，
     * 這次證據指向重試機制本身就沒有真的看到新資料。加上 bypassCache
     * 強制略過快取。
     */
    const retryLog = [check?.stillListed];
    for (let attempt = 0; attempt < 2 && check?.stillListed === true; attempt++) {
      await sleep(2000);
      await chrome.tabs.reload(tab.id, { bypassCache: true }).catch(() => {});
      await waitForTabLoad(tab.id, 8000);
      check = await runInTab(tab.id, "content/closeListing.js", (matchText) => window.__rrStillListed__(matchText), [matchText]).catch(() => check);
      retryLog.push(check?.stillListed);
    }
    await chrome.tabs.remove(tab.id).catch(() => {});
    const exceptionText = String(e && e.message ? e.message : e);
    const debugSuffix = check?.preSubmitDebug ? `，點擊前資訊：${JSON.stringify(check.preSubmitDebug)}` : "";
    /**
     * 🔴 2026-09-28 本人截圖抓到這個「中斷」很可能是原生 confirm()／
     * alert() 對話框卡住（跟 createListing.js 那邊撞到的同一類）——
     * suppressNativeDialogs() 現在兩邊都會蓋，這裡把有沒有真的攔到
     * confirm() 呼叫的證據也印出來，下次重試就能直接看到是不是同一個
     * 病灶，不用再猜。
     */
    const confirmSuffix = check?.nativeConfirmSeen ? `，原生confirm內容=${check.nativeConfirmSeen}` : "，nativeConfirmSeen=null";
    const retrySuffix = `，重試歷程=${JSON.stringify(retryLog)}`;
    if (check?.stillListed === false) return { ok: true, note: `點擊後腳本執行環境中斷（${exceptionText}），重新檢查確認已經不在上架中物件列表，判定成功${debugSuffix}${confirmSuffix}${retrySuffix}` };
    if (check?.stillListed === true) return { ok: false, error: `點擊後腳本執行環境中斷，重新檢查後物件仍在上架中物件列表，判定失敗${debugSuffix}${confirmSuffix}${retrySuffix}` };
    return { ok: false, error: `點擊後腳本執行環境中斷（${exceptionText}），重新檢查也失敗，無法判斷是否成功，需要人工到樂屋後台確認${debugSuffix}${confirmSuffix}${retrySuffix}`, needsManualCheck: true };
  }
  await chrome.tabs.remove(tab.id).catch(() => {});
  return result;
}

/**
 * 🔴🔴🔴 2026-09-30 本人截圖＋文字說明揭露的關鍵缺口：「成交/關閉」只是
 * 把物件從「上架中物件」移到「關閉中物件」，本人原話「樂屋網的機制是
 * 在關閉中不能有這個物件，不然你再重新上架的話，它的瀏覽頁面並不會
 * 跑到最前面去」——真正要清乾淨必須在「關閉中物件」分頁再找到這筆、
 * 按「刪除」、確認彈窗再按「確定」。這解釋了本系列反覆撞見的「物件
 * 名稱已被使用」：關閉不等於刪除，舊物件一直留在「關閉中物件」沒有
 * 真正清掉。
 *
 * 獨立開一個新分頁做這件事（不是塞進 closeOldListing() 內部），刻意
 * 不動那支已經很難搞定、驗證過能正確判斷成功/失敗的既有邏輯。
 * 2026-10-01 真帳號測出「點擊後中斷」，已比照 closeOldListing() 補上
 * 同一套「中斷後重新整理＋用真實畫面狀態重新檢查」機制，見下方 catch。
 *
 * 🎯🎯🎯🎯 2026-10-01 新增 `markDeleteStep` 逐步記錄中斷前走到哪之後，
 * 本人實測抓到「中斷前最後走到＝已點分頁籤，等畫面切換」——中斷點
 * 比想像中早很多，就在點「關閉中物件」分頁籤那一刻附近。追問本人
 * 點這個分頁籤前後網址列有沒有變，本人截圖證實：`hlist_up?objind=R`
 * （上架中物件）點了分頁籤後真的變成 `hlist_down?objind=R`（關閉中
 * 物件）——這從頭到尾就不是單純的前端分頁切換，是真正的整頁導航！
 * 之前每一輪「中斷點好像不固定」的詭異現象，答案就是：點擊觸發的是
 * 真實導航，程式在「網頁隨時可能被整頁換掉」的狀態下繼續往下跑，
 * 能跑到哪完全看運氣（有時候繼續跑了好幾步才被真正換頁的瞬間砍斷，
 * 有時候立刻就斷）。根本解法不是再猜怎麼撐過這個不可靠的瞬間，是
 * 乾脆不要用「點擊」去切換分頁——直接讓分頁導航到「關閉中物件」這個
 * 網址，用 `waitForTabLoad()` 老實等導航完成，完全避開「腳本在可能
 * 隨時被整頁換掉的半空中繼續執行」這個不穩定狀態。
 */
async function recheckDeleteOutcome(tab, matchText, exceptionText) {
  /**
   * 🔧 2026-10-01 本人真帳號實測：marker 修好之後真的找到「刪除」
   * 連結、也真的點了確認彈窗的「確定」，緊接著就是
   * 「Frame with ID 0 was removed.」——跟 closeOldListing() 當初撞過
   * 的同一種「按下確認動作觸發頁面重整，把執行中的腳本一起砍斷」。
   * 中斷後等頁面穩定、重新整理、用 `__rrStillInClosedList__` 看這筆
   * 還在不在「關閉中物件」列表，不在才判定成功，不猜例外訊息本身
   * 代表什麼。
   */
  await waitForTabLoad(tab.id, 8000);
  await sleep(1000);
  let check = await runInTab(tab.id, "content/closeListing.js", (matchText) => window.__rrStillInClosedList__({ matchText }), [matchText]).catch(
    (e2) => ({ stillThere: null, recheckError: String(e2 && e2.message ? e2.message : e2) })
  );
  const retryLog = [check?.stillThere];
  for (let attempt = 0; attempt < 2 && check?.stillThere !== false; attempt++) {
    await sleep(2000);
    await chrome.tabs.reload(tab.id, { bypassCache: true }).catch(() => {});
    await waitForTabLoad(tab.id, 8000);
    check = await runInTab(tab.id, "content/closeListing.js", (matchText) => window.__rrStillInClosedList__({ matchText }), [matchText]).catch(
      (e2) => ({ stillThere: null, recheckError: String(e2 && e2.message ? e2.message : e2) })
    );
    retryLog.push(check?.stillThere);
  }
  const recheckErrSuffix = check?.recheckError
    ? `，重新檢查本身的錯誤=${check.recheckError}`
    : check?.error
    ? `，重新檢查本身的錯誤=${check.error}`
    : check === undefined
    ? "，重新檢查沒有拋出例外但也沒有任何回傳值（可能分頁還不穩定）"
    : "";
  const lastStepSuffix = check?.lastStep ? `，中斷前最後走到＝${check.lastStep}` : "，中斷前最後走到＝(沒有記錄到)";
  const retrySuffix = `，重試歷程=${JSON.stringify(retryLog)}${recheckErrSuffix}${lastStepSuffix}`;
  if (check?.stillThere === false) {
    return { ok: true, note: `執行環境中斷（${exceptionText}），重新檢查確認已經不在關閉中物件列表，判定成功${retrySuffix}` };
  } else if (check?.stillThere === true) {
    return { ok: false, error: `執行環境中斷，重新檢查後這筆仍在關閉中物件列表，判定失敗${retrySuffix}` };
  }
  return {
    ok: false,
    error: `刪除關閉中物件時執行環境中斷（${exceptionText}），重新檢查也失敗，無法判斷是否成功，需要人工到樂屋後台確認${retrySuffix}`,
    needsManualCheck: true,
  };
}

async function deleteClosedListing(manageUrl, matchText) {
  const closedUrl = manageUrl.replace("hlist_up", "hlist_down");
  const tab = await chrome.tabs.create({ url: closedUrl, active: true });
  await waitForTabLoad(tab.id);
  await suppressNativeDialogs(tab.id);
  let result;
  try {
    result = await runInTab(tab.id, "content/closeListing.js", (matchText) => window.__rrDeleteClosedListing__({ matchText }), [matchText]);
    /**
     * 🔴 2026-10-01 本人真帳號實測抓到一種新的空白結果：沒有拋出例外
     * （不會進下面的 catch），`result` 卻直接是 `undefined`／`null`。
     * 跟 `__rrStillInClosedList__` 當初那個「Chrome 在分頁還不穩定時
     * 不丟例外、直接給空結果」是同一種行為，這次發生在第一次呼叫本身
     * 而不是重新檢查——代表這個分支完全沒被下面的 catch 接住，重試/
     * 診斷邏輯整組被跳過，直接把這個空值原封不動回傳出去。改成只要
     * `result` 不是一個正常帶 `ok` 欄位的物件，就當成跟拋例外同一類
     * 情況，一樣走重新檢查那一套，不要就這樣把空值吐回去。
     */
    if (!result || typeof result.ok !== "boolean") {
      result = await recheckDeleteOutcome(tab, matchText, "腳本執行環境異常（沒有拋出例外，但也沒有正常回傳值）");
    }
  } catch (e) {
    result = await recheckDeleteOutcome(tab, matchText, String(e && e.message ? e.message : e));
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
  /**
   * 🔴 2026-09-28 換第二筆物件測試（AD5401490）冒出第一筆從沒踩過的
   * 新紅字：「物件名稱」。標題原本純靠型錄資料 cleanTitle(listing.
   * rawTitle) 組——跟描述／封面照不一樣，完全沒有「以編輯頁現在的真實
   * 內容為準」這一層。同一個道理：本人送出之後常常會手動調整過標題，
   * 型錄資料只是最初貼文當下的版本，編輯頁現在存的才是真正在用、本人
   * 已經確認過的內容——改成優先用 capturedFormFields.hname 的值（照抄
   * 不重新清洗），抓不到才退回型錄推算當備援。
   */
  const capturedHname = snap.capturedFormFields && snap.capturedFormFields.hname;
  const title = capturedHname && capturedHname.value ? capturedHname.value : cleanTitle(listing.rawTitle);
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
  // 2026-09-29 findSubmitByColor() 顏色備援修法已經確認真的送出成功
  // （captureSuccess.js 連續兩次在成功頁被觸發，全新 ehid），改回背景
  // 執行——排程全自動時不該讓分頁跳出來搶走本人的視窗焦點。
  const tab = await chrome.tabs.create({ url: postUrl, active: false });
  /**
   * 🔴 2026-10-01 本人實測撞上 waitForSuccessUrl() 逾時回報失敗，但同一輪
   * captureSuccess.js 獨立偵測到真的成功、也真的登記了一筆新快照——代表
   * waitForSuccessUrl() 盯的 tab.id 跟真正跳轉到成功頁的分頁可能根本不是
   * 同一個（例如送出後樂屋開了新分頁，不是原地跳轉）。不猜，先留下證據：
   * 記下這裡建立的 tab.id，`rr:register-listing` 那邊也記下 sender.tab.id，
   * 下次比對這兩個數字是否相同，就能確定是不是同一分頁。
   */
  await pushDebug("createNewListing", `開分頁 tab.id=${tab.id}，等載入`);
  await waitForTabLoad(tab.id);
  await suppressNativeDialogs(tab.id);
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
  // 確定是同一戶（same）才看租金；型錄已經變成別戶的話，租金差多少都沒意義
  if (check.verdict === "same") {
    await observeRent(findById(list, snap.id), { source: "catalog", nowRent: check.freshRent, baselineRent: snap.listing?.rent });
  }
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
      ? `編輯頁掃描成功：表單欄位=${scraped.formFieldCount} 個，描述長度=${scraped.descText.length}，照片=${scraped.photoImgCount} 張（選第一張當封面，網址=${scraped.coverPhotoSrc || "(沒選到)"}，封面貼圖=${scraped.coverStickerDebug}），街道欄位=${scraped.addrRoadDebug}，是否社區欄位=${scraped.isCommunityDebug}，物件名稱欄位=${scraped.hnameDebug}`
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

  /**
   * 🔴 2026-09-28 這裡原本在最上面（掃描之前）就算好 matchText，用的是
   * 這一輪掃描之前的舊資料——搬到掃描完成、`item.capturedFormFields`
   * 更新之後才算，直接優先用這次剛掃到的 `scraped.formFields.hname`
   * （比 `titleOf(snap)` 读 `snap` 本身更新鮮，不用依賴 `item`／`snap`
   * 是不是同一個物件參照），掃描失敗或沒抓到才退回 `titleOf(snap)`
   * 這條舊邏輯（那條現在也會先看 `snap.capturedFormFields`，是更早之前
   * 某一輪存下來的，比純型錄推算新，但還是不如這次剛掃到的新鮮）。
   */
  const freshHname = scraped?.ok && scraped.formFields?.hname?.value;
  const matchText = freshHname ? freshHname.replace(/\s*[\d,.]+\s*(萬|元)\s*$/, "").trim() : titleOf(snap);

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

  /**
   * 🔴🔴🔴 2026-09-30 本人揭露的關鍵缺口：關閉不等於刪除，舊物件會停留
   * 在「關閉中物件」，這正是本系列反覆撞見「物件名稱已被使用」的真正
   * 原因（不是找錯按鈕，是根本沒做到這一步）。不管上面是正常關閉成功
   * 還是走 `alreadyNotListed` 那條路徑，都要在這裡補上刪除，確保舊物件
   * 真的清乾淨再建立新的——如果沒刪乾淨就急著建立新物件，新物件即使
   * 送出成功，也達不到本人要的「重新排到最前面」這個重刊的本意。
   * 「找不到」視為已經刪過／本來就不在，比照 `alreadyNotListed` 不當
   * 成硬失敗；找到了但刪不掉才真正停下來，不能悄悄放過。
   */
  const deleteResult = await deleteClosedListing(settings.manageUrl, matchText).catch((e) => ({ ok: false, error: String(e && e.message ? e.message : e) }));
  await pushDebug("recycleOne", `刪除關閉中物件結果：${JSON.stringify(deleteResult)}`);
  if (!deleteResult?.ok && !deleteResult?.notFound) {
    const item = findById(list, snap.id);
    item.status = "error";
    item.updatedAt = new Date().toISOString();
    await saveSnapshots(list);
    return { outcome: "error", error: `舊物件已關閉但刪除失敗，沒有繼續建立新物件：${deleteResult?.error}`, closedButNotRecreated: true };
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

/* ───────── 太平洋官網下架檢查（2026-10-02 本人要求）─────────
 * 對每筆 active 的追蹤物件，抓描述最後一行的太平洋官網連結，官網頁面沒了／坪數對不起來
 * （連抓兩次確認，見 lib/pacific-check.js）→ 在樂屋把這筆「成交/關閉」並標成 rented_out，
 * 重刊從此不再碰它。只做出租。刻意只關閉、不刪除：關閉中物件本人之後還能自己決定怎麼處理。 */

const DELIST_ALARM = "rr:delist";

async function scheduleDelistAlarm() {
  const { delistEnabled, delistTime, delistEveryDays } = await loadSettings();
  await chrome.alarms.clear(DELIST_ALARM);
  if (!delistEnabled) return;
  const [h, m] = String(delistTime || "09:00").split(":").map(Number);
  // 台灣沒有日光節約，直接用 UTC+8 算「下一個 HH:MM」
  const nowMs = Date.now();
  const tp = new Date(nowMs + 8 * 3600000);
  let next = Date.UTC(tp.getUTCFullYear(), tp.getUTCMonth(), tp.getUTCDate(), h || 0, m || 0) - 8 * 3600000;
  if (next <= nowMs + 30000) next += 86400000;
  // 每隔 N 天：以上次排程執行的日期為準往後推 N 天（沒有紀錄＝下一個 HH:MM 就跑）
  const days = Math.min(30, Math.max(1, Number(delistEveryDays) || 1));
  const { "rr:delistLastRun": last } = await chrome.storage.local.get("rr:delistLastRun");
  if (days > 1 && last) {
    const lp = new Date(last + 8 * 3600000);
    const due = Date.UTC(lp.getUTCFullYear(), lp.getUTCMonth(), lp.getUTCDate() + days, h || 0, m || 0) - 8 * 3600000;
    if (due > nowMs + 30000) next = due;
    else if (due <= nowMs + 30000 && due > last) next = Math.max(due, nowMs + 60000); // 錯過了，開啟後補跑
  }
  chrome.alarms.create(DELIST_ALARM, { when: next });
}

async function delistOnRakuya(list, snap, settings, reasons) {
  const matchText = titleOf(snap);
  let closeResult;
  try {
    closeResult = await closeOldListing(settings.manageUrl, matchText);
  } catch (e) {
    closeResult = { ok: false, error: String(e && e.message ? e.message : e) };
  }
  await pushDebug("delist", `${snap.no || snap.id} 關閉結果：${JSON.stringify(closeResult)}`);
  // 跟重刊同一個邏輯：列表裡找不到＝本來就已不在上架中（本人手動關過），也算下架完成
  const alreadyNotListed = !closeResult?.ok && /列表裡找不到/.test(closeResult?.error || "");
  const item = findById(list, snap.id);
  if (closeResult?.ok || alreadyNotListed) {
    item.status = "rented_out";
    item.lastCheckResult = "delisted_pacific";
    item.updatedAt = new Date().toISOString();
    await saveSnapshots(list);
    await pushLine(`⚫️ 官網已下架，樂屋同步關閉

${label(snap)}
原因：${reasons.join("、")}
${snap.pacificUrl || ""}
⏱ ${nowTaipei()}`);
    return { delisted: true };
  }
  await pushLine(`🔴 官網已下架，但樂屋關閉失敗，請手動處理！

${label(snap)}
原因：${reasons.join("、")}
錯誤：${String(closeResult?.error).slice(0, 200)}
⏱ ${nowTaipei()}`);
  return { delisted: false, error: closeResult?.error };
}

/** dryRun=true：只檢查回報，不動樂屋（「立即檢查」預設，第一次用先看判斷對不對） */
export async function runDelistSweep({ dryRun = false } = {}) {
  const settings = await loadSettings();
  const list = await loadSnapshots();
  const targets = list.filter((s) => s.status === "active");
  const results = [];
  for (const snap of targets) {
    const r = await checkPacific(snap);
    const item = findById(list, snap.id);
    item.lastPacificCheckAt = new Date().toISOString();
    item.lastPacificResult = r.verdict;
    if (r.url) item.pacificUrl = r.url;
    if (r.baseline) item.pacificBaseline = r.baseline;
    await pushDebug("delist", `${snap.no || snap.id}：${r.verdict}${r.error ? " " + r.error : ""}${r.reasons ? " " + r.reasons.join("、") : ""}${r.notes?.length ? " " + r.notes.join("、") : ""}`);
    const entry = { id: snap.id, no: snap.no, verdict: r.verdict, reasons: r.reasons, notes: r.notes, error: r.error };
    // 官網還在（same）才看租金；只回報模式也記進價格變動清單，只是不推 LINE
    if (r.verdict === "same") {
      entry.priceChange = await observeRent(item, { source: "pacific", nowRent: r.page?.rent ?? r.baseline?.rent, baselineRent: item.pacificBaseline?.rent, notify: !dryRun });
    }
    if (r.verdict === "delist") {
      item.lastPacificResult = dryRun ? "delist_dryrun" : "delist";
      await saveSnapshots(list);
      if (!dryRun && settings.delistAutoClose && settings.manageUrl) {
        Object.assign(entry, await delistOnRakuya(list, snap, settings, r.reasons || []));
      } else if (!dryRun) {
        await pushLine(`⚠️ 官網疑似已下架（尚未動樂屋）

${label(snap)}
原因：${(r.reasons || []).join("、")}
${snap.pacificUrl || ""}
⏱ ${nowTaipei()}`);
      }
    }
    await saveSnapshots(list);
    results.push(entry);
  }
  return { processed: results.length, results };
}

/* ───────── 一筆新物件被本人貼出去（不管手動還是樂屋助手）→ 開始追蹤 ───────── */

async function registerListing(catalogUrl, { rakuyaId = null, rakuyaUrl = null, descHtml = "", descText = "", coverPhotoDataUrl = "", formFields = null, fromTabId = null } = {}) {
  await pushDebug(
    "background",
    `registerListing 收到 catalogUrl=${catalogUrl} rakuyaId=${rakuyaId} 描述長度=${descText.length} 封面照片=${coverPhotoDataUrl ? "有" : "沒有"} 表單欄位=${formFields ? Object.keys(formFields).length : 0} 個 來源tab.id=${fromTabId}`,
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
    registerListing(msg.catalogUrl, { rakuyaId: msg.rakuyaId, rakuyaUrl: msg.rakuyaUrl, descHtml: msg.descHtml, descText: msg.descText, coverPhotoDataUrl: msg.coverPhotoDataUrl, formFields: msg.formFields, fromTabId: sender.tab?.id ?? null }).then((r) => sendResponse(r)).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "rr:delist-check") {
    runExclusive(() => runDelistSweep({ dryRun: !!msg.dryRun }))
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true;
  }

  if (msg.type === "rr:delist-reschedule") {
    scheduleDelistAlarm().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "rr:run-now") {
    runExclusive(() => runSweep({ force: true })).then((r) => sendResponse({ ok: true, ...r })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "rr:run-one") {
    runExclusive(() => runSweep({ force: true, onlyId: String(msg.id || "") }))
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
