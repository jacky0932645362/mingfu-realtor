/**
 * 內容腳本：在「出租物件管理」頁面把指定物件「成交/關閉」→關閉→不方便帶看→送出。
 * 不用 declarative content_scripts（manifest.json 沒宣告 matches），background.js 用
 * chrome.scripting.executeScript 在確定網址是對的之後才注入＋呼叫，理由是這個管理頁
 * 的真實網址還沒本人帶著確認過（見 [[project_樂屋出租循環刊登]]）。
 *
 * ⚠️ 第一版，還沒對真帳號跑過。照兩張截圖上看得到的文字標籤寫（「成交/關閉」「關閉」
 * 「不方便帶看」「確認送出」），跟 591-extension/fillRakuya.js 當初「應該長這樣」是
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

  window.__rrCloseListing__ = async function ({ matchText }) {
    try {
      const closeLink = await waitFor(() => findCloseLinkForRow(matchText), 10000);
      if (!closeLink) return { ok: false, error: `列表裡找不到「${matchText}」這一列的成交/關閉連結` };
      closeLink.click();

      const dialogTitle = await waitFor(() => findByText("成交 / 關閉物件") || findByText("成交/關閉物件"), 8000);
      if (!dialogTitle) return { ok: false, error: "點了成交/關閉，但沒看到彈窗跳出來" };

      // 原因下拉選「關閉」（不是「成交」）
      const reasonSelect = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => txt(o) === "關閉"));
      if (reasonSelect) {
        const opt = [...reasonSelect.options].find((o) => txt(o) === "關閉");
        reasonSelect.value = opt.value;
        reasonSelect.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(400); // 選了關閉之後「方式」單選才會出現
      }

      // 方式：固定選「不方便帶看」（🔴 本人 2026-09-26 拍板固定這個，不要選別的）
      const wayOption = await waitFor(() => findByText("不方便帶看", { exact: true }), 4000);
      if (!wayOption) return { ok: false, error: "選了關閉，但沒看到『不方便帶看』這個選項" };
      const radio = wayOption.closest("label")?.querySelector('input[type="radio"]') || wayOption.previousElementSibling;
      if (radio && radio.click) radio.click();
      else wayOption.click();

      const submitBtn = await waitFor(() => findByText("確認送出", { exact: true }), 4000);
      if (!submitBtn) return { ok: false, error: "選好方式了，但沒看到『確認送出』按鈕" };
      submitBtn.click();

      const closed = await waitFor(() => !findByText("成交 / 關閉物件") && !findByText("成交/關閉物件"), 8000);
      if (!closed) return { ok: false, error: "按了確認送出，但彈窗沒有關閉，不確定是不是真的成功" };

      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  };
})();
