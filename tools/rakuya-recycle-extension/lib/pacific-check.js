/**
 * 太平洋官網下架檢查（2026-10-02 本人要求）：樂屋描述最後一行放的是太平洋房屋官網的
 * 公開物件頁連結（R 開頭＝出租）。這支負責「抓那一頁、判斷這戶還在不在官網上」。
 *
 * 判斷依據（用真實頁面驗證過，fixtures 是對正式站抓下來的）：官網詳情頁的 og:title／
 * og:description 是伺服器端直接寫在 HTML 裡的（不是前端 Angular 才長出來）。
 *  - 還在的物件：og:title＝物件標題，og:description＝「租金23000元，坪數53.19坪」
 *  - 不存在的 saleID：HTTP 一樣 200，但 og:title／og:description 是空字串
 *
 * ⚠️ 沒有「真的剛出租掉的物件」樣本可驗證官網那時候怎麼顯示——假設它跟「不存在」一樣
 * （og:title 變空）。所以不輕易判定：連抓兩次都一樣才算數，抓不到（網路/HTTP 錯誤）
 * 永遠只算「檢查失敗」不算下架。
 *
 * 租金變動不算下架（屋主調價很常見）；只有「抓不到內容」或「坪數跟第一次記下來的差太多
 * （像是同一個編號變成別戶）」才判定內容已不符。
 */

const PACIFIC_URL_RE = /https?:\/\/(?:www\.)?pacific\.com\.tw\/[^\s"'<>)）]+/gi;
const PING_TOLERANCE = 0.5;

/** 從描述文字（或 HTML）找太平洋官網連結；描述最後一行才是，所以取最後一個 */
export function extractPacificUrl(...texts) {
  for (const t of texts) {
    const m = String(t || "").match(PACIFIC_URL_RE);
    if (m && m.length) return m[m.length - 1].replace(/&amp;/g, "&").replace(/[，。,.]+$/, "");
  }
  return "";
}

function metaContent(html, prop) {
  const m = html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i"));
  return m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim() : "";
}

export function parsePacificPage(html) {
  const title = metaContent(html, "og:title");
  const desc = metaContent(html, "og:description");
  const rentM = desc.match(/租金\s*([\d,]+)\s*元/);
  const pingM = desc.match(/坪數\s*([\d.]+)\s*坪/);
  return {
    exists: title !== "" && title !== "太平洋房屋",
    title,
    rent: rentM ? Number(rentM[1].replace(/,/g, "")) : null,
    ping: pingM ? Number(pingM[1]) : null,
  };
}

/**
 * baseline：第一次成功抓到時記下的 {title, rent, ping}。回傳
 *  { verdict: "same" | "gone" | "changed", reasons: [], notes: [] }
 * 租金變了只放進 notes（回報用），不影響 verdict。
 */
export function judgePacific(baseline, page) {
  if (!page.exists) return { verdict: "gone", reasons: ["官網頁面已經沒有這戶的內容"], notes: [] };
  const reasons = [];
  const notes = [];
  if (baseline?.ping != null && page.ping != null && Math.abs(baseline.ping - page.ping) > PING_TOLERANCE) {
    reasons.push(`坪數從 ${baseline.ping} 變成 ${page.ping}`);
  }
  if (baseline?.rent != null && page.rent != null && baseline.rent !== page.rent) {
    notes.push(`租金從 ${baseline.rent} 變成 ${page.rent}（只提醒，不算下架）`);
  }
  return { verdict: reasons.length ? "changed" : "same", reasons, notes };
}

export async function fetchPacificPage(url, { timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { credentials: "omit", signal: ctrl.signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, page: parsePacificPage(await res.text()) };
  } catch (e) {
    return { ok: false, error: `抓取失敗：${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 檢查一筆快照。不動樂屋、不寫儲存，只回報判斷：
 *  verdict: "no_link" | "never_seen" | "fetch_failed" | "same" | "delist"
 *  baseline: 第一次抓成功時要存起來的基準（呼叫端負責存）
 * 疑似下架（gone/changed）會等 gapMs 後再抓一次，兩次都不對才回 "delist"，
 * 第二次又恢復正常就當網站偶發錯誤，回 "same"。
 */
export async function checkPacific(snap, { gapMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const url = snap.pacificUrl || extractPacificUrl(snap.capturedDescText, snap.capturedDescHtml);
  if (!url) return { verdict: "no_link" };

  const first = await fetchPacificPage(url);
  if (!first.ok) return { verdict: "fetch_failed", url, error: first.error };

  // 第一次就是好的：沒有基準就記下當基準
  if (first.page.exists && !snap.pacificBaseline) {
    return { verdict: "same", url, baseline: { title: first.page.title, rent: first.page.rent, ping: first.page.ping }, notes: [] };
  }

  /* 🔴 從來沒成功看到過這戶（沒有基準、頁面又是空的）：可能連結本來就貼錯、或官網還沒同步，
     不是「下架」。沒有「曾經在過」的證據，絕不自動下架，只回報讓本人自己看。 */
  if (!snap.pacificBaseline) return { verdict: "never_seen", url };

  const j1 = judgePacific(snap.pacificBaseline, first.page);
  if (j1.verdict === "same") return { verdict: "same", url, notes: j1.notes, page: first.page };

  // 疑似下架：隔幾秒再確認一次
  await sleep(gapMs);
  const second = await fetchPacificPage(url);
  if (!second.ok) return { verdict: "fetch_failed", url, error: `第二次確認抓取失敗：${second.error}` };
  const j2 = judgePacific(snap.pacificBaseline, second.page);
  if (j2.verdict === "same") return { verdict: "same", url, notes: ["第一次疑似異常、第二次恢復正常，當作偶發"], page: second.page };
  return { verdict: "delist", url, reasons: j2.reasons, page: second.page };
}
