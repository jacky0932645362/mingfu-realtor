/**
 * LINE 推播——照抄 property-watch/notify.mjs 的做法（同一組 bot/群、同樣的環境
 * 變數命名習慣、沒設定就安靜跳過、純文字不寫 Markdown）。
 *
 * 想跟 property-watch／官網預約通知分開 → 環境變數 RR_LINE_TOKEN／RR_LINE_TARGET
 * 蓋過去。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PROJECT_ROOT, twClock } from "./_shared.mjs";

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

function readEnvLocal(keys) {
  const out = {};
  try {
    const raw = readFileSync(path.join(PROJECT_ROOT, ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || !keys.includes(m[1])) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  } catch {
    /* 沒有 .env.local 也沒關係 */
  }
  return out;
}

function lineConfig() {
  const env = readEnvLocal(["LINE_CHANNEL_ACCESS_TOKEN", "LINE_ADMIN_GROUP_ID"]);
  return {
    token: process.env.RR_LINE_TOKEN || env.LINE_CHANNEL_ACCESS_TOKEN || "",
    target: process.env.RR_LINE_TARGET || env.LINE_ADMIN_GROUP_ID || "",
  };
}

export async function pushLine(text) {
  const { token, target } = lineConfig();
  if (!token || !target) return { skipped: true, reason: "line_not_configured" };
  try {
    const res = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: target, messages: [{ type: "text", text: String(text).slice(0, 4900) }] }),
    });
    if (!res.ok) return { skipped: false, reason: `line_http_${res.status}` };
    return { skipped: false, reason: "ok" };
  } catch (e) {
    return { skipped: false, reason: "network_error", detail: String(e).slice(0, 200) };
  }
}

/**
 * 🔴 最重要的一則：舊物件已經關閉，但新物件沒建立成功——代表這戶現在完全
 * 沒曝光，需要本人立刻手動處理，不能等下次排程。跟其他事件比起來優先度最高。
 */
export function renderRecycleFailed(snap, error) {
  return `🔴 樂屋重刊失敗，物件已關閉但新的沒建立成功，需要你手動處理！\n\n` +
    `${snap.no || snap.listing?.title || "（沒有標題）"}\n` +
    `原因：${String(error).slice(0, 200)}\n` +
    `舊刊登：${snap.rakuyaUrl || "（沒有記錄）"}\n` +
    `⏱ ${twClock()}`;
}

export function renderRecycled(snap) {
  return `🔄 樂屋物件已重新上架\n\n${snap.no || snap.listing?.title || ""}\n第 ${snap.cycleCount} 次重刊\n🔗 ${snap.rakuyaUrl}\n⏱ ${twClock()}`;
}

export function renderRentedOut(snap, mismatchedFields) {
  return `⚫️ 判定已出租，停止重刊\n\n${snap.no || snap.listing?.title || ""}\n對不起來的欄位：${mismatchedFields.join("、")}\n⏱ ${twClock()}`;
}

export function renderCheckFailing(snap, failStreak) {
  return `⚠️ 存在檢查連續 ${failStreak} 次抓不到\n\n${snap.no || snap.listing?.title || ""}\n愛屋連結：${snap.catalogUrl}\n找時間自己點開看一下是不是連結失效了。\n⏱ ${twClock()}`;
}
