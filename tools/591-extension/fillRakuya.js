/**
 * 樂屋網刊登助手 —— 在 member.rakuya.com.tw/sell/post/*、/rent/post/* 跑的填表程式。
 *
 * 進場方式跟 591 一樣：操作頁按「上架到樂屋」→ background 存資料包（target="rakuya"）→ 開樂屋刊登頁 →
 * 這支程式向 background 要資料 → 填表 → 清掉。**永遠不按「庫存」「上架」**，那兩顆是使用者自己按的。
 *
 * 樂屋是原生 <select>／<input>／<radio>（不是 591 那套 Ant Design 虛擬下拉），欄位用 name 定位——
 * 詳細欄位對照表在 lib/rakuya-map.js 檔頭的註解，這裡只管「怎麼把值塞進去」。
 *
 * ⚠️ 這是第一版，**還沒對真的樂屋網跑過**。跟 591 剛開始一樣，name 屬性、選項文字、cascading 的時機
 *   都是照著「應該長這樣」寫的，第一次實測面板紅字很正常，照紅字回頭調這支檔案最上面的欄位名稱。
 */
(() => {
  "use strict";
  const path = location.pathname;
  if (!/^\/(sell|rent)\/post\//.test(path)) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (e) => (e && e.textContent ? e.textContent.replace(/\s+/g, " ").trim() : "");
  const visible = (e) => !!e && e.offsetParent !== null && getComputedStyle(e).visibility !== "hidden";
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

  /* ───────── 進度面板（跟 591 共用 panel.css） ───────── */
  let panel, list, missBox;
  function ensurePanel() {
    if (panel) return;
    panel = document.createElement("div");
    panel.id = "listing-panel";
    let ver = "";
    try {
      ver = " v" + chrome.runtime.getManifest().version;
    } catch {
      /* 測試環境沒有 getManifest */
    }
    panel.innerHTML = `<h4><span>樂屋刊登助手${ver}</span><button type="button" id="listing-panel-close">關閉</button></h4><ul></ul><div class="miss" hidden></div><div class="foot">填完請從上往下核對一遍，再自己按 <b>庫存</b>（先存不上架）或 <b>上架</b>；兩顆都是你按。</div>`;
    document.body.appendChild(panel);
    list = panel.querySelector("ul");
    missBox = panel.querySelector(".miss");
    panel.querySelector("#listing-panel-close").onclick = () => panel.remove();
  }
  function log(m, cls = "") {
    ensurePanel();
    const li = document.createElement("li");
    if (cls) li.className = cls;
    li.textContent = m;
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
  }
  function showMissing(items) {
    ensurePanel();
    missBox.hidden = !items.length;
    if (items.length) missBox.innerHTML = `<b>還要你自己補：</b>${items.map((s) => `<div>• ${s.replace(/[<>&]/g, "")}</div>`).join("")}`;
  }

  /* ───────── 原生表單操作 ───────── */
  const byName = (name) => document.querySelector(`[name="${name}"]`) || document.getElementById(name);
  const allByName = (name) => [...document.querySelectorAll(`[name="${name}"]`)];
  const fire = (el, types) => types.forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
  function setText(name, value) {
    const el = allByName(name).find(visible) || byName(name);
    if (!el) return false;
    el.focus();
    el.value = value == null ? "" : String(value);
    fire(el, ["input", "change", "blur"]);
    return true;
  }
  /** 原生下拉：cascading 的下拉要等上一格 change 之後選項才會長出來，等到了再照文字選 */
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
  const labelOf = (i) => txt(i.closest("label")) || (i.id && txt(document.querySelector(`label[for="${i.id}"]`))) || "";
  function clickRadio(name, labelText) {
    const rs = allByName(name).filter((i) => i.type === "radio");
    const r = rs.find((i) => labelOf(i) === labelText) || rs.find((i) => labelOf(i).startsWith(labelText));
    if (!r) return false;
    if (!r.checked) r.click();
    return true;
  }
  /** 勾選：labelText 給了就找那個文字的勾選框，沒給就用第一個（單一勾選框的情境，例如「隱藏門號」那種開關） */
  function setCheck(name, labelText, want) {
    const boxes = allByName(name).filter((i) => i.type === "checkbox");
    const b = labelText ? boxes.find((i) => labelOf(i) === labelText) || boxes.find((i) => labelOf(i).startsWith(labelText)) : boxes[0];
    if (!b) return false;
    if (b.checked !== want) b.click();
    return true;
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  /**
   * Summernote：直接寫 innerHTML，再發 input／keyup 讓它同步進底下真正送出的 textarea。
   * 有 html（固定尾段設了字級／顏色）就直接整段用它——Summernote 是純 contenteditable，innerHTML
   * 塞什麼都留得住，不用像 591 的 ProseMirror 那樣特地發 paste 事件才吃得住格式。
   */
  function setSummernote(text, html) {
    const ed = document.querySelector(".note-editable");
    if (!ed) return false;
    ed.focus();
    ed.innerHTML =
      html ||
      String(text || "")
        .split("\n")
        .map((l) => `<p>${esc(l) || "<br>"}</p>`)
        .join("");
    fire(ed, ["input", "keyup", "change", "blur"]);
    return true;
  }
  /**
   * 照片來源可能是遠端網址（愛屋圖檔，要 background 跨網域抓）或 data: URL（2026-09-24 新增：
   * 「封面貼圖」在 app.js 本機合成出來的結果，不用跨網域、也不用問 background，直接解碼
   * base64 段就好）。跟 fill591.js 同一招，591／樂屋各自一份（這支是 classic script，不是
   * ES module，沒辦法 import 共用）。
   */
  async function fetchPhotoAsB64(u) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(u);
    if (m) {
      if (!m[2]) return { ok: false, error: "data URL 不是 base64 編碼" };
      return { ok: true, b64: m[3], type: m[1] || "image/jpeg" };
    }
    return bg("listing:fetch-image", { url: u });
  }
  async function uploadPhotos(urls, inputName, onStep) {
    const input = byName(inputName);
    if (!input) return { done: 0, failed: urls.length, reason: "找不到上傳框" };
    let done = 0;
    let failed = 0;
    const batch = input.multiple ? 5 : 1;
    for (let i = 0; i < urls.length; i += batch) {
      const chunk = urls.slice(i, i + batch);
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
        const fresh = byName(inputName) || input;
        fresh.files = dt.files;
        fire(fresh, ["change"]);
        onStep && onStep(done, urls.length);
        await sleep(2500);
      }
    }
    return { done, failed };
  }

  /* ───────── 填表 ───────── */
  async function fill(p) {
    const missing = [];
    const r = p.rakuya || {};
    const a = p.addr || {};
    const A = p.area || {};
    const P = p.price || {};
    const L = p.layout || {};
    const rent = p.deal === "rent";

    const ok = await until(() => byName("usecode") && byName("city"), 15000);
    if (!ok) {
      log("等不到樂屋表單（還沒登入樂屋？或版面改了）。重新整理一次再試", "bad");
      return;
    }
    log(`樂屋（${rent ? "出租" : "出售"}）：開始填`);

    /* 1. 類型三連選（串接） */
    try {
      if (!(await setSelect("selectPropertyUsecode", r.legal))) log(`法定用途「${r.legal}」沒選到`, "warn");
      await sleep(400);
      if (!(await setSelect("usecode", r.usecode))) log(`現況型式「${r.usecode}」沒選到`, "bad");
      await sleep(600);
      if (!(await setSelect("typecode", r.typecode, 6000))) log(`現況類型「${r.typecode}」沒選到，請自己選`, "bad");
      await until(() => byName("surfloors") && visible(byName("surfloors")), 6000);
      await sleep(400);
      if (!rent && r.ageType) clickRadio("agetype", r.ageType);
      log("類型選好", "ok");
    } catch (e) {
      log(`類型出錯：${e.message}`, "bad");
    }

    /* 2. 名稱＋地址＋社區 */
    try {
      setText("hname", r.title25 || p.title || "");
      if (r.titleTruncated) log("物件名稱超過 25 字，已截短", "warn");
      if (!(await setSelect("city", a.city))) log("縣市沒選到", "bad");
      await sleep(600);
      if (!(await setSelect("zipcode", a.town, 6000))) log("行政區沒選到", "bad");
      await sleep(800);
      if (a.road && !(await setSelect("addr_road", [a.road], 8000))) {
        log(`街道「${a.road}」樂屋清單裡沒有，請自己選`, "bad");
        missing.push(`街道「${a.road}」`);
      }
      setText("addr_lane", a.lane || "");
      setText("addr_alley", a.alley || "");
      setText("addr_num", a.no ? `${a.no}${a.sub ? `之${a.sub}` : ""}` : "");
      if (!a.no) missing.push("門牌「號」（資料裡沒有）");
      clickRadio("is_community", r.isCommunity ? "是社區" : "非社區");
      if (r.isCommunity && p.community) {
        await sleep(900);
        const cs = byName("community");
        const cn = byName("community_new");
        let cdone = false;
        if (cs && cs.tagName === "SELECT" && visible(cs)) cdone = await setSelect("community", p.community, 3000);
        if (!cdone && cn && visible(cn)) cdone = setText("community_new", p.community);
        if (!cdone) missing.push(`社區名稱「${p.community}」（樂屋清單裡沒有，自己選或填新增）`);
      }
      log(`地址：${a.city}${a.town}${a.road}${a.no ? a.no + "號" : ""}`, "ok");
    } catch (e) {
      log(`地址區出錯：${e.message}`, "bad");
    }

    /* 3. 樓層／格局／屋齡／朝向／電梯／車位／坪數 */
    try {
      const f = p.floor || {};
      clickRadio("floors_type", r.floorsType || "單層");
      await sleep(300);
      if (r.floorsType === "多層") {
        const vis = allByName("floors").filter(visible);
        if (vis[0]) {
          vis[0].value = "1";
          fire(vis[0], ["input", "change"]);
        }
        setText("floors_max", r.floorsMax ?? f.total ?? "");
      } else if (has(f.sell)) setText("floors", f.sell);
      else missing.push("樓層");
      setText("surfloors", f.total ?? "");
      if (has(L.room)) await setSelect("bedrooms", String(L.room));
      if (has(L.hall)) await setSelect("livingrooms", String(L.hall));
      if (has(L.bath)) await setSelect("bathrooms", String(L.bath));
      if (has(r.ageYears)) setText("findate", r.ageYears);
      else setCheck("findateUnknow", null, true);
      if (p.facing) await setSelect("direction", p.facing);
      /* 電梯：出售表單是 radio、出租表單是 select，兩種都接 */
      const liftWant = /電梯大廈|華廈/.test(r.typecode || "") ? "有" : "無";
      const liftEl = byName("lifts");
      if (liftEl && liftEl.tagName === "SELECT") await setSelect("lifts", liftWant);
      else clickRadio("lifts", liftWant);
      if (rent) clickRadio("parkings", r.parkStatus === "無車位" ? "無車位" : "自有");
      else {
        clickRadio("parkings", r.parkStatus || "無車位");
        if (r.parkStatus === "有車位") {
          await sleep(500);
          if (r.parkKind) clickRadio("parkings_kind", r.parkKind);
          if (has(A.park)) setText("reg_garagesize", A.park);
        }
      }
      if (rent) setText("mainsize", (p.rent && p.rent.usePing) ?? A.main ?? "");
      else {
        setText("totalsize", A.reg ?? "");
        setCheck("is_size_including_parkings", null, !!A.inclPark);
        setText("mainsize", A.main ?? "");
        setText("subsize", A.att ?? "");
        setText("sharesize", A.pub ?? "");
      }
      if (has(A.land)) setText("basesize", A.land);
      await setSelect("manage", r.manage || "無");
      await sleep(300);
      if (has(r.manageFee)) setText("securityfee", r.manageFee);
      log("基礎資料填完", "ok");
    } catch (e) {
      log(`基礎資料出錯：${e.message}`, "bad");
    }

    /* 4. 價格（出售）／租住條件（出租） */
    try {
      if (rent) {
        const R = p.rent || {};
        const X = r.rent || {};
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
        missing.push("提供設備、提供傢俱（照照片勾）");
        log("租住條件填完", "ok");
      } else {
        setText("listprice", P.total ?? "");
        setCheck("is_price_including_parkings", null, !!P.inclPark);
        setCheck("is_calc_single_price", null, true);
        log("價格填完", "ok");
      }
    } catch (e) {
      log(`價格區出錯：${e.message}`, "bad");
    }

    /* 5. 描述、周圍環境 */
    try {
      if (p.desc) {
        /* descHtml 現在不是只有固定尾段設了樣式才會有值——抬頭（☆ 物件特色）固定粗體＋18px，
           2026-09-24 起只要有描述幾乎都會帶 descHtml，訊息不要照舊講死「固定尾段樣式」，改成籠統的「含格式」 */
        if (setSummernote(p.desc, p.descHtml)) log(p.descHtml ? "文案已貼入（含格式）" : "文案已貼入", "ok");
        else log("找不到描述編輯器，文案請自己貼", "bad");
      }
      const env = r.env || {};
      for (const k of ["elementary", "market", "park", "transport", "mrt", "vital_function"]) if (env[k]) setText(k, env[k]);
    } catch (e) {
      log(`文案出錯：${e.message}`, "bad");
    }

    /* 6. 聯絡人：切到「自行填寫」樂屋會把個人檔案帶的電話／Email 清掉，先記下來、切完再填回去，只改名字 */
    try {
      const keep = {};
      for (const k of ["tel2", "email", "tel1", "tel1_pre"]) {
        const el = byName(k);
        if (el && el.value) keep[k] = el.value;
      }
      clickRadio("isOwnerContact", "自行填寫");
      await sleep(400);
      if (r.contactName) setText("contact_name", r.contactName);
      if (keep.tel2 && !byName("tel2").value) setText("tel2", keep.tel2);
      if (keep.email && !byName("email").value) setText("email", keep.email);
      if (keep.tel1 && !byName("tel1").value) setText("tel1", keep.tel1);
      if (keep.tel1_pre) await setSelect("tel1_pre", keep.tel1_pre, 500);
      if (!byName("tel2") || !byName("tel2").value) missing.push("行動電話");
      if (!byName("email") || !byName("email").value) missing.push("Email");
      log("聯絡資料填完", "ok");
    } catch (e) {
      log(`聯絡資料出錯：${e.message}`, "bad");
    }

    /* 7. 照片 */
    if (p.photos && p.photos.length) {
      log(`照片：開始上傳 ${Math.min(p.photos.length, 25)} 張…`);
      const res = await uploadPhotos(p.photos.slice(0, 25), "surface_image_input", (d2, n) => log(`照片 ${d2}/${n}`));
      log(`照片完成 ${res.done} 張${res.failed ? `，失敗 ${res.failed} 張` : ""}${res.reason ? `（${res.reason}）` : ""}`, res.failed ? "warn" : "ok");
    } else missing.push("照片（自己上傳）");

    showMissing(missing);
    log("✅ 填完。請從上往下核對一遍，再自己按「庫存」或「上架」。", "ok");
  }

  async function main() {
    const res = await bg("listing:get");
    const p = res && res.ok ? res.payload : null;
    if (!p || p.v !== 1 || p.target !== "rakuya") return; // 不是給樂屋的資料就不動
    ensurePanel();
    if (document.hidden) log("這個分頁在背景，Chrome 會把它放慢；請點回這個分頁等它填完", "warn");
    await fill(p);
    await bg("listing:clear");
  }
  main().catch((e) => log(`程式出錯：${e.message}`, "bad"));
})();
