/**
 * Google 日曆事件的「長相」設定：標題怎麼寫、用哪個顏色（2026-08-06 系統擁有者）。
 *
 * 起因：系統擁有者看到自己日曆上寫「太平洋房屋預約｜蕭茗馥」——「好奇怪的名詞」。
 * 標題與顏色原本各自寫死在兩支檔案裡（`appointment-outbox.ts` 與 `google-calendar.ts`），
 * 改一邊會漏另一邊，所以把判準抽到這裡當單一來源。
 *
 * ⚠️ 這支檔案刻意**不 import 任何東西**：後台設定面板是 client component、
 *    產生事件的是 server 端，兩邊要共用同一份顏色清單與樣板規則。
 */

/** Google 日曆的 11 個事件顏色（colorId 是 Google 定的，不能自己編） */
export const CALENDAR_EVENT_COLORS: ReadonlyArray<{ id: string; name: string; hex: string }> = [
  { id: "1", name: "薰衣草紫", hex: "#7986cb" },
  { id: "2", name: "鼠尾草綠", hex: "#33b679" },
  { id: "3", name: "葡萄紫", hex: "#8e24aa" },
  { id: "4", name: "火鶴紅", hex: "#e67c73" },
  { id: "5", name: "香蕉黃", hex: "#f6bf26" },
  { id: "6", name: "橘", hex: "#f4511e" },
  { id: "7", name: "孔雀藍", hex: "#039be5" },
  { id: "8", name: "石墨灰", hex: "#616161" },
  { id: "9", name: "藍莓藍", hex: "#3f51b5" },
  { id: "10", name: "羅勒綠", hex: "#0b8043" },
  { id: "11", name: "番茄紅", hex: "#d50000" },
];

/** 2026-06-20 起用的孔雀藍。沒設定時沿用，避免既有日曆突然變色。 */
export const DEFAULT_CALENDAR_COLOR_ID = "7";

/** 沒設定時的標題。維持原樣，設定沒填不會改變任何既有行為。 */
export const DEFAULT_CALENDAR_TITLE_TEMPLATE = "太平洋房屋預約｜{姓名}";

/** 存在 appointment_config 的 key */
export const CALENDAR_TITLE_CONFIG_KEY = "calendar_title_template";
export const CALENDAR_COLOR_CONFIG_KEY = "calendar_color_id";

/** 標題可以用的代號。後台面板直接把這份列出來給人點。 */
export const CALENDAR_TITLE_TOKENS: ReadonlyArray<{ token: string; desc: string; sample: string }> = [
  { token: "{姓名}", desc: "預約人姓名", sample: "蕭茗馥" },
  { token: "{電話}", desc: "聯絡電話", sample: "0912345678" },
  { token: "{方式}", desc: "見面方式", sample: "公司面談" },
  { token: "{目的}", desc: "來意（房仲服務 / 課程諮詢⋯）", sample: "房仲服務" },
  { token: "{需求}", desc: "需求（買房 / 賣房⋯）", sample: "賣房" },
];

export type CalendarTitleData = {
  name?: string | null;
  phone?: string | null;
  meetTypeLabel?: string | null;
  intent?: string | null;
  purpose?: string | null;
};

/**
 * 把樣板換成真的字。
 *
 * 換完如果整串是空的（例如樣板只有 `{電話}` 而那筆沒電話），回退到預設樣板再換一次；
 * 還是空就回「預約」——**日曆事件絕不能沒有標題**，那在手機上會變成一條看不懂的空白格。
 */
export function renderCalendarTitle(template: string, data: CalendarTitleData): string {
  const map: Record<string, string> = {
    "{姓名}": String(data.name || "").trim(),
    "{電話}": String(data.phone || "").trim(),
    "{方式}": String(data.meetTypeLabel || "").trim(),
    "{目的}": String(data.intent || "").trim(),
    "{需求}": String(data.purpose || "").trim(),
  };
  const fill = (t: string) =>
    Object.entries(map)
      .reduce((acc, [k, v]) => acc.split(k).join(v), t)
      // 代號換成空字串後常留下「｜」「-」「·」孤零零掛在頭尾或連在一起
      .replace(/[｜|·・\-–—]{2,}/g, "｜")
      .replace(/^[\s｜|·・\-–—]+|[\s｜|·・\-–—]+$/g, "")
      .trim();

  const first = fill(String(template || "").trim() || DEFAULT_CALENDAR_TITLE_TEMPLATE);
  if (first) return first.slice(0, 120);
  const fallback = fill(DEFAULT_CALENDAR_TITLE_TEMPLATE);
  return (fallback || "預約").slice(0, 120);
}

/** 只認 Google 真的有的那 11 個色號，其餘一律回預設（後台亂填或舊資料髒了都不會炸） */
export function normalizeCalendarColorId(value: unknown): string {
  const v = String(value ?? "").trim();
  return CALENDAR_EVENT_COLORS.some((c) => c.id === v) ? v : DEFAULT_CALENDAR_COLOR_ID;
}

/** 樣板存進 DB 前的清洗：去頭尾空白、限長 120（Google 標題本身沒硬限，但太長在手機會被截掉） */
export function normalizeCalendarTitleTemplate(value: unknown): string {
  const v = String(value ?? "").replace(/[\r\n]+/g, " ").trim();
  return (v || DEFAULT_CALENDAR_TITLE_TEMPLATE).slice(0, 120);
}
