/**
 * 內容腳本：在樂屋「新增出租物件」表單頁把快照資料填進去，**填完真的按下「上架」送出**。
 * 跟 591-extension/fillRakuya.js 最大的不同：那支永遠「只填不送出，等人按」，這支不是——
 * 本人 2026-09-26 拍板「全自動」要包含無人值守真的送出，這是本專案系列第一個跨過那條
 * 安全線的工具，見 [[project_樂屋出租循環刊登]]。
 *
 * 低階 DOM 操作（setText/setSelect/clickRadio/setCheck/setSummernote）刻意照抄
 * fillRakuya.js 已經對真帳號驗證過的同一套邏輯（同樣用 name 屬性定位、同樣用「最近的
 * label 文字」找 radio）。商業邏輯（哪個欄位填什麼值）是本人拍板「另外寫一份，不動
 * 591-extension 這支天天在用的正式工具」之後重新對照 fillRakuya.js 的 fill() 手動搬過來
 * 的——以後樂屋表單改版、fillRakuya.js 那邊修的欄位對照，這裡不會自動跟著改，兩邊要
 * 記得互相檢查。範圍只有出租（本專案拍板只做樂屋出租），沒有 port 任何出售專屬欄位。
 *
 * ⚠️ 第一版，還沒對真帳號跑過。
 */
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const has = (v) => v !== null && v !== undefined && v !== "";
  const txt = (e) => (e && e.textContent ? e.textContent.replace(/\s+/g, " ").trim() : "");
  const visible = (e) => !!e && e.offsetParent !== null && getComputedStyle(e).visibility !== "hidden";
  const fire = (el, types) => types.forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
  const byName = (name) => document.querySelector(`[name="${name}"]`) || document.getElementById(name);
  const allByName = (name) => [...document.querySelectorAll(`[name="${name}"]`)];
  const labelOf = (i) => txt(i.closest("label")) || (i.id && txt(document.querySelector(`label[for="${i.id}"]`))) || "";
  /**
   * 🔴 2026-09-29 本人親自手動點「儲存」送出成功，證實表單資料本身完全
   * 沒問題，問題出在自動點擊的機制——跟 closeListing.js 當初「不方便
   * 帶看屋」踩過的坑是同一種：`el.textContent` 會把子孫元素的文字也算
   * 進去，如果真正的按鈕被包在一層沒有其他文字的外層容器裡，外層容器
   * 的 `textContent` 也會剛好完全等於「儲存」，`querySelectorAll` 由外
   * 到內的順序會讓外層容器比內層真正的按鈕先被找到、先被回傳——點擊
   * 這個外層容器不會觸發按鈕自己的事件處理，跟真人點擊按鈕本身不是
   * 同一個目標元素。改用 `ownText()`（只算自己的文字節點、不算子孫）
   * 取代 `textContent`，直接搬 closeListing.js 已經驗證過的同一份實作。
   */
  function ownText(e) {
    let s = "";
    for (const node of e.childNodes) {
      if (node.nodeType === 3) s += node.textContent;
    }
    return s.replace(/\s+/g, " ").trim();
  }

  /**
   * 🔴 2026-09-28 本人截圖抓到：按儲存時樂屋會跳出原生 confirm()「您已
   * 刊登過相同物件...」，background.js 已經改用 `world:"MAIN"` 注入蓋掉
   * `window.confirm`／`window.alert`——但這裡（隔離世界的內容腳本）沒
   * 辦法直接確認那個蓋法真的生效了、真的攔到呼叫。`world:"MAIN"` 注入
   * 的程式碼沒有 `chrome.*` API 可以直接回報，但跟這支內容腳本共用同一
   * 顆 DOM，用自訂事件（`document.dispatchEvent`／`addEventListener`
   * 兩邊都能存取同一個 document）把「confirm() 有沒有真的被呼叫、呼叫
   * 時的訊息是什麼」傳回來，不用再猜攔截機制到底有沒有生效。
   */
  let nativeConfirmSeen = null;
  document.addEventListener("rr:native-confirm", (e) => {
    nativeConfirmSeen = (e.detail && e.detail.message) || "(沒有訊息內容)";
  });

  /**
   * 真正的送出按鈕：2026-09-27 本人截圖實測確認文字是「儲存」，不是原本猜的「上架」
   * ——不限定標籤（不一定是 <button>），從畫面上所有元素裡找「自己的文字剛好就是
   * 這幾個詞之一」的那個。
   *
   * 🔴 2026-09-29 原本用 `el.textContent` 比對，換第二筆物件測試撞上：
   * 本人手動點「儲存」送出成功，證實自動送出點到的不是真正有作用的
   * 按鈕——`textContent` 含子孫元素文字，如果按鈕被包在一層沒有其他
   * 文字的外層容器（`<div><button>儲存</button></div>`這種），外層
   * `textContent` 也會剛好完全等於「儲存」，`querySelectorAll` 由外到
   * 內的順序讓外層容器比內層真正的按鈕先被找到、先被回傳——點這個外層
   * 容器不會觸發按鈕自己的事件處理。原本的註解「含其他文字的外層容器
   * 不會誤中」只防到「外層還有別的文字」這種情況，沒防到「外層沒有
   * 別的文字」這種最常見的純包裝寫法。改用 `ownText()`（只算自己的
   * 文字節點、不算子孫）取代，這樣不管真正的文字是掛在最外層還是最
   * 內層，一定會先比對到「自己的文字剛好等於」的那一個。
   */
  const SUBMIT_TEXTS = ["儲存", "上架", "確認上架", "立即上架"];
  function findSubmitAncestor(root) {
    const collapsed = (s) => String(s || "").replace(/\s+/g, "").trim();
    const all = root.querySelectorAll("button, a, div, span, input[type='submit'], input[type='button']");
    for (const el of all) {
      const t = el.tagName === "INPUT" ? el.value : ownText(el);
      if (SUBMIT_TEXTS.includes(collapsed(t)) && visible(el)) return el;
    }
    return null;
  }

  /**
   * 🔴🔴🔴 2026-09-29 本人親自確認：畫面上橘色「儲存」按鈕視覺正常、
   * 手動點擊真的能送出成功——`findSubmitAncestor()` 用 `ownText()` 抓
   * 這顆按鈕的文字（連同放大範圍、濾掉隱藏元素之後的候選清單）卻完全
   * 抓不到「儲存」兩個字。文字比對這條路線走到底了：最可能的解釋是這個
   * 「儲存」字樣根本不是一般的 DOM 文字節點（可能是圖示字型、CSS
   * `content` 偽元素、或類似做法），純文字比對天生就看不到。改用已經
   * 有直接視覺證據的線索——這顆按鈕本人這輪、先前所有截圖裡都是同一種
   * 醒目的橘色——跟本檔案已經驗證過的「紅字掃描」（用 `getComputedStyle`
   * 判斷顏色，不用猜確切 class 名稱）同一招，這次改成找背景是橘色的
   * 可見按鈕型元素，當文字比對找不到時的備援。
   *
   * 🔴🔴🔴🔴 2026-09-29 本人重試：`usedColorFallback:true`（顏色找法真的
   * 有比對到、真的點了），但畫面依然卡住沒跳轉、跟修好之前一模一樣。
   * 代表顏色比對本身不夠精準——同一頁候選清單裡本來就還有別的橘色系
   * 按鈕（例如照片區塊的「設為格局圖」「全部移除」、聯絡資訊的電話號碼
   * 按鈕），這次抓到的極可能是「畫面上第一個符合橘色的按鈕」而不是真正
   * 的「儲存」，原本用 `for...return`（找到第一個就回傳）在候選只有一個
   * 時剛好矇對，候選變多就失準。真正的「儲存」是整個表單最後的送出
   * 動作，改成收集所有符合顏色的候選、取**最後一個**（文件順序最晚
   * 出現的），比「拿第一個」更貼近「送出按鈕在表單最下面」這個已知的
   * 版面事實。
   */
  function findSubmitByColor(root) {
    const all = root.querySelectorAll("button, a, input[type='submit'], input[type='button']");
    let last = null;
    for (const el of all) {
      if (!visible(el)) continue;
      const c = getComputedStyle(el).backgroundColor;
      const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m && +m[1] > 200 && +m[2] > 80 && +m[2] < 180 && +m[3] < 100) last = el;
    }
    return last;
  }

  /**
   * 🔴 2026-09-29 輪詢 5 秒還是找不到「儲存」按鈕（排除純粹是時機問題），
   * 但不知道這次畫面上實際長怎樣——跟 closeListing.js 當初找「確認送出」
   * 反覆猜文字踩過的坑一樣，這次不繼續猜按鈕文字可能變成什麼，直接把
   * 找不到時畫面上所有看起來像可點擊元素的候選文字都倒出來，照抄
   * closeListing.js 的 `collectClickableTexts()` 同一套做法。
   *
   * 🔴🔴 第一版含「隱藏」元素、取字串結尾 800 字，本人重試撈到的整段
   * 全是網站共用頁首／頁尾連結（登出、網站地圖、Line找客服……）跟一個
   * 日期選擇器元件，一個「儲存」都沒看到——這些頁首頁尾連結全部標著
   * 隱藏，`findSubmitAncestor()` 本來就要求元素可見才會比對，隱藏元素
   * 對這次診斷沒有意義，卻佔掉大部分篇幅把真正有用的內容擠出截斷範圍。
   * 改成只列可見元素（跟 `findSubmitAncestor()` 篩選條件一致），雜訊
   * 濾掉之後才看得到表單本身实际有的內容。
   */
  function collectClickableTexts(root) {
    const els = [...root.querySelectorAll("button, a, span, div, label, input")];
    const texts = els
      .filter(visible)
      .map((e) => {
        const own = e.tagName === "INPUT" ? String(e.value || "").trim() : ownText(e);
        return own ? `<${e.tagName.toLowerCase()}>${own}` : null;
      })
      .filter((t) => t && t.length <= 60);
    return [...new Set(texts)].join(" | ").slice(-1500);
  }

  async function until(fn, timeout = 8000, step = 150) {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > timeout) return null;
      await sleep(step);
    }
  }

  function setText(name, value) {
    const el = allByName(name).find(visible) || byName(name);
    if (!el) return false;
    el.focus();
    el.value = value == null ? "" : String(value);
    fire(el, ["input", "change", "blur"]);
    return true;
  }

  async function setSelect(name, candidates, timeout = 5000) {
    const el = byName(name);
    if (!el || el.tagName !== "SELECT") return false;
    const wants = [].concat(candidates).filter(Boolean);
    if (!wants.length) return false;
    const find = () => {
      const opts = [...el.options];
      for (const w of wants) {
        const o = opts.find((x) => x.text.trim() === w) || opts.find((x) => x.text.trim().includes(w));
        if (o) return o;
      }
      return null;
    };
    const o = await until(find, timeout);
    if (!o) return false;
    el.value = o.value;
    fire(el, ["change"]);
    return true;
  }

  function clickRadio(name, labelText) {
    const rs = allByName(name).filter((i) => i.type === "radio");
    const r = rs.find((i) => labelOf(i) === labelText) || rs.find((i) => labelOf(i).startsWith(labelText));
    if (!r) return false;
    if (!r.checked) r.click();
    return true;
  }

  function setCheck(name, labelText, want) {
    const boxes = allByName(name).filter((i) => i.type === "checkbox");
    const b = labelText ? boxes.find((i) => labelOf(i) === labelText) || boxes.find((i) => labelOf(i).startsWith(labelText)) : boxes[0];
    if (!b) return false;
    if (b.checked !== want) b.click();
    return true;
  }

  /**
   * 🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-27 本人真帳號實測抓到的紅字：「基本
   * 資料、物件照片、特色描述文案的合法完整著作」，看起來是「本人保證以上內容
   * 合法完整著作權」這類必勾確認框，`setCheck()` 需要知道確切的 `name` 屬性，
   * 但這個欄位還沒 inspect 過。本人明講「這個重新上架的前提是我之前已經發布的
   * 文章都已經檢查過、確認沒有問題」「我務必要做到可以全自動發送，這個步驟
   * 不需要留給人工把關」——不是每次自動化都要跳過人工確認，是這個特定情境
   * （重刊本人自己已經審過的內容）本人拍板不需要。不用等紅字提示才被動反應，
   * 改成填表當下主動找「標籤文字含這幾個關鍵字」的 checkbox 直接勾起來，跟
   * 找按鈕那次「不能只用文字比對」的教訓一樣，用關鍵字模糊比對而不是要求
   * 標籤文字完全相等（不知道樂屋的確切用字，例如可能是「合法完整著作權」
   * 或「著作權完整合法」之類的排列）。
   */
  function checkAllConfirmBoxesByKeyword(keywords) {
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
    const hits = [];
    for (const b of boxes) {
      const label = labelOf(b) || txt(b.closest("div, li, p") || b.parentElement);
      if (keywords.some((k) => label.includes(k)) && !b.checked) {
        b.click();
        hits.push(label.slice(0, 60));
      }
    }
    return hits;
  }

  /**
   * 🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-27 本人親自盯著分頁看，抓到真正
   * 卡住送出的是「補充資訊」的「隔間材質」下拉選單——樂屋有、591 沒有對應
   * 欄位，591-extension 那套對映天生不會涵蓋。本人講得更完整：「你就是要
   * 複製我之前所有的資訊照片，如果一模一樣的話，一定是沒有問題，因為用
   * 物件上架助手刊登新物件之後，我也是有手動修改、補充一些東西」——不是
   * 只有描述、封面貼圖兩處可能被手動調整過，整張表單都有可能。這支函式
   * 把 captureListing.js 存下來的表單欄位快照，整批套用在上面結構性填表
   * 結束之後——結構性欄位（地址/坪數/格局……）繼續用型錄資料算沒有問題，
   * 這批只補「結構性填表沒處理到、或本人手動調整過」的欄位，用 name 屬性
   * 精準比對，不用逐一欄位猜測。單一欄位套用失敗不影響其他欄位。
   */
  /** 找出 info（文字優先，比對不到才退回比對 value）對應到 el 目前選項裡的哪一個 */
  function matchCapturedOption(el, info) {
    const opts = [...el.options];
    if (info.text) {
      const byText = opts.find((o) => o.text.trim() === info.text) || opts.find((o) => o.text.trim().includes(info.text));
      if (byText) return byText;
    }
    return opts.find((o) => o.value === info.value) || null;
  }

  async function applyCapturedFormFields(fields) {
    if (!fields) return { applied: 0, failed: 0 };
    let applied = 0, failed = 0;
    const appliedSelects = []; // 🔴 給下面的「設完再回頭驗證」用，記下這次真的設成功的 select 欄位
    const appliedTexts = []; // 🔴 同上，文字欄位也要回頭補一次，見下方說明
    const appliedRadios = []; // 🔴 同上，單選鈕（例如「是社區大樓」）也要回頭補一次，見下方說明
    for (const [name, info] of Object.entries(fields)) {
      try {
        if (info.type === "radio") {
          const group = allByName(name).filter((i) => i.type === "radio");
          const target = group.find((i) => i.value === info.value);
          if (target) {
            if (!target.checked) target.click();
            applied++;
            appliedRadios.push({ name, info });
          } else failed++;
        } else if (info.type === "checkbox-group") {
          const group = allByName(name).filter((i) => i.type === "checkbox");
          if (group.length) {
            for (const i of group) {
              const want = info.values.includes(i.value);
              if (i.checked !== want) i.click();
            }
            applied++;
          } else failed++;
        } else if (info.type === "checkbox") {
          const el = byName(name);
          if (el) { if (el.checked !== info.checked) el.click(); applied++; } else failed++;
        } else if (info.type === "select") {
          /**
           * 🔴🔴🔴 2026-09-28 本人真帳號實測抓到：街道／社區這類串接下拉，
           * 選項是等上一層選完才動態長出來的——第一版改成等目標選項出現
           * 才設值，本人重試還是卡在同樣的紅字，改成比對「看得到的文字」
           * 而不是比對 `.value`（這個網站下拉選單的內部 value 不是穩定值）
           * 也還是失敗，但這次擷取端證實真的抓到正確文字「大同街」，
           * 套用當下 `matchCapturedOption()` 也真的找到並設定成功——問題
           * 是設完之後畫面最後還是變回「請選擇」。懷疑這個網站「上層改變
           * →清空下層→重新產生下層選項」這三步不是同一時間完成，我設值
           * 的當下抓到選項剛長出來的瞬間、設定成功，但頁面自己的「清空」
           * 動作比預期晚到，把剛設好的值又清掉了。設完不能就當作結束，
           * 記下這個欄位，最後統一等一下再回頭驗證一次有沒有被清空。
           */
          const el = byName(name);
          if (el && el.tagName === "SELECT") {
            const found = await until(() => matchCapturedOption(el, info), 6000);
            if (found) {
              el.value = found.value;
              fire(el, ["change"]);
              applied++;
              appliedSelects.push({ name, info });
            } else failed++;
          } else failed++;
        } else if (info.type === "text") {
          const el = byName(name);
          if (el) {
            el.value = info.value;
            fire(el, ["input", "change", "blur"]);
            applied++;
            appliedTexts.push({ name, info });
          } else failed++;
        }
      } catch {
        failed++;
      }
    }

    if (appliedSelects.length || appliedTexts.length || appliedRadios.length) {
      await sleep(1500);
      for (const { name, info } of appliedSelects) {
        const el = byName(name);
        if (!el || el.tagName !== "SELECT") continue;
        const stillWant = matchCapturedOption(el, info);
        if (stillWant && el.value !== stillWant.value) {
          el.value = stillWant.value;
          fire(el, ["change"]);
        }
      }
      /**
       * 🔴 2026-09-28 本人這輪重測街道／社區都修好了，但門牌號碼不見了
       * ——跟街道／社區同一種病灶：門牌（`addr_num`）、巷（`addr_lane`）、
       * 弄（`addr_alley`）這幾個文字欄位是街道的「下游」，街道的 select
       * 重新設值＋重新觸發 change（不管是主迴圈第一次設，還是上面這段
       * 回頭重新驗證再設一次）都有可能讓樂屋自己的串接邏輯把這些下游
       * 文字欄位也一併延遲清空，而文字欄位這條路徑完全沒有回頭檢查——
       * 設完當下不管有沒有真的留住都直接算 applied，跟 select 一開始
       * 的病灶一模一樣。不特別去猜「哪些欄位是街道的下游」，乾脆對所有
       * 套用成功過的文字欄位在這裡統一補設一次值——這個動作是幂等的
       * （值本來就對的話再設一次沒有副作用），成本很低，可以保險涵蓋
       * 目前已知（門牌／巷／弄）跟還沒踩到的其他下游欄位。
       */
      for (const { name, info } of appliedTexts) {
        const el = byName(name);
        if (el && el.value !== info.value) {
          el.value = info.value;
          fire(el, ["input", "change", "blur"]);
        }
      }
      /**
       * 🔴 2026-09-28 本人截圖抓到第三個受害者：「社區大樓」下拉選單裡
       * 「九川木目心」已經是對的值，但上面「是社區大樓/建案」那顆單選鈕
       * 沒被勾選，紅字「社區大樓為必填選項，請選擇」——跟門牌號碼同一種
       * 病灶（設完之後被某個更晚發生的變更事件延遲重置），只是這次受害
       * 的是單選鈕不是文字欄位。不特別去確認是哪個欄位的 change 觸發了
       * 重置，直接對所有套用成功過的單選鈕在這裡統一補勾一次——`target.
       * checked` 已經是對的就不會誤觸發多餘的 click（既有邏輯本來就有
       * `if (!target.checked)` 判斷，幂等安全）。
       */
      for (const { name, info } of appliedRadios) {
        const group = allByName(name).filter((i) => i.type === "radio");
        const target = group.find((i) => i.value === info.value);
        if (target && !target.checked) target.click();
      }
    }

    return { applied, failed };
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function setSummernote(text, html) {
    const ed = document.querySelector(".note-editable");
    if (!ed) return false;
    ed.focus();
    ed.innerHTML = html || String(text || "").split("\n").map((l) => `<p>${esc(l) || "<br>"}</p>`).join("");
    fire(ed, ["input", "keyup", "change", "blur"]);
    return true;
  }

  /** 圖片跨網域，頁面自己抓不到——請 background 抓（跟 fillRakuya.js 的 bg("listing:fetch-image") 同一招） */
  function bg(type, extra) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...(extra || {}) }, (r) =>
          resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r || { ok: false, error: "背景程式沒回應" }),
        );
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  /**
   * 🔴🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-27 本人追問「封面有貼圖」的問題之後新增：第一張
   * 照片如果是快照存的 data URL（本人送出當下真正上傳的那個檔案，含封面貼圖），
   * 不用再跑跨網域抓圖那一套，直接解碼；其餘照片還是型錄網址，照舊用
   * background 代抓（houseol.com.tw 圖片跨網域抓不到，見 bg() 的用途）。
   */
  function bytesFromBase64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    return bytes;
  }

  async function uploadPhotos(urls, inputName) {
    const input = byName(inputName);
    if (!input) return { done: 0, failed: urls.length, reason: "找不到上傳框" };
    let done = 0, failed = 0;
    const batch = input.multiple ? 5 : 1;
    for (let i = 0; i < urls.length; i += batch) {
      const chunk = urls.slice(i, i + batch);
      const dt = new DataTransfer();
      for (const [j, u] of chunk.entries()) {
        let bytes, type;
        const dataMatch = /^data:([^;]+);base64,(.*)$/s.exec(u);
        if (dataMatch) {
          type = dataMatch[1];
          bytes = bytesFromBase64(dataMatch[2]);
        } else {
          const r = await bg("rr:fetch-image", { url: u });
          if (!r.ok) { failed++; continue; }
          type = r.type;
          bytes = bytesFromBase64(r.b64);
        }
        const ext = /png/i.test(type) ? "png" : /webp/i.test(type) ? "webp" : "jpg";
        dt.items.add(new File([bytes], `${String(i + j + 1).padStart(2, "0")}.${ext}`, { type }));
        done++;
      }
      if (dt.files.length) {
        const fresh = byName(inputName) || input;
        fresh.files = dt.files;
        fire(fresh, ["change"]);
        await sleep(2500);
      }
    }
    return { done, failed };
  }

  window.__rrCreateListing__ = async function (p) {
    try {
      const r = p.rakuya || {};
      const a = p.addr || {};
      const A = p.area || {};
      const L = p.layout || {};
      const f = p.floor || {};
      const R = p.rent || {};
      const X = r.rent || {};

      const ok = await until(() => byName("usecode") && byName("city"), 15000);
      if (!ok) return { ok: false, error: "等不到樂屋表單（還沒登入樂屋？或版面改了？）" };

      /* 1. 類型三連選 */
      await setSelect("selectPropertyUsecode", r.legal);
      await sleep(400);
      await setSelect("usecode", r.usecode);
      await sleep(600);
      await setSelect("typecode", r.typecode, 6000);
      await until(() => byName("surfloors") && visible(byName("surfloors")), 6000);
      await sleep(400);

      /* 2. 名稱＋地址＋社區 */
      setText("hname", r.title25 || p.title || "");
      await setSelect("city", a.city);
      await sleep(600);
      await setSelect("zipcode", a.town, 6000);
      await sleep(800);
      if (a.road) await setSelect("addr_road", [a.road], 8000);
      setText("addr_lane", a.lane || "");
      setText("addr_alley", a.alley || "");
      setText("addr_num", a.no ? `${a.no}${a.sub ? `之${a.sub}` : ""}` : "");
      clickRadio("is_community", r.isCommunity ? "是社區" : "非社區");
      if (r.isCommunity && p.community) {
        await sleep(900);
        const done = await setSelect("community", p.community, 3000);
        if (!done) setText("community_new", p.community);
      }

      /* 3. 樓層／格局／屋齡／朝向／電梯／車位／坪數（只做出租分支） */
      clickRadio("floors_type", r.floorsType || "單層");
      await sleep(300);
      if (r.floorsType === "多層") {
        setText("floors_max", r.floorsMax ?? f.total ?? "");
      } else if (has(f.sell)) {
        setText("floors", f.sell);
      }
      setText("surfloors", f.total ?? "");
      if (has(L.room)) await setSelect("bedrooms", String(L.room));
      if (has(L.hall)) await setSelect("livingrooms", String(L.hall));
      if (has(L.bath)) await setSelect("bathrooms", String(L.bath));
      if (has(r.ageYears)) setText("findate", r.ageYears);
      else setCheck("findateUnknow", null, true);
      if (p.facing) await setSelect("direction", p.facing);
      const liftWant = /電梯大廈|華廈/.test(r.typecode || "") ? "有" : "無";
      const liftEl = byName("lifts");
      if (liftEl && liftEl.tagName === "SELECT") await setSelect("lifts", liftWant);
      else clickRadio("lifts", liftWant);
      clickRadio("parkings", r.parkStatus === "無車位" ? "無車位" : "自有");
      setText("mainsize", R.usePing ?? A.main ?? "");
      if (has(A.land)) setText("basesize", A.land);
      await setSelect("manage", r.manage || "無");
      await sleep(300);
      if (has(r.manageFee)) setText("securityfee", r.manageFee);

      /* 4. 租住條件 */
      setText("rental", R.monthly ?? "");
      for (const x of X.includes || []) setCheck("rental_include[]", x, true);
      await setSelect("deposit_m", X.depositSel || "2個月租金");
      clickRadio("property_right", X.propertyRight || "有");
      clickRadio("short_rent", X.shortRent || "不可");
      setCheck("is_immigrate_anytime", null, X.anytime !== false);
      clickRadio("cook", X.cook || "可");
      clickRadio("pet", X.pet || "不可");
      clickRadio("sex", X.sex || "不限");
      clickRadio("ridentity", X.identity || "不限");
      clickRadio("landlord", X.landlord || "不與房東同住");

      /* 5. 描述、周圍環境（catalogUrl 這時候已經在 descHtml 最後一行的下一行，
            由快照存的時候處理好，見 [[project_樂屋出租循環刊登]] 拍板） */
      if (p.desc) setSummernote(p.desc, p.descHtml);
      const env = r.env || {};
      for (const k of ["elementary", "market", "park", "transport", "mrt", "vital_function"]) {
        if (env[k]) setText(k, env[k]);
      }

      /* 6. 聯絡人 */
      clickRadio("isOwnerContact", "自行填寫");
      await sleep(400);
      if (r.contactName) setText("contact_name", r.contactName);
      if (r.tel2) setText("tel2", r.tel2);
      if (r.email) setText("email", r.email);

      /* 7. 照片 */
      let photoResult = { done: 0, failed: 0 };
      if (p.photos && p.photos.length) {
        photoResult = await uploadPhotos(p.photos.slice(0, 25), "surface_image_input");
      }

      /**
       * 8. 內容合法性確認框：本人明講這批重刊的內容（基本資料／照片／描述）全部
       *    是本人自己原本就審過、發布過的舊內容，這個確認框不需要每次重刊都留給
       *    人工——本人拍板「這個步驟不需要留給人工把關」，直接自動勾起來。
       */
      const confirmedBoxes = checkAllConfirmBoxesByKeyword(["著作", "合法", "保證"]);

      /**
       * 9. 本人送出當下真正的表單欄位快照——整批套用在結構性填表結果之上，
       *    補上「隔間材質」這種結構性欄位對映沒涵蓋、本人平常都是手動填的欄位。
       */
      await sleep(300);
      const capturedFieldsResult = await applyCapturedFormFields(p.capturedFormFields);

      /**
       * 🔴🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-27 本人真帳號實測：欄位對映修好之後第一次真的
       * 點到「儲存」，但停在表單頁沒有跳轉，紅字「隔間材質」必填卻是空的——這個
       * 欄位樂屋有、591 沒有對應的格子，591-extension 搬過來的欄位對映裡完全沒有
       * 涵蓋，不知道還有沒有其他類似的樂屋專屬必填欄位本人還沒遇到。與其送出去
       * 才讓本人一個一個截圖抓紅字，改成送出前先掃一次頁面上所有標了 `required`
       * 的欄位，空的話直接列出名稱回報、不要浪費時間點下去等一個注定失敗的送出——
       * 下次除錯紀錄會直接列出還缺哪些欄位，不用再一次只能抓到一個。
       */
      function scanEmptyRequired() {
        const els = [...document.querySelectorAll("input[required], select[required], textarea[required]")];
        const seenRadioGroups = new Set();
        return els
          .filter((e) => {
            if (e.type === "radio") {
              if (seenRadioGroups.has(e.name)) return false;
              seenRadioGroups.add(e.name);
              return ![...document.querySelectorAll(`input[name="${e.name}"]`)].some((g) => g.checked);
            }
            if (e.type === "checkbox") return !e.checked;
            return !String(e.value || "").trim();
          })
          .map((e) => `${e.tagName.toLowerCase()}[name=${e.name || e.id || "(沒有name/id)"}]${labelOf(e) ? `「${labelOf(e)}」` : ""}`);
      }

      /* 跟 fillRakuya.js 最大的不同：這裡真的送出。送出前小睡一下讓 Summernote／
            cascading 下拉最後的 change 事件跑完。
            2026-09-27 本人截圖實測確認：真正的送出按鈕文字是「儲存」不是「上架」，
            按下去會整個跳轉到不同網域（member.rakuya.com.tw → my.rakuya.com.tw），
            這支腳本自己的執行環境會被導航直接砍斷——所以點下去之後**不等、不讀
            location.href**，能撐過跳轉活著把 {ok:true} 回傳出去就算數；background.js
            改成用 chrome.tabs.onUpdated 在外面等這個分頁真的跳到成功頁，不是靠這支
            自己讀網址（那個時候這支很可能已經被砍斷，讀不到、也回不了）。 */
      await sleep(1000);
      const emptyRequired = scanEmptyRequired();
      if (emptyRequired.length) return { ok: false, error: "送出前檢查：還有必填欄位是空的，沒有點送出", emptyRequired, confirmedBoxes, capturedFieldsResult, photoResult };
      /**
       * 🔴 2026-09-29 本人連續兩輪撞到「填完了，但找不到「儲存」按鈕」——
       * 上一輪明明才用 `ownText()` 修法成功找到同一顆按鈕，這次卻完全
       * 找不到，原本這裡是只檢查一次就下定論，沒有給按鈕時間出現／變成
       * 可見。改用既有的 `until()` 輪詢，跟表單填寫那段的既有做法一致
       * ——不管是按鈕本身晚一點才渲染出來、還是暫時被別的東西擋住變成
       * 不可見，多等一下比只看一次更穩。
       */
      let submitBtn = await until(() => findSubmitAncestor(document.body), 5000);
      /**
       * 🔴🔴🔴 2026-09-29 本人確認橘色「儲存」按鈕視覺正常、手動點擊能
       * 送出成功，但放大範圍＋濾掉隱藏元素之後的候選清單依然完全沒有
       * 「儲存」兩個字——文字比對這條路線确定走不通，不是時機或範圍
       * 問題。文字找不到才退回用顏色找（見 `findSubmitByColor()`），
       * 兩種找法都失敗才真的算找不到。
       */
      let usedColorFallback = false;
      let colorMatchDebug = "";
      if (!submitBtn) {
        submitBtn = await until(() => findSubmitByColor(document.body), 3000);
        usedColorFallback = !!submitBtn;
        /**
         * 🔴 2026-09-29 「取最後一個」是不是真的對症下藥不能只憑猜，把
         * 這次顏色找法實際點中的元素長什麼樣子（標籤、自己的文字、在
         * 畫面上的座標）記下來——下次不管成功還是失敗，都能直接對照這
         * 個元素是不是真的「儲存」，不用再靠結果反推。
         */
        if (submitBtn) {
          const r = submitBtn.getBoundingClientRect();
          colorMatchDebug = `<${submitBtn.tagName.toLowerCase()}>own="${ownText(submitBtn)}" value="${submitBtn.value || ""}" 位置=(${Math.round(r.left)},${Math.round(r.top)})`;
        }
      }
      if (!submitBtn) {
        return {
          ok: false,
          error: `填完了，但找不到「儲存」按鈕，沒有送出，畫面目前看到的候選文字：${collectClickableTexts(document.body)}`,
          confirmedBoxes,
          capturedFieldsResult,
          photoResult,
        };
      }
      submitBtn.click();

      /**
       * 🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-27 本人真帳號實測：`scanEmptyRequired()`
       * 只認 HTML `required` 屬性，這次真的點了送出、`emptyRequired` 也是空的（代表
       * 沒抓到任何 required 屬性的空欄位），但還是等不到成功頁——代表這個網站的
       * 「總樓層」「隔間材質」這類紅字驗證根本不是靠 `required` 屬性擋的，是自己
       * 寫的 JS 驗證（畫面上顯示紅字，但 DOM 屬性上完全看不出來）。與其再猜一種
       * HTML 屬性，改成點下去後等一下、看網址還在不在原頁面——如果沒跳轉，直接
       * 掃描畫面上看起來像紅字錯誤訊息的短文字（用文字顏色是不是偏紅判斷，不用
       * 猜確切的 class 名稱），這樣不管樂屋用什麼機制擋，只要畫面上顯示紅字就
       * 抓得到，不用每種驗證機制各寫一套。
       *
       * 🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-27 第一版掃出一大串「住家用／商業用／
       * 一般事務所……」這種看起來像下拉選單選項的雜訊——沒檢查元素是不是真的顯示
       * 在畫面上，撈到了隱藏的 `<select>` 裡面的 `<option>`（原生 option 文字顏色
       * 有時候會繼承到奇怪的紅色，但整組隱藏著，本人根本看不到）。但也撈到一句
       * 真正有意義的：「基本資料、物件照片、特色描述文案的合法完整著作」——這句
       * 被 60 字上限切斷，看起來像是某個「本人保證以上內容合法完整著作權」之類
       * 的必勾確認文字，createListing.js 完全沒有勾這個欄位。改法：①用
       * `offsetParent !== null` 濾掉隱藏元素，不會再撈到看不見的下拉選項
       * ②長度上限放寬到 200 字，完整句子不要被切斷。
       */
      /**
       * 🔴 2026-09-28 換第二筆物件測試，社區/門牌/標題等已知欄位問題都
       * 修好之後，這次紅字乾脆完全消失（連前一輪的「物件名稱已被使用」
       * 都不見了，猜測是這輪關閉步驟這次真的把舊物件清掉了），但畫面
       * 還是卡住沒跳轉——目前能找到的欄位層級問題都已經排除，剩下最
       * 可能的解釋是固定等 2 秒本來就不夠：本人送出當下常常要等系統
       * 跑完驗證/查重才會真的跳轉，改成用既有的 until() 輪詢，最多等
       * 8 秒、只要提早跳轉就提早結束，不用每次都乾等滿整段時間。
       */
      await until(() => location.pathname !== "/rent/post/add", 8000);
      if (location.pathname === "/rent/post/add") {
        const leafTexts = (filterFn) =>
          [...document.querySelectorAll("div,span,p,label,li,button,a")]
            .filter((e) => {
              if (e.children.length > 0) return false;
              if (e.offsetParent === null) return false;
              const t = (e.textContent || "").trim();
              if (!t || t.length > 200) return false;
              return filterFn(e, t);
            })
            .map((e) => e.textContent.trim());
        const redTexts = [
          ...new Set(
            leafTexts((e) => {
              const c = getComputedStyle(e).color;
              const m = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
              return m && +m[1] > 140 && +m[2] < 100 && +m[3] < 100;
            }),
          ),
        ];
        let error;
        if (redTexts.length) {
          error = `按了送出，但還停在原頁面，畫面上看到的紅字錯誤訊息：${redTexts.join("；")}`;
        } else {
          /**
           * 🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴 2026-09-27 本人連續三次真帳號實測，
           * 紅字掃描（含濾掉隱藏元素之後）連續都是空的，但頁面確定卡住沒有
           * 跳轉——顏色偵測這個方向已經碰到極限，可能根本不是紅字（例如是
           * 彈出視窗、圖示式警告、或別的顏色）。不要再繼續猜「應該用什麼
           * 顏色/什麼屬性找」，改成最原始的做法：把畫面上目前所有短文字
           * （不篩顏色，只濾掉看不到的元素跟長文字容器）整段倒出來，長度
           * 受除錯紀錄訊息上限限制沒辦法全部給，但至少能看到頁面現在真正
           * 停在什麼狀態、有沒有看起來眼熟的線索，比繼續猜哪種篩選條件
           * 更直接。
           */
          const allShort = [...new Set(leafTexts(() => true))].join(" | ").slice(0, 600);
          error = `按了送出，還停在原頁面，沒找到紅字，改列出畫面目前所有短文字供本人／我自己判讀：${allShort}`;
        }
        return { ok: false, error, confirmedBoxes, capturedFieldsResult, photoResult, nativeConfirmSeen, usedColorFallback, colorMatchDebug };
      }

      return { ok: true, confirmedBoxes, capturedFieldsResult, photoResult, nativeConfirmSeen, usedColorFallback, colorMatchDebug };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  };
})();
