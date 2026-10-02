/**
 * 對應層：解析出來的物件（parser.js 的 listing）→ 591 刊登表單每一格該填什麼。
 *
 * 591 出售第①頁四連點：出售 → 法定用途（照謄本）→ 房屋現況 → 房屋型態；出租：出租 → 類型 → 型態。
 * 第②頁的格子與規則（2026-09 對著 591 表單整理）：
 *   - 透天／別墅整棟賣，出售樓層填 0（591 的 0 = 整棟）
 *   - 有沒有車位坪決定「權狀坪數／售價」要點「含」還是「不含」車位
 *   - 完工年填民國年（西元 − 1911）；只知道屋齡就用今年反推、月日留白
 *   - 生活機能只勾型錄明寫的「鄰近OO」，不從文案猜 —— 猜出來的勾選是不實廣告
 *   - 法定用途照謄本（型錄「類別/謄本用途」斜線後面那個），不是住宅就一律「住家用」
 *
 * 不碰 DOM、不碰 chrome.*，介面與測試共用。
 */
import { joinAddress } from "./address.js";
import { findRisks } from "./risk.js";
import { buildTailDescHtml } from "./tailStyle.js";

export const DEFAULTS = {
  defaultCity: "台中市",
  downPaymentRatio: 0.2, // 591 出售的「自備款」必填；沒資料先給售價 20%
  contract: "有簽訂",
  titleMin: 6,
  titleMax: 30,
  descMax: 2500,
  descHead: "☆ 物件特色",
};

/* ───────── 推導 ───────── */

export function derive(d, nowYear = new Date().getFullYear()) {
  const k = d.kind || "";
  const rent = d.deal === "rent";

  /* 型態 */
  let type;
  if (/透天/.test(k)) type = "透天厝";
  else if (/別墅/.test(k)) type = "別墅";
  else if (/公寓/.test(k)) type = "公寓";
  else if (/華廈/.test(k)) type = "華廈";
  else if (/大樓/.test(k)) type = d.total && d.total <= 10 ? "華廈" : "電梯大樓";
  else if (d.total != null) type = d.total <= 5 ? "公寓" : d.total <= 10 ? "華廈" : "電梯大樓";
  else type = "電梯大樓";
  /* 591 出租第①頁的型態沒有「華廈」 */
  const typeFinal = rent && type === "華廈" ? "電梯大樓" : type;

  /* 現況 */
  const status = rent ? (/套房/.test(k) ? "獨立套房" : "整層住家") : /套房/.test(k) ? "套房" : "住宅";

  /* 法定用途：謄本用途在斜線後面 */
  const tengben = (d.usage || "").split("/").pop().trim();
  let legal;
  if (/住商/.test(tengben)) legal = "住商用";
  else if (/住工/.test(tengben)) legal = "住工用";
  else if (/商業|店鋪|店面/.test(tengben)) legal = "商業用";
  else if (/工業|廠/.test(tengben)) legal = "工業用";
  else if (/農業/.test(tengben)) legal = "農業用";
  else if (/事務所|辦公/.test(tengben)) legal = "一般事務所";
  else legal = "住家用";

  /* 朝向：型錄「座西 朝東」→ 591「坐西朝東」 */
  const fc = (d.facing || "").match(/朝\s*([東西南北]{1,2})/);
  const sit = (d.facing || "").match(/[座坐]\s*([東西南北]{1,2})/);
  const facing = fc ? (sit ? `坐${sit[1]}朝${fc[1]}` : `朝${fc[1]}`) : "";

  /* 完工年（民國） */
  let rocY = null;
  let rocYEstimated = false;
  if (d.y) rocY = d.y - 1911;
  else if (d.ageYears != null) {
    rocY = nowYear - Math.floor(d.ageYears) - 1911;
    rocYEstimated = true;
  }

  /* 出售／出租樓層 */
  let sellFloor = "";
  let sellFloorNote = "";
  if (/透天厝|別墅/.test(type)) {
    sellFloor = 0;
    sellFloorNote = "整棟（591 規定填 0）";
  } else if (d.floor != null) {
    sellFloor = d.floor;
    sellFloorNote = d.floorSub ? `單層，之 ${d.floorSub}` : "單層";
  } else {
    sellFloorNote = `資料寫「${d.floorRaw || "—"}」，要自己判斷`;
  }

  /* 車位 */
  const p = (d.parkType || "").replace(/[\s/]/g, "");
  const hasPark = !!(d.parkPing || (p && !/^無$|^無車位|^沒有/.test(p)) || d.rentCond.parkIncluded);
  let parkSel = "";
  if (hasPark) {
    if (/平面/.test(p) && /機械/.test(p)) parkSel = "平面式+機械式";
    else if (/平面/.test(p)) parkSel = "平面式停車位";
    else if (/機械|塔式|升降|昇降/.test(p)) parkSel = "機械式停車位";
    else parkSel = "其他";
  }

  /* 生活機能：只認型錄明寫的 */
  const life = [];
  if (d.school) life.push("近學校");
  if (d.park) life.push("近公園綠地");
  if (d.market) life.push("近傳統市場");

  const parts = { ...d.addrParts };
  if (!parts.city) parts.city = DEFAULTS.defaultCity;
  const fullAddr = joinAddress(parts, DEFAULTS.defaultCity);

  /* 出租條件（沒明寫就用預設：押金 2 個月、可開伙、不可養寵物、租金不含） */
  const c = d.rentCond;
  const depM = (d.deposit || "").match(/免押|(\d)\s*個月|面議/);
  const rentDeposit = !depM ? "2個月" : /免押/.test(depM[0]) ? "免押金" : /面議/.test(depM[0]) ? "面議" : depM[1] === "1" ? "1個月" : depM[1] === "2" ? "2個月" : "其他";
  const usePing = d.mainAttPing ?? (d.mainPing != null || d.attPing != null ? Math.round(((d.mainPing || 0) + (d.attPing || 0)) * 100) / 100 : null);

  return {
    deal: d.deal,
    adType: rent ? "出租" : "出售",
    legal: rent ? "" : legal,
    status,
    type: typeFinal,
    elevator: /電梯大樓|華廈/.test(typeFinal) ? "有" : "無",
    tengben,
    facing,
    rocY,
    rocYEstimated,
    sellFloor,
    sellFloorNote,
    hasPark,
    parkSel,
    areaOpt: hasPark ? "含車位面積" : "不含車位面積",
    priceOpt: hasPark ? "含車位價格" : "不含車位價格",
    down: d.price ? Math.round(d.price * DEFAULTS.downPaymentRatio) : null,
    life,
    parts,
    fullAddr,
    usePing,
    rentDeposit,
    rentIncludes: c.feeIncluded ? ["管理費"] : [],
    cook: c.cook === false ? "不可" : "可",
    pets: c.noPets === false ? "可" : "不可",
  };
}

