/**
 * 假的 591 刊登表單（給 test-fill-e2e.mjs 用）。
 *
 * 照 591 第②頁的長相（Ant Design Vue）做：.ant-form-item + .ant-form-item-label、input.ant-input、
 * .ant-input-number-input、label.ant-radio-wrapper／ant-checkbox-wrapper、.ant-select（選項清單 render 在 body 底下，
 * 用 aria-controls 對應）、街道自訂面板（.ant-dropdown .street）、ProseMirror、input[type=file][multiple]。
 *
 * ⚠️ 這只是「長得像」，不是 591 本尊。真表單以本人登入後實測為準；這裡抓的是程式邏輯錯誤（漏 await、選錯格、例外）。
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const item = (label, inner) => `<div class="ant-form-item"><div class="ant-form-item-label">${esc(label)}</div><div class="ant-form-item-control">${inner}</div></div>`;
const txt = (ph = "", extra = "") => `<input class="ant-input" placeholder="${esc(ph)}" ${extra}>`;
const num = (n = 1) => Array.from({ length: n }, () => `<div class="ant-input-number"><input class="ant-input-number-input"></div>`).join("");
const radios = (opts) => `<div class="ant-radio-group">${opts.map((o) => `<label class="ant-radio-wrapper"><span class="ant-radio"></span><span>${esc(o)}</span></label>`).join("")}</div>`;
const checks = (opts) => `<div class="ant-checkbox-group">${opts.map((o) => `<label class="ant-checkbox-wrapper"><span class="ant-checkbox"></span><span>${esc(o)}</span></label>`).join("")}</div>`;
let selN = 0;
/**
 * delayMs>0 模擬「選了鄉鎮才向伺服器要清單」的下拉（591 商辦街道就是這樣）：
 * 打開瞬間清單是空的，過 delayMs 才把選項生出來；搜尋框刻意標成 readonly（跟真的 591 一樣，
 * 這種下拉根本不是能打字篩選的，2026-09-12 用 DevTools 挖到的真結構）。
 */
const select = (opts, cls = "", delayMs = 0) => {
  const id = `mock-list-${++selN}`;
  const ro = delayMs ? "readonly" : "";
  return `<div class="ant-select ${cls}" data-options="${esc(JSON.stringify(opts))}" data-delay="${delayMs}"><div class="ant-select-selector"><input role="combobox" ${ro} aria-controls="${id}" data-list="${id}"><span class="ant-select-selection-item"></span></div></div>`;
};

const CITIES = ["台北市", "新北市", "台中市", "高雄市"];
const TOWNS = ["中區", "清水區", "梧棲區", "沙鹿區", "龍井區"];
/* 2026-09-12 真實案例（聯悅臻住宅出租）：「臨港路四段」591 搜尋整串「路名+幾段」會是 0 條，
   要搜「臨港路」（去掉幾段）才找得到——mock 用「比對時去掉幾段」模擬這個真的遇到的搜尋怪癖 */
const ROADS = ["中央路", "八德路", "四維路", "文化路", "民生街", "臨港路四段"];
/* 2026-09-16～18 真實案例（沙鹿自強路）：591 的搜尋框對這條路完全搜不到（不是「幾段」那種可以去尾
   重試的情況）——「自強路」故意不在 ROADS 裡，逼真的測到「搜尋 0 條 → 誠實回報交給本人手動選」這條
   路徑。591 的「顯示所有街道」完整清單其實有這條路，但那顆按鈕只認真人點擊、外掛自動點不了（換過
   4 種點擊方式都證實無效），所以這裡不再模擬翻頁，只需要模擬「搜尋失敗」這個狀態就夠了。 */
/* 2026-09-12 真實案例：商辦這類表單街道清單要選了鄉鎮才向伺服器要，開啟當下是空的、晚一點才出現 */
const OFFICE_ROADS = ["中央路一段", "中央路二段", "文化路", "民生街", "自強路", "光復路", "中山路", "中正路", "永安路", "四維路", "測試中路", "測試路", "和平街", "仁愛路", "信義路", "忠孝路", "建國路", "復興路", "民權路", "民族路"];
const FACING = ["坐北朝南", "坐南朝北", "坐東朝西", "坐西朝東"];

