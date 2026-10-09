/**
 * 愛屋型錄 → FB 社團廣告文案（2026-10-07，本人貼同業「FB 社團廣告助手」的「從愛屋帶入」截圖：
 * 「抓取的東西要跟這些截圖一樣就好」）。
 *
 * 純函式：進來一份 parseCatalog() 的結果，出去標題、貼文內容、提醒。不碰網路、不碰資料庫，測得起來。
 * 只 import 型別（編譯後整個消失），所以 node 測試可以直接讀這個檔。
 *
 * 版型（照截圖）：
 *   【案名】
 *
 *   💰 開價 738 萬
 *   📍 梧棲區民族路
 *   🏠 2房2廳1衛
 *   📐 登記 36.86 坪（主＋附屬 17.68 坪）
 *   🏢 4樓 / 共 12 樓
 *   📅 屋齡 2.5 年
 *   🚗 車位：坡道/平面
 *
 *   ✨ 環境特色
 *   ・…
 *
 * 🚫 不准捏造：型錄沒有的欄位整行省略（不補預設值、不寫「待確認」進文案裡），
 *    並在 warnings 講「哪一行因為型錄沒給所以沒放」，讓本人自己決定要不要手補。
 * 🔴 地址只到路名（FB 通路的鐵律，見 fb-copy.ts 的 roadLevelAddress）：用型錄拆好的「鄉鎮市區＋路名」組，
 *    巷、弄、號、樓層全都不放；就算型錄頁有顯示門牌也一樣。
 */
import type { CatalogListing } from "@/lib/catalog-import";

export type CatalogAdCopy = {
  /** 只給自己看的標題（貼文庫裡找得到就好），跟貼文第一行【】裡的是同一個 */
  title: string;
  /** 貼文內容（只寫這一戶的部分；署名由存檔時的 buildManualDraft 自動補） */
  body: string;
  /** 型錄沒給所以整行省略的、或要本人看一眼的 */
  warnings: string[];
};

/** 數字去掉多餘的小數尾巴：36.86 → "36.86"、47.35 → "47.35"、1880 → "1880"、43.7350 → "43.735"。 */
function fmtNum(n: number): string {
  return String(Number(n.toFixed(3)));
}

/**
 * parseCatalog 為了好比對標籤，把全形的「：（）」轉成了半形。特色文字要貼上 FB，得還原回來，
 * 不然「生活機能完整:家樂福5分」看起來很怪（同業截圖裡是全形冒號）。
 * 只動「緊貼中文字」的冒號、和括號裡有中文的括號；時間 9:30、網址、英文括號都不碰。
 */
export function restoreCjkPunctuation(s: string): string {
  return s.replace(/(?<=[一-鿿]):/g, "：").replace(/\(([^()]*[一-鿿][^()]*)\)/g, "（$1）");
}

/** 屋齡：型錄那格通常是「4 年」「2.5 年」。有數字就統一成「N 年」；沒有數字（新成屋之類）照原文。 */
function ageLine(ageText: string): string | null {
  const t = ageText.trim();
  if (!t) return null;
  const m = t.match(/(\d+(?:\.\d+)?)/);
  return m ? `屋齡 ${m[1]} 年` : `屋齡 ${t}`;
}

/** 樓別／樓高：「4 / 12」→「4樓 / 共 12 樓」；透天「1-3 / 3」→「1-3樓 / 共 3 樓」；「全棟 / 4」→「全棟 / 共 4 樓」。 */
function floorLine(d: CatalogListing): string | null {
  const raw = d.floorRaw.trim();
  if (!raw && d.total == null) return null;
  const left = raw ? (/^\d+(?:\s*[-~]\s*\d+)?$/.test(raw) ? `${raw.replace(/\s+/g, "")}樓` : raw) : "";
  const right = d.total != null ? `共 ${d.total} 樓` : "";
  return [left, right].filter(Boolean).join(" / ");
}

export function buildCatalogAdCopy(d: CatalogListing): CatalogAdCopy {
  const warnings: string[] = [];
  const lines: string[] = [];

  const title = restoreCjkPunctuation((d.title || d.rawTitle || "").trim());
  if (title) {
    lines.push(`【${title}】`, "");
  } else {
    warnings.push("型錄沒抓到案名，第一行的【標題】先省略了，自己補一個");
  }

  // 價格：出售＝開價（萬）；出租＝租金（元／月）
  if (d.deal === "rent") {
    if (d.rent != null) lines.push(`💰 租金 ${d.rent.toLocaleString("en-US")} 元／月`);
    else warnings.push("沒抓到租金，💰 那行先省略了");
  } else if (d.price != null) {
    lines.push(`💰 開價 ${fmtNum(d.price)} 萬`);
  } else {
    warnings.push("沒抓到開價，💰 那行先省略了");
  }

  const place = `${d.addrParts.town}${d.addrParts.road}`.trim();
  if (place) lines.push(`📍 ${place}`);
  else warnings.push("沒抓到地址（區＋路名），📍 那行先省略了");

  if (d.room != null) lines.push(`🏠 ${d.room}房${d.hall ?? 0}廳${d.bath ?? 0}衛`);
  else warnings.push("沒抓到格局，🏠 那行先省略了");

  if (d.regPing != null) {
    lines.push(`📐 登記 ${fmtNum(d.regPing)} 坪${d.mainAttPing != null ? `（主＋附屬 ${fmtNum(d.mainAttPing)} 坪）` : ""}`);
  } else {
    warnings.push("沒抓到登記坪數，📐 那行先省略了");
  }

  const floor = floorLine(d);
  if (floor) lines.push(`🏢 ${floor}`);
  else warnings.push("沒抓到樓別／樓高，🏢 那行先省略了");

  const age = ageLine(d.ageText);
  if (age) lines.push(`📅 ${age}`);
  else warnings.push("型錄沒有屋齡，📅 那行先省略了");

  if (d.parkType.trim()) lines.push(`🚗 車位：${d.parkType.trim()}`);
  else warnings.push("型錄沒有車位型式，🚗 那行先省略了");

  if (d.features.length) {
    lines.push("", "✨ 環境特色", ...d.features.map((f) => `・${restoreCjkPunctuation(f)}`));
  } else {
    warnings.push("型錄沒有環境特色，✨ 那一段先省略了");
  }

  return { title, body: lines.join("\n").trim(), warnings };
}