/* ───────── 確認表（介面上一格一格顯示、可以改） ───────── */

const s = (v) => (v === null || v === undefined ? "" : String(v));

/**
 * rows 每一列：{ label, value, note, req(591 必填), need(資料裡沒有，紅底), pick(591 用選的), ref(只是對照，不填) }
 * 或 { group: "區塊標題" }
 */
export function buildRows(d, o) {
  return d.deal === "rent" ? rentRows(d, o) : saleRows(d, o);
}

function addressRows(d, o, f, grp, floorLabel) {
  grp(`${o.adType}地址（前三格是下拉；「號」旁的「隱藏門號」會勾起來）`);
  f("縣市", o.parts.city, { pick: true, req: true, note: d.addrParts.city ? "" : "資料沒寫縣市，先給台中市" });
  f("鄉鎮", o.parts.town, { pick: true, req: true, need: !o.parts.town });
  f("街道", o.parts.road, { pick: true, req: true, need: !o.parts.road, note: "要跟 591 清單裡的一模一樣" });
  f("巷", o.parts.lane, { note: o.parts.lane ? "" : "沒有就留空" });
  f("弄", o.parts.alley, { note: o.parts.alley ? "" : "沒有就留空" });
  f("號", o.parts.no, { req: true, need: !o.parts.no, note: o.parts.no ? "" : "門牌被隱藏了，要自己填" });
  f("之", o.parts.sub, { note: o.parts.sub ? "" : "沒有就留空" });
  f("整串地址", o.fullAddr, { ref: true, note: "由上面幾格組成；591 有「填寫地址」快速框時會貼這串按「匯入地址」" });
  f(floorLabel, o.sellFloor, { req: true, need: o.sellFloor === "", note: o.sellFloorNote });
  f("樓 之", d.floorSub, { note: d.floorSub ? "樓層旁邊的「之」" : "沒有就留空" });
}

