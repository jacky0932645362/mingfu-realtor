"use client";
/**
 * 挑日期時間：日期 ＋「上午／下午」兩顆切換鈕 ＋ 幾點 ＋ 幾分。
 *
 * 為什麼不用瀏覽器原生的 `<input type="datetime-local">`：
 * 中文版 Chrome 雖然會顯示「上午 10:00」，但那個「上午」是輸入框裡一小格，
 * 要用滑鼠精準點到它、或用方向鍵切 —— 排錯成 12 小時後的下午是很容易發生的事，
 * 而且發文排錯時段的代價是真的貼出去。（2026-09-11 本人要求「我要區分上午跟下午」。）
 *
 * 日期也不用原生的 `<input type="date">`：那個小月曆點年份要先點標題再捲，
 * 本人 2026-09-21 要求「點下去就跳出年份讓你選（2026、2027、2028…），月、日、時、分
 * 全部同一種下拉」—— 所以年／月／日各一個 <select>，跟幾點／幾分長得一樣。
 * 年份給「今年起 5 年」；正在改的是舊任務（年份不在這 5 年裡）就把那一年也塞進清單，
 * 免得 <select> 對不到值、畫面顯示第一項卻不是真正的值。
 * 換月份／年份時，日超過那個月的天數（例：1/31 → 2 月）會自動收到當月最後一天。
 *
 * value / onChange 一律用 `YYYY-MM-DDTHH:mm`（24 小時制、本機時區），
 * 跟原本 datetime-local 的格式一模一樣 —— 呼叫端不用改，直接換掉即可。
 */
import { CIS_VAR as CIS } from "@/app/admin/_components/cis";

const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DDTHH:mm` → 拆成各部分。解不出來就退回今天 09:00。 */
function parse(v: string) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})/.exec(v || "");
  if (!m) {
    const d = new Date();
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, h24: 9, min: 0 };
  }
  return { date: m[1], h24: Number(m[2]), min: Number(m[3]) };
}

/** 24 小時制 → 上午/下午 ＋ 12 小時制的鐘面數字。 */
function to12(h24: number) {
  const pm = h24 >= 12;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { pm, h12 };
}

/** 上午/下午 ＋ 鐘面數字 → 24 小時制。 */
function to24(pm: boolean, h12: number) {
  if (h12 === 12) return pm ? 12 : 0;
  return pm ? h12 + 12 : h12;
}

/** 某年某月有幾天（month 是 1～12）。 */
export function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

/** 換年／月／日其中一個之後的日期字串；日超過那個月的天數就收到最後一天（1/31 → 2 月＝2/28）。 */
export function clampedDate(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
}

/** 年份下拉要列哪幾年：今年起 5 年，再把目前值的那一年補進去（改舊任務時才對得到）。 */
export function yearOptions(current: number) {
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => thisYear + i);
  if (!years.includes(current)) years.push(current);
  return years.sort((a, b) => a - b);
}

export function WhenPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const { date, h24, min } = parse(value);
  const { pm, h12 } = to12(h24);
  const [year, month, day] = date.split("-").map(Number);

  const emit = (d: string, isPm: boolean, hour12: number, minute: number) =>
    onChange(`${d}T${pad(to24(isPm, hour12))}:${pad(minute)}`);

  /** 改年／月／日其中一個；日超過那個月的天數就收到最後一天。 */
  const setDate = (y: number, m: number, d: number) => emit(clampedDate(y, m, d), pm, h12, min);

  const seg = (active: boolean): React.CSSProperties => ({
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: active ? 800 : 500,
    cursor: disabled ? "default" : "pointer",
    border: "none",
    background: active ? CIS.blue : "transparent",
    color: active ? "#fff" : CIS.textMute,
    transition: "background .12s",
  });

  const field: React.CSSProperties = {
    background: CIS.bgSoft,
    border: `1px solid ${CIS.cardBorder}`,
    color: CIS.text,
    borderRadius: 7,
    padding: "6px 9px",
    fontSize: 13,
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {/* 年／月／日：三個下拉，點下去直接列出來選（不用原生月曆）。 */}
      <select
        value={year}
        disabled={disabled}
        onChange={(e) => setDate(Number(e.target.value), month, day)}
        style={field}
        aria-label="年"
      >
        {yearOptions(year).map((y) => (
          <option key={y} value={y}>
            {y} 年
          </option>
        ))}
      </select>

      <select
        value={month}
        disabled={disabled}
        onChange={(e) => setDate(year, Number(e.target.value), day)}
        style={field}
        aria-label="月"
      >
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <option key={m} value={m}>
            {m} 月
          </option>
        ))}
      </select>

      <select
        value={day}
        disabled={disabled}
        onChange={(e) => setDate(year, month, Number(e.target.value))}
        style={field}
        aria-label="日"
      >
        {Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {d} 日
          </option>
        ))}
      </select>

      {/* 上午／下午：做成兩顆看得見的切換鈕，不要藏在輸入框的一小格裡 */}
      <div
        style={{
          display: "inline-flex",
          borderRadius: 7,
          overflow: "hidden",
          border: `1px solid ${CIS.cardBorder}`,
        }}
      >
        <button type="button" disabled={disabled} style={seg(!pm)} onClick={() => emit(date, false, h12, min)}>
          上午
        </button>
        <button type="button" disabled={disabled} style={seg(pm)} onClick={() => emit(date, true, h12, min)}>
          下午
        </button>
      </div>

      <select
        value={h12}
        disabled={disabled}
        onChange={(e) => emit(date, pm, Number(e.target.value), min)}
        style={field}
        aria-label="小時"
      >
        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
          <option key={h} value={h}>
            {h} 點
          </option>
        ))}
      </select>

      <select
        value={min}
        disabled={disabled}
        onChange={(e) => emit(date, pm, h12, Number(e.target.value))}
        style={field}
        aria-label="分鐘"
      >
        {/* 每 1 分鐘一格（2026-09-19 本人要求，原本每 5 分）。順便解掉一個隱性問題：
            「立即發佈」的 run_at 是當下的分鐘（例如 10:07），以前 07 不在清單裡，改時間時下拉會對不到值。 */}
        {Array.from({ length: 60 }, (_, i) => i).map((m) => (
          <option key={m} value={m}>
            {pad(m)} 分
          </option>
        ))}
      </select>

      <span style={{ fontSize: 12, color: CIS.textMute }}>
        {date.replace(/-/g, "/")} {pm ? "下午" : "上午"} {h12}:{pad(min)}
      </span>
    </div>
  );
}
