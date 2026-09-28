/**
 * 樂屋網（member.rakuya.com.tw）刊登表單的對應層 —— 跟 map591.js 一樣，吃 parser.js 的 listing／
 * map591.js 的 derive() 輸出／591 資料包，只是換一套詞彙對到樂屋的欄位。
 *
 * 樂屋是原生 <select>／<input>／<radio>（不是 591 那套 Ant Design 虛擬下拉），欄位用 name 定位：
 *   法定用途 selectPropertyUsecode → 現況型式 usecode → 現況類型 typecode（三個串接，選了才長出後面）
 *   縣市 city → 行政區 zipcode → 街道 addr_road（三個串接）；巷 addr_lane／弄 addr_alley／號 addr_num
 *   物件名稱 hname（上限 25 字）；社區 is_community(是/非社區) + community(下拉) / community_new(新增文字)
 *   出售樓層 floors_type(單層/多層) + floors + floors_max；出租/出售共用 surfloors(總樓層)
 *   格局 bedrooms／livingrooms／bathrooms；完工 findate(民國前的西元屋齡年數，其實是「屋齡」不是「完工年」)／findateUnknow
 *   朝向 direction；電梯 lifts（出售是 radio、出租是 select）；車位 parkings／parkings_kind／reg_garagesize
 *   坪數 totalsize／mainsize／subsize／sharesize／basesize；is_size_including_parkings
 *   管理 manage／securityfee；出售價格 listprice／is_price_including_parkings／is_calc_single_price
 *   出租 rental／rental_include[]／deposit_m／property_right／short_rent／is_immigrate_anytime／cook／pet／sex／ridentity／landlord
 *   周圍環境 elementary／market／park／transport／mrt／vital_function
 *   聯絡 isOwnerContact(自行填寫)／contact_name／tel2；照片 surface_image_input（上限 25 張）
 *
 * ⚠️ 這是「猜著寫」的第一版，還沒對真的樂屋網跑過——跟 591 一樣，一定要對著本人登入的樂屋帳號實測、
 *    照面板紅字回頭調欄位名稱。真結構以本人截圖為準。
 *
 * 🔴🔴 2026-09-27 從 591-extension/lib/rakuya-map.js 原封不動複製過來——是
 * createListing.js 真正需要的那份「巢狀 rakuya payload」的來源，見 map591.js 開頭那則同一天的
 * 記錄。見 [[project_樂屋出租循環刊登]]。
 */

export const RAKUYA_TITLE_MAX = 25;
const LEGAL_OK = ["住家用", "住商用", "住工用", "集合住宅", "國民住宅", "工商用", "商業用", "工業用", "農業用", "店鋪", "廠房", "一般事務所"];

/**
 * 法定用途：591 的 derive() 只在出售才算（出租那邊 591 表單本來就不問法定用途，所以直接清空），
 * 但樂屋出租一樣有「法定用途」這個串接下拉，要用——不能沿用 o.legal，改用一直都在的 o.tengben
 * （型錄「類別/謄本用途」原文）自己重算一次，規則要跟 map591.js 的 derive() 保持一致。
 */
function legalFromTengben(tengben) {
  if (/住商/.test(tengben)) return "住商用";
  if (/住工/.test(tengben)) return "住工用";
  if (/商業|店鋪|店面/.test(tengben)) return "商業用";
  if (/工業|廠/.test(tengben)) return "工業用";
  if (/農業/.test(tengben)) return "農業用";
  if (/事務所|辦公/.test(tengben)) return "一般事務所";
  return "住家用";
}

/** 型錄「坡道/平面」「升降/機械」→ 樂屋車位類型的單選字 */
export function rakuyaParkKind(parkType) {
  const p = (parkType || "").replace(/[\s/]/g, "");
  if (/坡道.*平面|平面.*坡道/.test(p)) return "坡道平面式";
  if (/坡道.*機械|機械.*坡道/.test(p)) return "坡道機械式";
  if (/(?:升降|昇降).*平面|平面.*(?:升降|昇降)/.test(p)) return "昇降平面式";
  if (/(?:升降|昇降).*機械|機械.*(?:升降|昇降)/.test(p)) return "昇降機械式";
  if (/循環/.test(p)) return "機械循環式";
  if (/庭院/.test(p)) return "庭院式";
  if (/車庫/.test(p)) return "獨立車庫";
  if (/電腦選號/.test(p)) return "電腦選號";
  if (/機械/.test(p)) return "機械式車位";
  return "平面式車位";
}