function contactRows(d, o, f, grp, rent) {
  grp("聯絡資料");
  f("聯絡人", "", { note: "用「⚙ 我的資料」填的姓名" });
  f("委託書", DEFAULTS.contract, { pick: true, req: true, note: "專任約的話自己改成對應選項" });
  if (rent) f("產權登記", "已辦產", { pick: true, req: true, note: "未辦產的話自己改" });
  f("服務費", rent ? "（不動，照 591 預設）" : "收取服務費", rent ? { ref: true } : { pick: true, req: true });
  f("經紀業資料", "☑ 打勾", { pick: true, req: true, note: "「我已閱讀並確認經紀業資料無誤」" });
}

function refRows(d, o, f, grp, pairs) {
  const rows = pairs.filter(([, v]) => v);
  if (!rows.length) return;
  grp("資料有、但 591 沒這格（不用填，給你對照）");
  for (const [label, value, note] of rows) f(label, value, { ref: true, note });
}

function saleRows(d, o) {
  const rows = [];
  const grp = (title) => rows.push({ group: title, label: "", value: "" });
  const f = (label, value, opt = {}) => rows.push({ label, value: s(value), ...opt });

  addressRows(d, o, f, grp, "出售樓層");

  grp("基礎資料");
  f("出售總樓層", d.total, { req: true, need: !d.total, note: "層" });
  const needCommunity = /電梯大樓|華廈/.test(o.type);
  f("社區名稱", d.community, {
    req: needCommunity,
    need: needCommunity && !d.community,
    note: d.communityGuessed ? "⚠ 猜的，請核對" : d.community ? "" : needCommunity ? "大樓必填，資料沒給" : "透天沒社區，留空",
  });
  f("格局 房", d.room, { req: true, need: !d.room });
  f("格局 廳", d.hall);
  f("格局 衛", d.bath);
  f("完工 民國年", o.rocY, {
    req: true,
    need: o.rocY == null,
    note: d.y ? `西元 ${d.y}/${d.m}/${d.dd}` : o.rocYEstimated ? `⚠ 只知道屋齡 ${d.ageYears} 年，反推的；月日留白` : "",
  });
  f("完工 月", d.y ? d.m : "", { note: d.y ? "" : "不知道就留空" });
  f("完工 日", d.y ? d.dd : "", { note: d.y ? "" : "不知道就留空" });
  f("朝向", o.facing, { pick: true, note: d.facing ? `資料寫「${d.facing}」` : "資料沒寫，留空就不選" });
  f("權狀坪數", d.regPing, { req: true, need: !d.regPing });
  f("　└ 面積選項", o.areaOpt, { pick: true, note: o.hasPark ? "有車位，點「含」" : "沒車位，點「不含」" });
  f("車位面積", o.hasPark ? d.parkPing : "", { note: o.hasPark ? "坪；型錄沒寫就留空" : "沒車位不用填" });
  f("　└ 車位型式", o.parkSel, { pick: true, note: o.hasPark ? `資料寫「${d.parkType || "—"}」；591 只有 平面式／機械式／平面式+機械式／其他` : "沒車位不用選" });
  f("主建物", d.mainPing);
  f("附屬建物", d.attPing);
  f("共有部分", d.pubPing, { note: "型錄的「公設建坪」" });
  f("土地坪數", d.landPing);

  grp("房屋價格");
  f("售價", d.price, { req: true, need: !d.price, note: "萬元" });
  f("　└ 價格選項", o.priceOpt, { pick: true });
  f("自備款", o.down, { req: true, need: o.down == null, note: `萬元（先給售價 ${Math.round(DEFAULTS.downPaymentRatio * 100)}%，可以改）` });
  const feeKnown = d.fee != null;
  f("管理費有無", feeKnown ? "有" : d.source === "catalog" ? "無" : "", {
    pick: true,
    need: !feeKnown && d.source !== "catalog",
    note: feeKnown ? "" : d.source === "catalog" ? "型錄管理費欄是空的 → 無；有的話改成「有」並填金額" : "資料沒寫，要填 有／無",
  });
  f("管理費", d.fee, { note: feeKnown ? "元／月" : "有管理費才填，每月金額（元）" });
  f("　└ 繳費週期", feeKnown ? d.feeCycle : "", { pick: true, note: feeKnown ? "" : "有管理費才選" });
  f("帶租約", "否", { pick: true });
  f("裝潢程度", "", { pick: true, need: true, note: "簡易裝潢／中檔裝潢／高檔裝潢／尚未裝潢 —— 要你看過屋況才知道" });

  grp("生活機能（用勾的）");
  f("勾選這些", o.life.join("、"), { pick: true, note: o.life.length ? "只勾型錄明寫的「鄰近OO」" : "型錄沒明寫，先不勾；要勾自己在 591 上勾" });

  grp("標題與描述");
  f("（在下面「④ 標題與描述」改）", "", { ref: true });

  contactRows(d, o, f, grp, false);

  refRows(d, o, f, grp, [
    ["物件編號", d.no],
    ["類型／現況", d.kind],
    ["類別／謄本用途", d.usage, `法定用途照這個選「${o.legal}」`],
    ["車位／編號", d.parkNo],
    ["屋齡", d.ageText || (d.ageYears != null ? `${d.ageYears} 年` : ""), "591 自己從完工年算"],
    ["使用分區", d.zone],
    ["建物結構", d.struct],
    ["建物外觀", d.exterior],
    ["生活圈", d.lifeArea, "只是分類名，別拿來勾生活機能"],
    ["面寬／深度", [d.width, d.depth].filter(Boolean).join(" × ")],
    ["鄰近學校", d.school],
    ["鄰近公園", d.park],
    ["鄰近市場", d.market],
    ["鑰匙／帶看", d.keyNote],
  ]);
  return rows;
}

