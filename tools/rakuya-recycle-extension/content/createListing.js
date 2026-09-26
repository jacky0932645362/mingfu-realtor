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

  async function uploadPhotos(urls, inputName) {
    const input = byName(inputName);
    if (!input) return { done: 0, failed: urls.length, reason: "找不到上傳框" };
    let done = 0, failed = 0;
    const batch = input.multiple ? 5 : 1;
    for (let i = 0; i < urls.length; i += batch) {
      const chunk = urls.slice(i, i + batch);
      const dt = new DataTransfer();
      for (const [j, u] of chunk.entries()) {
        const r = await bg("rr:fetch-image", { url: u });
        if (!r.ok) { failed++; continue; }
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

      /* 🔴 跟 fillRakuya.js 最大的不同：這裡真的送出。送出前小睡一下讓 Summernote／
            cascading 下拉最後的 change 事件跑完。 */
      await sleep(1000);
      const submitBtn = [...document.querySelectorAll("button")].find((b) => txt(b) === "上架");
      if (!submitBtn) return { ok: false, error: "填完了，但找不到「上架」按鈕，沒有送出", photoResult };
      submitBtn.click();
      await sleep(1500);

      return { ok: true, photoResult, finalUrl: location.href };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  };
})();
