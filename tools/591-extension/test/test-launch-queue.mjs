/**
 * 「591＋樂屋一起上架」排隊邏輯（lib/launchQueue.js）的純函式測試。跑法：node test/test-launch-queue.mjs
 * background.js 是 classic script 不是 ES module，實際跑的是照這裡的邏輯另外手寫的一份；
 * 這支測試是那份邏輯的正本與說明（見 background.js 開頭的註解）。
 */
import { payloadSlotKey, planLaunchStore, planChainOpen } from "../lib/launchQueue.js";

let pass = 0;
let fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.log(`❌ ${label}\n   得到 ${JSON.stringify(got)}\n   應該 ${JSON.stringify(want)}`);
  }
}

eq("slot：沒給 target 當 591", payloadSlotKey(undefined), "listing:payload:591");
eq("slot：591", payloadSlotKey("591"), "listing:payload:591");
eq("slot：樂屋", payloadSlotKey("rakuya"), "listing:payload:rakuya");

/* ───────── planLaunchStore ───────── */
{
  const r = planLaunchStore({ v: 1, desc: "單獨上 591" });
  eq("單獨上 591：只存 591 那格", Object.keys(r.store), ["listing:payload:591"]);
  eq("單獨上 591：沒有 chain", r.chained, false);
  eq("單獨上 591：openTarget", r.openTarget, undefined);
}
{
  const r = planLaunchStore({ v: 1, target: "rakuya", desc: "單獨上樂屋" });
  eq("單獨上樂屋：只存樂屋那格", Object.keys(r.store), ["listing:payload:rakuya"]);
  eq("單獨上樂屋：沒有 chain", r.chained, false);
}
{
  const r = planLaunchStore({ v: 1, target: "591", desc: "591本體", chain: { v: 1, desc: "樂屋本體" } });
  eq("一起上架：兩格都存", Object.keys(r.store).sort(), ["listing:payload:591", "listing:payload:rakuya"]);
  eq("一起上架：591 那格不帶 chain 欄位（不能整包存進 storage）", "chain" in r.store["listing:payload:591"], false);
  eq("一起上架：樂屋那格標 queued、target 補成 rakuya", r.store["listing:payload:rakuya"], { v: 1, desc: "樂屋本體", target: "rakuya", queued: true });
  eq("一起上架：chained 為 true、只開 591", [r.chained, r.openTarget], [true, "591"]);
}

/* ───────── planChainOpen：591 填完之後，樂屋排隊中要不要接著開 ───────── */
eq("591 填完，樂屋沒有排隊 → 不用開", planChainOpen("591", undefined), null);
eq("591 填完，樂屋那格不是排隊狀態（已經開過或本來就沒有一起上架）→ 不用開", planChainOpen("591", { v: 1, target: "rakuya" }), null);
eq("591 填完，樂屋還在排隊 → 開，並拿掉 queued", planChainOpen("591", { v: 1, target: "rakuya", queued: true }), { v: 1, target: "rakuya" });
eq("樂屋填完（不是 591）→ 不會觸發（一起上架永遠是 591 先填）", planChainOpen("rakuya", { v: 1, target: "rakuya", queued: true }), null);

console.log(`\n${pass} 過、${fail} 沒過`);
if (fail) process.exit(1);
