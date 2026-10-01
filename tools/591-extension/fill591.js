/**
 * 在 591 刊登頁（user.591.com.tw/post/*）裡跑的填表程式。
 *
 * 進場：操作頁按「上架」→ background 存資料包、開這個分頁 → 這支向 background 要資料（listing:get）
 *       → 一格一格填 → 填完清掉（listing:clear，重新整理就不會再填）。
 * 沒有資料包（使用者自己開的 591 頁）→ 什麼都不做。
 *
 * 🔴 永遠不按「保存資料，下一步」與「立即支付」—— 那兩顆是使用者自己按的。
 * 🔴 不抓 591 任何資料、不送任何東西到別的地方。
 *
 * 591 的表單是 Vue 3 + Ant Design Vue（2026-09 整理）：
 *   - 第②頁一進來先跳「請選擇你想要刊登物件的所屬縣市」彈窗
 *   - 地址用「填寫完整地址」快速框＋「匯入地址」最穩：會選好縣市／鄉鎮／街道並填「號」，但不填「樓」
 *   - 沒有快速框的版面：縣市／鄉鎮是一般下拉；街道是自訂面板（打字 → 按放大鏡 → 點清單）
 *   - 標籤在 .ant-form-item-label，常帶尾巴「(說明)」，所以先整格比對再用「開頭符合」退路
 *   - 文字欄 input.ant-input／數字欄 .ant-input-number-input：用原型的 value setter 設值再發 input＋change，Vue 才收得到
 *   - 單選／勾選要點 label.ant-radio-wrapper／label.ant-checkbox-wrapper
 *   - 下拉 .ant-select 的選項清單在 body 底下，要用 input[role=combobox] 的 aria-controls 找到自己那份
 *   - 現況特色描述是 ProseMirror；照片是第一個 input[type=file][multiple]
 *
 * ⚠️ Chrome 會把放到背景的分頁計時器凍住，填到一半切走分頁會像卡住；點回來等它跑完就好。
 *
 * 591 改版時：先改下面 T（標籤文字）；結構變了再改對應的函式。面板會逐格報「沒找到」，照面板回報就知道壞在哪。
 */