function rentRows(d, o) {
  const rows = [];
  const grp = (title) => rows.push({ group: title, label: "", value: "" });
  const f = (label, value, opt = {}) => rows.push({ label, value: s(value), ...opt });
  const c = d.rentCond;

  addressRows(d, o, f, grp, "出租樓層");

  grp("基礎資料");
  f("出租總樓層", d.total, { req: true, need: !d.total, note: "層" });
  f("電梯", o.elevator, { pick: true, note: `照型態「${o.type}」給的` });
  f("社區名稱", d.community, { note: d.community ? "" : "沒有就留空" });
  f("格局 房", d.room, { req: true, need: !d.room });
  f("格局 廳", d.hall);
  f("格局 衛", d.bath);
  f("可使用坪數", o.usePing, { req: true, need: o.usePing == null, note: d.mainAttPing != null ? "型錄的「主+附屬」" : "主建物＋附屬建物" });
  f("權狀坪數", d.regPing, { req: true, need: !d.regPing, note: "型錄的「登記坪數」" });
  f("車位", o.hasPark ? "有" : "無", {
    pick: true,
    note: c.parkIncluded ? "型錄寫含車位" : c.motorbike ? "型錄寫「附機車位」—— 機車位不算，591 的車位是汽車" : d.parkNo ? `型錄車位 ${d.parkNo}` : "",
  });
  f("　└ 車位型式", o.hasPark ? o.parkSel.replace("停車位", "") : "", { pick: true, note: o.hasPark ? "平面式／機械式／平面式 + 機械式／其他" : "沒車位不用選" });
  f("完工 民國年", o.rocY, { note: d.y ? `西元 ${d.y}/${d.m}/${d.dd}` : "租屋型錄沒竣工日：留空就點「屋齡不詳」，知道的話填民國年" });
  f("完工 月", d.y ? d.m : "");
  f("完工 日", d.y ? d.dd : "");
  f("朝向", o.facing, { pick: true, note: d.facing ? `資料寫「${d.facing}」` : "資料沒寫，留空就不選" });
  f("裝潢時間", "", { pick: true, need: true, note: "半年內／1年內／3年內／3年以上，591 要選一個" });
  f("裝潢程度", "", { pick: true, need: true, note: "尚未裝潢／簡易裝潢／中檔裝潢／高檔裝潢，看過屋況再選" });

  grp("租住說明");
  f("最短租期", "1年", { pick: true });
  f("可遷入日", "隨時可遷入", { pick: true });
  f("提供設備", "", { pick: true, need: true, note: "洗衣機／冰箱／電視／冷氣／熱水器／網路／第四台／天然瓦斯 —— 看照片自己勾" });
  f("提供家具", "", { pick: true, need: true, note: "床／衣櫃／沙發／桌子／椅子 —— 看照片自己勾" });
  f("身份要求", "學生、上班族、家庭", { pick: true });
  f("開伙", o.cook, { pick: true, note: c.cook == null ? "型錄沒寫，預設可" : "照型錄" });
  f("養寵物", o.pets, { pick: true, note: c.noPets == null ? "型錄沒寫，預設不可" : c.noPets ? "型錄寫禁寵" : "型錄寫可養" });

  grp("房屋價格");
  f("租金", d.rent, { req: true, need: d.rent == null, note: "元／月" });
  f("押金", o.rentDeposit, { pick: true, note: d.deposit ? `型錄寫「${d.deposit}」` : "型錄沒寫，預設 2 個月" });
  f("租金包含", o.rentIncludes.join("、") || "無", { pick: true, note: c.feeIncluded ? "型錄寫含管理費" : "預設不含；要含就寫 管理費、水費… 用「、」隔開" });
  f("水費", "台水繳費", { pick: true });
  f("電費", "台電繳費", { pick: true });
  f("管理費", d.fee, {
    note: d.fee != null ? "元／月" : c.feeIncluded ? "租金已含，591 仍會問金額；知道就填，不知道留空（面板會提醒）" : "有的話填每月金額（元），沒有留空",
  });

  grp("生活機能（用勾的）");
  f("勾選這些", o.life.join("、"), { pick: true, note: o.life.length ? "只勾型錄明寫的「鄰近OO」" : "型錄沒明寫，先不勾" });

  grp("標題與描述");
  f("（在下面「④ 標題與描述」改）", "", { ref: true });

  contactRows(d, o, f, grp, true);

  refRows(d, o, f, grp, [
    ["物件編號", d.no],
    ["類型／現況", d.kind],
    ["車位／編號", d.parkNo],
    ["租住條件（型錄原文）", [c.noSmoking ? "禁菸" : "", c.noPets ? "禁寵" : "", c.noAltar ? "禁神明廳" : "", c.feeIncluded ? "含管理費" : "", c.parkIncluded ? "含車位" : "", c.motorbike ? "附機車位" : ""].filter(Boolean).join("、")],
    ["建物結構", d.struct],
    ["鑰匙／帶看", d.keyNote],
  ]);
  return rows;
}

