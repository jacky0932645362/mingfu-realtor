/**
 * 591 上架包 —— 把資料庫裡的一筆物件，轉成「591 後台可以直接貼上」的內容（2026-08-24）
 *
 * 這個檔刻意做成純函式、不碰資料庫、不碰 React：
 * 進來一個 PropertyRow，出去一包字串。這樣才測得起來（見 test-export-591.mjs）。
 *
 * ⚠️ 為什麼不做「自動登入 591 幫你填」？
 *   591 沒有給個人房仲的官方刊登 API（2026-08-24 查證，只有 B2B 合約給品牌總部）。
 *   要自動填就只能用瀏覽器自動化模擬登入，而 591 服務條款禁止程式操作，
 *   批次連發會被判定異常鎖帳號。所以這個模組只做到「把字準備好」，
 *   最後那一下貼上與送出由本人自己按 —— 零封號風險，而痛的其實也只有打字那段。
 *
 * ⚠️ 不准捏造：這裡只會重排資料庫裡真的有的東西。
 *   沒填的欄位就是留白 + 進 warnings 提醒，絕不自己生出「近三井 Outlet」這種句子。
 */

import type { PropertyRow } from "@/lib/property";
import { propertyTypeLabel } from "@/lib/property";
import { directImageUrl, parseImageList, parseVideoList } from "@/lib/media-url";

/** 591 標題的建議上限。實際限制以 591 後台為準，這裡只當作「太長會被截」的預警線。 */
export const TITLE_LIMIT = 30;

export type Field591 = {
  /** 591 後台那一格大概叫什麼（欄位名稱以實際後台為準） */
  label: string;
  /** 要貼進去的值。空字串 = 你資料庫沒這筆 */
  value: string;
  /** 補充說明，例如「591 是房/廳/衛三個下拉，分開選」 */
  hint?: string;
  /** true = 591 通常必填，沒值會卡住上架流程 */
  required?: boolean;
};

export type Export591Package = {
  /** 591 物件標題（已裁到建議長度內的版本） */
  title: string;
  /** 沒裁過的原始標題，長度超標時用來讓本人自己決定砍哪裡 */
  titleFull: string;
  titleLength: number;
  titleOverflow: boolean;
  /** 591 物件描述全文，照「內容產出規格」的要素順序組出來 */
  description: string;
  /** 欄位對照表：左邊 591 欄位、右邊你的值 */
  fields: Field591[];
  /** 照片直連網址，依刊登順序（封面在第一張） */
  photos: string[];
  /** 影片連結。591 影音欄位不見得吃，主要是留給自己貼別的平台 */
  videos: string[];
  /** 上架前該補的東西 */
  warnings: string[];
  /** 整包純文字，一鍵全複製用 */
  plainText: string;
};

/* ────────────────── 小工具 ────────────────── */