/**
 * d：parser.js 的 listing；o：map591.js 的 derive() 輸出；p：map591.js 的 buildPayload() 輸出
 * （拿現成算好的 title／desc／photos／contact，樂屋不用重算一次）。
 */
export function buildRakuya(d, o, p, nowYear = new Date().getFullYear()) {
  const rent = d.deal === "rent";
  const t = o.type;
  const typecode = /電梯大樓/.test(t)
    ? "電梯大廈"
    : /華廈/.test(t)
      ? "華廈"
      : /透天/.test(t)
        ? "透天厝"
        : /公寓/.test(t)
          ? "公寓"
          : /別墅/.test(t)
            ? "別墅"
            : /樓中樓/.test(t)
              ? "樓中樓"
              : "電梯大廈";

  /* 屋齡：完工西元年優先（型錄竣工日期），沒有就用型錄寫的屋齡年數反推 */
  const doneAd = d.y != null ? d.y : o.rocY != null ? o.rocY + 1911 : null;
  const ageYears = doneAd != null ? Math.max(0, nowYear - doneAd) : d.ageYears != null ? Math.floor(d.ageYears) : null;

  const dep = (o.rentDeposit || "2個月").trim();
  const depositSel = /免押/.test(dep) ? "其他押金" : /面議/.test(dep) ? "面議" : /^1個月/.test(dep) ? "1個月租金" : /^2個月/.test(dep) ? "2個月租金" : "其他押金";
  const includesRakuya = (o.rentIncludes || [])
    .map((x) => (x === "網路" ? "網路費" : x))
    .filter((x) => /水費|電費|第四台|網路費|瓦斯費|管理費|停車費|清潔費/.test(x));
  if (rent && d.rentCond.parkIncluded && !includesRakuya.includes("停車費")) includesRakuya.push("停車費");

  const legal = legalFromTengben(o.tengben || "");
  return {
    legal: LEGAL_OK.includes(legal) ? legal : "住家用",
    usecode: rent ? o.status : /套房/.test(o.status) ? "套房" : "住宅",
    typecode: !rent && /套房/.test(o.status) ? "套房" : typecode,
    ageType: ageYears != null && ageYears <= 3 ? "新屋" : "中古屋",
    ageYears,
    isCommunity: !!d.community,
    floorsType: o.sellFloor === 0 ? "多層" : "單層",
    floorsMax: o.sellFloor === 0 ? d.total : null,
    /* 管理費金額知道，或型錄寫「租金已含管理費」（金額沒單獨列），都算有管理 */
    manage: d.fee != null || (rent && d.rentCond.feeIncluded) ? "管理員(警衛)" : "無",
    manageFee: d.fee,
    parkStatus: o.hasPark ? (rent ? "自有" : "有車位") : "無車位",
    parkKind: rakuyaParkKind(d.parkType),
    env: { elementary: d.school || "", market: d.market || "", park: d.park || "", transport: "", mrt: "", vital_function: "" },
    title25: [...(p.title || "")].slice(0, RAKUYA_TITLE_MAX).join(""),
    titleTruncated: [...(p.title || "")].length > RAKUYA_TITLE_MAX,
    contactName: (p.contact && p.contact.name) || "",
    rent: rent
      ? {
          depositSel,
          includes: includesRakuya,
          shortRent: "不可",
          sex: "不限",
          identity: "不限",
          landlord: "不與房東同住",
          propertyRight: /未辦/.test((p.rent && p.rent.ownership) || "") ? "無" : "有",
          cook: (p.rent && p.rent.cook) || "可",
          pet: (p.rent && p.rent.pets) || "不可",
          anytime: true,
        }
      : undefined,
  };
}