/* ───────── 標題／描述 ───────── */

/**
 * 型錄標題常帶「租-」「售-」這種內部前綴，591 不需要。
 *
 * 2026-10-02 本人回報樂屋物件名稱「每次都會出現 ?萬（價格）」（例：「【房仲蕭邦】遠雄質感三房含車含管
 * 可寵 2萬」），不要。查出來：貼型錄「網址」自動解析時標題是從愛屋頁面的 <title> 標籤抓的，那個標籤
 * 會在標題後面接一個空白＋價格（「租-長虹天擎3房平車全配 2.3萬」），但頁面上看得到的標題本身沒有
 * （對兩戶真實物件分別核對過）。手動 Ctrl+A 貼整頁那條路抓到的是頁面上的標題，所以沒這個尾巴——
 * 這就是為什麼「每次」出現（本人幾乎都是貼網址）。價格 591／樂屋都有自己的欄位，標題不需要，
 * 而且樂屋標題只收 25 字，這個尾巴白占 3～6 個字。
 *
 * 只拿掉「結尾、前面隔著空白」的「數字＋萬／億／元」：型錄接上去的價格永遠長這樣；標題中間或沒隔空白
 * 的字（「月租2萬三房」「管理費3600元」）是本人自己打的內容，不動。
 */
export function cleanTitle(raw) {
  return String(raw || "")
    .replace(/^\s*[租售]\s*[-－—–]\s*/, "")
    .replace(/\s+[\d,.]+\s*(?:萬|億|元)\s*$/, "")
    .trim();
}