/**
 * mode："quick"＝有「填寫完整地址」快速框＋匯入；"street-panel"＝街道是自訂搜尋面板（住宅類表單常見）；
 * "office"＝沒有快速框、街道是「要打字才有選項」的一般下拉（2026-09-11 商辦真實案例）。
 *
 * 🔴 樓／樓之：2026-09-11 用 DevTools 挖過真的 591，**不管哪一種版面，樓／樓之都是自己獨立一個
 * .ant-form-item**，跟縣市/鄉鎮/街道/巷/號/之完全不同一列，而且沒有自己的欄位標籤——
 * 認得出它的只有 591 自己印的說明文字「(出租樓層0為整棟，-1為地下樓，+1為頂樓加蓋)」。
 * `fill591.js` 的 `findFloorInputs()` 就是靠這句話定位，這裡照真實結構放，回歸測試才測得到重點。
 */
function addressBlock(label, mode) {
  const quick = mode === "quick";
  const office = mode === "office";
  const street = quick
    ? select(ROADS, "road")
    : office
      ? select(OFFICE_ROADS, "road", 900)
      : `<div class="ant-select road street-select"><div class="ant-select-selector"><input role="combobox"><span class="ant-select-selection-item"></span></div></div>`;
  const row1 = item(
    label,
    (quick ? `${txt("建議填寫完整地址，例：台中市西屯區台灣大道三段99號", 'id="quick"')}<button type="button" id="import">匯入地址</button>` : "") +
      select(CITIES, "city") +
      select(TOWNS, "town") +
      street +
      txt("選填", 'data-f="lane"') +
      num(1) +
      txt("必填", 'data-f="no"') +
      txt("選填", 'data-f="sub"') +
      checks(["隱藏門號"]),
  );
  const floorWord = label.includes("出租") ? "出租" : "出售";
  const row2 = item("", radios([`${floorWord}單層`, "整棟"]) + txt("必填", 'data-f="floor"') + txt("選填", 'data-f="floorSub"') + `<span>(${floorWord}樓層0為整棟，-1為地下樓，+1為頂樓加蓋)</span>`);
  return row1 + row2;
}

