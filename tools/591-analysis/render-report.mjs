/**
 * 把 extract.mjs 抽出來的資料，變成一份 HTML 報告。
 *
 * 一份報告兩個區塊：
 *   1. 內部判讀 —— 給本人自己看，數字完整，附 591 原始連結方便深入查。
 *   2. 屋主溝通版 —— 乾淨、有品牌署名、適合截圖或列印給屋主看的卡片。
 *      只放「591 已經公開顯示的數字」，不生成任何買賣建議或漲跌判斷 ——
 *      要不要調價是本人跟屋主談的事，這份報告只負責把行情攤在桌上。
 *
 * 色票沿用 tools/land-tax-calculator.html 那一份（品牌紅 + 中性色階），
 * 見 reference_品牌識別.md 的 CIS 色票。
 */

const ROOM_LABELS = ["", "一房", "二房", "三房", "四房", "五房", "六房", "七房", "八房"];

function roomCountFromLayout(layout) {
  if (!layout) return null;
  const m = layout.match(/^(\d+)房/);
  return m ? Number(m[1]) : null;
}

function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("zh-TW");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** 標的物件單價 vs 同房型社區成交均價，算出差距。找不到可比對象就回 null，不硬湊。 */
function comparePositioning(data) {
  const { unitPrice, layout, community } = data;
  if (!unitPrice?.value || !community) return null;

  const roomCount = roomCountFromLayout(layout);
  const roomLabel = roomCount ? ROOM_LABELS[roomCount] : null;

  // 591 兩個地方數字系統不一樣：房型分布用中文數字「三房」，成交均價用阿拉伯數字「3房」。
  // 兩邊都還原成房數再比，不直接比字串，才不會因為數字系統不同誤判成「對不上」。
  const avgDealRoomCount = community.avgDealRoomType ? Number((community.avgDealRoomType.match(/^(\d+)房/) || [])[1]) : null;

  // 優先用「X房成交均價」——是真實成交價，比在售開價更貼近行情
  if (community.avgDealUnitPrice && roomCount && avgDealRoomCount === roomCount) {
    const diff = unitPrice.value - community.avgDealUnitPrice;
    const pct = (diff / community.avgDealUnitPrice) * 100;
    return {
      basis: `同社區${roomLabel}成交均價`,
      baseValue: community.avgDealUnitPrice,
      diffPct: pct,
    };
  }
  return null;
}

function positioningLabel(pct) {
  if (pct == null) return { text: "—", tone: "neutral" };
  if (Math.abs(pct) <= 3) return { text: "貼近行情", tone: "neutral" };
  if (pct > 0) return { text: `高於行情 ${pct.toFixed(1)}%`, tone: "high" };
  return { text: `低於行情 ${Math.abs(pct).toFixed(1)}%`, tone: "low" };
}

function renderSpecRow(label, value) {
  if (!value) return "";
  return `<div class="spec-row"><span class="spec-key">${escapeHtml(label)}</span><span class="spec-val">${escapeHtml(value)}</span></div>`;
}