/**
 * 「物件名稱開頭」（⚙ 我的資料，2026-10-02 本人要求）：每一戶標題最前面固定加的字，例如
 * 【房仲蕭邦】。本人原本是每一戶自己手打進標題（樂屋「物件名稱」欄，見他貼的真實畫面
 * 「【房仲蕭邦】花漾天鵝✨高樓層三房平車✨全配」），現在改成設一次、自動加。
 *
 * - 標題已經是這個開頭就不重複加（重新解析、按「套用」建議標題都不會疊兩層）。
 * - oldPrefix：本人改了設定再按儲存時，把目前標題最前面的「舊開頭」換成新的，標題其他地方
 *   本人手動改過的字原封不動；標題本來就沒有舊開頭（本人刪掉或自己改過）就只補新的。
 * - 不加分隔空格：開頭怎麼寫就怎麼接，【房仲蕭邦】花漾天鵝 這種不需要空格；真的要空格就寫在標題裡。
 */
export function applyTitlePrefix(title, prefix, oldPrefix = "") {
  let t = String(title || "").trim();
  const old = String(oldPrefix || "").trim();
  if (old && t.startsWith(old)) t = t.slice(old.length).trim();
  const p = String(prefix || "").trim();
  if (!t || !p || t.startsWith(p)) return t; // 標題本身是空的就維持空的，不要讓「只有開頭」的標題看起來像合格的
  return p + t;
}

export function titleCheck(title) {
  const len = [...String(title || "").trim()].length;
  if (!len) return { ok: false, len, msg: "標題是空的" };
  if (len < DEFAULTS.titleMin) return { ok: false, len, msg: `太短，591 要 ${DEFAULTS.titleMin} 字以上（現在 ${len} 字）` };
  if (len > DEFAULTS.titleMax) return { ok: false, len, msg: `太長，591 上限 ${DEFAULTS.titleMax} 字，超出 ${len - DEFAULTS.titleMax} 字` };
  return { ok: true, len, msg: `${len} 字，在 ${DEFAULTS.titleMin}～${DEFAULTS.titleMax} 之間` };
}

/**
 * 用資料裡真的有的東西拼一個建議標題（社區＋格局＋租住條件／車位），不捏造。
 * 只是建議，畫面上要人按一下才會套。
 * prefix：「物件名稱開頭」設定（見 applyTitlePrefix）。建議標題也要帶開頭，不然按「套用」會把
 * 本人設好的開頭整個蓋掉；開頭佔掉的字數要從 30 字上限裡扣，不然建議本身就超標。
 */
export function suggestTitle(d, o, prefix = "") {
  const bits = [];
  if (d.community) bits.push(d.community);
  if (d.room) bits.push(`${d.room}房${d.hall ? `${d.hall}廳` : ""}`);
  if (d.deal === "rent") {
    if (d.rentCond.feeIncluded) bits.push("含管理費");
    if (d.rentCond.motorbike) bits.push("附機車位");
    if (d.rentCond.parkIncluded) bits.push("含車位");
    if (o.elevator === "有" && d.floor != null) bits.push(`${d.floor}樓`);
  } else {
    if (o.hasPark) bits.push(/平面/.test(o.parkSel) ? "平車" : "車位");
    if (d.floor != null && d.total && d.floor >= Math.ceil(d.total * 0.7)) bits.push("高樓層");
    if (o.facing) bits.push(o.facing);
  }
  const t = bits.join(" ");
  if ([...t].length < DEFAULTS.titleMin) return "";
  const p = String(prefix || "").trim();
  const room = Math.max(DEFAULTS.titleMax - [...p].length, 0);
  return p + [...t].slice(0, room).join("");
}

/** 規格摘要（只放資料裡有的） */
export function factsLine(d, o) {
  const bits = [];
  if (d.room) bits.push(`${d.room}房${d.hall ?? ""}${d.hall != null ? "廳" : ""}${d.bath ?? ""}${d.bath != null ? "衛" : ""}`);
  if (d.regPing) bits.push(`權狀 ${d.regPing} 坪${d.mainAttPing ? `（主＋附屬 ${d.mainAttPing} 坪）` : d.mainPing ? `（主建物 ${d.mainPing} 坪）` : ""}`);
  if (d.floor != null && d.total) bits.push(`${d.floor}樓／共${d.total}樓`);
  else if (o.sellFloor === 0 && d.total) bits.push(`整棟共${d.total}樓`);
  if (d.community) bits.push(d.community);
  if (o.facing) bits.push(o.facing);
  if (d.y) bits.push(`${d.y} 年完工`);
  return bits.join("｜");
}

