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
 * ⚠️⚠️ `extractCommunityComps()`（社區在售物件清單頁）有一個更明確的反爬蟲機制：
 *    591 用自訂元素 `<wc-obfuscate-price>`／`<wc-obfuscate-area>`／`<wc-obfuscate-floor>`
 *    把總價、坪數、樓層直接藏起來（不是排序詭計，是內容真的不在 DOM 裡）——這已經不是
 *    「格式難解析」，是 591 明確表態「這幾個數字在列表頁不給程式讀」。**這裡刻意不試圖破解，
 *    只抓這三個元件以外、591 自己就用純文字顯示的欄位**（標題／格局／仲介／標籤／單價）。
 *    不要為了補齊總價／坪數／樓層去研究怎麼繞過這幾個自訂元素——那已經跨過「讀公開頁面」
 *    到「破解主動的技術性防護」，是刻意劃的線，不是還沒做完。要精確數字，報告會附連結，
 *    人自己點進單一物件頁看（那一頁這些欄位就是純文字，見 extractListing()）。
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
 * 從社區「在售物件」清單頁（`community.onSaleListUrl`，market.591.com.tw/{id}/sale）
 * 抽出實際在售的個別物件——這才是真正的「競品」清單，不是只有社區級的統計數字。
 *
 * 只抓頁面載入當下已經渲染出來的卡片（通常十來筆），不模擬捲動載入更多、
 * 不翻頁抓完整份 67 筆——那會從「看一頁」變成「把整份清單搬過來」，
 * 已經不是這支工具設計時談過的風險範圍。報告裡會誠實寫「頁面顯示的前 N 筆，
 * 共 M 筆」，不會假裝這就是全部。
 */
export async function extractCommunityComps(page) {
  return page.evaluate(() => {
    function text(el) {
      return el ? el.textContent.trim() : "";
    }

    const cards = Array.from(document.querySelectorAll("a > div.info"));
    return cards.map((info) => {
      const link = info.parentElement;
      const detail = info.querySelector(".detail");
      const spans = detail ? Array.from(detail.querySelectorAll(":scope > span")) : [];
      // .detail 底下第一個 span 是格局（純文字）；坪數／樓層那兩個 span 內容被
      // <wc-obfuscate-*> 自訂元件吃掉，textContent 讀出來就是空的，刻意留白不硬湊。
      const layout = spans[0] ? text(spans[0]) : null;

      return {
        title: text(info.querySelector("h3")) || null,
        url: link ? link.href.split("?")[0] : null,
        layout,
        agent: text(info.querySelector(".normal-broker-name span")) || null,
        viewCountText: text(info.querySelector(".normal-broker-browse span")) || null,
        tags: Array.from(info.querySelectorAll(".tags .tag")).map((t) => text(t)),
        unitPrice: text(info.querySelector(".price-info .price")) || null,
      };
    });
  });
}
