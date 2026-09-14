/**
 * 從一頁已經開好的 591 物件詳情頁，抽出分析要用的資料。
 *
 * 輸入是 Playwright 的 `page`（可以是真的開去 591，也可以是測試時
 * `page.setContent(fixtureHtml)` 的假頁面——兩邊跑同一份邏輯，跟
 * 591-autofill 的 test-fill-e2e.mjs 同一個做法）。
 *
 * ⚠️ 591 有一招反爬蟲：部分數字（社區在售物件的坪數區間）用一堆
 * `<i style="order:N">單一字元</i>` 拼字，DOM 出現順序跟畫面看到的順序
 * 故意不一樣，肉眼看沒事、單純照 DOM 順序讀字串會讀錯數字。
 * 這裡一律照 style.order 排序後再拼字（等於照人眼實際看到的做）。
 *
 * ⚠️ 找不到的欄位一律回傳 null／空陣列並記進 warnings，絕不猜。
 *    591 改版時，先看 warnings 裡缺哪個欄位，再回來對照真實頁面調整下面的選取器。
 *
 * ⚠️⚠️ 同社區在售清單的來源，2026-09-14 從 market.591.com.tw 的社區清單頁改成
 *    591 主站的關鍵字搜尋頁（`extractSearchComps()`）。原因：社區清單頁用自訂元素
 *    `<wc-obfuscate-price>`／`<wc-obfuscate-area>`／`<wc-obfuscate-floor>` 把總價、
 *    坪數、樓層直接藏起來（內容真的不在 DOM 裡），元件名稱就寫著 obfuscate，591 的意圖
 *    沒有模糊空間——**那一頁我們從頭到尾沒有試圖破解，現在也不讀它了**。
 *    搜尋頁是 591 自己用純文字把同一批數字排出來的（總價 `.ware-item__price-value`、
 *    權狀坪、樓層都在 `.ware-item__attr`），讀它跟人打開瀏覽器看沒有差別。
 *    如果哪天搜尋頁也開始 obfuscate，做法一樣：留白、附連結，不要去研究怎麼繞。
 */

