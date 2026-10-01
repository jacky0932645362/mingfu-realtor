/**
 * 背景程式（MV3 service worker）。做六件事：
 *   ① 點工具列圖示 → 開外掛自己的操作頁 app.html
 *   ② 保管「資料包」（chrome.storage.session，關掉瀏覽器就沒了）並開 591／樂屋刊登分頁——
 *      591／樂屋各自一格（見 payloadSlotKey），「一起上架」時樂屋那份先存起來標 queued、
 *      等 591 回報填完才真的開它的分頁（見 planChainOpen，兩個分頁輪流在前景填，見 README）
 *   ③ 刊登頁面的 fill591.js／fillRakuya.js 來要資料就給它；填完就清掉（重新整理不會再填一次）
 *   ④ 幫頁面端跨網域抓東西：照片檔（愛屋圖檔主機／Cloudinary）→ base64；型錄頁 HTML（只抓 houseol.com.tw）
 *   ⑤ 2026-09-12 起：上架前檢查授權碼（要發給同事測試用）——規則、快取、離線處理都在 license.js
 *   ⑥ 2026-09-19 起：按「上架」開好分頁後，順手登記一筆到官網的追蹤清單（/admin/post591-tracker）——
 *      失敗就算了（離線、官網剛好在部署都不擋上架這個主功能），本人事後自己在後台補也可以
 *
 * 🔴 不抓 591／樂屋任何資料、不送物件資料到別的伺服器；授權驗證只送授權碼、安裝編號、外掛版本；
 *    登記追蹤只送來源網址／標題／地址（外掛本來就有的資料，不是新收集的）。
 *
 * 認得的物件組合直接開第②頁（網址帶 kind/shape/purpose），不認得的開第①頁由 fill591.js 幫忙點。
 */
/**
 * 資料包一個平台一格：service worker 是 classic script 不是 ES module，這裡跟 launchUrl() 一樣
 * 手動照 lib/launchQueue.js 的邏輯另外寫一份（正本＋單元測試在那支，node 測得起來）。
 */
const payloadSlotKey = (target) => `listing:payload:${target === "rakuya" ? "rakuya" : "591"}`;
/** 這則訊息是哪個平台的分頁傳來的：看 sender 的網址（fill591.js 只會在 591 跑、fillRakuya.js 只會在樂屋跑） */
const targetOfSender = (sender) => (sender && sender.url && /rakuya\.com\.tw/.test(sender.url) ? "rakuya" : "591");

importScripts("license.js", "lib/floorplan.js", "lib/pacific.js");
const license = self.P591License.create({
  storage: { get: (k) => chrome.storage.local.get(k), set: (o) => chrome.storage.local.set(o) },
  fetch: (u, o) => fetch(u, o),
  version: chrome.runtime.getManifest().version,
});

const SHAPE = { 電梯大樓: 2, 透天厝: 3, 華廈: 5 };
const PURPOSE = { 住家用: 3, 住商用: 4 };

function launchUrl(p) {
  if (p && p.target === "rakuya") return p.deal === "rent" ? "https://member.rakuya.com.tw/rent/post/add" : "https://member.rakuya.com.tw/sell/post/add"; // 樂屋一頁式，沒有第①頁
  const f = (p && p.first) || {};
  if (p.deal === "rent") {
    const shape = SHAPE[f.type];
    if (f.status === "整層住家" && shape) return `https://user.591.com.tw/post/two/rent?is_use_first=1&kind=1&shape=${shape}&purpose=&purpose_custom=`;
    return "https://user.591.com.tw/post/first";
  }
  const shape = SHAPE[f.type];
  const purpose = PURPOSE[f.legal];
  if (f.status === "住宅" && shape && purpose) return `https://user.591.com.tw/post/two/sale?is_use_first=1&kind=9&shape=${shape}&purpose=${purpose}&purpose_custom=`;
  return "https://user.591.com.tw/post/first";
}

/**
 * Chrome 偶爾會丟一個內部的暫時性錯誤：「Tabs cannot be edited right now (user may be dragging a tab)」，
 * 是 Chrome 自己已知的怪癖（不是真的在拖分頁，是分頁管理內部短暫鎖住），過一下重試通常就會成功。
 * 2026-09-11 這裡原本沒接住，導致擴充功能卡片上出現一條跟本人操作無關的「錯誤」紀錄。
 */
