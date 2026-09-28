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

      submitBtn.click();

      const closed = await waitFor(() => !findByText("成交 / 關閉物件") && !findByText("成交/關閉物件"), 8000);
      if (!closed) return { ok: false, error: "按了確認送出，但彈窗沒有關閉，不確定是不是真的成功" };

      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
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
    try {
      const o = await chrome.storage.local.get("rr:pre-submit-debug");
      preSubmitDebug = o["rr:pre-submit-debug"] || null;
      await chrome.storage.local.remove("rr:pre-submit-debug");
    } catch {
      // 讀不到就算了，不影響 stillListed 這個主要判斷結果
    }
    return { stillListed, preSubmitDebug };
  };
})();
