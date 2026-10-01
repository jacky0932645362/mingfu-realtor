/**
 * 假的樂屋刊登表單（給 test-fill-rakuya-e2e.mjs 用）。
 *
 * 樂屋是原生 <select>／<input>／<radio>（不像 591 是 Ant Design 虛擬下拉），這裡照 lib/rakuya-map.js
 * 檔頭註解的欄位 name 做——法定用途→現況型式→現況類型三連選、縣市→行政區→街道三連選都是「選了才長出下一個選項」。
 *
 * ⚠️ 這只是「長得像」，不是樂屋本尊。真表單以本人登入後實測為準；這裡抓的是程式邏輯錯誤（漏 await、選錯格、例外）。
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const opt = (v) => `<option value="${esc(v)}">${esc(v)}</option>`;
const sel = (name, opts, extra = "") => `<select name="${name}" ${extra}><option value="">請選擇</option>${opts.map(opt).join("")}</select>`;
const txt = (name, extra = "") => `<input type="text" name="${name}" ${extra}>`;
const radioGroup = (name, opts) => opts.map((o) => `<label><input type="radio" name="${name}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join("");
const checkGroup = (name, opts) => opts.map((o) => `<label><input type="checkbox" name="${name}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join("");
const row = (label, inner) => `<div class="row"><label class="row-label">${esc(label)}</label>${inner}</div>`;

const LEGAL = ["住家用", "住商用", "商業用", "工業用", "農業用", "一般事務所"];
const USECODE_SALE = ["住宅", "套房"];
const USECODE_RENT = ["整層住家", "獨立套房"];
const TYPECODE = ["電梯大廈", "華廈", "透天厝", "公寓", "別墅", "樓中樓"];
const CITIES = ["台中市", "台北市"];
const ZIPCODES = ["梧棲區", "清水區"];
const ROADS = ["四維路", "文興路", "臨港路四段", "八德路"];

export function buildRakuyaMock(kind) {
  const rent = kind === "rent";
  const body = [
    row("法定用途", sel("selectPropertyUsecode", LEGAL)),
    row("現況型式", sel("usecode", rent ? USECODE_RENT : USECODE_SALE)),
    row("現況類型", sel("typecode", TYPECODE)),
    !rent ? row("屋齡分類", radioGroup("agetype", ["新屋", "中古屋"])) : "",
    row("物件名稱", txt("hname", 'maxlength="25"')),
    row("縣市", sel("city", CITIES)),
    row("行政區", sel("zipcode", ZIPCODES)),
    row("街道", sel("addr_road", ROADS)),
    row("巷", txt("addr_lane")),
    row("弄", txt("addr_alley")),
    row("號", txt("addr_num")),
    row("是否社區", radioGroup("is_community", ["是社區", "非社區"])),
    row("社區名稱", sel("community", ["和築好好窩", "領袖天廈", "聯悅臻"]) + txt("community_new", 'style="display:none"')),
    row("樓層類型", radioGroup("floors_type", ["單層", "多層"])),
    `<div class="row"><label class="row-label">樓層</label>${txt("floors", 'style="display:none" data-single="1"')}${txt("floors", 'data-multi="1"')}${txt("floors_max")}</div>`,
    row("總樓層", txt("surfloors")),
    row("房", sel("bedrooms", ["0", "1", "2", "3", "4", "5"])),
    row("廳", sel("livingrooms", ["0", "1", "2", "3"])),
    row("衛", sel("bathrooms", ["0", "1", "2", "3"])),
    row("屋齡", txt("findate") + `<label><input type="checkbox" name="findateUnknow"><span>屋齡不詳</span></label>`),
    row("朝向", sel("direction", ["坐北朝南", "坐南朝北", "坐東朝西", "坐西朝東"])),
    row("電梯", rent ? sel("lifts", ["有", "無"]) : radioGroup("lifts", ["有", "無"])),
    row("車位", radioGroup("parkings", rent ? ["無車位", "自有"] : ["無車位", "有車位"])),
    row("車位型式", radioGroup("parkings_kind", ["坡道平面式", "坡道機械式", "昇降平面式", "昇降機械式", "機械循環式", "庭院式", "獨立車庫", "電腦選號", "機械式車位", "平面式車位"])),
    row("車位坪數", txt("reg_garagesize")),
    rent ? row("可使用坪數", txt("mainsize")) : row("權狀坪數", txt("totalsize") + `<label><input type="checkbox" name="is_size_including_parkings"><span>含車位</span></label>`),
    !rent ? row("主建物", txt("mainsize")) : "",
    !rent ? row("附屬建物", txt("subsize")) : "",
    !rent ? row("共有部分", txt("sharesize")) : "",
    row("土地坪數", txt("basesize")),
    row("管理方式", sel("manage", ["管理員(警衛)", "無"])),
    row("管理費", txt("securityfee")),
    !rent ? row("售價", txt("listprice") + `<label><input type="checkbox" name="is_price_including_parkings"><span>含車位</span></label>` + `<label><input type="checkbox" name="is_calc_single_price"><span>算單價</span></label>`) : "",
    rent ? row("租金", txt("rental")) : "",
    rent ? row("租金包含", checkGroup("rental_include[]", ["水費", "電費", "第四台", "網路費", "瓦斯費", "管理費", "停車費", "清潔費"])) : "",
    rent ? row("押金", sel("deposit_m", ["1個月租金", "2個月租金", "其他押金", "面議"])) : "",
    rent ? row("產權登記", radioGroup("property_right", ["有", "無"])) : "",
    rent ? row("短期租賃", radioGroup("short_rent", ["可", "不可"])) : "",
    rent ? `<label><input type="checkbox" name="is_immigrate_anytime"><span>隨時可遷入</span></label>` : "",
    rent ? row("開伙", radioGroup("cook", ["可", "不可"])) : "",
    rent ? row("寵物", radioGroup("pet", ["可", "不可"])) : "",
    rent ? row("性別限制", radioGroup("sex", ["不限", "限男", "限女"])) : "",
    rent ? row("身份限制", radioGroup("ridentity", ["不限", "限學生", "限上班族"])) : "",
    rent ? row("房東同住", radioGroup("landlord", ["與房東同住", "不與房東同住"])) : "",
    `<div class="note-editable" contenteditable="true"></div>`,
    row("鄰近國小", txt("elementary")),
    row("鄰近市場", txt("market")),
    row("鄰近公園", txt("park")),
    row("交通", txt("transport")),
    row("捷運", txt("mrt")),
    row("機能", txt("vital_function")),
    row("聯絡方式", radioGroup("isOwnerContact", ["與屋主同一人", "自行填寫"])),
    row("聯絡人姓名", txt("contact_name")),
    row("行動電話", txt("tel2")),
    row("Email", txt("email")),
    row("市話", txt("tel1")),
    row("區碼", sel("tel1_pre", ["04", "02"])),
    `<input type="file" name="surface_image_input" multiple>`,
  ]
    .filter(Boolean)
    .join("\n");

  return `<!doctype html><html><head><meta charset="utf-8"><title>mock rakuya</title>
<style>[style*="display:none"]{display:none}</style>
</head><body>
<form id="f">${body}</form>
<script>
(() => {
  window.__mock = { events: [] };
  const byName = (n) => document.querySelector('[name="' + n + '"]');
  const allByName = (n) => [...document.querySelectorAll('[name="' + n + '"]')];
  const track = (name) => { const els = allByName(name); els.forEach(el => el.addEventListener('change', () => window.__mock.events.push(name + ':' + (el.type === 'checkbox' ? (el.checked ? el.value || 'on' : '(取消)' + (el.value||'')) : el.value)))); };
  ['selectPropertyUsecode','usecode','typecode','city','zipcode','addr_road','community','bedrooms','livingrooms','bathrooms','direction','lifts','manage','deposit_m','tel1_pre'].forEach(track);
  document.querySelectorAll('input[type=radio], input[type=checkbox]').forEach(el => el.addEventListener('change', () => window.__mock.events.push(el.name + ':' + (el.type === 'checkbox' ? (el.checked ? 'on' : 'off') : el.value))));

  // 法定用途 → 現況型式 → 現況類型：串接，選了上一個才「解鎖」下一個（用 disabled 模擬要等待）
  const chain = [['selectPropertyUsecode','usecode'], ['usecode','typecode'], ['city','zipcode'], ['zipcode','addr_road']];
  chain.forEach(([from, to]) => {
    const a = byName(from), b = byName(to);
    if (!a || !b) return;
    b.disabled = true;
    a.addEventListener('change', () => { setTimeout(() => { b.disabled = false; }, 80); });
  });

  // 是否社區：切社區時顯示 select，切非社區顯示 community_new 文字框
  const isCommunity = allByName('is_community');
  const communitySel = byName('community');
  const communityNew = byName('community_new');
  isCommunity.forEach(r => r.addEventListener('change', () => {
    const yes = r.value === '是社區' && r.checked;
    if (r.checked) { communitySel.style.display = yes ? '' : 'none'; communityNew.style.display = yes ? 'none' : ''; }
  }));

  // 樓層類型：單層/多層切換哪個 floors 輸入框可見
  const floorsInputs = allByName('floors');
  const single = floorsInputs.find(i => i.dataset.single);
  const multi = floorsInputs.find(i => i.dataset.multi);
  allByName('floors_type').forEach(r => r.addEventListener('change', () => {
    if (!r.checked) return;
    const isMulti = r.value === '多層';
    single.style.display = isMulti ? 'none' : '';
    multi.style.display = isMulti ? '' : 'none';
  }));

  // 車位：選「有車位/自有」才讓「車位型式」「車位坪數」可以互動（這裡不隱藏，僅記錄）
  // 聯絡方式：切「自行填寫」清空 tel2/email/tel1（模擬樂屋真的會清掉），contact_name 保留手動填
  allByName('isOwnerContact').forEach(r => r.addEventListener('change', () => {
    if (r.checked && r.value === '自行填寫') {
      window.__mock.clearedOnOwnerContact = true;
      byName('tel2').value = '';
      byName('email').value = '';
      byName('tel1').value = '';
    }
  }));

  document.querySelector('[name=surface_image_input]').addEventListener('change', (ev) => { window.__mock.files = (window.__mock.files || 0) + ev.target.files.length; });
})();
</script></body></html>`;
}
