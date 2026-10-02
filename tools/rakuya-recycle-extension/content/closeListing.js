/**
 * 內容腳本：在「出租物件管理」頁面把指定物件「成交/關閉」→關閉→不方便帶看屋→送出。
 * 不用 declarative content_scripts（manifest.json 沒宣告 matches），background.js 用
 * chrome.scripting.executeScript 在確定網址是對的之後才注入＋呼叫，理由是這個管理頁
 * 的真實網址還沒本人帶著確認過（見 [[project_樂屋出租循環刊登]]）。
 *
 * ⚠️ 第一版，還沒對真帳號跑過。照兩張截圖上看得到的文字標籤寫（「成交/關閉」「關閉」
 * 「不方便帶看屋」「確認送出」），跟 591-extension/fillRakuya.js 當初「應該長這樣」是
 * 同一個處境，第一次真的跑，錯誤訊息回頭調整這支檔案。
 *
 * 掛在 window 上、不自動執行——background.js 注入這支檔案之後，再用
 * chrome.scripting.executeScript({func:...}) 另外呼叫 window.__rrCloseListing__(args)
 * 才會真的動作，避免「檔案一注入就自動跑」在時機沒抓好時誤觸發。
 */
(() => {
  const txt = (e) => (e && e.textContent ? e.textContent.replace(/\s+/g, " ").trim() : "");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * 🎯 2026-10-01 本人親自手動點「刪除」彈窗的「確定」證實：人工點擊
   * 有效、`element.click()` 沒效，先補的「等 0.5 秒再點」沒有解決
   * （下一輪還是一樣的「重試歷程=[true,true,true]」）。回頭查：
   * `HTMLElement.click()` 只會直接發一個合成的 `click` 事件
   * （`isTrusted:false`），不會先發 `mousedown`／`mouseup`——如果這顆
   * 按鈕背後的框架是靠監聽 `mousedown`/`pointerdown` 之類的事件來
   * 判斷「真的被按下去」（這類元件庫做法不罕見，尤其是自訂樣式按鈕
   * 而非原生 `<button>` 預設行為），單純 `.click()` 可能完全不會觸發
   * 真正的刪除動作，即使按鈕存在、`.click()` 呼叫本身沒有報錯。改成
   * 補發一整串更接近真人滑鼠操作的事件序列（pointerdown/mousedown/
   * pointerup/mouseup/click），不要只靠 `.click()` 這一種方式。
   */
  function realisticClick(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(type, opts));
    }
    el.click();
  }

  /**
   * 🔴 2026-09-28 本人截圖抓到：這裡的「點擊後腳本執行環境中斷，重新
   * 檢查後物件仍在上架中物件列表」跟 createListing.js 當初撞到的原生
   * confirm() 對話框卡住是同一類症狀（點下去被某個原生對話框卡住，
   * 沒人按會一直卡著）。background.js 的 createNewListing() 已經用
   * `world:"MAIN"` 蓋掉 window.confirm／alert，這裡（closeOldListing()）
   * 原本沒有同一套保護——background.js 這次也一併補上同一套注入。跟
   * createListing.js 同一招，用自訂事件把「confirm() 有沒有真的被呼叫」
   * 的證據傳回來，不用再靠猜。
   */
  let nativeConfirmSeen = null;
  document.addEventListener("rr:native-confirm", (e) => {
    nativeConfirmSeen = (e.detail && e.detail.message) || "(沒有訊息內容)";
    /**
     * 🔴 點擊之後如果緊接著發生跨網域跳轉／重新整理，這支內容腳本的整個
     * 執行環境（含這裡的 nativeConfirmSeen 變數）會被砍掉重來，
     * __rrStillListed__ 是頁面穩定後重新注入呼叫的全新執行環境，讀不到
     * 這個變數——跟 rr:pre-submit-debug 同一招，事件一發生就搶先存進
     * chrome.storage.local，才不會被中斷砍掉這份證據。
     */
    chrome.storage.local.set({ "rr:native-confirm-seen": nativeConfirmSeen }).catch(() => {});
  });

  function findByText(text, { exact = false } = {}) {
    const all = [...document.querySelectorAll("a, button, span, div, label")];
    return all.find((e) => {
      const t = txt(e);
      return exact ? t === text : t.includes(text);
    });
  }

  async function waitFor(fn, timeout = 10000, step = 150) {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > timeout) return null;
      await sleep(step);
    }
  }

  /**
   * 🔴🔴 2026-09-27 第一版 collectClickableTexts() 掃整個 document 的
   * button/a/input，結果撈到的全是頁面導覽列／頁尾（買屋、租屋、樂屋網、
   * LINE找客服……），一個都不是彈窗裡的按鈕——這個網站彈窗的按鈕八成跟
   * 「不方便帶看屋」選項本身一樣是 div/span/label 裝出來的，不是真的
   * <button>/<a>，而且掃整個 document 範圍太大，真正的目標被頁面雜訊淹沒。
   * 改法：①用 findDialogRoot() 先找到彈窗自己的容器，只在容器「裡面」找，
   * 不掃整個頁面 ②把候選標籤放寬到 span/div/label（跟 findByText 用的
   * 標籤集合一樣）③只收「沒有子元素」的葉節點，避免整個彈窗容器自己的
   * textContent 被當成一整條「按鈕文字」。
   */
  function findDialogRoot(markerEl) {
    let node = markerEl;
    for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
      const t = txt(node);
      if (t.length > 40) return node;
    }
    return document.body;
  }

  /**
   * 🔴🔴🔴 2026-09-27 第二版還是漏抓：本人截圖回報連「方式」底下5個選項
   * （已付斡旋金或簽約中／仲介打擾／已委託仲介／不方便帶看屋／其他，這5個
   * 確定存在，因為前面就是靠 findByText 找到其中一個才點下去的）一個都沒
   * 出現在 visibleButtons 裡——代表「只收沒有子元素的葉節點」這個過濾條件
   * 本身就抓錯重點：這種舊式表單常見寫法是 `<label><input type="radio">
   * 文字</label>`，label 雖然「有子元素」（那顆 input），但 label 自己的
   * 直接文字內容才是我們真正要的按鈕/選項文字。改法：不再用「有沒有子
   * 元素」判斷，改成只取每個元素「自己的文字節點」（不含子元素貢獻的文字）
   * ——純包裹用的外層容器（例如整個彈窗最外層 div）自己不帶文字，天然會
   * 因為空字串被濾掉，不用另外判斷是不是葉節點。
   */
  function ownText(e) {
    let s = "";
    for (const node of e.childNodes) {
      if (node.nodeType === 3) s += node.textContent;
    }
    return s.replace(/\s+/g, " ").trim();
  }

  function collectClickableTexts(root) {
    const els = [...root.querySelectorAll("button, a, span, div, label, input, img")];
    const texts = els
      .map((e) => {
        const own = e.tagName === "INPUT" ? String(e.value || "").trim() : ownText(e);
        const alt = (e.tagName === "IMG" || e.tagName === "INPUT") && e.getAttribute("alt");
        const onclick = e.getAttribute && e.getAttribute("onclick");
        const bits = [];
        if (own) bits.push(own);
        if (alt) bits.push(`alt=${alt}`);
        if (onclick) bits.push(`onclick=${onclick.slice(0, 30)}`);
        return bits.length ? `<${e.tagName.toLowerCase()}>${bits.join(",")}` : null;
      })
      .filter((t) => t && t.length <= 60);
    return [...new Set(texts)].join(" | ").slice(0, 800);
  }

  /**
   * 🔴🔴🔴🔴 2026-09-27 廣度掃描（文字/圖片/onclick）三輪都掃不到「確認送出」，
   * 但更早之前 dialogTextDump 曾經把彈窗的原始內嵌 <script> 文字整段記錄下來，
   * 裡面清楚看到真正的送出處理函式是 `doItemDownClose()`（讀 `.reason:visible`
   * 的 id，分流呼叫 `report_send()`／`itemClose_send()`）。與其繼續猜文字/猜
   * 標籤，不如直接用這個「已經在真實畫面上出現過」的函式名稱去找誰的
   * onclick 呼叫了它——這是本人截圖證實過的真實證據，不是新的猜測。
   */
  function findSubmitByOnclick(root) {
    const els = [...root.querySelectorAll("*")];
    return els.find((e) => {
      const oc = e.getAttribute && e.getAttribute("onclick");
      return oc && oc.includes("doItemDownClose");
    });
  }

  /** 找出「成交/關閉」列表裡，屬於 matchText 那一列的連結——用最近的祖先容器縮小範圍，避免點到別戶 */
  function findCloseLinkForRow(matchText) {
    const marker = findByText(matchText);
    if (!marker) return null;
    let node = marker;
    for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
      const link = [...node.querySelectorAll("a, button")].find((e) => txt(e).includes("成交") && txt(e).includes("關閉"));
      if (link) return link;
    }
    return null;
  }

  /**
   * 🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-28 本人直接截圖
   * 給了真正的答案：手動點「關閉中物件」的「修改」，網址列是
   * `member.rakuya.com.tw/rent/post/edit?ehid={ehid}`——`ehid` 本來就
   * 存在快照的 `rakuyaId` 裡，`background.js` 現在直接組這個網址開分頁
   * （`scrapeCurrentListingState()`），不用在管理頁上找「修改」連結再
   * 點——這裡原本 `findEditLinkForRow()`／`__rrClickEditLink__` 這兩個
   * 函式一直失敗的真正原因：那支物件當時已經在「關閉中物件」分頁，根本
   * 不在「上架中物件」，在管理頁上怎麼搜都找不到，不是找法本身猜錯
   * 標籤。這兩個函式已經沒有用到，拿掉。
   */

  window.__rrCloseListing__ = async function ({ matchText }) {
    try {
      const closeLink = await waitFor(() => findCloseLinkForRow(matchText), 10000);
      if (!closeLink) return { ok: false, error: `列表裡找不到「${matchText}」這一列的成交/關閉連結` };
      closeLink.click();

      const dialogTitle = await waitFor(() => findByText("成交 / 關閉物件") || findByText("成交/關閉物件"), 8000);
      if (!dialogTitle) return { ok: false, error: "點了成交/關閉，但沒看到彈窗跳出來" };

      /*
       * 🔴 2026-09-27 本人截圖過的原始畫面（成交/關閉物件彈窗）顯示：彈窗一打開
       * 「請選擇原因」就已經是「關閉」、「方式」的單選（已付斡旋金或簽約中／
       * 仲介打擾／已委託仲介／不方便帶看屋／其他）也已經在畫面上，不確定是不是
       * 一定要「主動選一次關閉」才會出現。改成不賭這件事：先直接找「不方便
       * 帶屋」，找不到才去嘗試切一次下拉選單、多等一下再找一次——兩種情境
       * （選項本來就在／要選過才出現）都涵蓋，不用先猜是哪一種。
       *
       * 🔴🔴 2026-09-27 真正病灶找到了：本人拍板固定選的那個選項，文字其實是
       * 「不方便帶看屋」（六個字），不是「不方便帶看」——從那之後全部程式碼
       * 都在找一個畫面上根本不存在的字串，難怪連續兩種「猜情境」的修法都
       * 沒用——問題從來不是「情境猜錯」，是「文字本身就抄錯了」。
       *
       * 🔴🔴🔴 補充：用 dialogTextDump 把畫面文字記下來後一度誤判成「不方便
       * 帶屋」（少了一個「看」字）——純文字擷取這裡漏抓了一個字，原因不明
       * （可能是這個字用了特殊排版方式）。本人直接截圖彈窗畫面比對確認，
       * 真正正確的文字是「不方便帶看屋」，以本人截圖為準，不是以
       * dialogTextDump 這種純文字擷取的結果為準——兩者都可能失真，真的
       * 有疑慮時截圖仍然是最後的裁判。
       */
      let wayOption = await waitFor(() => findByText("不方便帶看屋", { exact: true }), 2000);
      if (!wayOption) {
        const reasonSelect = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => txt(o) === "關閉"));
        if (reasonSelect) {
          const opt = [...reasonSelect.options].find((o) => txt(o) === "關閉");
          reasonSelect.value = opt.value;
          reasonSelect.dispatchEvent(new Event("change", { bubbles: true }));
          reasonSelect.dispatchEvent(new Event("input", { bubbles: true }));
        }
        wayOption = await waitFor(() => findByText("不方便帶看屋", { exact: true }), 8000);
      }
      // 方式：固定選「不方便帶看屋」（🔴 本人 2026-09-26 拍板固定這個，不要選別的）
      if (!wayOption) {
        /* 🔴 2026-09-27 連猜兩次都沒找到，不要猜第三次——這些操作在背景分頁跑，
           本人從沒親眼看過這個畫面，把彈窗當下的文字整段記下來，才看得到真正
           發生了什麼（例如：文字其實不是「不方便帶看屋」四個字、彈窗根本沒開好、
           或選了關閉之後畫面整個換了別的樣子）。 */
        const dialogRoot = findDialogRoot(dialogTitle);
        const dump = dialogRoot === document.body ? "(找不到彈窗容器)" : txt(dialogRoot).slice(0, 500);
        return { ok: false, error: "選了關閉，但沒看到『不方便帶看屋』這個選項", dialogTextDump: dump };
      }
      const radio = wayOption.closest("label")?.querySelector('input[type="radio"]') || wayOption.previousElementSibling;
      if (radio && radio.click) radio.click();
      else wayOption.click();

      let submitBtn = await waitFor(() => findByText("確認送出", { exact: true }), 4000);
      let foundVia = "text";
      if (!submitBtn) {
        submitBtn = findSubmitByOnclick(findDialogRoot(dialogTitle));
        foundVia = "onclick";
      }
      if (!submitBtn) {
        return {
          ok: false,
          error: "選好方式了，但沒看到『確認送出』按鈕",
          visibleButtons: collectClickableTexts(findDialogRoot(dialogTitle)),
        };
      }

      /**
       * 🔴🔴🔴🔴🔴 2026-09-27 本人實測：點下去這裡之後腳本執行環境常常
       * 中斷（Frame with ID 0 was removed），但重新檢查後物件卻還在
       * 上架中物件列表——代表點擊本身沒有真的送出成功，不是「中斷=成功」
       * 那種情況。中斷之後這支函式的其餘程式碼都不會執行，回傳值也送不
       * 出去，所以要在點擊前先把「準備點什麼」寫進 chrome.storage.local
       * （跟 captureListing.js 當初解決跨網域跳轉是同一招：中斷前搶先
       * 存證據），等頁面穩定後 __rrStillListed__ 才有辦法把這份點擊前的
       * 資訊撈回去，不用再靠猜點到的到底是不是對的元素。
       */
      try {
        const reasonEls = [...document.querySelectorAll(".reason")];
        const visibleReason = reasonEls.find((e) => e.offsetParent !== null);
        await chrome.storage.local.set({
          "rr:pre-submit-debug": {
            foundVia,
            tag: submitBtn.tagName,
            outerHtmlSnippet: String(submitBtn.outerHTML || "").slice(0, 150),
            visibleReasonId: visibleReason ? visibleReason.id || "(沒有id)" : "(找不到可見的 .reason 元素)",
            reasonCount: reasonEls.length,
          },
        });
      } catch {
        // 存證據本身失敗也不該擋住流程，最壞情況就是少一份診斷資訊
      }

      /**
       * 🎯 2026-10-01 刪除那邊的「確定」按鈕撞過一模一樣的症狀（點擊後
       * 中斷、重新檢查後物件卻還在），本人親自手動點證實人工點擊有效、
       * 程式點擊沒效，加 0.5 秒延遲那版沒解決，後來改用
       * `realisticClick()`（補發 pointerdown/mousedown/pointerup/
       * mouseup 完整事件序列，不只是 `.click()`）。這裡是結構相同的
       * 情境，一起換成同一套，不要只改了刪除那邊。
       */
      await sleep(500);
      realisticClick(submitBtn);

      const closed = await waitFor(() => !findByText("成交 / 關閉物件") && !findByText("成交/關閉物件"), 8000);
      if (!closed) return { ok: false, error: "按了確認送出，但彈窗沒有關閉，不確定是不是真的成功", nativeConfirmSeen };

      return { ok: true, nativeConfirmSeen };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e), nativeConfirmSeen };
    }
  };

  /**
   * 🔴 2026-09-27 本人實測發現點擊送出後會觸發讓上面 __rrCloseListing__
   * 執行環境中斷的動作（background.js 收到「Frame with ID 0 was removed.」）
   * ——這支函式給 background.js 在頁面穩定下來之後重新注入呼叫，單純檢查
   * 這筆物件的標題還在不在「上架中物件」列表上，作為中斷後的真實驗證，
   * 不是靠猜例外訊息代表成功還是失敗。
   */
  window.__rrStillListed__ = async function (matchText) {
    const stillListed = !!findByText(matchText);
    let preSubmitDebug = null;
    let nativeConfirmSeenPersisted = null;
    try {
      const o = await chrome.storage.local.get(["rr:pre-submit-debug", "rr:native-confirm-seen"]);
      preSubmitDebug = o["rr:pre-submit-debug"] || null;
      nativeConfirmSeenPersisted = o["rr:native-confirm-seen"] || null;
      await chrome.storage.local.remove(["rr:pre-submit-debug", "rr:native-confirm-seen"]);
    } catch {
      // 讀不到就算了，不影響 stillListed 這個主要判斷結果
    }
    return { stillListed, preSubmitDebug, nativeConfirmSeen: nativeConfirmSeenPersisted };
  };

  /**
   * 🔴🔴🔴 2026-09-30 本人截圖＋文字說明揭露這整個系列一直沒抓到的關鍵
   * 一步：「成交/關閉」只是把物件從「上架中物件」移到「關閉中物件」，
   * 本人原話「樂屋網的機制是在關閉中不能有這個物件，不然你再重新上架
   * 的話，它的瀏覽頁面並不會跑到最前面去」——真正要「清乾淨」必須在
   * 「關閉中物件」分頁再找到這筆、按「刪除」、跳出確認彈窗再按「確定」
   * 才算數（本人截圖三張分別對應這三步）。這解釋了本系列反覆撞見的
   * 「物件名稱已被使用」：關閉不等於刪除，舊物件一直留在「關閉中物件」
   * 沒有真正清掉。
   *
   * ⚠️ 第一版，還沒對真帳號跑過。「關閉中物件」分頁籤本身用文字找
   * （跟「上架中物件」「已成交物件」同一排籤，本人截圖看到的原文），
   * 這頁面看起來是同一個管理頁面內的分頁切換（不確定是不是整頁重新
   * 導航，用 waitFor 而不是假設網址一定會變），刪除確認彈窗的「確定」
   * 按鈕也是用文字找（截圖上原文就是「確定」）。這幾個環節都可能跟
   * 「不方便帶看屋」「確認送出」一樣，猜的文字或標籤是錯的，要等本人
   * 真帳號重試的錯誤訊息回頭調整。
   */
  /**
   * 🔴 2026-10-01 本人親眼觀察到「刪除」彈窗這次根本沒有跳出來，但
   * background.js 收到的卻是「Frame with ID 0 was removed」這種執行
   * 環境中斷的例外——代表中斷點比想像中更早（很可能在 `delLink.click()`
   * 附近，不是先前以為的確認彈窗那一步），而且中斷點好像每輪不太一樣
   * （有時候是找到確定按鈕點下去才斷、這次是連彈窗都沒開）。不要再猜
   * 是哪一步，照抄 `__rrCloseListing__` 當初用 `chrome.storage.local`
   * 搶在中斷前存證據的同一招：每跨過一個關鍵步驟就記一筆「目前走到
   * 哪」，就算中途被整個砍斷，下一次 `__rrStillInClosedList__` 重新
   * 檢查時也能把這份「最後停在哪一步」的記錄讀回來，不用再猜。
   */
  const markDeleteStep = (step) => chrome.storage.local.set({ "rr:delete-checkpoint": { step, at: Date.now() } }).catch(() => {});

  window.__rrDeleteClosedListing__ = async function ({ matchText }) {
    try {
      await chrome.storage.local.remove("rr:delete-checkpoint").catch(() => {});
      /**
       * 🎯🎯🎯🎯 2026-10-01 本人截圖證實點「關閉中物件」分頁籤會讓網址從
       * `hlist_up?objind=R` 真的變成 `hlist_down?objind=R`——這從頭到尾
       * 不是前端切換，是整頁導航。之前這裡用 `tab.click()` 讓同一支
       * 腳本在「網頁隨時可能被整頁換掉」的狀態下繼續往下跑，中斷點
       * 每輪不固定（有時候跑了好幾步才斷、有時候立刻斷）就是這樣來的。
       * 改法：`background.js` 的 `deleteClosedListing()` 現在改成一開始
       * 就直接把分頁導航到 `hlist_down` 這個網址（`chrome.tabs.create`
       * 時給的網址就是它），這支腳本是導航完成、頁面穩定之後才被注入
       * 執行，理論上一開始就已經在「關閉中物件」——這裡只做最後一道
       * 確認（等「出租 - 關閉中物件」標題出現），不再負責「切換」這個
       * 動作本身，避免再度卡進那個不穩定的半空中狀態。
       */
      await markDeleteStep("開始：確認已經在「關閉中物件」頁面");
      const switched = await waitFor(() => findByText("出租 - 關閉中物件", { exact: true }) || findByText("出租 - 關閉中物件"), 8000);
      if (!switched) return { ok: false, error: "分頁應該已經導航到「關閉中物件」，但畫面上等不到「出租 - 關閉中物件」標題" };
      await markDeleteStep("已確認在關閉中物件頁面，開始找這一列");

      /**
       * 🎯 2026-10-01 本人直接截圖「檢查」(DevTools Inspect) 給了刪除連結
       * 真正的原始碼：`<a class="mfunc_link" onclick="...(物件ID)">刪除</a>`，
       * 包在巢狀表格裡（外層 tr>td 裡面還有一層 inner table>tbody>tr>td）。
       * 回頭查出真正病灶跟巢狀表格無關，出在更前面一步：原本 `marker` 是
       * 用共用的 `findByText(matchText)`（沒有 `exact:true`，子字串比對）
       * 找的。`querySelectorAll` 回傳的是文件順序，父層元素一定排在子層
       * 前面，而任何外層容器的 textContent 本來就是把所有子孫文字串起來
       * ——只要外層容器剛好也「包含」matchText 這個子字串（幾乎必然成立，
       * 因為真正的標題元素本來就是它的子孫），`.find()` 永遠會先選到那個
       * 外層容器，不會選到真正裝標題的小元素。marker 很可能整個抓錯成
       * 巨大的外層容器，導致往上爬 8 層反而越爬越遠、範圍早就跳過了真正
       * 那一列，這才是「找不到刪除連結」的根本原因，不是巢狀表格深度
       * 不夠、也不是刪除連結文字本身有問題。
       *
       * 改法：不用 `.find()`（永遠拿第一個＝最外層），改成收集所有「文字
       * 包含 matchText 且看得到」的候選，取「子孫元素數量最少」的那個
       * （包得最緊、最接近真正標題元素的那個），再從這個更精準的起點往上
       * 找刪除連結，順便把跳數從 8 拉高到 14 留更多安全餘裕。
       */
      const marker = await waitFor(() => {
        const candidates = [...document.querySelectorAll("a, button, span, div, label, td")].filter(
          (e) => e.offsetParent !== null && txt(e).includes(matchText)
        );
        if (!candidates.length) return null;
        candidates.sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);
        return candidates[0];
      }, 10000);
      if (!marker) return { ok: false, error: `「關閉中物件」列表裡找不到「${matchText}」這一列（可能還沒真的移過來，或本來就不在）`, notFound: true };
      await markDeleteStep("找到這一列，開始找刪除連結");

      /** 找出這一列的「刪除」連結——用最近的祖先容器縮小範圍，避免點到別戶（跟 findCloseLinkForRow 同一招） */
      let delLink = null;
      let node = marker;
      let lastNode = marker;
      for (let i = 0; i < 14 && node && !delLink; i++, node = node.parentElement) {
        lastNode = node;
        delLink = [...node.querySelectorAll("a, button, span, div")].find((e) => ownText(e) === "刪除" && e.offsetParent !== null);
      }
      if (!delLink) {
        /**
         * 找到這一列卻還是找不到「刪除」連結——不繼續猜，把最後嘗試範圍內
         * 看起來像可點擊元素的候選文字倒出來，照抄 createListing.js 的
         * `collectClickableTexts()` 同一套做法。
         */
        const candidates = [...lastNode.querySelectorAll("a, button, span, div, label")]
          .map((e) => {
            const own = ownText(e);
            if (!own || own.length > 30) return null;
            return e.offsetParent === null ? `${own}(隱藏)` : own;
          })
          .filter(Boolean);
        const dump = [...new Set(candidates)].join(" | ").slice(0, 600);
        return { ok: false, error: `找到「${matchText}」這一列，但這一列附近找不到「刪除」連結，附近看到的候選文字：${dump}` };
      }
      await markDeleteStep("找到刪除連結，準備點擊");
      delLink.click();
      await markDeleteStep("已點刪除連結，等確認彈窗出現");

      /**
       * 🎯 2026-10-01 本人截圖「檢查」給了確認彈窗真正的原始碼：是標準
       * Bootstrap 彈窗（modal-dialog/modal-content/modal-footer），
       * 「確定」是 `<button id="modal-NAME-confirm" class="r-btn
       * is--main">確定</button>`，旁邊還有 `<input type="hidden"
       * id="modal-NAME-hidList" value="35646302">` 帶著這筆物件的 ID。
       * 原本用 `ownText(e)==="確定"` 掃全頁文字——這個網站是用同一套
       * Bootstrap 彈窗樣板處理好幾種不同的確認動作，如果 DOM 裡同時
       * 殘留超過一個這種彈窗（Bootstrap 常見做法：彈窗關閉後 HTML 還留
       * 在頁面上只是隱藏），純文字比對可能撞到別的彈窗、按到不對的
       * 「確定」，而且重試三次全部確認「這筆物件沒有真的被刪除」，
       * 跟這個猜測吻合。改成優先用這個穩定的 id 直接鎖定，id 選不到
       * 才退回原本的文字比對當備援。
       */
      const confirmBtn = await waitFor(() => {
        const byId = document.getElementById("modal-NAME-confirm");
        if (byId && byId.offsetParent !== null) return byId;
        const all = [...document.querySelectorAll("button, a, span, div")];
        return all.find((e) => ownText(e) === "確定" && e.offsetParent !== null);
      }, 5000);
      if (!confirmBtn) return { ok: false, error: "按了「刪除」，但找不到確認彈窗的「確定」按鈕" };
      await markDeleteStep("找到確定按鈕，準備點擊");
      /**
       * 🎯 2026-10-01 改用穩定 id 鎖定之後依然沒有真的刪掉——本人直接
       * 手動點「刪除」→「確定」證實：人工點擊這個按鈕真的會讓物件消失，
       * 排除「這個功能本身有什麼前提條件沒做到」，問題在「程式點擊」
       * 這個動作本身。先猜是動畫時機（加 0.5 秒延遲），本人重試後
       * 還是沒用——代表不是單純「點太早」。真正的差異更可能是
       * `element.click()` 只會直接發一個合成 `click` 事件
       * （`isTrusted:false`），完全不會先發 `mousedown`/`mouseup`，
       * 如果這顆按鈕背後的元件庫是監聽 `mousedown`/`pointerdown` 之類
       * 的事件才真正觸發動作（自訂樣式按鈕常見做法，不是原生
       * `<button>` 預設行為），單純 `.click()` 可能完全沒碰到真正的
       * 處理邏輯。改用 `realisticClick()` 補發完整的滑鼠事件序列，
       * 延遲保留著當作安全邊際。
       */
      await sleep(500);
      realisticClick(confirmBtn);
      await markDeleteStep("已點確定，等 1.5 秒後重新檢查");

      await sleep(1500);
      const stillThere = !!findByText(matchText);
      return stillThere
        ? { ok: false, error: `按了確定刪除，但重新檢查「${matchText}」依然在「關閉中物件」列表` }
        : { ok: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  };

  /**
   * 🔧 2026-10-01 本人真帳號實測：marker 修好之後真的找到「刪除」連結、
   * 也真的找到「確定」按鈕點下去，但緊接著腳本執行環境中斷
   * （Frame with ID 0 was removed.）——跟 `__rrCloseListing__`／
   * `createListing.js` 當初撞過的同一類問題：按下確認動作觸發頁面
   * 重整/導頁，把正在執行的腳本一起砍斷，中斷不等於失敗。這裡比照
   * `__rrStillListed__` 同一招，提供一個獨立、輕量的「重新檢查」函式：
   * 不重新嘗試刪除，只確認分頁籤切到「關閉中物件」後這筆還在不在。
   */
  window.__rrStillInClosedList__ = async function ({ matchText }) {
    const checkpoint = await chrome.storage.local
      .get("rr:delete-checkpoint")
      .then((o) => o["rr:delete-checkpoint"])
      .catch(() => null);
    try {
      /**
       * 🎯🎯🎯🎯 2026-10-01 證實「關閉中物件」分頁籤其實是導航到
       * `hlist_down?objind=R` 這個網址（不是前端切換）之後，
       * `deleteClosedListing()` 改成一開始建立分頁就直接用這個網址，
       * `chrome.tabs.reload()` 重新整理也只會重讀同一個網址，不會跳回
       * 別的分頁——這支函式不再需要「點一次分頁籤」這個動作，頁面本來
       * 就應該已經在對的網址上，不用再猜要不要點。
       */
      await sleep(500);
      return { stillThere: !!findByText(matchText), lastStep: checkpoint?.step };
    } catch (e) {
      return { stillThere: null, error: String(e && e.message ? e.message : e), lastStep: checkpoint?.step };
    }
  };
})();