/** 固定尾段的 {{name}} {{phone}} {{line}} {{company}} 代換 */
export function fillTail(tail, settings) {
  return String(tail || "")
    .replace(/\{\{name\}\}/g, settings.name || "")
    .replace(/\{\{phone\}\}/g, settings.phone || "")
    .replace(/\{\{line\}\}/g, settings.line || "")
    .replace(/\{\{company\}\}/g, settings.company || "")
    .trim();
}

/**
 * 描述：抬頭 → 規格摘要 → ✨ 特色行（環境特色＋補充說明）→ 固定尾段（有填才接）。
 * 純文字。591 的編輯器會把每一行變成一個段落。
 */
/**
 * 抬頭 → ✨ 特色行 → 固定尾段（有填才接）。純文字，591 的編輯器會把每一行變成一個段落。
 * 2026-09-17 本人拍板：規格摘要（factsLine，「5房1廳6衛｜權狀63.72坪…」那一行）不要出現在描述裡——
 * 這些資料③每一格都填得到，描述裡再列一次是重複；factsLine() 這個函式留著（獨立測試還在測它），
 * 只是不再接進 buildDescription() 組出來的文字。
 */
export function buildDescription(d, o, settings) {
  const head = (settings.descHead ?? DEFAULTS.descHead).trim();
  const lines = [...d.features, ...String(d.extraNote || "").split("\n").map((l) => l.trim()).filter(Boolean)].map((l) => l.replace(/^✨\s*/, "")).filter(Boolean).map((l) => `✨${l}`);
  const tail = fillTail(settings.tail, settings);
  const parts = [];
  if (head) parts.push(head);
  if (lines.length) parts.push(lines.join("\n"));
  if (tail) parts.push(tail);
  return parts.join("\n\n");
}

export function descRisks(title, desc) {
  return findRisks(title, desc);
}

/* ───────── 資料包（給外掛帶去 591 頁面） ───────── */

