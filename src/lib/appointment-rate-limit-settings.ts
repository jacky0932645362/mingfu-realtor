/**
 * 預約防灌爆的三道限制，改成後台可調（2026-08-06 系統擁有者）。
 *
 * 系統擁有者：「我不要讓系統自動卡我，我要自己處理。幾次才算太頻繁、幾分鐘後自動解除，
 *        這個我要從後臺設定。」
 *
 * 原本三個數字寫死在 `api/appointment/create/route.ts` 裡：
 *   IP 8 次 / 10 分鐘、相同聯絡資料 3 次 / 60 分鐘、重複防呆 10 分鐘。
 * 系統擁有者自己測試時一直用同一組 email + 電話，**3 次就被鎖 1 小時**，測不下去。
 *
 * ⚠️ 這支檔案刻意**不 import 任何東西**：後台設定面板是 client component、
 *    擋人的是 API route，兩邊要共用同一份預設值與正規化規則。
 */

/** 存在 appointment_config 的 key */
export const RATE_LIMIT_CONFIG_KEYS = {
  ipLimit: "rate_ip_limit",
  ipWindowMin: "rate_ip_window_min",
  contactLimit: "rate_contact_limit",
  contactWindowMin: "rate_contact_window_min",
  duplicateWindowMin: "rate_duplicate_window_min",
} as const;

export type AppointmentRateLimitSettings = {
  /** 同一個 IP 幾分鐘內最多送幾次。0 = 不限制 */
  ipLimit: number;
  ipWindowMin: number;
  /** 同一組 email + 電話幾分鐘內最多送幾次。0 = 不限制 */
  contactLimit: number;
  contactWindowMin: number;
  /** 同一組聯絡資料送出後，幾分鐘內不能再送（防手滑連按）。0 = 不限制 */
  duplicateWindowMin: number;
};

/** 沒設定時就用這組 —— 跟 2026-08-06 之前寫死的數字一模一樣，不改變任何既有行為 */
export const DEFAULT_RATE_LIMIT_SETTINGS: AppointmentRateLimitSettings = {
  ipLimit: 8,
  ipWindowMin: 10,
  contactLimit: 3,
  contactWindowMin: 60,
  duplicateWindowMin: 10,
};

/**
 * 系統擁有者自己測試時建議的一組（面板上有一鍵套用）。
 * 放寬到「同一組資料 10 分鐘 20 次、重複防呆只留 1 分鐘」—— 連續測不會被自己卡住，
 * 但真的有人拿機器灌還是擋得住。
 */
export const TESTING_RATE_LIMIT_SETTINGS: AppointmentRateLimitSettings = {
  ipLimit: 40,
  ipWindowMin: 10,
  contactLimit: 20,
  contactWindowMin: 10,
  duplicateWindowMin: 1,
};

/** 上限值：擋住手滑打成 999999 讓視窗變成好幾天 */
const MAX_LIMIT = 1000;
const MAX_WINDOW_MIN = 24 * 60;

function num(value: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

/** 把後台存的字串（或空值）變成能用的設定。任何一欄壞掉只回退那一欄，不整組作廢。 */
export function normalizeRateLimitSettings(
  raw: Partial<Record<keyof AppointmentRateLimitSettings, unknown>>,
): AppointmentRateLimitSettings {
  const d = DEFAULT_RATE_LIMIT_SETTINGS;
  return {
    ipLimit: num(raw.ipLimit, d.ipLimit, MAX_LIMIT),
    // 視窗至少 1 分鐘：填 0 會讓「幾分鐘內」失去意義，而且會一直重算視窗
    ipWindowMin: Math.max(1, num(raw.ipWindowMin, d.ipWindowMin, MAX_WINDOW_MIN)),
    contactLimit: num(raw.contactLimit, d.contactLimit, MAX_LIMIT),
    contactWindowMin: Math.max(1, num(raw.contactWindowMin, d.contactWindowMin, MAX_WINDOW_MIN)),
    duplicateWindowMin: num(raw.duplicateWindowMin, d.duplicateWindowMin, MAX_WINDOW_MIN),
  };
}

/** 人話說明目前這組設定會怎麼擋人，直接顯示在後台，不用自己推。 */
export function describeRateLimitSettings(s: AppointmentRateLimitSettings): string[] {
  const lines: string[] = [];
  lines.push(
    s.ipLimit > 0
      ? `同一台裝置（同 IP）${s.ipWindowMin} 分鐘內最多送 ${s.ipLimit} 次，超過要等 ${s.ipWindowMin} 分鐘。`
      : "同一台裝置：不限制。",
  );
  lines.push(
    s.contactLimit > 0
      ? `同一組 Email ＋ 電話 ${s.contactWindowMin} 分鐘內最多送 ${s.contactLimit} 次，超過要等 ${s.contactWindowMin} 分鐘。`
      : "同一組 Email ＋ 電話：不限制。",
  );
  lines.push(
    s.duplicateWindowMin > 0
      ? `同一組聯絡資料送出後 ${s.duplicateWindowMin} 分鐘內不能再送（防手滑連按兩次）。`
      : "重複防呆：關閉，同一組資料可以連續送。",
  );
  return lines;
}
