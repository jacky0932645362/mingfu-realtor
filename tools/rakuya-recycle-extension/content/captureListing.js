/**
 * 內容腳本：本人按下真正的送出按鈕之前，先把描述裡的太平洋房屋連結存起來，
 * 讓 captureSuccess.js（掛在送出後跳轉到的成功頁）撿回去完成登記。
 *
 * 🔴 2026-09-26／27 四輪真帳號診斷才確認：
 *   1. 真正的送出按鈕文字是「儲存」，不是「上架」。
 *   2. 按下去會整個跳轉到完全不同網域（member.rakuya.com.tw → my.rakuya.com.tw
 *      /pay/item_carry/success?ehid=...），要把連結存起來讓成功頁撿回去。
 *   3. 加了除錯紀錄（chrome.storage.local，options.html 會顯示）之後才照到
 *      真正病灶：原本存連結是寫 chrome.storage.session，但 Chrome 預設**不准
 *      內容腳本存取 session storage**（"Access to storage is not allowed
 *      from this context"，只有背景程式／外掛自己的頁面才有權限）——改用
 *      chrome.storage.local，內容腳本本來就有權限，不用額外呼叫
 *      setAccessLevel() 開放。
 */
(() => {
  const DEBUG_KEY = "rr:debug";
  function dbg(message) {
    chrome.storage.local.get(DEBUG_KEY, (o) => {
      const list = Array.isArray(o[DEBUG_KEY]) ? o[DEBUG_KEY] : [];
      list.push({ at: new Date().toISOString(), from: "captureListing", message: String(message).slice(0, 1000) });
      chrome.storage.local.set({ [DEBUG_KEY]: list.slice(-80) });
    });
  }

  const path = location.pathname;
  dbg(`載入，path=${path}`);
  if (!/^\/rent\/post\//.test(path)) return;

  const CATALOG_URL_RE = /https?:\/\/[^\s"'<>]*houseol\.com\.tw\/[^\s"'<>]*\.aspx[^\s"'<>]*/i;
  function findCatalogUrlInDescription() {
    const ed = document.querySelector(".note-editable");
    if (!ed) return { ed: false };
    const raw = ed.innerText || ed.textContent || "";
    const m = raw.match(CATALOG_URL_RE);
    return { ed: true, rawTail: raw.slice(-120), url: m ? m[0] : null };
  }

  const txt = (e) => (e && e.textContent ? e.textContent.replace(/\s+/g, "").trim() : "");
  const SUBMIT_TEXTS = ["儲存", "上架", "確認上架", "立即上架"];
  function findSubmitAncestor(el) {
    for (let n = el, i = 0; n && i < 8; n = n.parentElement, i++) {
      const t = txt(n);
      if (SUBMIT_TEXTS.includes(t)) return { el: n, matched: t, depth: i };
    }
    return null;
  }

  /**
   * 🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-27 本人真帳號實測發現重刊出來的「特色描述」不是他
   * 原本貼的內容——原因找到了：快照存的 `listing` 一直是「重新抓愛屋型錄頁」解析
   * 出來的原始資料，不是本人當初實際貼在樂屋描述欄裡（可能手動調整過）的那段文字。
   * 本人明講過「你必須在刪除之前，記住裡面這筆物件的所有資訊」——這代表要記的是
   * 「本人實際貼出去的內容」，不是「型錄網站現在長什麼樣子」。改法：跟抓連結
   * 同一個時機（按下送出的那一刻），把描述編輯器當下的 innerHTML 也一起存起來，
   * 讓 createNewListing() 重刊時優先用這份「本人真的貼過的內容」，不是每次都重新
   * 用型錄資料組一份新的。
   *
   * 🔴🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-27 本人追問同一件事在照片上也存在：第一張照片
   * 本人會另外貼上「封面貼圖」（批次貼圖工具／591 外掛的「⚙我的資料」合成功能），
   * 型錄原始照片是沒有貼圖的版本，快照現在只存型錄照片網址，重刊會漏掉這個合成
   * 結果。跟描述同一個道理：不要去猜「貼圖是怎麼合成的」再重做一次，直接在送出
   * 的那一刻，把當下真正已經選進上傳欄位（`surface_image_input`）的第一個檔案
   * 整個讀出來存成 data URL——不管封面是型錄原圖還是合成過貼圖的版本，讀到的
   * 都是「本人當下真的要送出去的那個檔案」，不用理解合成邏輯本身。只存第一張
   * （本人這次問題只提到第一張封面），其餘照片繼續用型錄網址重抓，量體可控。
   */
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("FileReader 失敗"));
      reader.readAsDataURL(file);
    });
  }

  async function captureCoverPhotoDataUrl() {
    const input = document.querySelector('[name="surface_image_input"]');
    if (!input) return { ok: false, error: "找不到照片上傳欄位" };
    const file = input.files && input.files[0];
    if (!file) return { ok: false, error: "上傳欄位裡目前沒有檔案" };
    try {
      const dataUrl = await readFileAsDataUrl(file);
      return { ok: true, dataUrl, size: file.size, name: file.name };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }

  /**
   * 🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-27 本人真帳號實測＋本人親自盯著
   * 分頁看：真正卡住送出的是「補充資訊」區塊的「隔間材質」下拉選單，樂屋有、
   * 591 沒有對應欄位，591-extension 搬過來的整套欄位對映天生不會涵蓋。本人這次
   * 把話說得更完整：「你就是要複製我之前所有的資訊照片，如果一模一樣的話，
   * 一定是沒有問題，因為用物件上架助手刊登新物件之後，我也是有手動修改、
   * 補充一些東西」——代表本人平常貼文本來就會在自動填表工具跑完之後手動
   * 調整補充，這些手動補充的內容從來沒被記錄下來過，不是只有描述、封面
   * 貼圖兩處，是**整個表單**都可能有本人手動調整的痕跡。與其繼續一個一個
   * 等本人截圖抓到才回頭修一個欄位（總樓層→描述→封面貼圖→隔間材質，
   * 目前已經四輪，不知道還有沒有第五輪），改成一次性的通解：送出的當下，
   * 把整張表單目前所有欄位的值都掃一遍存起來，重刊時整批套用在填表結果
   * 之上（結構性欄位如地址/坪數繼續用型錄資料算，本人手動調整過的欄位這批
   * 補上去蓋掉），不用再逐一欄位猜測、逐一欄位補程式碼。
   */
  function captureFormFields() {
    const fields = {};
    const seen = new Set();
    const inputs = [...document.querySelectorAll("input, select, textarea")];
    for (const el of inputs) {
      const name = el.name;
      if (!name || seen.has(name) || el.type === "file") continue;
      try {
        if (el.type === "radio") {
          const group = [...document.querySelectorAll(`input[name="${CSS.escape(name)}"]`)];
          const checked = group.find((g) => g.checked);
          if (checked) fields[name] = { type: "radio", value: checked.value };
        } else if (el.type === "checkbox") {
          const group = [...document.querySelectorAll(`input[name="${CSS.escape(name)}"]`)];
          if (group.length > 1) fields[name] = { type: "checkbox-group", values: group.filter((g) => g.checked).map((g) => g.value) };
          else fields[name] = { type: "checkbox", checked: el.checked };
        } else if (el.tagName === "SELECT") {
          // 🔴 2026-09-28 跟 scrapeListing.js 同一個修正：只存 .value 沒用，
          // 這個網站下拉選單的內部 value 不是穩定值，applyCapturedFormFields()
          // 優先用看得到的文字比對（跟既有 setSelect() 邏輯一致），這裡兩個都存。
          if (el.value) {
            const opt = el.options[el.selectedIndex];
            fields[name] = { type: "select", value: el.value, text: opt ? opt.text.trim() : "" };
          }
        } else if (el.tagName === "TEXTAREA" || el.type === "text" || el.type === "number" || el.type === "tel" || el.type === "email") {
          if (el.value) fields[name] = { type: "text", value: el.value };
        }
      } catch {
        // 單一欄位讀取失敗不要讓整批擷取掛掉
      }
      seen.add(name);
    }
    return fields;
  }

  let saved = false;
  async function tryStash(ev) {
    const hit = findSubmitAncestor(ev.target);
    if (!hit) return;
    dbg(`偵測到點擊符合送出按鈕（文字="${hit.matched}"，往上${hit.depth}層），事件類型=${ev.type}`);
    if (saved) { dbg("剛存過，3秒內不重複存"); return; }
    const found = findCatalogUrlInDescription();
    if (!found.ed) { dbg("找不到 .note-editable 描述編輯器"); return; }
    if (!found.url) { dbg(`描述編輯器有找到，但沒抓到愛屋連結。描述結尾片段="${found.rawTail}"`); return; }
    saved = true;
    const ed = document.querySelector(".note-editable");
    const descHtml = ed ? ed.innerHTML : "";
    const descText = ed ? (ed.innerText || ed.textContent || "") : "";
    const cover = await captureCoverPhotoDataUrl();
    dbg(cover.ok ? `封面照片讀到了：${cover.name}，${cover.size} bytes` : `封面照片沒讀到：${cover.error}（不影響其他資訊照常存檔，其餘照片仍用型錄網址）`);
    const formFields = captureFormFields();
    dbg(`表單欄位快照抓到 ${Object.keys(formFields).length} 個有值的欄位`);
    /* 🔴 2026-09-27 真bug：chrome.storage.session 預設不准內容腳本存取
       （"Access to storage is not allowed from this context"）——只有背景程式／
       外掛自己的頁面才有權限，除非額外呼叫 setAccessLevel() 開放。改用
       chrome.storage.local，內容腳本本來就有權限，不用額外設定。 */
    dbg(`抓到連結：${found.url}，寫進 chrome.storage.local（同時存下描述，共 ${descText.length} 字）`);
    chrome.storage.local.set(
      {
        "rr:pending-catalog-url": found.url,
        "rr:pending-desc-html": descHtml,
        "rr:pending-desc-text": descText,
        "rr:pending-cover-photo": cover.ok ? cover.dataUrl : "",
        "rr:pending-form-fields": formFields,
      },
      () => {
        dbg(chrome.runtime.lastError ? `寫入失敗：${chrome.runtime.lastError.message}` : "寫入 chrome.storage.local 成功");
      },
    );
    setTimeout(() => { saved = false; }, 3000);
  }

  document.addEventListener("mousedown", tryStash, true);
  document.addEventListener("click", tryStash, true);
})();