function renderRoomBreakdownRows(rows, subjectRoomCount) {
  if (!rows?.length) return `<p class="muted">社區房型分布資料不足。</p>`;
  return `
    <table class="data-table">
      <thead><tr><th>房型</th><th>在售間數</th><th>坪數</th><th>總價區間（萬）</th></tr></thead>
      <tbody>
        ${rows
          .map((r) => {
            const isSubject = subjectRoomCount && r.roomType === ROOM_LABELS[subjectRoomCount];
            return `<tr class="${isSubject ? "is-subject" : ""}">
              <td>${escapeHtml(r.roomType)}${isSubject ? '<span class="chip">本件房型</span>' : ""}</td>
              <td>${r.count ?? "—"}</td>
              <td>${escapeHtml(r.sizeText || "—")}</td>
              <td>${r.priceMin != null ? `${fmtMoney(r.priceMin)}${r.priceMax && r.priceMax !== r.priceMin ? `~${fmtMoney(r.priceMax)}` : ""}` : "—"}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>`;
}

function renderDealRows(deals) {
  if (!deals?.length) return `<p class="muted">頁面上沒有顯示實價登錄樣本。</p>`;
  return `
    <table class="data-table">
      <thead><tr><th>年月</th><th>格局</th><th>坪數</th><th>樓層</th><th>單價</th><th>總價</th></tr></thead>
      <tbody>
        ${deals
          .map(
            (d) => `<tr>
              <td>${escapeHtml(d.yearMonth || "—")}</td>
              <td>${escapeHtml(d.layout || "—")}</td>
              <td>${escapeHtml(d.size || "—")}</td>
              <td>${escapeHtml(d.floor || "—")}</td>
              <td>${escapeHtml(d.unitPrice || "—")}</td>
              <td>${escapeHtml(d.totalPrice || "—")}</td>
            </tr>`,
          )
          .join("")}
      </tbody>
    </table>`;
}

export function renderReport(data, owner) {
  const community = data.community;
  const positioning = comparePositioning(data);
  const posLabel = positioning ? positioningLabel(positioning.diffPct) : null;
  const subjectRoomCount = roomCountFromLayout(data.layout);
  const fetchedDate = new Date(data.fetchedAt).toLocaleString("zh-TW", { hour12: false });

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>591競品分析｜${escapeHtml(data.title || "")}</title>
<style>
  :root {
    --ground:#EBEEEF; --surface:#FFFFFF; --surface-2:#F5F7F7;
    --ink:#161E20; --ink-2:#4A585B; --ink-3:#68787B;
    --rule:#D2DADC; --rule-soft:#E4E9EA;
    --brand:#E00000; --brand-ink:#FFFFFF;
    --high:#A11616; --high-bg:#FCEAEA;
    --low:#0B6B5E; --low-bg:#E7F2F0;
    --neutral:#8A6D1E; --neutral-bg:#FBF4E3;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground:#101617; --surface:#182123; --surface-2:#1E292B;
      --ink:#E4EBEC; --ink-2:#A7B6B8; --ink-3:#8B9B9E;
      --rule:#2C393B; --rule-soft:#232F31;
      --brand:#FF5252; --brand-ink:#1A0505;
      --high:#FF6B6B; --high-bg:#2A1616;
      --low:#46C4AC; --low-bg:#132824;
      --neutral:#E0BB5C; --neutral-bg:#2A2419;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ground); color: var(--ink);
    font-family: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif;
    line-height: 1.6;
  }
  .wrap { max-width: 880px; margin: 0 auto; padding: 24px 16px 64px; }
  .masthead { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 20px; flex-wrap: wrap; gap: 8px; }
  .masthead h1 { font-size: 18px; margin: 0; color: var(--ink-2); font-weight: 600; }
  .masthead .meta { font-size: 12px; color: var(--ink-3); }
  section.card {
    background: var(--surface); border: 1px solid var(--rule); border-radius: 14px;
    padding: 20px 22px; margin-bottom: 20px;
  }
  section.card > h2 { font-size: 14px; letter-spacing: .04em; color: var(--ink-3); margin: 0 0 14px; text-transform: uppercase; }
  .subject-title { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
  .subject-price { display: flex; align-items: baseline; gap: 10px; margin: 10px 0 16px; }
  .subject-price .total { font-size: 30px; font-weight: 800; color: var(--brand); }
  .subject-price .unit { font-size: 14px; color: var(--ink-2); }
  .spec-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0; border-top: 1px solid var(--rule-soft); }
  .spec-row { display: flex; justify-content: space-between; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--rule-soft); font-size: 14px; }
  .spec-key { color: var(--ink-3); }
  .spec-val { font-weight: 600; }
  .stat-strip { display: flex; gap: 10px; flex-wrap: wrap; margin: 4px 0 18px; }
  .stat-pill { background: var(--surface-2); border-radius: 10px; padding: 10px 14px; flex: 1; min-width: 110px; }
  .stat-pill .num { font-size: 20px; font-weight: 800; }
  .stat-pill .label { font-size: 12px; color: var(--ink-3); }
  .position-banner { border-radius: 12px; padding: 14px 16px; margin: 4px 0 18px; font-size: 14px; }
  .position-banner .big { font-size: 18px; font-weight: 800; display: block; margin-bottom: 2px; }
  .position-banner.tone-high { background: var(--high-bg); color: var(--high); }
  .position-banner.tone-low { background: var(--low-bg); color: var(--low); }
  .position-banner.tone-neutral { background: var(--neutral-bg); color: var(--neutral); }
  .data-table { width: 100%; border-collapse: collapse; font-size: 13.5px; margin-top: 4px; }
  .data-table th { text-align: left; color: var(--ink-3); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--rule); }
  .data-table td { padding: 8px; border-bottom: 1px solid var(--rule-soft); }
  .data-table tr.is-subject td { background: var(--surface-2); font-weight: 700; }
  .chip { display: inline-block; margin-left: 6px; font-size: 11px; background: var(--brand); color: var(--brand-ink); border-radius: 999px; padding: 1px 8px; font-weight: 600; }
  .muted { color: var(--ink-3); font-size: 13px; }
  .links { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; margin-top: 6px; }
  .links a { color: var(--ink-2); }
  .disclaimer { font-size: 11.5px; color: var(--ink-3); border-top: 1px dashed var(--rule); padding-top: 10px; margin-top: 8px; }

  /* ── 屋主溝通版：獨立卡片樣式，設計成適合截圖 ──
     用 section.share-card（跟 section.card 同特異度）才蓋得掉上面 section.card 的灰框，
     單純 .share-card 特異度較低，之前被 section.card 的灰色框蓋掉過。 */
  section.share-card { background: linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%); border: 2px solid var(--brand); border-radius: 18px; padding: 26px 24px; }
  .share-card .brand-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
  .share-card .brand-name { font-weight: 800; font-size: 15px; color: var(--brand); }
  .share-card .brand-contact { font-size: 12px; color: var(--ink-3); }
  .share-card .headline { font-size: 17px; font-weight: 700; margin: 4px 0 18px; }
  .share-card .kpi-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 18px; }
  .share-card .kpi { text-align: center; background: var(--surface); border-radius: 10px; padding: 12px 6px; }
  .share-card .kpi .num { font-size: 19px; font-weight: 800; }
  .share-card .kpi .label { font-size: 11px; color: var(--ink-3); margin-top: 2px; }
  .share-card .sentence { font-size: 14.5px; margin: 10px 0; padding: 12px 14px; background: var(--surface); border-radius: 10px; border-left: 3px solid var(--brand); }
  .print-hint { text-align: center; font-size: 12px; color: var(--ink-3); margin-top: 10px; }
  @media print { .no-print { display: none; } .wrap { max-width: none; } }
</style>
</head>
<body>
<div class="wrap">

  <div class="masthead">
    <h1>591 競品分析報告</h1>
    <span class="meta">擷取時間：${escapeHtml(fetchedDate)}</span>
  </div>

  <section class="card">
    <h2>標的物件</h2>
    <p class="subject-title">${escapeHtml(data.title || "（無標題）")}</p>
    <div class="subject-price">
      <span class="total">${fmtMoney(data.totalPrice?.value)} 萬${data.totalPrice?.includesParking ? "（含車位）" : ""}</span>
      <span class="unit">單價 ${escapeHtml(data.unitPrice?.raw || "—")}</span>
    </div>
    <div class="spec-grid">
      ${renderSpecRow("格局", data.layout)}
      ${renderSpecRow("屋齡", data.ageYears != null ? `${data.ageYears}年` : null)}
      ${renderSpecRow("權狀坪數", data.registeredPing)}
      ${renderSpecRow("樓層", data.floor)}
      ${renderSpecRow("朝向", data.orientation)}
      ${renderSpecRow("社區", data.communityName)}
      ${renderSpecRow("地址", data.address)}
    </div>
  </section>

  ${
    community
      ? `
  <section class="card">
    <h2>社區行情總覽 —— ${escapeHtml(community.name || "")}</h2>
    <div class="stat-strip">
      <div class="stat-pill"><div class="num">${community.onSaleCount ?? "—"}</div><div class="label">目前在售（間）</div></div>
      <div class="stat-pill"><div class="num">${community.recentListedCount ?? "—"}</div><div class="label">近半個月新上架</div></div>
      <div class="stat-pill"><div class="num">${community.priceDroppedCount ?? "—"}</div><div class="label">已降價</div></div>
      <div class="stat-pill"><div class="num">${community.avgDealUnitPrice ? `${community.avgDealUnitPrice}萬` : "—"}</div><div class="label">${escapeHtml(community.avgDealRoomType || "")}成交均價/坪</div></div>
    </div>

    ${
      positioning
        ? `<div class="position-banner tone-${posLabel.tone}">
            <span class="big">${escapeHtml(posLabel.text)}</span>
            本件單價 ${data.unitPrice.value}萬/坪，對照${escapeHtml(positioning.basis)} ${positioning.baseValue}萬/坪
          </div>`
        : `<p class="muted">本件房型與社區成交均價的房型對不上，或社區資料不足，這裡先不算差距。</p>`
    }

    <h3 style="font-size:13px;color:var(--ink-3);margin:18px 0 8px;">在售房型分布</h3>
    ${renderRoomBreakdownRows(community.roomBreakdown, subjectRoomCount)}

    <h3 style="font-size:13px;color:var(--ink-3);margin:18px 0 8px;">實價登錄樣本（頁面顯示的部分，共 ${community.dealCount ?? "—"} 筆）</h3>
    ${renderDealRows(community.recentDeals)}

    <p class="links no-print">
      <a href="${community.onSaleListUrl || "#"}" target="_blank" rel="noopener">→ 591 看全部在售物件</a>
      <a href="${community.dealListUrl || "#"}" target="_blank" rel="noopener">→ 591 看全部實價登錄</a>
      <a href="${data.sourceUrl}" target="_blank" rel="noopener">→ 回原始物件頁</a>
    </p>
  </section>
  `
      : `<section class="card"><h2>社區行情總覽</h2><p class="muted">這頁沒有抓到社區資料（community 區塊缺失），可能是這個物件沒有掛社區，或 591 改版了。</p></section>`
  }

  <section class="card share-card">
    <div class="brand-row">
      <span class="brand-name">${escapeHtml(owner.brandPersona)}</span>
      <span class="brand-contact">${escapeHtml(owner.phone)}</span>
    </div>
    <p class="headline">${escapeHtml(community?.name || data.communityName || "本社區")}・市場行情比較</p>

    <div class="kpi-row">
      <div class="kpi"><div class="num">${community?.onSaleCount ?? "—"}</div><div class="label">目前在售</div></div>
      <div class="kpi"><div class="num">${community?.avgDealUnitPrice ? `${community.avgDealUnitPrice}萬` : "—"}</div><div class="label">成交均價/坪</div></div>
      <div class="kpi"><div class="num">${data.unitPrice?.raw ? data.unitPrice.raw.replace("萬/坪", "萬") : "—"}</div><div class="label">本件單價/坪</div></div>
    </div>

    <p class="sentence">
      ${escapeHtml(data.communityName || "本社區")}目前${community?.onSaleCount != null ? `有 ${community.onSaleCount} 間在售` : "在售物件資料不足"}${community?.priceDroppedCount ? `，其中 ${community.priceDroppedCount} 間已降價` : ""}。
      ${positioning ? `這間${escapeHtml(data.layout || "")}單價${escapeHtml(posLabel.text)}（${escapeHtml(positioning.basis)} ${positioning.baseValue}萬/坪）。` : ""}
    </p>

    <p class="print-hint no-print">此區塊可直接截圖或列印給屋主看</p>
  </section>

  <p class="disclaimer">
    資料來源：591房屋交易網（<a href="${data.sourceUrl}" target="_blank" rel="noopener">原始物件頁</a>），擷取時間 ${escapeHtml(fetchedDate)}。
    社區在售與成交數字為擷取當下的 591 頁面內容，會隨時間變動，僅供參考，實際請以 591 當下顯示與正式契約為準。
    本報告只整理 591 公開顯示的行情數據，不構成買賣或訂價建議。
  </p>

</div>
</body>
</html>`;
}
