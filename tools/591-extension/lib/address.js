/**
 * 台灣地址拆解：「台中市梧棲區八德路89號4樓之8」→ 縣市／鄉鎮／街道／巷／弄／號／之／樓／樓之。
 *
 * 591 的地址區是一格一格的（縣市、鄉鎮、街道三個下拉＋巷、弄、號、之、樓、樓之六個框），
 * 所以要拆到這麼細。樓層先摘掉再拆「號之」，否則「89號4樓之8」的「之8」會被當成「號之」。
 *
 * 不碰 DOM、不碰 chrome.*。
 */

function normalize(a) {
  return String(a || "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[－—–]/g, "-")
    .replace(/\s+/g, "")
    .replace(/臺/g, "台");
}

/**
 * 中文數字轉阿拉伯數字，只收 0～99（門牌樓層夠用；「一百」以上的樓層不存在，抓到也不會亂猜）。
 * 型錄地址常寫「十三樓之２」而不是「13樓之2」——2026-09-11 真實案例（昇祐 One Plus 商辦）踩到，
 * 這種寫法原本完全抓不到樓層，畫面上那格會空著、也不會有警告。
 */
const CN_DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnToInt(s) {
  if (s == null || s === "") return null;
  if (/^\d+$/.test(s)) return +s;
  if (s === "十") return 10;
  let m;
  if ((m = s.match(/^([一二三四五六七八九])十([一二三四五六七八九])?$/))) return CN_DIGIT[m[1]] * 10 + (m[2] ? CN_DIGIT[m[2]] : 0);
  if ((m = s.match(/^十([一二三四五六七八九])$/))) return 10 + CN_DIGIT[m[1]];
  if ((m = s.match(/^([一二三四五六七八九])$/))) return CN_DIGIT[m[1]];
  return null;
}
/** 阿拉伯數字或中文數字都收的「樓層數字」正規式片段（用在樓與樓之） */
const FLOOR_NUM = "(\\d+|[一二三四五六七八九]?十[一二三四五六七八九]?|[一二三四五六七八九])";

/** 「三段」「3段」都收；回傳原字串（591 的街道清單通常寫「沙田路三段」） */
export function splitAddress(a) {
  const r = { city: "", town: "", road: "", lane: "", alley: "", no: "", sub: "", floor: null, floorSub: "", text: "" };
  let s = normalize(a);
  if (!s) return r;
  let m;
  if ((m = s.match(/^(.{2}[縣市])/))) {
    r.city = m[1];
    s = s.slice(m[1].length);
  }
  /* 鄉鎮市區：1～4 字＋區/鄉/鎮/市（梧棲區、大肚區、竹北市、太麻里鄉）。縣轄市的「市」也在這層 */
  if ((m = s.match(/^(.{1,4}?[區鄉鎮市])/))) {
    r.town = m[1];
    s = s.slice(m[1].length);
  }
  /* 樓層先摘：「4樓之8」「4F之8」「4樓」「十三樓之２」（中文數字，型錄地址常這樣寫） */
  if ((m = s.match(new RegExp(FLOOR_NUM + "\\s*(?:樓|F)(?:之" + FLOOR_NUM + ")?", "i")))) {
    const f = cnToInt(m[1]);
    if (f != null) {
      r.floor = f;
      r.floorSub = m[2] != null ? String(cnToInt(m[2])) : "";
      s = s.slice(0, m.index) + s.slice(m.index + m[0].length);
    }
  }
  if ((m = s.match(/(\d+)巷/))) r.lane = m[1];
  if ((m = s.match(/(\d+)弄/))) r.alley = m[1];
  if ((m = s.match(/(\d+)(?:之|-)(\d+)號/))) {
    r.no = m[1];
    r.sub = m[2];
  } else if ((m = s.match(/(\d+)號(?:之|-)(\d+)/))) {
    r.no = m[1];
    r.sub = m[2];
  } else if ((m = s.match(/(\d+)號/))) {
    r.no = m[1];
  }
  r.road = s.replace(/\d+(?:巷|弄|號|之|-).*$/, "").replace(/[之\-]+$/, "").trim();
  r.text = [r.city, r.town, r.road, r.lane ? `${r.lane}巷` : "", r.alley ? `${r.alley}弄` : "", r.no ? `${r.no}${r.sub ? `之${r.sub}` : ""}號` : ""].join("");
  return r;
}

/** 拆好的地址組回一串（給 591「填寫完整地址」快速框用；沒縣市時補預設縣市） */
export function joinAddress(p, defaultCity = "台中市") {
  const city = p.city || defaultCity;
  return [city, p.town, p.road, p.lane ? `${p.lane}巷` : "", p.alley ? `${p.alley}弄` : "", p.no ? `${p.no}${p.sub ? `之${p.sub}` : ""}號` : ""].join("");
}
