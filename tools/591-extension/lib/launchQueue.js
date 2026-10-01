/**
 * 「591＋樂屋一起上架」的資料包排隊邏輯 —— 純函式，background.js 只負責接 chrome.storage/chrome.tabs
 * （service worker 是 classic script 不是 ES module，跟 lib/map591.js 的 launchUrl() 一樣，
 * background.js 裡會照這裡的邏輯另外寫一份能跑在那邊的版本；這支是給 node 測試與說明用的正本）。
 *
 * 兩個平台的資料包要分開放（各自的分頁各拿各的），不然「一起上架」兩個分頁同時開著時會互搶同一格。
 * 「一起上架」＝ 591 的資料包裡帶一份樂屋的（chain）：先把樂屋那份存起來標 queued（只存不開分頁），
 * 只開 591 的分頁；等 591 那邊回報填完（clear）才把 queued 拿掉、真正開它的分頁——兩個分頁輪流在
 * 前景填，不會有一個一直待在背景被 Chrome 放慢計時器（README「填到一半停住」那條）。
 */

export const payloadSlotKey = (target) => `listing:payload:${target === "rakuya" ? "rakuya" : "591"}`;

/**
 * 一次 listing:launch 訊息 → 要寫進 chrome.storage.session 的內容。
 * payload.chain 存在時代表「一起上架」：chain 是樂屋的資料包，先排隊、不開分頁。
 */
export function planLaunchStore(payload) {
  const main = { ...payload };
  const chain = main.chain && typeof main.chain === "object" ? main.chain : null;
  delete main.chain;
  const store = { [payloadSlotKey(main.target)]: main };
  if (chain) store[payloadSlotKey("rakuya")] = { ...chain, target: "rakuya", queued: true };
  return { store, openTarget: main.target, chained: !!chain };
}

/**
 * 某平台回報「填完，清掉我的資料包」之後，要不要接著開排隊中的另一個平台。
 * 一起上架永遠是 591 先填，所以只有清掉 591 那格才可能觸發；rakuyaSlotValue 是清掉 591 那格前，
 * 樂屋那一格目前存的值（可能沒有）。回傳 null＝不用開；否則回傳「拿掉 queued 之後」該存＋該開分頁的值。
 */
export function planChainOpen(clearedTarget, rakuyaSlotValue) {
  if (clearedTarget !== "591") return null;
  if (!rakuyaSlotValue || !rakuyaSlotValue.queued) return null;
  const { queued, ...rest } = rakuyaSlotValue;
  return rest;
}