(() => {
  "use strict";
  if (!/^\/post\//.test(location.pathname)) return;

  /* ───────── 591 表單上的文字（改版時改這裡） ───────── */
  const T = {
    cityModal: /所屬縣市/,
    addr: ["門牌地址", "出售地址", "出租地址"],
    quickAddrPlaceholder: /完整地址/,
    importBtn: "匯入地址",
    hideNo: "隱藏門號",
    totalFloor: { sale: "出售總樓層", rent: "出租總樓層" },
    community: "社區名稱",
    layout: "格局",
    done: "建築完工時間",
    doneBuilt: "成屋",
    doneUnknown: ["屋齡不詳", "預售屋"],
    facing: "朝向",
    regPing: "權狀坪數",
    areaIncl: ["含車位面積", "不含車位面積"],
    parkPing: "車位面積",
    main: "主建物",
    att: "附屬建物",
    pub: "共有部分",
    land: "土地坪數",
    price: "售價",
    priceIncl: ["含車位價格", "不含車位價格"],
    down: "自備款",
    fee: "管理費",
    floorPlan: "格局圖",
    lease: "帶租約",
    deco: "裝潢程度",
    title: "廣告標題",
    contact: "聯絡人",
    contract: "委託書",
    serviceFee: "服務費",
    serviceFeeYes: "收取服務費",
    serviceFeeNo: "不須服務費",
    agencyOk: ["我已閲讀並確認經紀業資料無誤", "我已閱讀並確認經紀業資料無誤", "我已閲讀", "我已閱讀"],
    /* 出租 */
    elevator: "電梯",
    usePing: "可使用坪數",
    park: "車位",
    decoTime: "裝潢時間",
    minTerm: "最短租期",
    moveIn: "可遷入日",
    moveInAny: "隨時可遷入",
    identity: "身份要求",
    identityAll: ["學生", "上班族", "家庭"],
    cook: "開伙",
    pets: "養寵物",
    rent: "租金",
    deposit: "押金",
    includes: "租金包含",
    water: "水費",
    power: "電費",
    ownership: "產權登記",
  };
  const NUM = ".ant-input-number-input";
  const TXT = "input.ant-input";
  const ANY = `${NUM}, ${TXT}`;
  const SEL = ".ant-select";
  const RADIO = "label.ant-radio-wrapper";
  const CHECK = "label.ant-checkbox-wrapper";

  /* ───────── 小工具 ───────── */
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const text = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const visible = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, timeout = 8000, step = 150) {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > timeout) return null;
      await sleep(step);
    }
  }
  const bg = (type, extra) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...(extra || {}) }, (r) =>
          resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r || { ok: false, error: "背景程式沒回應" }),
        );
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  const has = (v) => v !== null && v !== undefined && v !== "";

  /* ───────── 進度面板 ───────── */
  let panel, logList, missBox;
  function ensurePanel() {
    if (panel) return;
    panel = document.createElement("div");
    panel.id = "listing-panel";
    /* 標題帶版本號：2026-09-12 曾經因為外掛沒重載成功、看著舊版的面板 debug 新版程式，白繞一圈。看標題就知道跑的是哪一版 */
    let ver = "";
    try {
      ver = " v" + chrome.runtime.getManifest().version;
    } catch {
      /* 測試環境沒有 getManifest */
    }
    panel.innerHTML = `<h4><span>物件上架助手${ver}</span><button type="button" id="listing-panel-close">關閉</button></h4><ul></ul><div class="miss" hidden></div><div class="foot">填完請從上往下核對一遍，再自己按 <b>保存資料，下一步</b>；<b>立即支付</b> 也是你按。</div>`;
    document.body.appendChild(panel);
    logList = panel.querySelector("ul");
    missBox = panel.querySelector(".miss");
    panel.querySelector("#listing-panel-close").onclick = () => panel.remove();
  }
  function log(m, cls = "") {
    ensurePanel();
    const li = document.createElement("li");
    if (cls) li.className = cls;
    li.textContent = m;
    logList.appendChild(li);
    logList.scrollTop = logList.scrollHeight;
  }
  function showMissing(items) {
    ensurePanel();
    missBox.hidden = !items.length;
    if (items.length) missBox.innerHTML = `<b>還要你自己補：</b>${items.map((s) => `<div>• ${s.replace(/[<>&]/g, "")}</div>`).join("")}`;
  }

  /* ───────── 表單操作基本功 ───────── */
  function setValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus();
    setter.call(el, value == null ? "" : String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }
  /**
   * 在下拉的搜尋框「一個字一個字」打：2026-09-11 實測，591 街道那種要打字才出選項的下拉，
   * 一次把整串文字塞進去、只發一個 input 事件不會觸發搜尋（多半是綁在逐字 input／中文組字事件上，
   * 或搜尋本身要打字才會去問伺服器）。改成每打一個字元都設值＋發 input，模擬真人逐字輸入。
   * 只發 input，不 focus/blur —— 打完字要讓下拉繼續開著，跟 setValue（會 blur）不一樣用途。
   */
  async function typeInto(el, value) {
    const v = value == null ? "" : String(value);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    for (let i = 1; i <= v.length; i++) {
      setter.call(el, v.slice(0, i));
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: v[i - 1], inputType: "insertText" }));
      await sleep(40);
    }
  }
  const stripLabel = (s) => s.replace(/\s*\(說明\)|\s*說明$|\s*[:：]$/g, "").trim();

  /** 找標籤元素：先在表單列的標籤格裡整格比對，再「開頭符合」，最後退到任何短文字元素 */
  function findLabel(names) {
    const wants = [].concat(names).filter(Boolean);
    const labels = $$(".ant-form-item-label").filter(visible);
    for (const w of wants) {
      const hit = labels.find((l) => stripLabel(text(l)) === w);
      if (hit) return hit;
    }
    for (const w of wants) {
      const hit = labels.find((l) => stripLabel(text(l)).startsWith(w));
      if (hit) return hit;
    }
    const cands = $$("label, span, div, p, h3, h4").filter((e) => e.children.length <= 2 && visible(e));
    for (const w of wants) {
      const hit = cands.find((e) => text(e) === w);
      if (hit) return hit;
    }
    for (const w of wants) {
      const hit = cands.find((e) => {
        const t = text(e);
        return t.length <= 14 && t.startsWith(w);
      });
      if (hit) return hit;
    }
    return null;
  }
  /**
   * 某個標籤「管的」控制項：先在同一列（.ant-form-item）裡找；那一列沒有就退回「標籤之後（DOM 順序）的前 n 個」。
   * 同一列優先是為了出租表單：「管理費」既是一列的標籤、又是「租金包含」那列的勾選字，只看 DOM 順序會錯位。
   */
  function controls(label, selector, n = 1) {
    const L = label instanceof Element ? label : findLabel(label);
    if (!L) return [];
    const item = L.closest(".ant-form-item");
    if (item) {
      const inside = $$(selector, item);
      if (inside.length) return inside.slice(0, n);
    }
    const out = [];
    for (const el of $$(selector)) {
      if (L.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
        out.push(el);
        if (out.length >= n) break;
      }
    }
    return out;
  }
  /**
   * 樓／樓之：2026-09-11 實測用 DevTools 挖出來的真結構——591 把這兩格拆到跟「巷/號/之」完全不同的
   * .ant-form-item（自己獨立一列，甚至沒有自己的欄位標籤），用「標籤同一列」或「下幾列」猜都猜不對。
   * 改成認 591 自己印在畫面上、文字固定不變的說明文字「(出租樓層0為整棟，-1為地下樓，+1為頂樓加蓋)」
   * （出售版是「出售樓層0為整棟…」）—— 樓／樓之兩個輸入框就在這句話同一個區塊裡，定位比猜結構穩。
   */
  function findFloorInputs() {
    const note = $$("span, div").find((e) => e.children.length === 0 && /樓層\s*0\s*為整棟/.test(text(e)));
    if (!note) return [null, null];
    const box = note.closest(".ant-form-item-control-input-content") || note.closest(".ant-form-item") || note.parentElement;
    const inputs = $$(TXT, box).filter((i) => /^(選填|必填)$/.test(i.placeholder || ""));
    return [inputs[0] || null, inputs[1] || null];
  }
  /** 填數字欄（同一個標籤底下可能好幾格，例如 格局 房/廳/衛、完工 年/月/日）。回填到的格數 */
  function fillNums(label, values) {
    const els = controls(label, NUM, values.length);
    if (!els.length) return 0;
    values.forEach((v, i) => els[i] && setValue(els[i], v == null ? "" : v));
    return els.length;
  }
  /** 填一格（數字欄或文字欄都接）。回 true/false */
  function fillOne(label, value) {
    const el = controls(label, ANY, 1)[0];
    if (!el) return false;
    setValue(el, value == null ? "" : value);
    return true;
  }
  /**
   * 點單選／勾選。label 為 null 就在整頁找（生活機能、隱藏門號那種沒有列標籤的）。
   * want=true 要它選起來、false 要它取消；已經是想要的狀態就不動。
   */
  function choose(label, optionText, want = true) {
    let boxes;
    if (label) {
      const L = findLabel(label);
      if (!L) return false;
      boxes = controls(L, `${RADIO}, ${CHECK}`, 16);
    } else boxes = $$(`${RADIO}, ${CHECK}`);
    const opts = [].concat(optionText);
    let B = null;
    for (const o of opts) {
      B = boxes.find((b) => text(b) === o) || boxes.find((b) => text(b).startsWith(o));
      if (B) break;
    }
    if (!B) return false;
    const checked = B.classList.contains("ant-radio-wrapper-checked") || B.classList.contains("ant-checkbox-wrapper-checked");
    if (checked !== want) B.click();
    return true;
  }
  const visibleDropdowns = () => $$(".ant-select-dropdown").filter((d) => !d.classList.contains("ant-select-dropdown-hidden") && visible(d));
  /**
   * Ant Select：打開 → 找到自己那份清單（aria-controls）→ 找選項（虛擬清單就往下捲）→ 點 → 等選中的字出現。
   * candidates 可給多個候選字，依序找第一個有的。
   */
  async function pickSelect(sel, candidates) {
    if (!sel) return false;
    const wants = [].concat(candidates).filter(Boolean);
    if (!wants.length) return false;
    const current = () => text(sel.querySelector(".ant-select-selection-item"));
    if (wants.includes(current())) return true;
    const selector = sel.querySelector(".ant-select-selector") || sel;
    const combo = sel.querySelector("input[role=combobox]");
    /* 2026-09-12 實測：591 街道那格的搜尋框是 readonly＋opacity:0 —— 根本不是能打字搜尋的框，
       只是 Ant Design 給非搜尋型下拉的無障礙標記，一般下拉（縣市/鄉鎮/街道）幾乎都是這種。 */
    const searchable = !!combo && !combo.readOnly;
    const listId = combo && combo.getAttribute("aria-controls");
    const ownDropdown = () => {
      if (listId) {
        const el = document.getElementById(listId);
        const d = el && el.closest(".ant-select-dropdown");
        return d && visible(d) ? d : null;
      }
      return visibleDropdowns().at(-1) || null;
    };
    selector.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    let dd = await until(ownDropdown, 2500);
    if (!dd) {
      selector.click();
      dd = await until(ownDropdown, 2500);
    }
    if (!dd) return false;
    const name = (o) => o.getAttribute("title") || text(o);
    const findHit = () => {
      const opts = $$(".ant-select-item-option", dd);
      for (const w of wants) {
        const hit = opts.find((o) => name(o) === w) || opts.find((o) => name(o).includes(w));
        if (hit) return hit;
      }
      return null;
    };
    const clickHit = async (hit) => {
      const picked = name(hit);
      hit.scrollIntoView({ block: "nearest" });
      hit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      hit.click();
      const ok = await until(() => current() === picked, 2500);
      if (!ok) document.body.click();
      return !!ok;
    };
    /*
      2026-09-12 實測：街道這種「選了鄉鎮才向伺服器要清單」的下拉，選項不是一開啟就有——
      打開瞬間清單是空的，原本的程式馬上判定「捲到底了、沒有更多」直接放棄，其實只是清單還沒回來。
      改成先耐心等（最多 4 秒）看有沒有出現符合的選項，再進入「清單很長要往下捲」那段。
    */
    let hit = await until(findHit, 4000);
    if (hit) return clickHit(hit);
    const holder = dd.querySelector(".rc-virtual-list-holder");
    for (let i = 0; i < 40 && holder; i++) {
      holder.scrollTop += holder.clientHeight * 0.8;
      holder.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(120);
      hit = findHit();
      if (hit) return clickHit(hit);
      if (holder.scrollTop + holder.clientHeight >= holder.scrollHeight - 2 && i > 3) break;
    }
    /*
      還是找不到才試著打字篩選——但 readonly 的搜尋框（591 一般下拉幾乎都是，縣市/鄉鎮/街道常見）
      打了沒用，跳過；2026-09-11 也試過「一律先打字」，反而讓本來就 render 好選項的下拉選不到
      （猜是照代碼比對不是顯示文字），所以只在框真的能打字搜尋時才試。
    */
    if (searchable) {
      await typeInto(combo, wants[0]);
      hit = await until(findHit, 4000);
      if (hit) return clickHit(hit);
    }
    document.body.click();
    return false;
  }
  /**
   * 街道下拉（沒有「匯入地址」快速框的版面）：點開 → 面板 .ant-dropdown .street → 上面搜尋框打街道名 →
   * 按放大鏡 → 下面 .street-content 只剩符合的 li → 點它。只打字不按放大鏡、或不點 li，都不會選到。
   */
  async function pickStreet(sel, road) {
    if (!sel || !road) return false;
    const current = () => text(sel.querySelector(".ant-select-selection-item"));
    if (current() === road) return true;
    (sel.querySelector(".ant-select-selector") || sel).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    /* 2026-09-12 實測：這個面板是 591 客製的（不是標準 Ant Select 下拉），出現得比一般下拉慢，
       3 秒有時不夠（本人電腦規格不高），拉長一點再放棄。 */
    const box = await until(() => $$(".ant-dropdown .street").find(visible), 5000);
    if (!box) {
      log(`街道「${road}」：沒等到搜尋面板，改當一般下拉試試`, "warn");
      // 這個版面的街道說不定就是一般下拉（591 部分表單類別是這樣，例如商辦）：
      // 上面已經開過一次，先點別處關掉，讓 pickSelect 自己重新開一次，不然二次 mousedown 會把它關掉而不是打開
      document.body.click();
      await sleep(150);
      return pickSelect(sel, [road]);
    }
    const input = box.querySelector(".street-header input");
    const items = () => $$(".street-content li", box).filter(visible);
    /*
      打字進搜尋框 → 按放大鏡。**只發一次搜尋**：原本這裡除了點放大鏡，還多發了一組 Enter 按鍵事件
      當保險（怕放大鏡那顆元素抓不到），但 2026-09-18 比對同業已驗證可用的做法後改掉——他那邊從頭到尾
      只有「改值 → 發 input → 點放大鏡」，沒有 Enter。多發 Enter 等於同一次搜尋按兩次送出，591 若是
      「新的查詢會取消掉前一個」的寫法，兩次擠在一起就可能兩邊都被吃掉、清單回 0 條，反而害到自己。
      放大鏡抓不到時寧可不搜（下面照樣會在現有清單裡找），也不要亂送第二次。
    */
    async function search(term) {
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, term);
      input.dispatchEvent(new Event("input", { bubbles: true })); // 不能 blur，面板會關
      await sleep(200);
      const btn = box.querySelector(".street-header button") || box.querySelector(".street-header .ant-input-group-addon");
      if (btn) btn.click();
      else log(`街道「${road}」：面板裡找不到放大鏡按鈕，只能靠打字後的即時篩選`, "warn");
      await sleep(300);
    }
    let hit = null;
    if (input) {
      await search(road);
      hit = await until(() => items().find((li) => text(li) === road) || null, 3000);
      log(`街道「${road}」：搜尋「${road}」後清單剩 ${items().length} 條${hit ? "，找到了" : ""}`, "warn");
      /*
        2026-09-12 實測：591 的搜尋對「臨港路四段」這種帶「幾段」的路名，搜完整名稱會是 0 條——
        清單裡明明有這條路，用「顯示所有街道」手動翻頁找得到，搜尋卻找不到，猜是搜尋只認路名主體、
        「幾段」要等結果出來才分——所以搜不到、且路名帶「段」時，改搜去掉「幾段」的主體再從結果裡挑完整的。
      */
      if (!hit) {
        const base = road.match(/^(.+?)(?:[一二三四五六七八九十]+|\d+)段$/);
        if (base && base[1] !== road) {
          await search(base[1]);
          hit = await until(() => items().find((li) => text(li) === road) || null, 3000);
          log(`街道「${road}」：改搜路名主體「${base[1]}」後清單剩 ${items().length} 條${hit ? "，找到「" + road + "」了" : "，還是沒有「" + road + "」"}`, "warn");
        }
      }
      if (!hit) hit = items().find((li) => text(li).includes(road)) || null;
    } else {
      log(`街道「${road}」：面板裡找不到搜尋框，直接在目前清單裡找`, "warn");
      hit = items().find((li) => text(li) === road) || items().find((li) => text(li).includes(road)) || null;
    }
    /**
     * 2026-09-16～18 一整段追下來的結論：搜尋框搜不到時，**不要自動點「顯示所有街道」**。
     * 連續 5 個版本、換了 4 種點擊/等待方式（拉長等待、拿掉多餘的 mousedown、點前先清空搜尋框…）
     * 都是**點擊前後 street-content 內容長度一模一樣、完全零變化**，選擇器每次都用 DevTools 核對過
     * 是對的。2026-09-18 再比對同業已驗證可用的 v1.5.3：他那支 `pickStreet` **根本沒有這段**——
     * 搜不到就 `return false` 讓人自己選，跟這裡現在一樣。也就是說「自動翻完整清單」這條路
     * 不是我們沒找到方法，是沒有人做得到，真正該走的是上面 `fillAddress()` 的「匯入地址」快速框
     * （整串地址丟給 591 自己解析，比街道下拉的搜尋耐用）。
     * 🔴 有人再提議自動點「顯示所有街道」之前，先回頭看這段。
     */
    if (!hit) {
      const shown = items().slice(0, 8).map((li) => text(li)).join("、");
      log(`街道「${road}」：搜尋不到（清單目前顯示：${shown || "（空）"}）。麻煩自己點街道欄位、按「顯示所有街道」翻頁選這條路。`, "warn");
      document.body.click();
      return false;
    }
    const picked = text(hit);
    hit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    hit.click();
    return !!(await until(() => current() === picked, 3000));
  }
  /**
   * 現況特色描述（ProseMirror）：全選 → 等一拍（不等的話內容會接在後面而不是取代）→ 貼進去。
   * 沒有 html（固定尾段沒設樣式，多數情況）：跟以前一樣，先試 insertText，不夠再退回發 paste 純文字事件。
   *
   * 有 html（固定尾段設了字級／顏色）：2026-09-15 本人第一次真的測，字級／粗體完全沒套上（純文字貼進去）——
   * 猜是 ProseMirror 認得出「這個 paste 事件是程式發的、不是使用者真的按 Ctrl+V」（合成事件的
   * isTrusted 是 false），選擇性地不處理格式。改用 execCommand("insertHTML")：這是瀏覽器原生指令，
   * 走的是跟真的打字/貼上同一條 DOM 編輯管線（會發真的 beforeinput/input），ProseMirror 監聽 DOM
   * 變化重建文件模型時比較可能吃得住格式。貼完檢查 DOM 裡有沒有留下格式痕跡，沒有才退回發 paste 事件
   * 再試一次（兩種都試，不要只賭一種）。⚠️ insertHTML 這條本人還沒測過，是看到第一次測試結果失敗後的
   * 下一步嘗試，麻煩重新載入外掛再測一次、把畫面截圖回報。
   */
  async function setEditor(plain, html) {
    const pm = document.querySelector("div.ProseMirror[contenteditable=true]");
    if (!pm) return false;
    pm.focus();
    document.execCommand("selectAll", false, null);
    await sleep(150);
    if (html) {
      document.execCommand("insertHTML", false, html);
      await sleep(150);
      if (!/style=|<strong|<b\b|<u\b/i.test(pm.innerHTML)) {
        pm.focus();
        document.execCommand("selectAll", false, null);
        await sleep(150);
        const dt = new DataTransfer();
        dt.setData("text/html", html);
        dt.setData("text/plain", plain);
        pm.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
        await sleep(200);
      }
      return true;
    }
    const ok = document.execCommand("insertText", false, plain);
    await sleep(150);
    if (!ok || text(pm).length < Math.min(20, plain.length)) {
      pm.focus();
      document.execCommand("selectAll", false, null);
      await sleep(150);
      const dt = new DataTransfer();
      dt.setData("text/plain", plain);
      pm.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      await sleep(200);
    }
    return true;
  }
  /**
   * 照片來源可能是遠端網址（愛屋圖檔，要 background 跨網域抓）或 data: URL（2026-09-24 新增：
   * 「封面貼圖」在 app.js 本機合成出來的結果，本機產生的圖不用跨網域、也不用問 background，
   * 直接解碼 base64 段就好）。uploadPhotos()／uploadFloorPlan() 共用這支，不用各自分辨網址種類。
   */
  async function fetchPhotoAsB64(u) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(u);
    if (m) {
      if (!m[2]) return { ok: false, error: "data URL 不是 base64 編碼" }; // 合成一定是 base64，這裡防呆
      return { ok: true, b64: m[3], type: m[1] || "image/jpeg" };
    }
    return bg("listing:fetch-image", { url: u });
  }

  /** 照片：抓回 base64（遠端或本機合成，見 fetchPhotoAsB64）→ File → DataTransfer → 塞進
   *  input[type=file][multiple]。一批 5 張。 */
  async function uploadPhotos(urls, onStep) {
    const first = document.querySelector("input[type=file][multiple]") || document.querySelector("input[type=file]");
    if (!first) return { done: 0, failed: urls.length, reason: "找不到上傳框" };
    let done = 0;
    let failed = 0;
    for (let i = 0; i < urls.length; i += 5) {
      const chunk = urls.slice(i, i + 5);
      const dt = new DataTransfer();
      for (const [j, u] of chunk.entries()) {
        const r = await fetchPhotoAsB64(u);
        if (!r.ok) {
          failed++;
          continue;
        }
        const bin = atob(r.b64);
        const bytes = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
        const ext = /png/i.test(r.type) ? "png" : /webp/i.test(r.type) ? "webp" : "jpg";
        dt.items.add(new File([bytes], `${String(i + j + 1).padStart(2, "0")}.${ext}`, { type: r.type }));
        done++;
      }
      if (dt.files.length) {
        const input = document.querySelector("input[type=file][multiple]") || document.querySelector("input[type=file]") || first;
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        onStep && onStep(done, urls.length);
        await sleep(2500);
      }
    }
    return { done, failed };
  }

  /**
   * 格局圖：591 **出售**有專屬的「格局圖」那一格（限 1 張、不是 multiple），標籤寫「格局圖」；
   * 出租沒有這一格（見 T.floorPlan／runRent 不呼叫這支）。愛屋的 HTML 沒有標記哪張是格局圖，
   * 是 app.js 那邊用「長相」（白底線稿，lib/floorplan.js）猜出來的候選——這支只管「猜到的話
   * 傳到 591 哪一格」，猜得準不準是 app.js／background.js 的事，不是這支的責任。
   */
  async function uploadFloorPlan(url) {
    const label = findLabel(T.floorPlan);
    if (!label) return false;
    const item = label.closest(".ant-form-item");
    const input = (item && item.querySelector("input[type=file]:not([multiple])")) || (item && item.querySelector("input[type=file]"));
    if (!input) return false;
    const r = await fetchPhotoAsB64(url);
    if (!r.ok) return false;
    const bin = atob(r.b64);
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    const ext = /png/i.test(r.type) ? "png" : /webp/i.test(r.type) ? "webp" : "jpg";
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], `floorplan.${ext}`, { type: r.type }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(1200);
    return true;
  }

  /* ───────── 第①頁：四連點（只有不認得的組合才會開到這裡） ───────── */
  async function runFirst(p) {
    log("第①頁：開始點選");
    async function clickItem(t) {
      const li = await until(() => $$("li").find((l) => text(l) === t && visible(l)), 6000);
      if (!li) {
        log(`找不到「${t}」，請自己點`, "bad");
        return false;
      }
      if (li.classList.contains("active")) {
        log(`「${t}」已經是選中的`, "ok");
        return true;
      }
      li.click();
      await sleep(600);
      log(`點了「${t}」`, "ok");
      return true;
    }
    const f = p.first || {};
    const seq = [f.adType || (p.deal === "rent" ? "出租" : "出售"), ...(f.legal ? [f.legal] : []), f.status, f.type].filter(Boolean);
    for (const t of seq) if (!(await clickItem(t))) return;
    /* 最後一下 591 會整頁跳到第②頁，這支程式會在那頁重新跑（資料還在 background） */
  }

  /* ───────── 第②頁共用：縣市彈窗、地址 ───────── */
  async function handleCityModal(city) {
    const modal = await until(() => $$(".ant-modal").find((m) => T.cityModal.test(text(m)) && visible(m)), 4000);
    if (!modal) return;
    const want = city || "台中市";
    const item = $$("li, span, div", modal).find((e) => e.children.length === 0 && text(e) === want);
    if (item) {
      item.click();
      log(`縣市彈窗：選了 ${want}`, "ok");
    } else log(`縣市彈窗裡找不到「${want}」，請自己點`, "bad");
  }

  async function fillAddress(p, missing, floorName) {
    const a = p.addr || {};
    const f = p.floor || {};
    const addrLabel = findLabel(T.addr);
    const full = [a.city, a.town, a.road, a.lane ? `${a.lane}巷` : "", a.alley ? `${a.alley}弄` : "", a.no ? `${a.no}${a.sub ? `之${a.sub}` : ""}號` : ""].join("");
    let imported = false;

    /*
      快速框：貼整串 → 匯入地址（會選好縣市／鄉鎮／街道並填「號」，但不填「樓」）。
      2026-09-18：這條路其實是**街道最重要的一條路**——整串地址是丟給 591 自己去解析，比下面街道下拉
      那個搜尋框耐用（搜尋框對「自強路」這種路名會 0 條，匯入卻可能解得出來）。以前這裡三個岔路
      （沒有快速框／找不到匯入鈕／匯入沒成功）有兩個是悶不吭聲跳過的，面板上看不出來到底卡在哪，
      只看到後面街道搜尋失敗，害人以為問題出在街道。現在三條都留話。
    */
    const quick = $$("input").find((i) => T.quickAddrPlaceholder.test(i.placeholder || ""));
    if (quick && a.town && a.road) {
      setValue(quick, full);
      const btn = await until(() => $$("button").find((b) => text(b) === T.importBtn && visible(b)), 5000);
      if (btn) {
        btn.click();
        const yes = await until(() => $$(".ant-modal button").find((b) => /確\s*定/.test(text(b)) && visible(b)), 1500);
        if (yes) yes.click();
        imported = !!(await until(() => $$(".ant-select .ant-select-selection-item").some((e) => text(e) === a.town), 8000));
        log(imported ? `地址匯入：${full}` : `地址匯入按了「${T.importBtn}」但沒生效（等 8 秒沒看到鄉鎮變成「${a.town}」），改一格一格選`, imported ? "ok" : "warn");
      } else {
        log(`地址：找得到「完整地址」快速框，但找不到「${T.importBtn}」按鈕，改一格一格選`, "warn");
      }
    } else if (!quick) {
      log("地址：這個版面沒有「完整地址」快速框，只能一格一格選（街道要靠搜尋，搜不到的路名就得自己選）", "warn");
    }
    if (!imported) {
      if (!addrLabel) {
        log("找不到地址那一區的標籤，地址請自己填", "bad");
        missing.push("地址整區");
      } else {
        const sels = () => controls(addrLabel, SEL, 3);
        if (a.city && !(await pickSelect(sels()[0], [a.city]))) log("縣市沒選到，請自己選", "bad");
        await sleep(500);
        if (a.town && !(await pickSelect(sels()[1], [a.town]))) log("鄉鎮沒選到，請自己選", "bad");
        await sleep(500);
        if (a.road) {
          if (await pickStreet(sels()[2], a.road)) log(`地址：${a.city}${a.town}${a.road}`, "ok");
          else {
            /* 2026-09-12 實測：選不到常常不是程式問題，是 591 的街道資料庫根本沒登記這條路
               （搜尋會出現「非常抱歉，沒有搜尋到」），要走「新增」自己註冊，這步交給人判斷比較安全 */
            log(`街道「${a.road}」沒選到，請自己選（如果清單裡真的沒有這條路，591 有「新增」可以自己註冊）`, "bad");
            missing.push(`街道「${a.road}」（清單裡找不到就用 591 的「新增」自己註冊）`);
          }
        }
      }
    }
    /* 巷／號／之 是門牌那一列的文字框（跟縣市/鄉鎮/街道同一個 .ant-form-item）；弄是數字框 */
    if (addrLabel) {
      const boxes = controls(addrLabel, TXT, 14).filter((i) => /^(選填|必填)$/.test(i.placeholder || ""));
      const [lane, no, sub] = boxes;
      if (lane && a.lane && !lane.value) setValue(lane, a.lane);
      if (no && a.no && no.value !== String(a.no)) setValue(no, a.no);
      if (sub && a.sub && !sub.value) setValue(sub, a.sub);
      const alley = controls(addrLabel, NUM, 1)[0];
      if (alley && a.alley) setValue(alley, a.alley);
      log(`門牌：${a.lane ? a.lane + "巷 " : ""}${a.alley ? a.alley + "弄 " : ""}${a.no || "（沒有號）"}${a.sub ? "之" + a.sub : ""}號`, boxes.length >= 2 ? "ok" : "warn");
      if (boxes.length < 2) log(`門牌那排只找到 ${boxes.length} 個框，請核對巷／號／之`, "warn");
    }
    if (!a.no) missing.push("門牌「號」（資料裡沒有）");
    /* 樓／樓之：另一個獨立區塊，用旁邊的說明文字定位（見 findFloorInputs 的註解） */
    const [floor, floorSub] = findFloorInputs();
    if (floor && has(f.sell)) setValue(floor, f.sell);
    else if (has(f.sell)) log(`「樓」那格沒找到，${floorName}「${f.sell}」要自己填`, "bad");
    if (floorSub && f.sub) setValue(floorSub, f.sub);
    else if (f.sub && has(f.sell)) log(`「樓 之」那格沒找到，之${f.sub} 要自己填`, "warn");
    if (!has(f.sell)) missing.push(floorName);
    if (a.hide !== false) choose(null, T.hideNo, true);
  }

  /* ───────── 第②頁：出售 ───────── */
  async function runSale(p) {
    const missing = [];
    await handleCityModal((p.addr || {}).city);
    const ready = await until(() => findLabel(T.totalFloor.sale) && findLabel(T.addr), 20000);
    if (!ready) {
      log("等不到出售表單（還沒登入 591？或 591 改版了）。重新整理一次再試", "bad");
      return false;
    }
    log("第②頁（出售）：開始填");

    try {
      await fillAddress(p, missing, "出售樓層");
    } catch (e) {
      log(`地址區出錯：${e.message}`, "bad");
    }

    /* 基礎資料 */
    try {
      const f = p.floor || {};
      if (has(f.total)) fillNums(T.totalFloor.sale, [f.total]);
      else missing.push("出售總樓層");
      fillOne(T.community, p.community || "");
      if (/電梯大樓|華廈/.test((p.first || {}).type || "") && !p.community) missing.push("社區名稱");
      const L = p.layout || {};
      fillNums(T.layout, [L.room, L.hall, L.bath]);
      const D = p.done || {};
      if (has(D.y)) {
        choose(T.done, T.doneBuilt);
        fillNums(T.done, [D.y, D.m, D.d]);
      } else missing.push("完工 民國年");
      if (p.facing && !(await pickSelect(controls(T.facing, SEL, 1)[0], [p.facing]))) log(`朝向「${p.facing}」沒選到`, "warn");
      const A = p.area || {};
      fillNums(T.regPing, [A.reg]);
      choose(T.regPing, A.inclPark ? T.areaIncl[0] : T.areaIncl[1]);
      if (A.inclPark) {
        await sleep(500);
        if (await until(() => findLabel(T.parkPing), 3000)) {
          if (has(A.park)) fillNums(T.parkPing, [A.park]);
          const pt = A.parkType || "";
          const cands = [pt, /平面.*機械|機械.*平面/.test(pt) ? "平面式+機械式" : "", /平面/.test(pt) ? "平面式停車位" : "", /機械/.test(pt) ? "機械式停車位" : "", pt ? "" : "其他"].filter(Boolean);
          if (!(await pickSelect(controls(T.parkPing, SEL, 1)[0], cands))) missing.push(`車位型式（想選「${pt || "其他"}」，沒選到）`);
        }
      }
      if (has(A.main)) fillNums(T.main, [A.main]);
      if (has(A.att)) fillNums(T.att, [A.att]);
      if (has(A.pub)) fillNums(T.pub, [A.pub]);
      if (has(A.land)) fillNums(T.land, [A.land]);
      log("基礎資料填完", "ok");
    } catch (e) {
      log(`基礎資料出錯：${e.message}`, "bad");
    }

    /* 價格 */
    try {
      const P = p.price || {};
      if (has(P.total)) fillOne(T.price, P.total);
      else missing.push("售價");
      choose(T.price, P.inclPark ? T.priceIncl[0] : T.priceIncl[1]);
      await sleep(300);
      if (has(P.down)) fillOne(T.down, P.down);
      const F = p.fee || {};
      if (F.has === true) {
        choose(T.fee, "有");
        await sleep(300);
        if (has(F.amount)) fillOne(T.fee, F.amount);
        else missing.push("管理費金額");
      } else if (F.has === false) choose(T.fee, "無");
      else missing.push("管理費 有／無");
      choose(T.lease, p.lease ? "是" : "否");
      if (p.deco) choose(T.deco, p.deco);
      else missing.push("裝潢程度（要你看過屋況再選）");
      log("價格填完", "ok");
    } catch (e) {
      log(`價格區出錯：${e.message}`, "bad");
    }

    /* 生活機能 */
    for (const item of p.life || []) if (!choose(null, item, true)) log(`生活機能「${item}」沒找到`, "warn");

    await fillTitleDesc(p, missing);
    await fillContact(p, missing, false);
    await fillPhotos(p, missing);

    showMissing(missing);
    log("✅ 填完。請從上往下核對一遍，再自己按「保存資料，下一步」。", "ok");
    return true;
  }

  /* ───────── 第②頁：出租 ───────── */
  async function runRent(p) {
    const missing = [];
    const r = p.rent || {};
    await handleCityModal((p.addr || {}).city);
    const ready = await until(() => findLabel(T.totalFloor.rent) && findLabel(T.addr), 20000);
    if (!ready) {
      log("等不到出租表單（還沒登入 591？或 591 改版了）。重新整理一次再試", "bad");
      return false;
    }
    log("第②頁（出租）：開始填");

    try {
      await fillAddress(p, missing, "出租樓層");
    } catch (e) {
      log(`地址區出錯：${e.message}`, "bad");
    }

    /* 基礎資料 */
    try {
      const f = p.floor || {};
      if (has(f.total)) fillNums(T.totalFloor.rent, [f.total]);
      else missing.push("出租總樓層");
      if (r.elevator) choose(T.elevator, r.elevator);
      fillOne(T.community, p.community || "");
      const L = p.layout || {};
      fillNums(T.layout, [L.room, L.hall, L.bath]);
      if (has(r.usePing)) fillNums(T.usePing, [r.usePing]);
      else missing.push("可使用坪數");
      const A = p.area || {};
      if (has(A.reg)) fillNums(T.regPing, [A.reg]);
      choose(T.park, r.park ? "有" : "無");
      if (r.park) {
        await sleep(400);
        const pt = A.parkType || "";
        const cands = [/平面.*機械|機械.*平面/.test(pt) ? "平面式 + 機械式" : "", /平面/.test(pt) ? "平面式" : "", /機械/.test(pt) ? "機械式" : "", pt ? "" : "其他"].filter(Boolean);
        if (!(await pickSelect(controls(T.park, SEL, 1)[0], cands))) missing.push("車位型式（平面式／機械式）");
      }
      const D = p.done || {};
      if (has(D.y)) {
        choose(T.done, T.doneBuilt);
        fillNums(T.done, [D.y, D.m, D.d]);
      } else {
        if (choose(T.done, T.doneUnknown)) log("完工時間：型錄沒竣工日，點了「屋齡不詳」", "warn");
        else missing.push("建築完工時間（屋齡不詳／民國年）");
      }
      if (p.facing && !(await pickSelect(controls(T.facing, SEL, 1)[0], [p.facing]))) log(`朝向「${p.facing}」沒選到`, "warn");
      if (r.decoTime) choose(T.decoTime, r.decoTime);
      else missing.push("裝潢時間（半年內／1年內／3年內／3年以上）");
      if (p.deco) choose(T.deco, p.deco);
      else missing.push("裝潢程度（要你看過屋況再選）");
      log("基礎資料填完", "ok");
    } catch (e) {
      log(`基礎資料出錯：${e.message}`, "bad");
    }

    /* 租住說明 */
    try {
      if (r.minTerm) choose(T.minTerm, r.minTerm);
      if (r.moveInAny) choose(T.moveIn, T.moveInAny, true);
      for (const who of T.identityAll) choose(T.identity, who, (r.identity || []).includes(who));
      if (r.cook) choose(T.cook, r.cook);
      if (r.pets) choose(T.pets, r.pets);
      missing.push("提供設備、提供家具（照照片勾）");
      log("租住說明填完", "ok");
    } catch (e) {
      log(`租住說明出錯：${e.message}`, "bad");
    }

    /* 價格 */
    try {
      if (has(r.monthly)) fillOne(T.rent, r.monthly);
      else missing.push("租金");
      if (r.deposit) choose(T.deposit, r.deposit);
      const inc = r.includes || [];
      if (inc.length) for (const x of inc) choose(T.includes, x, true);
      else choose(T.includes, "無", true);
      if (r.water) choose(T.water, r.water);
      if (r.power) choose(T.power, r.power);
      const F = p.fee || {};
      if (has(F.amount)) fillOne(T.fee, F.amount);
      else if (F.has === false) choose(T.fee, "無", true);
      else missing.push("管理費金額（租金已含，591 仍會問；不知道就勾「無」）");
      log("價格填完", "ok");
    } catch (e) {
      log(`價格區出錯：${e.message}`, "bad");
    }

    for (const item of p.life || []) if (!choose(null, item, true)) log(`生活機能「${item}」沒找到`, "warn");

    await fillTitleDesc(p, missing);
    await fillContact(p, missing, true);
    await fillPhotos(p, missing);

    showMissing(missing);
    log("✅ 填完。請從上往下核對一遍，再自己按「保存資料，下一步」。", "ok");
    return true;
  }

  /* ───────── 共用：標題描述、聯絡資料、照片 ───────── */
  async function fillTitleDesc(p, missing) {
    try {
      if (p.title) fillOne(T.title, p.title);
      else missing.push("廣告標題");
      if (p.desc) {
        /* descHtml 現在不是只有固定尾段設了樣式才會有值——抬頭（☆ 物件特色）固定粗體＋18px，
           2026-09-24 起只要有描述幾乎都會帶 descHtml，訊息不要照舊講死「固定尾段樣式」，改成籠統的「含格式」 */
        if (await setEditor(p.desc, p.descHtml)) log(p.descHtml ? "文案已貼入（含格式）" : "文案已貼入", "ok");
        else log("找不到描述編輯器，文案請自己貼", "bad");
      }
    } catch (e) {
      log(`文案出錯：${e.message}`, "bad");
    }
  }
  async function fillContact(p, missing, rent) {
    try {
      const C = p.contact || {};
      const name = controls(T.contact, TXT, 1)[0];
      if (name && C.name && name.value !== C.name) setValue(name, C.name);
      if (C.contract) choose(T.contract, C.contract);
      if (rent) {
        if ((p.rent || {}).ownership) choose(T.ownership, p.rent.ownership);
        /* 出租的服務費不動，照 591 自己的預設 */
      } else choose(T.serviceFee, C.serviceFee === false ? T.serviceFeeNo : T.serviceFeeYes);
      if (!choose(null, T.agencyOk, true)) log("「我已閱讀並確認經紀業資料無誤」沒找到，請自己勾", "warn");
      log("聯絡資料填完", "ok");
    } catch (e) {
      log(`聯絡資料出錯：${e.message}`, "bad");
    }
  }
  async function fillPhotos(p, missing) {
    /* 格局圖（有的話）先傳到它自己那一格；出租表單沒有這一格，p.floorPlan 出租一律不會設（見 map591.js／app.js） */
    if (p.floorPlan) {
      const okPlan = await uploadFloorPlan(p.floorPlan);
      log(okPlan ? "格局圖已傳到「格局圖」那一格" : "找不到「格局圖」那一格，請自己傳", okPlan ? "ok" : "warn");
      if (!okPlan) missing.push("格局圖（自己傳到「格局圖」那一格）");
    }
    if (p.photos && p.photos.length) {
      log(`照片：開始上傳 ${p.photos.length} 張…`);
      const res = await uploadPhotos(p.photos, (d, n) => log(`照片 ${d}/${n}`));
      log(`照片完成 ${res.done} 張${res.failed ? `，失敗 ${res.failed} 張` : ""}${res.reason ? `（${res.reason}）` : ""}`, res.failed ? "warn" : "ok");
    } else if (!p.floorPlan) missing.push("照片（自己上傳）");
  }

  /* ───────── 進場 ───────── */
  async function main() {
    const r = await bg("listing:get");
    const p = r && r.ok ? r.payload : null;
    if (!p || p.v !== 1) return; // 不是從操作頁來的，什麼都不做
    ensurePanel();
    log(`${p.deal === "rent" ? "出租" : "出售"}：${(p.first || {}).type || ""}　${p.title || ""}`);
    if (document.hidden) log("這個分頁在背景，Chrome 會把它放慢；請點回這個分頁等它填完", "warn");
    if (/\/post\/first/.test(location.pathname)) {
      await runFirst(p);
    } else if (/\/post\/two\//.test(location.pathname)) {
      const done = p.deal === "rent" ? await runRent(p) : await runSale(p);
      if (done) await bg("listing:clear"); // 填過就清掉，重新整理不會再填一次
    }
  }
  main().catch((e) => log(`程式出錯：${e.message}`, "bad"));
})();