const numOrNull = (v, fallback) => {
  if (v === undefined) return fallback;
  const t = String(v).trim();
  if (t === "") return null;
  const n = parseFloat(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : fallback;
};
const strOr = (v, fallback) => (v === undefined ? fallback : String(v).trim());
const list = (v, fallback) => (v === undefined ? fallback : String(v).split(/[、,，]/).map((x) => x.trim()).filter(Boolean)).filter((x) => x !== "無" && !/^[（(]/.test(x));

/**
 * rows 是介面上可能被改過的確認表；改過的以 rows 為準，沒改的用推導值。
 */
export function buildPayload(d, o, rows, title, desc, settings) {
  const e = new Map();
  for (const r of rows) if (!r.group && !r.ref) e.set(r.label.replace(/^\s*└\s*/, "").trim(), r.value);
  const rent = d.deal === "rent";
  const floorLabel = rent ? "出租樓層" : "出售樓層";
  const sellRaw = strOr(e.get(floorLabel), o.sellFloor === "" ? "" : String(o.sellFloor));
  const feeHas = strOr(e.get("管理費有無"), "");
  const parkTypeRaw = strOr(e.get("車位型式"), o.parkSel);
  const hasPark = rent ? strOr(e.get("車位"), o.hasPark ? "有" : "無") === "有" : o.hasPark;
  /* 固定尾段設了字級／顏色才會有值；沒設就是空字串，外掛照舊貼純文字（591／樂屋共用同一份 HTML） */
  const descHtml = buildTailDescHtml(desc, fillTail(settings.tail, settings).split("\n")[0], settings.tailStyle);

  return {
    v: 1,
    source: "app",
    deal: d.deal,
    first: { adType: o.adType, legal: o.legal, status: o.status, type: o.type },
    addr: {
      city: strOr(e.get("縣市"), o.parts.city),
      town: strOr(e.get("鄉鎮"), o.parts.town),
      road: strOr(e.get("街道"), o.parts.road),
      lane: strOr(e.get("巷"), o.parts.lane),
      alley: strOr(e.get("弄"), o.parts.alley),
      no: strOr(e.get("號"), o.parts.no),
      sub: strOr(e.get("之"), o.parts.sub),
      hide: true,
    },
    floor: {
      sell: sellRaw === "" ? "" : Number(sellRaw),
      sub: strOr(e.get("樓 之"), d.floorSub),
      total: numOrNull(e.get(rent ? "出租總樓層" : "出售總樓層"), d.total),
    },
    community: strOr(e.get("社區名稱"), d.community),
    layout: { room: numOrNull(e.get("格局 房"), d.room), hall: numOrNull(e.get("格局 廳"), d.hall), bath: numOrNull(e.get("格局 衛"), d.bath) },
    done: { y: numOrNull(e.get("完工 民國年"), o.rocY), m: numOrNull(e.get("完工 月"), d.y ? d.m : null), d: numOrNull(e.get("完工 日"), d.y ? d.dd : null) },
    facing: strOr(e.get("朝向"), o.facing),
    area: {
      reg: numOrNull(e.get("權狀坪數"), d.regPing),
      inclPark: hasPark,
      park: numOrNull(e.get("車位面積"), d.parkPing),
      parkType: parkTypeRaw,
      main: numOrNull(e.get("主建物"), d.mainPing),
      att: numOrNull(e.get("附屬建物"), d.attPing),
      pub: numOrNull(e.get("共有部分"), d.pubPing),
      land: numOrNull(e.get("土地坪數"), d.landPing),
    },
    price: { total: numOrNull(e.get("售價"), d.price), inclPark: hasPark, down: numOrNull(e.get("自備款"), o.down) },
    fee: {
      has: rent ? (numOrNull(e.get("管理費"), d.fee) != null ? true : d.rentCond.feeIncluded ? null : false) : feeHas === "有" ? true : feeHas === "無" ? false : null,
      amount: numOrNull(e.get("管理費"), d.fee),
      cycle: strOr(e.get("繳費週期"), d.feeCycle),
    },
    lease: strOr(e.get("帶租約"), "否") === "是",
    deco: strOr(e.get("裝潢程度"), ""),
    life: list(e.get("勾選這些"), o.life).filter((x) => /^近/.test(x)),
    rent: rent
      ? {
          monthly: numOrNull(e.get("租金"), d.rent),
          deposit: strOr(e.get("押金"), o.rentDeposit),
          minTerm: strOr(e.get("最短租期"), "1年"),
          moveInAny: strOr(e.get("可遷入日"), "隨時可遷入") === "隨時可遷入",
          identity: list(e.get("身份要求"), ["學生", "上班族", "家庭"]),
          cook: strOr(e.get("開伙"), o.cook),
          pets: strOr(e.get("養寵物"), o.pets),
          includes: list(e.get("租金包含"), o.rentIncludes),
          water: strOr(e.get("水費"), "台水繳費"),
          power: strOr(e.get("電費"), "台電繳費"),
          elevator: strOr(e.get("電梯"), o.elevator),
          park: hasPark,
          usePing: numOrNull(e.get("可使用坪數"), o.usePing),
          ownership: strOr(e.get("產權登記"), "已辦產"),
          decoTime: strOr(e.get("裝潢時間"), ""),
        }
      : null,
    title: String(title || "").trim(),
    desc: String(desc || ""),
    ...(descHtml ? { descHtml } : {}),
    contact: {
      name: settings.name || "",
      contract: strOr(e.get("委託書"), DEFAULTS.contract),
      serviceFee: true,
    },
    photos: d.photos.slice(),
  };
}

/**
 * 認得的組合直接開第②頁（少按四下）；不認得的開第①頁由外掛幫忙點。
 * 參數對照（2026-09 從 591 第①頁點完後的網址學到）：kind 住宅=9、出租整層住家=1；
 * shape 電梯大樓=2、透天厝=3、華廈=5；purpose 住家用=3、住商用=4。
 */
export function launchUrl(p) {
  const f = (p && p.first) || {};
  const SHAPE = { 電梯大樓: 2, 透天厝: 3, 華廈: 5 };
  if (p.deal === "rent") {
    const shape = SHAPE[f.type];
    if (f.status === "整層住家" && shape) return `https://user.591.com.tw/post/two/rent?is_use_first=1&kind=1&shape=${shape}&purpose=&purpose_custom=`;
    return "https://user.591.com.tw/post/first";
  }
  const PURPOSE = { 住家用: 3, 住商用: 4 };
  const shape = SHAPE[f.type];
  const purpose = PURPOSE[f.legal];
  if (f.status === "住宅" && shape && purpose) return `https://user.591.com.tw/post/two/sale?is_use_first=1&kind=9&shape=${shape}&purpose=${purpose}&purpose_custom=`;
  return "https://user.591.com.tw/post/first";
}
