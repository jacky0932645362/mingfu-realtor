/**
 * 內容腳本：注入到樂屋「編輯出租物件」頁面（點列表裡的「修改」連結會開到這頁）。
 * 在關閉舊物件之前，先把這筆物件目前真正的完整狀態（本人原始貼文之後可能手動
 * 調整過的描述、封面照片、隔間材質這類表單欄位）掃一遍存起來，取代「依賴
 * captureListing.js 剛好在本人貼文當下有抓到」這個前提——這個方法對任何已經
 * 存在的舊物件都有效，不用等本人重新走一次貼文流程。
 *
 * 🔴 2026-09-27 本人直接問「有沒有其他的方式自動化，複製我之前所有的資訊照片，
 * 如果一模一樣的話，一定是没有問題，這樣重新上架才可以完全的自動化」——這支
 * 檔案是回應這句話的解法，見 [[project_樂屋出租循環刊登]]。
 *
 * ⚠️ 第一版，還沒對真帳號跑過。編輯頁的欄位結構是照「新增物件」頁面
 * （createListing.js／captureListing.js）的既有經驗推測（欄位 name 屬性
 * 應該一樣，因為新增/編輯通常共用同一套表單元件），封面照片的選取方式
 * 完全是猜的——回傳值刻意帶足夠的診斷資訊（找到幾張圖、選到的圖網址），
 * 錯的話從除錯紀錄就看得出來，不用再猜。
 *
 * 掛在 window 上、不自動執行——background.js 注入這支檔案之後，再用
 * chrome.scripting.executeScript({func:...}) 另外呼叫
 * window.__rrScrapeListing__() 才會真的動作。
 */