export async function extractListing(page) {
  const raw = await page.evaluate(() => {
    /**
     * 591 這頁偶爾會在還沒 hydrate 完成時被抓到，這時候欄位裡讀到的不是真的資料，
     * 是字面上的樣板語法（例如標題直接讀到字串 "${title}"）。這種內容比「抓不到」
     * 更危險——它看起來像有值，會被當成真資料印進報告。凡是含樣板語法的一律當成
     * 沒抓到（回空字串，交給下面既有的 warnings 機制），不能讓這種字面上的
     * 「${...}」流進最後給屋主看的報告。
     */
    function looksLikeUnrenderedTemplate(s) {
      return /\$\{|\{\{|<%[=-]?/.test(s);
    }
    function text(el) {
      if (!el) return "";
      const t = el.textContent.trim();
      return looksLikeUnrenderedTemplate(t) ? "" : t;
    }

    /** 依 style.order 排序後拼字，破解 591 對特定數字的 DOM 亂序反爬蟲。 */
    function readOrdered(el) {
      if (!el) return "";
      const spans = Array.from(el.querySelectorAll("i"));
      if (spans.length === 0) return text(el);
      return spans
        .slice()
        .sort((a, b) => (parseInt(a.style.order, 10) || 0) - (parseInt(b.style.order, 10) || 0))
        .map((s) => s.textContent.trim())
        .join("");
    }

    const warnings = [];
    const out = { warnings };

    out.title = text(document.querySelector(".detail-title-text"));
    if (!out.title) warnings.push("抓不到標題（.detail-title-text）");

    const priceEl = document.querySelector(".info-price-text");
    out.totalPrice = {
      raw: text(priceEl),
      value: priceEl ? Number(text(priceEl).replace(/,/g, "")) : null,
      unit: text(document.querySelector(".info-price-unit")) || "萬元",
      includesParking: !!document.querySelector(".info-box-car"),
    };
    if (out.totalPrice.value == null) warnings.push("抓不到總價（.info-price-text）");

    const perPriceText = text(document.querySelector(".per-price-text"));
    const perPriceMatch = perPriceText.match(/([\d.]+)\s*萬\/坪/);
    out.unitPrice = { raw: perPriceText, value: perPriceMatch ? Number(perPriceMatch[1]) : null };
    if (out.unitPrice.value == null) warnings.push("抓不到單價（.per-price-text）");

    // .info-addr-content：一列一個 label(.info-addr-key) + value(.info-addr-value)
    const specs = {};
    for (const row of document.querySelectorAll(".info-addr-content")) {
      const key = text(row.querySelector(".info-addr-key"));
      const valueEl = row.querySelector(".info-addr-value-text") || row.querySelector(".info-addr-value");
      if (key) specs[key] = text(valueEl);
    }
    out.floor = specs["樓層"] || null;
    out.orientation = specs["朝向"] || null;
    out.address = specs["地址"] || null;
    out.communityName = specs["社區"] || null;
    const communityLink = document.querySelector(".info-addr-value.community-link a, .community-link a");
    out.communityMarketUrl = communityLink ? communityLink.href.split("?")[0] : null;
    out.communityId = out.communityMarketUrl ? (out.communityMarketUrl.match(/market\.591\.com\.tw\/(\d+)/) || [])[1] || null : null;
    if (!out.communityName) warnings.push("抓不到社區名稱（.info-addr-content 裡的「社區」列）");
    if (!out.communityId) warnings.push("抓不到社區 ID（社區連結）——後面的社區資料會整段缺");

    // 格局／屋齡／權狀坪數：591 這幾格是「數值在前、標籤在後」的快速資訊列，
    // 目前沒有穩定的 class 可以選，改用整頁文字比對標籤字樣（同一套邏輯見 README）。
    const bodyText = document.body.innerText;
    const layoutMatch = bodyText.match(/(\d+房\d+廳\d+衛(?:\d*陽台)?)\s*\n?\s*格局/);
    const ageMatch = bodyText.match(/(\d+)\s*年\s*\n?\s*屋齡/);
    const pingMatch = bodyText.match(/([\d.]+坪(?:\(含車位\))?)\s*\n?\s*權狀坪數/);
    out.layout = layoutMatch ? layoutMatch[1] : null;
    out.ageYears = ageMatch ? Number(ageMatch[1]) : null;
    out.registeredPing = pingMatch ? pingMatch[1] : null;
    if (!out.layout) warnings.push("抓不到格局（文字比對「格局」標籤失敗，591 可能改版了）");

    // 社區資訊區塊：.n-community-container，591 自己算好的社區行情
    const box = document.querySelector(".n-community-container");
    if (!box) {
      warnings.push("整個社區資訊區塊都不見了（.n-community-container）——這頁可能沒有社區資料，或 591 改版");
      out.community = null;
      return out;
    }

    const community = {};
    community.name = text(box.querySelector(".community-card-info h3 em.ellipsis")) || out.communityName;

    const totalPriceEl = box.querySelector(".price.total-price .price-info strong");
    community.onSaleStartPrice = totalPriceEl ? Number(text(totalPriceEl).replace(/,/g, "")) : null;

    const avgDealEl = box.querySelector(".price:not(.total-price) .price-info strong");
    const avgDealDesc = text(box.querySelector(".price:not(.total-price) .price-des")); // 例："3房成交均價"
    community.avgDealUnitPrice = avgDealEl ? Number(text(avgDealEl)) : null;
    community.avgDealRoomType = avgDealDesc.replace("成交均價", "") || null;

    const onSaleTitle = box.querySelector(".community-info-onsale-title.hot");
    const onSaleCountMatch = text(onSaleTitle).match(/熱賣物件(\d+)間/);
    community.onSaleCount = onSaleCountMatch ? Number(onSaleCountMatch[1]) : null;

    const recentTag = text(box.querySelector(".tag.recent-publish")).match(/近半個月上架(\d+)間/);
    community.recentListedCount = recentTag ? Number(recentTag[1]) : null;

    const tags = Array.from(box.querySelectorAll(".community-info-onsale-title.hot .tag"));
    const dropTag = tags.map((t) => text(t)).find((t) => t.includes("降價"));
    const dropMatch = dropTag ? dropTag.match(/降價(\d+)間/) : null;
    community.priceDroppedCount = dropMatch ? Number(dropMatch[1]) : null;

    const onSaleLink = box.querySelector("a.community-info-onsale");
    community.onSaleListUrl = onSaleLink ? onSaleLink.href.split("?")[0] : null;

    community.roomBreakdown = Array.from(box.querySelectorAll(".community-info-onsale-room > li")).map((li) => {
      const numText = text(li.querySelector(".num")); // 例："三房(64間)"
      const numMatch = numText.match(/^(.+?)\((\d+)間\)$/);
      const sizeText = readOrdered(li.querySelector(".area")).replace(/坪$/, "").trim(); // 已修正亂序
      const priceStrong = text(li.querySelector(".price strong")).replace(/,/g, "");
      const [priceMin, priceMax] = priceStrong.split("~").map((v) => (v ? Number(v) : null));
      return {
        roomType: numMatch ? numMatch[1] : numText,
        count: numMatch ? Number(numMatch[2]) : null,
        sizeText: sizeText ? `${sizeText}坪` : null,
        priceMin: priceMin ?? null,
        priceMax: priceMax ?? priceMin ?? null,
      };
    });
    if (community.roomBreakdown.length === 0) warnings.push("社區房型分布抓不到（.community-info-onsale-room）");

    const priceLink = box.querySelector("a.community-info-price");
    community.dealListUrl = priceLink ? priceLink.href.split("?")[0] : null;
    const dealCountMatch = text(box.querySelector(".community-info-onsale-title:not(.hot)")).match(/實價登錄(\d+)筆/);
    community.dealCount = dealCountMatch ? Number(dealCountMatch[1]) : null;

    community.recentDeals = Array.from(box.querySelectorAll(".onsale-list-item")).map((item) => {
      const spans = Array.from(item.querySelectorAll(":scope > span"));
      const field = (label) => {
        const span = spans.find((s) => text(s.querySelector("em")) === label);
        if (!span) return null;
        const em = span.querySelector("em");
        return span.textContent.replace(text(em), "").trim();
      };
      return {
        yearMonth: field("年月："),
        layout: field("格局："),
        size: field("坪數："),
        floor: field("樓層："),
        unitPrice: field("單價："),
        totalPrice: field("總價："),
      };
    });

    out.community = community;
    return out;
  });

  raw.sourceUrl = page.url();
  raw.fetchedAt = new Date().toISOString();
  return raw;
}

/**
 * 從 591 主站的關鍵字搜尋頁（`sale.591.com.tw/?region=N&keywords=社區名`）抽出
 * 同社區實際在售的個別物件——這才是真正逐筆比較的「競品」，不是社區級的統計數字。
 *
 * 搜尋結果會混進不相干的東西（熱銷建案廣告、「依您的偏好推薦」的別區物件），
 * 所以每張卡片都要過濾：社區名對得上（統一「悅／悦」異體字），或行政區＋路名對得上
 * （社區名拼法對不上時的備援）。兩個都對不上的一律丟掉，寧可少也不要混進別的社區。
 *
 * 只抓頁面載入當下已經渲染出來的卡片（三十筆左右），不模擬捲動、不翻頁把 145 筆抓完——
 * 那會從「看一頁」變成「把整份清單搬過來」，已經不是這支工具談過的風險範圍。
 * 報告裡誠實寫「搜尋找到 N 筆，頁面顯示 M 筆，其中 K 筆屬本社區」。
 *
 * ⚠️ 刻意不抓經紀人姓名／公司。本人 2026-09-14 拍板：報告（含內部版）一律不秀其他仲介的
 *    經紀人與公司，所以從源頭就不收這個欄位，免得之後哪個版面又不小心印出來。
 */
export async function extractSearchComps(page, subject) {
  return page.evaluate((subject) => {
    function text(el) {
      return el ? el.textContent.trim() : "";
    }
    function normalizeName(s) {
      return String(s || "").replace(/悦/g, "悅").replace(/[\s　()（）]/g, "");
    }
    // 這幾個是 591 的功能標籤，不是物件屬性，放進報告只會干擾。
    const UI_TAGS = new Set(["AI即時回覆", "影片房屋", "AI影音講房", "VR賞屋", "AI裝潢前", "AI裝潢後"]);

    const foundMatch = document.body.innerText.match(/已為你找到\s*([\d,]+)\s*間房屋/);
    const foundCount = foundMatch ? Number(foundMatch[1].replace(/,/g, "")) : null;

    const wantName = normalizeName(subject.communityName);
    const items = Array.from(document.querySelectorAll(".ware-item"));
    const comps = [];
    for (const item of items) {
      const link = item.querySelector(".ware-item__header a[href*='/detail/']");
      if (!link) continue; // 建案廣告卡沒有物件連結

      const community = text(item.querySelector(".ware-item__community"));
      const district = text(item.querySelector(".ware-item__section")).replace(/-$/, "");
      const road = text(item.querySelector(".ware-item__address"));
      const nameMatch = wantName && normalizeName(community) === wantName;
      const addressMatch =
        subject.district && subject.road && district === subject.district && subject.road.includes(road) && road.length >= 3;
      if (!nameMatch && !addressMatch) continue;

      const attrs = Array.from(item.querySelectorAll(".ware-item__attr")).map((a) => text(a));
      const pick = (re) => attrs.map((a) => a.match(re)).find(Boolean);
      const sizeM = pick(/^權狀([\d.]+)坪$/);
      const mainM = pick(/^主建([\d.]+)坪$/);
      const floorM = pick(/^([^/]+F|整棟|B\d+~?\d*F?)\/(\d+F)$/);
      const ageM = pick(/^(\d+(?:年|個月))$/);
      const layoutM = pick(/^(\d+房.*)$/);

      const priceSection = item.querySelector(".ware-item__price-section");
      const totalRaw = text(item.querySelector(".ware-item__price-value")).replace(/,/g, "");
      const unitM = text(priceSection).match(/([\d.]+)\s*萬\/坪/);

      comps.push({
        title: text(link) || link.getAttribute("title") || null,
        url: link.href.split("?")[0],
        community: community || null,
        buildingType: attrs[0] && !/[房坪年F]/.test(attrs[0]) ? attrs[0] : null,
        layout: layoutM ? layoutM[1] : null,
        sizePing: sizeM ? Number(sizeM[1]) : null,
        mainPing: mainM ? Number(mainM[1]) : null,
        ageText: ageM ? ageM[1] : null,
        floor: floorM ? `${floorM[1]}/${floorM[2]}` : null,
        totalPrice: totalRaw && !Number.isNaN(Number(totalRaw)) ? Number(totalRaw) : null,
        priceIncludesParking: /含車位價/.test(text(item.querySelector(".ware-item__price-note"))),
        priceDrop: text(item.querySelector(".ware-item__price-down span")) || null,
        unitPrice: unitM ? Number(unitM[1]) : null,
        tags: Array.from(item.querySelectorAll(".tags-row__item"))
          .map((t) => text(t))
          .filter((t) => t && !UI_TAGS.has(t)),
      });
    }
    return { foundCount, renderedCount: items.length, comps };
  }, subject);
}