export function buildMock(kind) {
  selN = 0;
  const rent = kind === "rent" || kind === "office";
  const addrMode = kind === "office" ? "office" : rent ? "quick" : "street-panel";
  const body = rent
    ? [
        addressBlock("出租地址", addrMode),
        item("出租總樓層", num(1)),
        item("電梯", radios(["有", "無"])),
        item("社區名稱", txt("選填")),
        item("格局（現況）(說明)", num(4)),
        item("可使用坪數", num(1)),
        item("權狀坪數", num(1)),
        item("車位", radios(["有", "無"]) + `<div id="park-extra" hidden>${select(["平面式", "機械式", "平面式 + 機械式", "其他"])}</div>`),
        item("建築完工時間(說明)", radios(["成屋", "屋齡不詳"]) + num(3)),
        item("朝向", select(FACING)),
        item("裝潢時間", radios(["半年內", "1年內", "3年內", "3年以上"])),
        item("裝潢程度", radios(["尚未裝潢", "簡易裝潢", "中檔裝潢", "高檔裝潢"])),
        item("最短租期", radios(["1年", "半年", "不限"])),
        item("可遷入日", checks(["隨時可遷入"]) + txt("日期")),
        item("身份要求", checks(["學生", "上班族", "家庭"])),
        item("開伙", radios(["可", "不可"])),
        item("養寵物", radios(["可", "不可"])),
        item("租金", txt("元/月")),
        item("押金", radios(["免押金", "1個月", "2個月", "其他", "面議"])),
        item("租金包含", checks(["無", "管理費", "水費", "電費", "網路", "第四台"])),
        item("水費", radios(["台水繳費", "定額"])),
        item("電費", radios(["台電繳費", "定額"])),
        item("管理費", txt("元/月") + checks(["無"])),
        `<div class="life">${checks(["近學校", "近公園綠地", "近傳統市場", "近超市"])}</div>`,
        item("廣告標題", txt("6-30字")),
        `<div class="ProseMirror" contenteditable="true"></div>`,
        item("聯絡人", txt("")),
        item("委託書", radios(["有簽訂", "無簽訂"])),
        item("產權登記", radios(["已辦產", "未辦產"])),
        item("服務費", radios(["收取服務費", "不須服務費"])),
        checks(["我已閲讀並確認經紀業資料無誤"]),
        `<input type="file" multiple id="photos">`,
      ]
    : [
        addressBlock("出售地址", "street-panel"),
        item("出售總樓層", num(1)),
        item("社區名稱", txt("選填")),
        item("格局（現況）(說明)", num(4)),
        item("建築完工時間(說明)", radios(["成屋", "預售屋"]) + num(3)),
        item("朝向", select(FACING)),
        item("權狀坪數", num(1) + radios(["含車位面積", "不含車位面積"])),
        `<div id="park-item" hidden>${item("車位面積", num(1) + select(["平面式停車位", "機械式停車位", "平面式+機械式", "其他"]))}</div>`,
        item("主建物", num(1)),
        item("附屬建物", num(1)),
        item("共有部分", num(1)),
        item("土地坪數土地持分坪數", num(1)),
        item("售價", txt("萬元") + radios(["含車位價格", "不含車位價格"])),
        item("自備款", txt("萬元")),
        item("管理費", radios(["有", "無"]) + num(1)),
        item("帶租約", radios(["是", "否"])),
        item("裝潢程度", radios(["尚未裝潢", "簡易裝潢", "中檔裝潢", "高檔裝潢"])),
        `<div class="life">${checks(["近學校", "近公園綠地", "近傳統市場", "近超市"])}</div>`,
        item("廣告標題", txt("6-30字")),
        `<div class="ProseMirror" contenteditable="true"></div>`,
        item("聯絡人", txt("")),
        item("委託書", radios(["有簽訂", "無簽訂"])),
        item("服務費", radios(["收取服務費", "不須服務費"])),
        checks(["我已閲讀並確認經紀業資料無誤"]),
        /* 2026-09-23：591 出售有專屬的「格局圖」那一格，限 1 張、不是 multiple，跟下面一般照片的
           input[type=file][multiple] 是兩個不同的上傳框——fill591.js 的 uploadFloorPlan() 要能分清楚。 */
        item("格局圖", `<input type="file" id="floorplan-photo">`),
        `<input type="file" multiple id="photos">`,
      ];

  return `<!doctype html><html><head><meta charset="utf-8"><title>mock 591</title>
<style>[hidden]{display:none!important}.ant-select-dropdown-hidden{display:none}.ant-form-item{padding:4px}.ant-select-dropdown{position:absolute;background:#fff;border:1px solid #ccc}</style>
</head><body>
<div class="ant-modal" id="city-modal"><div>請選擇你想要刊登物件的所屬縣市</div><ul>${CITIES.map((c) => `<li class="light">${c}</li>`).join("")}</ul></div>
<form id="f">${body.join("\n")}</form>
<script>
(() => {
  // 縣市彈窗
  document.querySelectorAll('#city-modal li').forEach(li => li.addEventListener('click', () => { document.getElementById('city-modal').hidden = true; window.__mock.city = li.textContent; }));
  window.__mock = { events: [], city: '' };
  // 單選／勾選
  document.addEventListener('click', (ev) => {
    const r = ev.target.closest('label.ant-radio-wrapper');
    if (r) { r.parentElement.querySelectorAll('label.ant-radio-wrapper').forEach(x => x.classList.remove('ant-radio-wrapper-checked')); r.classList.add('ant-radio-wrapper-checked'); window.__mock.events.push('radio:' + r.textContent.trim()); onRadio(r); }
    const c = ev.target.closest('label.ant-checkbox-wrapper');
    if (c) { c.classList.toggle('ant-checkbox-wrapper-checked'); window.__mock.events.push('check:' + c.textContent.trim()); }
  });
  function onRadio(r) {
    const t = r.textContent.trim();
    const pe = document.getElementById('park-extra'); if (pe && r.closest('.ant-form-item').querySelector('.ant-form-item-label').textContent === '車位') pe.hidden = t !== '有';
    const pi = document.getElementById('park-item'); if (pi && /車位面積/.test(t)) pi.hidden = t !== '含車位面積';
  }
  // Ant Select：mousedown 打開，清單 render 在 body 底下
  document.querySelectorAll('.ant-select[data-options]').forEach(sel => {
    const opts = JSON.parse(sel.dataset.options);
    const delayMs = parseInt(sel.dataset.delay, 10) || 0;
    const listId = sel.querySelector('[data-list]').dataset.list;
    const selector = sel.querySelector('.ant-select-selector');
    let dd = null;
    let loaded = delayMs === 0; // delayMs=0：跟縣市/鄉鎮一樣，開啟當下就有選項；>0：要等（模擬問伺服器）
    const render = () => {
      const show = loaded ? opts : [];
      dd.querySelector('[role=listbox]').innerHTML = show.map(o => '<div class="ant-select-item-option" title="' + o + '"><div class="ant-select-item-option-content">' + o + '</div></div>').join('');
      dd.querySelectorAll('.ant-select-item-option').forEach(o => o.addEventListener('click', () => { sel.querySelector('.ant-select-selection-item').textContent = o.title; dd.classList.add('ant-select-dropdown-hidden'); window.__mock.events.push('select:' + o.title); }));
      window.__mock.events.push('render:' + sel.className.split(' ')[1] + '=' + show.length);
    };
    selector.addEventListener('mousedown', () => {
      if (!dd) {
        dd = document.createElement('div'); dd.className = 'ant-select-dropdown';
        dd.innerHTML = '<div class="rc-virtual-list-holder"><div id="' + listId + '" role="listbox"></div></div>';
        document.body.appendChild(dd);
        render();
        if (delayMs && !loaded) setTimeout(() => { loaded = true; render(); }, delayMs);
      }
      setTimeout(() => { dd.classList.remove('ant-select-dropdown-hidden'); render(); }, 30);
    });
    document.body.addEventListener('click', (ev) => { if (dd && !dd.contains(ev.target) && !sel.contains(ev.target)) dd.classList.add('ant-select-dropdown-hidden'); });
  });
  /*
    街道自訂面板：打字 → 按放大鏡 → 清單縮小 → 點 li。
    2026-09-12 真實案例：目標路名（四維路）**故意不在預設顯示的那幾條裡**（模擬 591 真的分頁 8 頁、
    要搜尋才會出現在眼前那種情況）；搜尋鈕故意做成 <span> 不是 <button>，逼外掛不能只認 <button>。
    2026-09-18 改：這裡**只有按放大鏡才會真的搜尋**，打字跟按 Enter 都不算——這是已知事實
    （「只打字不按放大鏡、或不點下面的 li，都不會選到」），也順便擋住「怕抓不到按鈕就多送一次 Enter」
    這種保險寫法：多送等於同一次搜尋送兩遍，真站上很可能自己把自己洗掉。
  */
  const st = document.querySelector('.street-select');
  if (st) {
    let panel = null;
    const PAGE1 = ['中央路', '八德路', '文化路', '民生街']; // 故意不含「四維路」，模擬它在很後面那一頁
    st.querySelector('.ant-select-selector').addEventListener('mousedown', () => {
      if (!panel) {
        panel = document.createElement('div'); panel.className = 'ant-dropdown';
        // 「顯示所有街道」留著（真實結構裡有這顆連結），但這顆是死的：程式點它不會有反應（實測換了
        // 4 種點法都零變化，同業已驗證可用的 v1.5.3 也根本沒去點它）。留著是為了測「外掛不會浪費
        // 時間去點它」，不是為了模擬點了會怎樣
        panel.innerHTML = '<div class="street"><div class="street-header"><input placeholder="輸入街道"><span class="ant-input-group-addon">🔍</span></div><a class="show-all">顯示所有街道</a><ul class="street-content">' + ${JSON.stringify(ROADS)}.map(r => '<li' + (PAGE1.includes(r) ? '' : ' hidden') + '>' + r + '</li>').join('') + '</ul></div>';
        document.body.appendChild(panel);
        const input = panel.querySelector('input');
        const ul = panel.querySelector('.street-content');
        // 591 的搜尋只認路名主體：比對用「去掉幾段」的 key，不是顯示出來的完整文字；搜不到的路名（例如
        // 「自強路」）不在 ROADS 裡，怎麼搜都是 0 條，逼真的測到「搜尋失敗→誠實回報」這條路徑
        const searchKey = (s) => s.replace(/(?:[一二三四五六七八九十]+|\d+)段$/, '');
        const doSearch = () => {
          ul.querySelectorAll('li').forEach(li => li.hidden = !searchKey(li.textContent).includes(input.value));
          window.__mock.events.push('street-search:' + input.value);
        };
        panel.querySelector('.ant-input-group-addon').addEventListener('click', doSearch);
        ul.querySelectorAll('li').forEach(li => li.addEventListener('click', () => { st.querySelector('.ant-select-selection-item').textContent = li.textContent; panel.hidden = true; window.__mock.events.push('street:' + li.textContent); }));
      }
      panel.hidden = false;
    });
  }
  // 匯入地址：選好縣市／鄉鎮／街道並填「號」，不填樓
  const imp = document.getElementById('import');
  if (imp) imp.addEventListener('click', () => {
    const v = document.getElementById('quick').value;
    const m = v.match(/^(.{2}[縣市])(.{1,4}?[區鄉鎮市])(.+?)(\\d+)(?:之(\\d+))?號$/);
    window.__mock.events.push('import:' + v);
    if (!m) return;
    const sels = imp.closest('.ant-form-item').querySelectorAll('.ant-select');
    sels[0].querySelector('.ant-select-selection-item').textContent = m[1];
    sels[1].querySelector('.ant-select-selection-item').textContent = m[2];
    sels[2].querySelector('.ant-select-selection-item').textContent = m[3].replace(/\\d+巷.*$/, '');
    imp.closest('.ant-form-item').querySelector('[data-f=no]').value = m[4];
    if (m[5]) imp.closest('.ant-form-item').querySelector('[data-f=sub]').value = m[5];
  });
  // 記錄 input 事件（驗證 Vue 收得到）
  document.addEventListener('input', (ev) => { if (ev.target.matches('input')) window.__mock.events.push('input'); });
  document.getElementById('photos').addEventListener('change', (ev) => { window.__mock.files = (window.__mock.files || 0) + ev.target.files.length; });
  const fp = document.getElementById('floorplan-photo');
  if (fp) fp.addEventListener('change', (ev) => { window.__mock.floorPlanFile = ev.target.files[0] && ev.target.files[0].name; });
  /*
    這只是「長得像」的 contenteditable，不是真的 ProseMirror；execCommand("insertText") 是瀏覽器原生指令，
    對隨便一個 contenteditable 都有效，不用另外接。但 fill591.js 貼固定尾段樣式時走的是 paste 事件帶
    text/html——真的 ProseMirror 才會自己接住這個事件、照它的 schema 轉成文件；bare contenteditable
    什麼都不會做。這裡補一個最陽春的 paste handler，只夠測「fill591.js 有沒有正確帶 text/html／text/plain
    發出這個事件」，不是要模擬 591 真正的格式過濾（例如真的 591 會把 <u> 底線丟掉，這裡不模擬那件事）。
  */
  const pm = document.querySelector('.ProseMirror');
  if (pm) pm.addEventListener('paste', (ev) => {
    ev.preventDefault();
    const html = ev.clipboardData.getData('text/html');
    const plain = ev.clipboardData.getData('text/plain');
    pm.innerHTML = html || ('<p>' + plain.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) + '</p>');
    window.__mock.events.push('pm-paste:' + (html ? 'html' : 'plain'));
  });
})();
</script></body></html>`;
}