(() => {
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
          /**
           * 🔴 2026-09-28 本人真帳號實測抓到：只存 `.value` 沒用——這個
           * 選單的內部 value 看起來不是穩定不變的（本人截圖畫面上明明有
           * 選「大同街」，但重刊時 `.value` 對不到新頁面上任何一個選項，
           * 等多久都一樣）。既有的 `setSelect()`（結構性填表那邊，已經
           * 對真帳號驗證過）本來就是用「看得到的文字」比對，不是比對
           * `.value`——這裡改成兩個都存，`applyCapturedFormFields()`
           * 優先用文字比對，跟既有邏輯一致。
           */
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

  function loadImageEl(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("圖片讀取失敗"));
      img.src = src;
    });
  }

  /** 封面照＋封面貼圖合成：滿版寬、貼齊底部（跟 591-extension 的 app.js 同一套位置公式）。 */
  async function compositeCoverSticker(coverDataUrl, sticker) {
    const coverImg = await loadImageEl(coverDataUrl);
    const stickerImg = await loadImageEl(sticker.src);
    const canvas = document.createElement("canvas");
    canvas.width = coverImg.naturalWidth;
    canvas.height = coverImg.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(coverImg, 0, 0);
    const w = canvas.width;
    const h = w * (stickerImg.naturalHeight / stickerImg.naturalWidth);
    ctx.drawImage(stickerImg, 0, canvas.height - h, w, h);
    return canvas.toDataURL("image/jpeg", 0.92);
  }

  /**
   * 🔴 2026-09-28 本人已經正確上傳貼圖存檔，除錯訊息卻還是「封面照本身
   * 沒抓到，沒得合成」——加了診斷之後這裡先改成直接 throw 而不是靜默
   * 吞掉，本人下一輪重試就看到真正原因：「Failed to fetch」——這是
   * CORS／CSP 層級失敗（連 HTTP 狀態碼都沒有），不是伺服器拒絕。在內容
   * 腳本裡對 `static.rakuya.com.tw` 這種跨網域圖片直接呼叫 `fetch()`，
   * 會被編輯頁（member.rakuya.com.tw）自己的 CSP／CORS 規則卡住。
   * background.js 本來就有 `rr:fetch-image` 中繼站（給 createListing.js
   * 抓愛屋型錄圖片用），不受頁面 CSP 限制、只受 host_permissions 管，
   * 已把 rakuya.com.tw 加進白名單，改成跟 createListing.js 的
   * `uploadPhotos()` 一樣，全部圖片都走背景頁代抓，不要在內容腳本裡
   * 直接 fetch 跨網域圖片。
   */
  async function fetchAsDataUrl(url) {
    const r = await chrome.runtime.sendMessage({ type: "rr:fetch-image", url });
    if (!r || !r.ok) throw new Error((r && r.error) || "背景頁沒有回應");
    return `data:${r.type};base64,${r.b64}`;
  }

  async function until(fn, timeout = 15000, step = 200) {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > timeout) return null;
      await new Promise((r) => setTimeout(r, step));
    }
  }

  window.__rrScrapeListing__ = async function () {
    const ok = await until(() => document.querySelector('[name="surface_image_input"]') || document.querySelector(".note-editable"), 15000);
    if (!ok) return { ok: false, error: "等不到編輯頁的表單（還沒登入樂屋？或這不是編輯頁？）" };

    const ed = document.querySelector(".note-editable");
    const descHtml = ed ? ed.innerHTML : "";
    const descText = ed ? (ed.innerText || ed.textContent || "") : "";

    /**
     * 🔴🔴 2026-09-28 本人真帳號實測連續兩輪都抓到同一張本人的大頭貼
     * （`https://pic.rakuya.com.tw/avatars/...`）——第一版用「房屋照片」
     * 標題文字當錨點縮小範圍，這一輪還是同一張，代表那個錨點搜尋本身
     * 沒找到（可能標題文字外面還包了一層別的元素，不是乾淨的葉節點），
     * 靜靜退回掃整個頁面，跟完全沒縮小範圍一樣。這次不再只靠「找對範圍」
     * 這個方向猜第三次，改成直接用已經兩輪證實存在的真實證據——大頭貼
     * 網址一定含 `/avatars/`——直接排除掉，不管有沒有成功縮小範圍，
     * 這張圖永遠不會被選中；範圍縮小依然保留當第一道防線，兩者疊加。
     */
    const photoSectionLabel = [...document.querySelectorAll("*")].find((e) => (e.textContent || "").trim() === "房屋照片" && e.children.length <= 1);
    let photoScope = document;
    if (photoSectionLabel) {
      let node = photoSectionLabel;
      for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
        if (node.querySelectorAll("img").length >= 1) { photoScope = node; break; }
      }
    }
    const photoImgs = [...photoScope.querySelectorAll("img")].filter(
      (img) => img.naturalWidth >= 80 && img.naturalHeight >= 80 && !/\/avatars\//i.test(img.src),
    );
    let coverPhotoDataUrl = "";
    let coverPhotoSrc = "";
    let coverStickerApplied = false;
    let coverStickerDebug = "(沒有封面照可合成)";
    if (photoImgs[0]) {
      coverPhotoSrc = photoImgs[0].src;
      try {
        coverPhotoDataUrl = await fetchAsDataUrl(photoImgs[0].src);
      } catch (e) {
        coverStickerDebug = `封面照抓取失敗：${String((e && e.message) || e)}`;
      }
      /**
       * 🔴 2026-09-28 本人重刊全程跑通之後回報最後一個問題：原本第一張
       * 照片有貼人像貼圖，但這裡抓回來的是樂屋伺服器存的原圖，沒有貼圖。
       * 跟「物件上架助手」外掛的「封面貼圖」同一個概念（存一張貼圖，
       * 合成到封面照最下面、滿版寬），但 chrome.storage 每個外掛各自
       * 獨立讀不到那邊存的，這支外掛的設定頁（options.html／options.js）
       * 新增了自己的一份。合成數學（滿版寬、貼齊底部、輸出 JPEG 0.92）
       * 照抄 591-extension 的 app.js。
       * ⚠️已知簡化：下一輪重刊會再抓一次這裡合成過的封面照，如果又設定
       * 了貼圖會在同一個位置再疊一次——貼圖本身通常是不透明的人像去背，
       * 疊在同一個位置視覺上不會變厚，只是每輪多一次 JPEG 重新壓縮，
       * 長期畫質會慢慢變差，還沒真的驗證過會不會有感。
       *
       * 🔴🔴 2026-09-28 本人確認已經在這支外掛的設定頁上傳＋存檔，結果
       * 還是「沒設定/沒合成」——代表不是本人操作問題，是這裡真的有 bug，
       * 但原本 catch 整個吞掉、完全看不到失敗在哪一步。改成把「沒讀到
       * 設定」跟「讀到了但合成本身失敗（連錯誤訊息一起記）」分開，不要
       * 再靠猜的。
       */
      if (coverPhotoDataUrl) {
        try {
          const st = await chrome.storage.local.get("rr:settings");
          const sticker = st["rr:settings"] && st["rr:settings"].coverSticker;
          if (sticker && sticker.src) {
            try {
              coverPhotoDataUrl = await compositeCoverSticker(coverPhotoDataUrl, sticker);
              coverStickerApplied = true;
              coverStickerDebug = "已合成";
            } catch (e) {
              coverStickerDebug = `合成失敗：${String((e && e.message) || e)}`;
            }
          } else {
            coverStickerDebug = "讀到 rr:settings 但裡面沒有 coverSticker（還沒存，或存的格式不對）";
          }
        } catch (e) {
          coverStickerDebug = `讀取設定失敗：${String((e && e.message) || e)}`;
        }
      }
      // coverPhotoDataUrl 是空的：catch 那段已經把真正的失敗原因（HTTP 狀態碼／
      // 例外訊息）記進 coverStickerDebug 了，這裡不能再覆蓋回去變成看不出原因。
    }

    /**
     * 🔴🔴🔴 2026-09-28 本人真帳號實測：套用結果連續兩輪都是
     * `applied:63,failed:0`，但畫面上街道還是選不上——如果套用端一直
     * 回報「成功」，代表問題可能根本不在套用端，是**擷取端**一開始就
     * 沒抓到正確的值：編輯頁載入後，街道這類串接下拉本身可能也需要
     * 一點時間才會把「這筆物件原本存的值」自動選回去（頁面自己的初始化
     * 邏輯，不是本人手動操作觸發的），如果擷取跑得太早，擷取到的可能
     * 是還沒選定的空值，後面套用端不管邏輯多正確，複製過去的本來就是
     * 空的。加一段等待，給頁面自己的初始化時間穩定下來，再開始擷取。
     */
    await new Promise((r) => setTimeout(r, 2000));

    const formFields = captureFormFields();
    /**
     * 🔴 2026-09-28 直接把街道（`addr_road`）這個具體欄位的擷取結果記
     * 進除錯訊息——不用再從一堆欄位名稱裡自己找，一眼就能看到這次到底
     * 有沒有抓到值，抓到的話文字是什麼。
     */
    const addrRoadDebug = formFields.addr_road ? JSON.stringify(formFields.addr_road) : "(這次沒抓到 addr_road 這個欄位)";
    return {
      ok: true,
      descHtml,
      descText,
      coverPhotoDataUrl,
      coverPhotoSrc,
      coverStickerApplied,
      coverStickerDebug,
      photoImgCount: photoImgs.length,
      formFieldCount: Object.keys(formFields).length,
      formFields,
      addrRoadDebug,
    };
  };
})();