function clean(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function pingNumber(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 32.00 →「32 坪」、32.55 → 「32.55 坪」。沒值回空字串。 */
function pingText(value: string | null): string {
  const n = pingNumber(value);
  if (n == null) return "";
  return `${Number.isInteger(n) ? n : Number(n.toFixed(2))} 坪`;
}

/**
 * 「3房2廳2衛」→ { rooms: 3, halls: 2, baths: 2 }
 *
 * 591 的格局是房／廳／衛三個獨立下拉，不是一格文字，所以要拆開才好對照著選。
 * 拆不出來（例如寫成「兩房一廳」或「開放式」）就回 null，讓畫面退回顯示原文，
 * 不要自作聰明猜數字。
 */
export function parseLayout(
  raw: string | null,
): { rooms: number; halls: number; baths: number } | null {
  const text = clean(raw);
  if (!text) return null;
  const rooms = text.match(/(\d+)\s*房/);
  const halls = text.match(/(\d+)\s*廳/);
  const baths = text.match(/(\d+)\s*[衛浴]/);
  if (!rooms) return null;
  return {
    rooms: Number(rooms[1]),
    halls: halls ? Number(halls[1]) : 0,
    baths: baths ? Number(baths[1]) : 0,
  };
}

/**
 * 「12樓/15樓」「12F/15F」「12樓，共15樓」→ { floor: 12, total: 15 }
 *
 * 591 的樓層也是「第幾樓」「共幾樓」兩格。拆不出來回 null，畫面退回原文。
 */
export function parseFloor(raw: string | null): { floor: number; total: number | null } | null {
  const text = clean(raw);
  if (!text) return null;
  const nums = text.match(/\d+/g);
  if (!nums || nums.length === 0) return null;
  const floor = Number(nums[0]);
  const total = nums.length > 1 ? Number(nums[1]) : null;
  if (!Number.isFinite(floor) || floor <= 0) return null;
  return { floor, total: total && total > 0 ? total : null };
}

/**
 * 591 標題。
 *
 * 規則照「內容產出規格」：挑最強的一個鉤子當主軸，不要全塞。
 * 這裡的策略是 —— 本人自己寫的 headline 永遠優先（他寫的鉤子比程式組的好），
 * 沒寫才用「總價＋格局＋最強條件」自動組一個能用的版本。
 */
export function build591Title(p: PropertyRow): string {
  const headline = clean(p.headline);
  if (headline) return headline;

  const parts: string[] = [];
  if (p.price) parts.push(`${p.price}萬`);

  const layout = clean(p.layout);
  if (layout) parts.push(layout.replace(/\s+/g, ""));

  // 賣點只挑一個最強的塞進標題，順序就是海線客戶最在意的順序
  const parking = clean(p.parking);
  const community = clean(p.community);
  const hook =
    (parking.includes("平面") || parking.includes("平車") ? "平面車位" : "") ||
    (clean(p.highlights).split(/[\r\n]+/)[0] || "").trim().slice(0, 10) ||
    community ||
    "";
  if (hook) parts.push(hook);

  const where = clean(p.district) ? `${p.district}` : "";
  if (where) parts.unshift(where);

  const joined = parts.filter(Boolean).join(" ");
  return joined || clean(p.title);
}

/**
 * 591 物件描述。
 *
 * 骨架固定照「內容產出規格」的要素順序：
 * 總價 → 格局 → 核心賣點 → 樓層／視野 → 車位 → 社區／建商 → 生活機能 → 交通／建設 → 收尾
 *
 * ⚠️ 收尾刻意不放電話／LINE／網址：刊登平台普遍禁止在物件描述裡導流到站外，
 *    591 上被檢舉是會被下架的。要放聯絡方式請用 591 自己的仲介資訊欄位。
 */
export function build591Description(p: PropertyRow): string {
  const blocks: string[] = [];

  /* ---- 開頭：總價 + 格局 + 位置，一句話講完「這是什麼房子」 ---- */
  const opening: string[] = [];
  if (p.price) opening.push(`總價 ${p.price} 萬`);
  if (clean(p.price_note)) opening.push(clean(p.price_note));
  if (clean(p.layout)) opening.push(clean(p.layout));
  const where = clean(p.address_public) || (clean(p.district) ? `台中市${p.district}區` : "");
  if (where) opening.push(where);
  if (opening.length) blocks.push(opening.join("｜"));

  /* ---- 核心賣點 ---- */
  const highlights = clean(p.highlights)
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (highlights.length) {
    blocks.push(["【這間的重點】", ...highlights.map((h) => `・${h}`)].join("\n"));
  }

  /* ---- 房屋條件（樓層／車位／社區／建商都收在這一段，591 讀起來比散開清楚）---- */
  const specs: string[] = [];
  if (clean(p.floor_info)) specs.push(`樓層：${clean(p.floor_info)}`);
  if (clean(p.direction)) specs.push(`朝向：${clean(p.direction)}`);
  if (pingText(p.size_ping)) specs.push(`建物登記：${pingText(p.size_ping)}`);
  if (pingText(p.main_building_ping)) specs.push(`主建物：${pingText(p.main_building_ping)}`);
  if (pingText(p.land_ping)) specs.push(`土地：${pingText(p.land_ping)}`);
  if (p.age_years != null) specs.push(`屋齡：${p.age_years} 年`);
  if (clean(p.parking)) specs.push(`車位：${clean(p.parking)}`);
  if (clean(p.community)) specs.push(`社區：${clean(p.community)}`);
  if (clean(p.builder)) specs.push(`建設公司：${clean(p.builder)}`);
  if (specs.length) blocks.push(["【房屋條件】", ...specs.map((s) => `・${s}`)].join("\n"));

  /* ---- 房仲語言 → 客戶語言：登記坪數不等於實際能用的空間 ---- */
  const registered = pingNumber(p.size_ping);
  const mainBuilding = pingNumber(p.main_building_ping);
  if (registered && mainBuilding && mainBuilding < registered) {
    blocks.push(
      [
        "【坪數怎麼看】",
        `登記 ${registered} 坪裡面，真正的室內空間（主建物）是 ${mainBuilding} 坪，` +
          `其餘 ${(registered - mainBuilding).toFixed(2)} 坪是陽台、雨遮與公共設施分攤的部分。` +
          "實際走進去的感覺以主建物為準，看屋時可以直接對照。",
      ].join("\n"),
    );
  }

  /* ---- 物件介紹全文 ---- */
  if (clean(p.description)) blocks.push(["【物件介紹】", clean(p.description)].join("\n"));

  /* ---- 適合誰 ---- */
  if (clean(p.suitable_for)) blocks.push(["【適合誰】", clean(p.suitable_for)].join("\n"));

  /* ---- 生活機能 ---- */
  if (clean(p.life_info)) blocks.push(["【生活機能】", clean(p.life_info)].join("\n"));

  /* ---- 交通與建設 ---- */
  if (clean(p.transport_info)) blocks.push(["【交通與重大建設】", clean(p.transport_info)].join("\n"));

  /* ---- 收尾（不含任何聯絡方式）---- */
  blocks.push(
    "以上坪數、屋齡、格局以地政機關登記與現場實況為準，價格與銷售狀態可能隨時調整。" +
      "歡迎透過 591 直接留言或來電洽詢，可安排現場看屋。",
  );

  return blocks.join("\n\n");
}

/* ────────────────── 欄位對照表 ────────────────── */

function buildFields(p: PropertyRow): Field591[] {
  const layout = parseLayout(p.layout);
  const floor = parseFloor(p.floor_info);
  const typeText = propertyTypeLabel(p);

  return [
    {
      label: "售價（萬元）",
      value: p.price != null ? String(p.price) : "",
      hint: clean(p.price_note) ? `備註：${clean(p.price_note)}` : undefined,
      required: true,
    },
    { label: "物件類型", value: typeText, required: true },
    { label: "縣市", value: clean(p.district) ? "台中市" : "", required: true },
    { label: "行政區", value: clean(p.district) ? `${p.district}區` : "", required: true },
    {
      label: "地址",
      value: clean(p.address),
      hint: "591 要完整門牌，但可以勾「不揭露門牌號碼」。這是內部欄位，官網公開頁不會顯示。",
      required: true,
    },
    { label: "社區名稱", value: clean(p.community) },
    {
      label: "格局",
      value: layout
        ? `${layout.rooms} 房 ${layout.halls} 廳 ${layout.baths} 衛`
        : clean(p.layout),
      hint: layout
        ? "591 是房／廳／衛三個獨立下拉，照這個數字分開選"
        : clean(p.layout)
          ? "⚠ 這欄拆不出房／廳／衛的數字，591 要分開選，請自己對一下"
          : undefined,
      required: true,
    },
    { label: "建物坪數", value: pingText(p.size_ping), required: true },
    { label: "主建物坪數", value: pingText(p.main_building_ping) },
    { label: "土地坪數", value: pingText(p.land_ping) },
    {
      label: "樓層",
      value: floor ? `${floor.floor}` : clean(p.floor_info),
      hint: floor
        ? "591 是「第幾樓」「共幾樓」兩格"
        : clean(p.floor_info)
          ? "⚠ 這欄拆不出樓層數字，請自己對一下"
          : undefined,
      required: true,
    },
    { label: "總樓層", value: floor?.total != null ? `${floor.total}` : "" },
    { label: "屋齡", value: p.age_years != null ? `${p.age_years} 年` : "" },
    { label: "朝向", value: clean(p.direction) },
    { label: "車位", value: clean(p.parking) },
    { label: "建設公司", value: clean(p.builder) },
  ];
}

/* ────────────────── 上架前檢查 ────────────────── */

function buildWarnings(p: PropertyRow, fields: Field591[], photos: string[], title: string): string[] {
  const out: string[] = [];

  const missing = fields.filter((f) => f.required && !f.value).map((f) => f.label);
  if (missing.length) out.push(`這些 591 通常必填的欄位還沒資料：${missing.join("、")}`);

  if (photos.length === 0) {
    out.push("一張照片都沒有。591 沒照片的物件幾乎沒人點，先補照片再上架。");
  } else if (photos.length < 6) {
    out.push(`目前只有 ${photos.length} 張照片。591 建議至少 6～10 張（客廳、主臥、廚房、衛浴、陽台、外觀）。`);
  }

  if (title.length > TITLE_LIMIT) {
    out.push(`標題 ${title.length} 字，超過建議的 ${TITLE_LIMIT} 字，591 可能會截掉後面。`);
  }

  if (!clean(p.highlights)) {
    out.push("「核心賣點」沒填，描述會少掉最重要的那一段（客戶為什麼要買這間）。");
  }
  if (!clean(p.description)) {
    out.push("「物件介紹」沒填，描述只會有規格條列，讀起來像規格表不像房子。");
  }
  if (!clean(p.address)) {
    out.push("完整地址沒填。591 上架要輸入門牌（可勾不揭露），沒有會卡在表單。");
  }

  return out;
}

/* ────────────────── 組整包 ────────────────── */

export function build591Package(p: PropertyRow): Export591Package {
  const titleFull = build591Title(p);
  const title = titleFull.length > TITLE_LIMIT ? titleFull.slice(0, TITLE_LIMIT) : titleFull;
  const description = build591Description(p);
  const fields = buildFields(p);

  const photos = [
    ...(clean(p.cover_url) ? [directImageUrl(clean(p.cover_url))] : []),
    ...parseImageList(p.photo_urls),
  ].filter((url, i, arr) => arr.indexOf(url) === i);

  const videos = parseVideoList(p.video_urls).map((v) => v.src);
  const warnings = buildWarnings(p, fields, photos, titleFull);

  const plainText = [
    `【591 標題】（${titleFull.length} 字）`,
    titleFull,
    "",
    "【591 欄位】",
    ...fields.map((f) => `${f.label}：${f.value || "（未填）"}`),
    "",
    "【591 物件描述】",
    description,
    "",
    `【照片網址】共 ${photos.length} 張，依序上傳`,
    ...(photos.length ? photos.map((url, i) => `${String(i + 1).padStart(2, "0")}. ${url}`) : ["（沒有照片）"]),
  ].join("\n");

  return {
    title,
    titleFull,
    titleLength: titleFull.length,
    titleOverflow: titleFull.length > TITLE_LIMIT,
    description,
    fields,
    photos,
    videos,
    warnings,
    plainText,
  };
}