async function openTab(opts, retries = 2) {
  for (let i = 0; ; i++) {
    try {
      return await chrome.tabs.create(opts);
    } catch (e) {
      if (i >= retries || !/cannot be edited right now/i.test(String((e && e.message) || e))) throw e;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

chrome.action.onClicked.addListener(() => {
  openTab({ url: chrome.runtime.getURL("app.html") }).catch((e) => console.error("開外掛頁面失敗：", e));
});

function allowedFetchHost(hostname) {
  return hostname === "houseol.com.tw" || hostname.endsWith(".houseol.com.tw") || hostname === "res.cloudinary.com";
}

/**
 * listing:fetch-image 跟格局圖偵測都要「抓愛屋圖檔」，host 檢查／fetch 這段共用。
 * 🔴 2026-09-24 本人真實測試：格局圖偵測回報「The message port closed before a response was
 * received」——這是 MV3 service worker 常見的真實坑：一批 fetch 裡只要有一張卡住不動（網路延遲、
 * 對方主機沒回應），JS 的 fetch() 預設沒有 timeout，會一直等，可能等到 service worker 被 Chrome
 * 自己判定太久沒回應而砍掉，換來這句籠統的錯誤。加一個逾時，卡住的那張直接算失敗（會被
 * pickFloorPlan／bestCandidate 忽略），不會拖累其他張、也不會拖垮整個 service worker。
 */
async function fetchImageBytes(url, timeoutMs = 10000) {
  const u = new URL(String(url || ""));
  if (!allowedFetchHost(u.hostname)) throw new Error("不抓這個網域的圖：" + u.hostname);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(u.href, { credentials: "omit", signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res;
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error(`抓圖超過 ${Math.round(timeoutMs / 1000)} 秒沒回應，跳過`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 格局圖偵測用：把圖縮到固定小尺寸取樣（運算量跟原始張數、原始解析度都脫鉤），算白色比例／
 * 灰階比例——判斷邏輯（門檻、挑哪一張）在 lib/floorplan.js（純函式，node 測得到）；這支只管
 * 「怎麼把圖檔解碼成像素」，MV3 service worker 才有的 createImageBitmap／OffscreenCanvas 沒辦法
 * 在 node 裡測，所以留在這裡當薄薄一層 glue，不放進 lib/。
 *
 * 🔴 2026-09-24 真實測試逾時之後查出來的另一個問題：原本是先用 createImageBitmap(blob) 把整張
 * 「原始解析度」的大圖整個解碼出來（不動產照片常常是幾千 x 幾千、好幾 MB 的原圖），再手動畫到
 * 縮小的 canvas 上取樣——本人這台機器規格不算高（i5-8400／8GB RAM，見
 * [[reference_電腦硬體規格]]），十幾張真實照片同時整張全解析度解碼，光這步就可能是真正拖慢、
 * 拖到 timeout 的主因。改成 createImageBitmap 的 resizeWidth/resizeHeight/resizeQuality 選項，
 * 讓瀏覽器自己的解碼器在解碼當下就順便縮小（多數格式的解碼器本來就支援邊解邊縮，比「整張解出來
 * 再裁切」省時間也省記憶體很多）。不管原始長寬比是多少一律縮成固定的正方形：這裡只算整體白色／
 * 灰階像素比例，跟形狀、長寬比完全無關，壓扁一點不影響判斷準確度。
 */
async function imageStatsFor(url) {
  const res = await fetchImageBytes(url);
  const blob = await res.blob();
  const SAMPLE = 48;
  const bitmap = await createImageBitmap(blob, { resizeWidth: SAMPLE, resizeHeight: SAMPLE, resizeQuality: "low" });
  const canvas = new OffscreenCanvas(SAMPLE, SAMPLE);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE);
  return self.P591FloorPlan.statsFromImageData({ width: SAMPLE, height: SAMPLE, data });
}

/** 一次最多同時處理 limit 張，不要 15、20 張圖同時解碼——這台機器規格不算高，一次全開很可能是拖垮
 *  service worker、換來「message port closed」的另一個原因。跟 fill591.js 的 uploadPhotos() 分批
 *  上傳同一個道理，只是這裡不用等使用者看進度，用一個簡單的 worker pool 就好。 */
async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * 太平洋官網公開物件頁連結（2026-10-01）：匹配邏輯在 lib/pacific.js（純函式），這裡只管真的打
 * pacific.com.tw 的 API。Authorization 這組 Basic 碼不是本人帳號密碼、不是機密——是官網自己
 * 的頁面原始碼裡，每個訪客打開 /Object/ObjectRentList 都看得到、頁面自己的前端 JS
 * （/Object/module.js）也是這樣原樣讀出來當成所有訪客共用的 API 門檻，本人在瀏覽器 console
 * 對正式站打過確認可行，跟官網「輸入關鍵字搜尋」那個公開功能做的是同一件事、打的是同一支 API，
 * 不是繞過任何登入或權限。
 *
 * 抓不到、比對不到（listing.rawTitle 清不出關鍵字、API 逾時或改版、剛好 0 筆或 2 筆以上無法
 * 判斷是哪一戶）一律回傳 url:null，呼叫端（app.js 的 rakuyaVariant()）當作沒有這個連結可以加，
 * 不擋上架這個主功能、也不會塞錯連結。
 */
async function findPacificLink(rawTitle, listingNo, { rent = true, timeoutMs = 8000 } = {}) {
  const keyword = self.P591Pacific.pacificSearchKeyword(rawTitle);
  if (!keyword || !listingNo) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://www.pacific.com.tw/api/ObjectAPI/SearchObject2", {
      method: "POST",
      credentials: "omit",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: "Basic cHJtczpwcm1z" },
      body: JSON.stringify({ City: "臺中市", Keyword: keyword }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const saleID = self.P591Pacific.matchPacificListing(data, listingNo);
    return saleID ? self.P591Pacific.pacificDetailUrl(saleID, { rent }) : null;
  } catch {
    return null; // 逾時／網路問題／改版格式跑掉——安靜回 null，不要讓這個附加功能擋到上架主流程
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return false;
  const reply = (fn) => {
    fn()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true; // 非同步回覆
  };

  switch (msg.type) {
    case "listing:launch":
      return reply(async () => {
        const p = msg.payload;
        if (!p || p.v !== 1) throw new Error("資料包格式不對");
        // 沒有有效授權碼就不開分頁；event=launch → 這一次一定問伺服器、記一次上架次數（一起上架也只算一次）
        const lic = await license.check({ event: "launch" });
        if (!lic.ok) return { ok: false, error: self.P591License.message(lic), license: lic };
        const main = { ...p };
        const chain = main.chain && typeof main.chain === "object" ? main.chain : null;
        delete main.chain;
        const store = { [payloadSlotKey(main.target)]: main };
        // 一起上架：樂屋的資料包先排隊存起來（標 queued，不開分頁），等 591 填完（listing:clear）才輪到它
        if (chain) store[payloadSlotKey("rakuya")] = { ...chain, target: "rakuya", queued: true };
        await chrome.storage.session.set(store);
        const tab = await openTab({ url: launchUrl(main) });
        return { ok: true, tabId: tab.id, url: launchUrl(main), chained: !!chain };
      });

    case "listing:license-check":
      return reply(async () => {
        const lic = await license.check({ force: !!msg.force });
        return { ok: true, license: lic, message: self.P591License.message(lic) };
      });

    case "listing:license-set":
      return reply(async () => {
        const lic = await license.setKey(msg.key);
        return { ok: true, license: lic, message: self.P591License.message(lic) };
      });

    case "listing:get":
      return reply(async () => {
        const key = payloadSlotKey(targetOfSender(sender));
        const o = await chrome.storage.session.get(key);
        const p = o[key] || null;
        return { ok: true, payload: p && !p.queued ? p : null }; // 還在排隊的樂屋資料包不給（分頁還沒輪到它）
      });

    case "listing:clear":
      return reply(async () => {
        const target = targetOfSender(sender);
        await chrome.storage.session.remove(payloadSlotKey(target));
        if (target === "591") {
          // 591 填完了：樂屋那格若還在排隊（一起上架），現在開它的分頁接著填
          const rk = payloadSlotKey("rakuya");
          const o = await chrome.storage.session.get(rk);
          if (o[rk] && o[rk].queued) {
            const { queued, ...rest } = o[rk];
            await chrome.storage.session.set({ [rk]: rest });
            const tab = await openTab({ url: launchUrl(rest) });
            return { ok: true, opened: "rakuya", tabId: tab.id };
          }
        }
        return { ok: true };
      });

    case "listing:fetch-page":
      /**
       * 只抓使用者自己貼進來的愛屋型錄頁，回 HTML 讓頁面端撈這一戶嵌在頁面上的照片網址、或轉成文字解析。
       *
       * 🔴 2026-09-16 三次來回才確認：**要帶 credentials:"include"**。本人實測貼網址抓不到完整門牌，
       * 一度改成 include、又因為「查這個網址看起來沒有登入機制」自己判斷錯誤改回 omit——後來比對同業
       * 黃瑋凱同一支功能的程式碼，他也是 `credentials:"include"`，註解明寫「登入愛屋的型錄頁才有
       * 『顯示』門牌那顆按鈕（完整地址在它的 alt），匿名頁只印路名」。我判斷錯的地方：用 Claude 的
       * 瀏覽器工具去查這個網址，那個瀏覽器本來就沒登入過愛屋、也沒有登入連結可點，所以「查不到登入
       * 機制」——但那只代表**我的測試瀏覽器沒登入過**，不代表這個網站沒有登入這回事。本人自己的
       * Chrome 因為平常業務就有登入愛屋，帶著 include 才抓得到跟本人手動 Ctrl+A 一樣的完整內容。
       */
      return reply(async () => {
        const u = new URL(String(msg.url || ""));
        if (!(u.hostname === "houseol.com.tw" || u.hostname.endsWith(".houseol.com.tw"))) throw new Error("只抓愛屋型錄頁");
        const res = await fetch(u.href, { credentials: "include" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const html = await res.text();
        return { ok: true, html: html.slice(0, 2_000_000) };
      });

    case "listing:register":
      /**
       * 上架物件追蹤清單登記（2026-09-19）：app.js 在 launch() 成功開好分頁之後呼叫，
       * 失敗一律吞掉（best-effort，不能讓「官網剛好連不上」擋到上架這個主功能）。
       */
      return reply(async () => {
        try {
          const res = await fetch("https://mingfu-realtor.vercel.app/api/post591-ext/register-listing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceUrl: String(msg.sourceUrl || ""),
              title: String(msg.title || ""),
              address: String(msg.address || ""),
              platform: String(msg.platform || ""),
            }),
          });
          return { ok: res.ok };
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) };
        }
      });

    case "listing:fetch-image":
      /* 591 頁面本身不能跨網域抓圖，這裡抓回來轉 base64 交給 fill591.js 塞進上傳框 */
      return reply(async () => {
        const res = await fetchImageBytes(msg.url);
        const bytes = new Uint8Array(await res.arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return { ok: true, b64: btoa(bin), type: res.headers.get("content-type") || "image/jpeg" };
      });

    case "listing:detect-floorplan":
      /**
       * 格局圖偵測（2026-09-23，跟同事黃瑋凱 v1.6.2 一樣的功能：愛屋有格局圖時 591 出售會自動傳到
       * 「格局圖」那一格、照片區不放它）。app.js 解析完照片清單就會呼叫這支，逐張抓回來看「長相」
       * （lib/floorplan.js 的門檻），回傳每張的原始比例——app.js 顯示訊息時附上這些數字，誤判時
       * 本人不用開 DevTools 就能回報。最多看前 20 張。
       *
       * 🔴 2026-09-24 本人真實測試（15 張真實不動產照片）回報「The message port closed before a
       * response was received」——原本這裡一次把全部張數同時 Promise.all 送出，每張又是整張原始
       * 解析度解碼（見 imageStatsFor 的說明），在這台規格不算高的機器上疊在一起很可能就是真正的
       * 病灶：不是某一張特別慢，是「一次太多張、每張又太重」一起把 service worker 拖過了 Chrome
       * 自己的逾時，換來這句籠統的錯誤，不是格局圖偵測邏輯本身的問題。已經雙管齊下：
       * imageStatsFor 改用解碼時就縮小（省時間省記憶體）＋這裡改成 mapWithConcurrency 一次最多
       * 4 張，不要一次全開。
       */
      return reply(async () => {
        const urls = Array.isArray(msg.urls) ? msg.urls.slice(0, 20) : [];
        const items = await mapWithConcurrency(urls, 4, async (u) => {
          try {
            return { url: u, ...(await imageStatsFor(u)) };
          } catch (e) {
            return { url: u, error: String((e && e.message) || e) };
          }
        });
        const pick = self.P591FloorPlan.pickFloorPlan(items);
        const best = self.P591FloorPlan.bestCandidate(items);
        return { ok: true, items, floorPlanUrl: pick ? pick.url : null, best };
      });

    case "listing:find-pacific-link":
      /* 太平洋官網連結（2026-10-01，見 findPacificLink 開頭的說明）。app.js 的 rakuyaVariant()
         樂屋出租物件上架時呼叫；找不到就回 url:null，不當錯誤、不擋上架。 */
      return reply(async () => {
        const url = await findPacificLink(msg.rawTitle, msg.listingNo, { rent: msg.rent !== false });
        return { ok: true, url };
      });

    default:
      return false;
  }
});
