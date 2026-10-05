"use client";
/**
 * 排一個發文任務。
 * 預設值：時間＝明天早上 10:00（今天馬上發最容易忘了先看一眼文案）；
 *          冷卻中的社團預設不勾（那個提示存在的意義就是「別貼」）；
 *          自己按發布預設開（本人要自動，但第一次接真 FB 先讓它停在最後一步比較安全）。
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { scheduleTaskAction } from "@/lib/actions/fb-actions";
import { CIS, CHIP } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import { WhenPicker } from "@/app/admin/_ui/WhenPicker";
import styles from "../fb.module.css";

type GroupOption = { id: string; name: string; cooling: boolean; note: string };
/** IG／Threads 帳號連結狀態（2026-09-21）：沒連結就不給勾，勾了到點也發不出去。 */
export type SocialOption = { connected: boolean; username: string | null; appConfigured: boolean };

const inputStyle = { background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text };

function defaultRunAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ScheduleForm({
  drafts,
  groups,
  channel,
  preselectDraft,
  marketplaceOnly,
  social,
}: {
  drafts: Array<{ id: string; title: string }>;
  groups: GroupOption[];
  channel: string;
  preselectDraft: string;
  marketplaceOnly: boolean;
  social?: { ig: SocialOption; threads: SocialOption };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const [draftId, setDraftId] = useState(
    drafts.some((d) => d.id === preselectDraft) ? preselectDraft : drafts[0]?.id || "",
  );

  // 🔴 drafts 這個 prop 會變：換通路分頁（一般貼文 ↔ Marketplace）、或排完一筆之後
  //    那則就掉出「還沒貼」清單。但 useState 只在第一次掛載時算一次 ——
  //    state 裡存的 id 就會變成「清單裡根本沒有的東西」。
  //    症狀很陰險：<select> 的 value 對不到任何 <option>，瀏覽器會顯示第一項，
  //    看起來明明選好了，一按送出卻跳「先挑一則文案」。
  //    （2026-09-08 本人踩到：一般貼文 0 則 → 切到 Marketplace，draftId 還是空字串。）
  //    所以送出跟顯示都用這個「校正過」的值，不要直接用 state。
  const safeDraftId = drafts.some((d) => d.id === draftId) ? draftId : drafts[0]?.id || "";
  const [runAt, setRunAt] = useState(defaultRunAt);
  const [timeline, setTimeline] = useState(true);
  const [autoPublish, setAutoPublish] = useState(true);
  // 同時發到 IG／Threads（官方 API）。預設不勾：那是公開發到另外兩個平台，要本人明確打開。
  const [shareIg, setShareIg] = useState(false);
  const [shareThreads, setShareThreads] = useState(false);
  // Marketplace 專用：到點也照貼文庫那則存的社團清單一起勾社團上架。預設不勾 ——
  // 沒人看著的排程勾錯社團＝直接公開發到錯地方，要本人明確打開。
  const [mpCrosspost, setMpCrosspost] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(groups.filter((g) => !g.cooling).map((g) => g.id)),
  );

  const chosen = useMemo(() => groups.filter((g) => picked.has(g.id)), [groups, picked]);
  const coolingChosen = chosen.filter((g) => g.cooling).length;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = (runNow = false) => {
    setMsg(null);
    if (!safeDraftId) return setMsg({ tone: "bad", text: "先挑一則文案" });
    start(async () => {
      const res = await scheduleTaskAction({
        draftId: safeDraftId,
        channel,
        runAt,
        postToTimeline: timeline,
        groupIds: [...picked],
        autoPublish,
        runNow,
        crosspost: mpCrosspost,
        shareIg: !marketplaceOnly && shareIg,
        shareThreads: !marketplaceOnly && shareThreads,
      });
      setMsg(res.ok ? { tone: "ok", text: res.message || "排好了" } : { tone: "bad", text: res.error || "排程失敗" });
      if (res.ok) router.refresh();
    });
  };

  // 🔴 沒有可排的文案時，這裡會 early return —— 連「排定時間發佈／立即發佈」兩顆按鈕都看不到。
  //    本人 2026-09-11 就是卡在這：以為是功能壞了，其實是「還沒貼」的文案是 0。
  //    所以訊息要講清楚「為什麼是 0」跟「怎麼弄出一則來」，不能只說「沒有文案」。
  if (drafts.length === 0) {
    return (
      <div
        className={styles.empty}
        style={{ borderColor: CIS.cardBorder, color: CIS.textMute, textAlign: "left", lineHeight: 1.9 }}
      >
        <strong style={{ color: CIS.textSub }}>
          沒有「還沒貼」的{marketplaceOnly ? " Marketplace " : "一般貼文"}文案可以排。
        </strong>
        <br />
        （發過的會標成「已發」，就不會出現在這個下拉裡了）
        <div style={{ marginTop: 10, fontSize: 13 }}>
          要弄出一則可以排的，兩條路：
          <div style={{ marginTop: 6 }}>
            1️⃣{" "}
            <Link href="/admin/fb/library" style={{ color: CIS.blueSoft }}>
              去貼文庫
            </Link>{" "}
            點進發過的那則 → 按右上角「<strong style={{ color: CIS.textSub }}>再發一次</strong>」→ 狀態退回「還沒貼」
          </div>
          <div style={{ marginTop: 4 }}>
            2️⃣{" "}
            <Link href="/admin/fb/compose" style={{ color: CIS.blueSoft }}>
              去產生文案
            </Link>{" "}
            從物件庫挑一筆產新的
          </div>
        </div>
        {marketplaceOnly ? (
          <div style={{ marginTop: 12, fontSize: 12.5, color: "#b45309", lineHeight: 1.75 }}>
            ⚠️ Marketplace 版本<strong>只有「從物件庫挑一筆」產的文案才有</strong>。
            「手動填一筆」寫的只會有一般貼文版本 —— Marketplace 的價格／坪數／格局那些欄位，
            要有結構化的物件資料才組得出來。
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
      <h3 className={styles.cardTitle}>
        <Icon name="calendar" size={16} color={CIS.blueSoft} />
        排一個「{channel === "post" ? "一般貼文" : "Marketplace"}」任務
      </h3>

      {msg ? (
        <div
          className={styles.notice}
          style={
            msg.tone === "ok"
              ? { background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#16a34a" }
              : { background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.3)", color: "#e11d48" }
          }
        >
          <Icon name={msg.tone === "ok" ? "success" : "error"} size={16} className={styles.noticeIcon} />
          <div>{msg.text}</div>
        </div>
      ) : null}

      <div className={styles.grid2}>
        <div className={styles.field}>
          <label className={styles.label} style={{ color: CIS.textSub }}>
            要貼哪一則文案
          </label>
          <select
            className={styles.select}
            style={inputStyle}
            value={safeDraftId}
            onChange={(e) => setDraftId(e.target.value)}
          >
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} style={{ color: CIS.textSub }}>
            {marketplaceOnly ? "排定的發佈時間（用「立即發佈」的話這個不看）" : "什麼時候發"}
          </label>
          <WhenPicker value={runAt} onChange={setRunAt} />
        </div>
      </div>

      {!marketplaceOnly ? (
        <>
          <div className={styles.field} style={{ marginTop: 18 }}>
            <label className={styles.label} style={{ color: CIS.textSub }}>
              要貼到哪些地方
            </label>
            <label
              className={styles.checkBox}
              style={{ background: CIS.bgSoft, border: `1px solid ${timeline ? "rgba(90,145,225,0.4)" : CIS.cardBorder}` }}
            >
              <input type="checkbox" checked={timeline} onChange={(e) => setTimeline(e.target.checked)} />
              <span>
                <strong>貼在自己的 FB 動態</strong>
                <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 2 }}>
                  先貼自己的牆，社團的人點進來才看得到
                </div>
              </span>
            </label>
          </div>

          {/* IG／Threads（2026-09-21）：同一份工作多兩個目標，到點 runner 先用官方 API 發這兩個、再開瀏覽器跑 FB */}
          <div className={styles.field} style={{ marginTop: 14 }}>
            <label className={styles.label} style={{ color: CIS.textSub }}>
              同時分享到（官方 API，不開瀏覽器）
            </label>
            <div className={styles.checkGrid}>
              {(
                [
                  { key: "ig", label: "Instagram", on: shareIg, set: setShareIg, opt: social?.ig, hint: "輪播最多 10 張、只吃 JPEG（Cloudinary 照片會自動轉）；一定要有照片" },
                  { key: "threads", label: "Threads", on: shareThreads, set: setShareThreads, opt: social?.threads, hint: "內文 500 字內（貼文庫那則的 Threads 分頁可改）；可以純文字" },
                ] as const
              ).map((p) => {
                const connected = Boolean(p.opt?.connected);
                return (
                  <label
                    key={p.key}
                    className={styles.checkBox}
                    style={{
                      background: CIS.bgSoft,
                      border: `1px solid ${p.on ? "rgba(90,145,225,0.4)" : CIS.cardBorder}`,
                      opacity: connected ? 1 : 0.6,
                      cursor: connected ? "pointer" : "not-allowed",
                    }}
                  >
                    <input type="checkbox" checked={p.on} disabled={!connected} onChange={(e) => p.set(e.target.checked)} />
                    <span style={{ minWidth: 0 }}>
                      <strong>{p.label}</strong>
                      <span style={{ color: CIS.textMute, fontSize: 12 }}>
                        {connected ? `　@${p.opt?.username || "已連結"}` : ""}
                      </span>
                      <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 2 }}>
                        {connected ? (
                          p.hint
                        ) : (
                          <>
                            還沒連結帳號 →{" "}
                            <Link href="/admin/fb/social" style={{ color: CIS.blueSoft }}>
                              IG／Threads 帳號
                            </Link>
                            {p.opt && !p.opt.appConfigured ? "（App ID／Secret 也還沒設）" : ""}
                          </>
                        )}
                      </div>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className={styles.field} style={{ marginTop: 14 }}>
            <label className={styles.label} style={{ color: CIS.textSub }}>
              社團（{groups.length} 個收這種文）—— 橘色的是距離上次貼太近，預設不勾
            </label>
            {groups.length === 0 ? (
              <div style={{ fontSize: 13, color: CIS.textMute }}>這個通路還沒有啟用的社團。去「社團清單」加幾個。</div>
            ) : (
              <div className={styles.checkGrid}>
                {groups.map((g) => {
                  const on = picked.has(g.id);
                  return (
                    <label
                      key={g.id}
                      className={styles.checkBox}
                      style={{
                        background: CIS.bgSoft,
                        border: `1px solid ${on ? (g.cooling ? "rgba(245,158,11,0.45)" : "rgba(90,145,225,0.4)") : CIS.cardBorder}`,
                      }}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggle(g.id)} />
                      <span style={{ minWidth: 0 }}>
                        <strong style={{ color: g.cooling ? "#b45309" : CIS.text }}>{g.name}</strong>
                        <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 2 }}>{g.note}</div>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <label
            className={styles.checkBox}
            style={{
              marginTop: 16,
              background: autoPublish ? "rgba(244,63,94,0.08)" : CIS.bgSoft,
              border: `1px solid ${autoPublish ? "rgba(244,63,94,0.3)" : CIS.cardBorder}`,
            }}
          >
            <input type="checkbox" checked={autoPublish} onChange={(e) => setAutoPublish(e.target.checked)} />
            <span>
              <strong style={{ color: autoPublish ? "#e11d48" : CIS.text }}>
                {autoPublish ? "🔴 程式自己按「發佈」（全自動）" : "打完字停住，最後那下我自己按"}
              </strong>
              <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 3, lineHeight: 1.65 }}>
                {autoPublish
                  ? "全程不用你在。打完字還是會讀回來對答案，少超過一成就中止不發。"
                  : "桌機會開瀏覽器、打好字、上傳照片，然後停在最後一步等你。適合第一次跑、或這篇特別重要的時候。"}
              </div>
            </span>
          </label>

          {coolingChosen > 0 ? (
            <div style={{ marginTop: 12, fontSize: 13 }}>
              <span
                className={styles.chip}
                style={{ background: CHIP.warn.bg, color: CHIP.warn.color, borderColor: CHIP.warn.border }}
              >
                <Icon name="warning" size={11} />
                勾了 {coolingChosen} 個冷卻中的社團
              </span>
              <span style={{ color: CIS.textMute, marginLeft: 8 }}>
                冷卻只是提醒，勾了到點還是會照發——確定要貼就留著。
              </span>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <label
            className={styles.checkBox}
            style={{
              marginTop: 16,
              background: mpCrosspost ? "rgba(244,63,94,0.08)" : CIS.bgSoft,
              border: `1px solid ${mpCrosspost ? "rgba(244,63,94,0.3)" : CIS.cardBorder}`,
            }}
          >
            <input type="checkbox" checked={mpCrosspost} onChange={(e) => setMpCrosspost(e.target.checked)} />
            <span>
              <strong style={{ color: mpCrosspost ? "#e11d48" : CIS.text }}>
                {mpCrosspost ? "🔴 同時上架到社團" : "同時上架到社團（預設不勾）"}
              </strong>
              <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 3, lineHeight: 1.65 }}>
                照「貼文庫 → 這則 → Marketplace → 打算上架去哪些社團」那份清單，在刊登流程一次勾。
                {mpCrosspost
                  ? " ⚠️ 沒人在旁邊看，那份清單裡若有勾錯的社團，會直接公開發出去。不確定就關掉，用桌機 FB-Marketplace.bat 自己看著發。"
                  : " 清單是空的就只上架 Marketplace 本身。"}
              </div>
            </span>
          </label>

          <div style={{ marginTop: 14, fontSize: 12.5, color: CIS.textMute, lineHeight: 1.7 }}>
            兩顆都是叫桌機 runner 去發（不是這個網站發）。「立即發佈」＝runner 下次輪詢就發（約 5
            分內）；「排定時間發佈」＝到上面那個時間才發。<strong style={{ color: CIS.textSub }}>桌機要開著、runner 要在跑。</strong>
            發佈前貼文庫的「狀況」沒選會被擋。
          </div>
        </>
      )}

      {marketplaceOnly ? (
        <div className={styles.btnRow} style={{ marginTop: 18 }}>
          <button
            type="button"
            className={styles.btn}
            style={{ background: CIS.blue, color: "#fff" }}
            disabled={pending}
            onClick={() => submit(false)}
          >
            <Icon name={pending ? "loading" : "calendar"} size={15} />
            排定時間發佈
          </button>
          <button
            type="button"
            className={styles.btn}
            style={{ background: "rgba(15,23,42,0.06)", color: CIS.text, borderColor: CIS.cardBorder }}
            disabled={pending}
            onClick={() => submit(true)}
          >
            <Icon name={pending ? "loading" : "zap"} size={15} />
            立即發佈
          </button>
        </div>
      ) : (
        <>
          <div className={styles.btnRow} style={{ marginTop: 18 }}>
            <button
              type="button"
              className={styles.btn}
              style={{ background: CIS.blue, color: "#fff" }}
              disabled={pending || (!timeline && picked.size === 0)}
              onClick={() => submit(false)}
            >
              <Icon name={pending ? "loading" : "calendar"} size={15} />
              {pending ? "排程中…" : "排進排程"}
            </button>
            <button
              type="button"
              className={styles.btn}
              style={{ background: "rgba(15,23,42,0.06)", color: CIS.text, borderColor: CIS.cardBorder }}
              disabled={pending || (!timeline && picked.size === 0)}
              onClick={() => submit(true)}
            >
              <Icon name={pending ? "loading" : "zap"} size={15} />
              立即發佈
            </button>
            <span style={{ fontSize: 13, color: CIS.textMute }}>
              共 {(timeline ? 1 : 0) + picked.size} 個地方
            </span>
          </div>
          <div style={{ marginTop: 8, fontSize: 12.5, color: CIS.textMute, lineHeight: 1.7 }}>
            「立即發佈」＝runner 下次輪詢就處理（約 5 分內，不抖動）；「排進排程」＝到上面選的時間才發。桌機要開著、runner 要在跑。
          </div>
        </>
      )}
    </section>
  );
}
