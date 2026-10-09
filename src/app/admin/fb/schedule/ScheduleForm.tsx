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

/** identityId：這個社團屬於哪個發文身分（主帳號＝"main"）。各身分的社團清單是分開的。 */
type GroupOption = { id: string; name: string; identityId: string; cooling: boolean; note: string };
/** 發文身分（2026-10-07）：排程時「用哪個身分發」。loginState 是桌機 runner 回報的。 */
export type IdentityOption = {
  id: string;
  name: string;
  /** personal＝個人帳號；page＝以粉專身分發社團（借 viaName 那個個人帳號的登入切換，2026-10-09） */
  kind: "personal" | "page";
  isDefault: boolean;
  loginState: "ok" | "missing" | "stale" | "unknown";
  loginLabel: string;
  /** 社團清單用誰的（粉專＝它借的個人帳號那份） */
  groupOwnerId: string;
  viaName: string | null;
};
/** 「同時發到」的官方 API 帳號（2026-10-09）：每一組粉專／IG／Threads 一個勾選框，自由勾。ready＝有授權鑰匙。 */
export type ApiAccountOption = { id: string; kind: "page" | "ig" | "threads"; name: string; sub: string | null; ready: boolean };

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
  identities,
  channel,
  preselectDraft,
  marketplaceOnly,
  apiAccounts = [],
}: {
  drafts: Array<{ id: string; title: string }>;
  groups: GroupOption[];
  identities: IdentityOption[];
  channel: string;
  preselectDraft: string;
  marketplaceOnly: boolean;
  apiAccounts?: ApiAccountOption[];
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
  // 同時發到粉專動態／IG／Threads（官方 API，每一組帳號各自勾）。預設都不勾：那是公開發到別的地方，要本人明確打開。
  const [apiPicked, setApiPicked] = useState<Set<string>>(() => new Set());
  const toggleApi = (id: string) =>
    setApiPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Marketplace 專用：到點也照貼文庫那則存的社團清單一起勾社團上架。預設不勾 ——
  // 沒人看著的排程勾錯社團＝直接公開發到錯地方，要本人明確打開。
  const [mpCrosspost, setMpCrosspost] = useState(false);

  // 發文身分（2026-10-07）：預設主帳號。state 裡的 id 可能不在選單裡（身分被停用／刪掉），
  // 所以送出跟顯示都用校正過的值（同 safeDraftId 的道理）。
  // Marketplace 只能用個人帳號（粉專身分只發一般貼文的社團）
  const idChoices = marketplaceOnly ? identities.filter((i) => i.kind === "personal") : identities;
  const defaultIdentityId = idChoices.find((i) => i.isDefault)?.id ?? idChoices[0]?.id ?? "main";
  const [identityId, setIdentityId] = useState(defaultIdentityId);
  const safeIdentityId = idChoices.some((i) => i.id === identityId) ? identityId : defaultIdentityId;
  const currentIdentity = idChoices.find((i) => i.id === safeIdentityId);
  const isMainIdentity = currentIdentity ? currentIdentity.isDefault : true;
  const isPageIdentity = currentIdentity?.kind === "page";
  const ownerOf = (id: string) => idChoices.find((i) => i.id === id)?.groupOwnerId ?? id;
  const groupOwner = ownerOf(safeIdentityId);

  // 各身分的社團清單是分開的（各帳號加入的社團不一樣）：只顯示、只送出「這個身分（粉專＝它借的個人帳號）」的社團
  const visibleGroups = useMemo(() => groups.filter((g) => g.identityId === groupOwner), [groups, groupOwner]);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(groups.filter((g) => g.identityId === ownerOf(defaultIdentityId) && !g.cooling).map((g) => g.id)),
  );

  const chosen = useMemo(() => visibleGroups.filter((g) => picked.has(g.id)), [visibleGroups, picked]);
  const coolingChosen = chosen.filter((g) => g.cooling).length;

  const pickIdentity = (id: string) => {
    setIdentityId(id);
    // 換身分＝換一份社團清單，預設值重算（冷卻中的不勾）；上一個身分勾的不會帶過來
    setPicked(new Set(groups.filter((g) => g.identityId === ownerOf(id) && !g.cooling).map((g) => g.id)));
    // 以粉專身分只發社團，粉專自己的動態走下面的官方 API
    if (idChoices.find((i) => i.id === id)?.kind === "page") setTimeline(false);
  };

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
      const visibleIds = new Set(visibleGroups.map((g) => g.id));
      const res = await scheduleTaskAction({
        draftId: safeDraftId,
        channel,
        runAt,
        postToTimeline: timeline && !isPageIdentity,
        groupIds: [...picked].filter((id) => visibleIds.has(id)),
        autoPublish,
        runNow,
        crosspost: mpCrosspost,
        apiIdentityIds: marketplaceOnly ? [] : apiAccounts.filter((a) => a.ready && apiPicked.has(a.id)).map((a) => a.id),
        identityId: safeIdentityId,
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

      {/* 發文身分（2026-10-07）：對應同業「用哪個身分發」。換身分＝換登入帳號＋換一份社團清單。 */}
      <div className={styles.field} style={{ marginTop: 18 }}>
        <label className={styles.label} style={{ color: CIS.textSub }}>
          用哪個身分發
        </label>
        {idChoices.length === 0 ? (
          <div style={{ fontSize: 13, color: CIS.textMute }}>
            還沒有發文身分，請到{" "}
            <Link href="/admin/fb/identities" style={{ color: CIS.blueSoft }}>
              發文身分
            </Link>{" "}
            新增。
          </div>
        ) : (
          <div className={styles.checkGrid}>
            {idChoices.map((i) => {
              const on = i.id === safeIdentityId;
              const loginOk = i.loginState === "ok";
              return (
                <label
                  key={i.id}
                  className={styles.checkBox}
                  style={{ background: CIS.bgSoft, border: `1px solid ${on ? "rgba(90,145,225,0.5)" : CIS.cardBorder}` }}
                >
                  <input type="radio" name="fb-identity" checked={on} onChange={() => pickIdentity(i.id)} />
                  <span style={{ minWidth: 0 }}>
                    <strong>{i.name}</strong>
                    <span style={{ color: CIS.textMute, fontSize: 12 }}>
                      {i.isDefault ? "　主帳號" : i.kind === "page" ? `　粉專（用「${i.viaName}」切換）` : "　個人帳號"}
                    </span>
                    <div style={{ fontSize: 12, color: loginOk || i.isDefault ? CIS.textMute : "#b45309", marginTop: 2 }}>
                      {i.isDefault && i.loginState === "unknown" ? "原本的帳號" : i.loginLabel}
                    </div>
                  </span>
                </label>
              );
            })}
          </div>
        )}
        <div style={{ fontSize: 12, color: CIS.textMute, lineHeight: 1.7 }}>
          要加其他帳號（或看登入狀態）→{" "}
          <Link href="/admin/fb/identities" style={{ color: CIS.blueSoft }}>
            發文身分
          </Link>
          。換身分時下面的社團清單會跟著換成那個帳號的社團；粉專身分用的是它借的那個個人帳號的社團清單（粉專自己也要加入那些社團才發得出去）。
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
              <input type="checkbox" checked={timeline && !isPageIdentity} disabled={isPageIdentity} onChange={(e) => setTimeline(e.target.checked)} />
              <span>
                <strong>{isMainIdentity ? "貼在自己的 FB 動態" : `貼在「${currentIdentity?.name}」的 FB 動態`}</strong>
                <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 2 }}>
                  {isPageIdentity
                    ? "以粉專身分只發社團；粉專自己的動態請勾下面「同時發到」的粉專（官方 API，比開瀏覽器安全）"
                    : "先貼自己的牆，社團的人點進來才看得到"}
                </div>
              </span>
            </label>
          </div>

          {/* 同時發到（2026-10-09）：每一組粉專動態／IG／Threads 帳號一個勾選框，自由勾。到點 runner 先用官方 API 發、再開瀏覽器跑 FB */}
          <div className={styles.field} style={{ marginTop: 14 }}>
            <label className={styles.label} style={{ color: CIS.textSub }}>
              同時發到（官方 API，不開瀏覽器，可以勾好幾個）
            </label>
            {apiAccounts.length === 0 ? (
              <div style={{ fontSize: 13, color: CIS.textMute }}>
                還沒連結任何粉專／IG／Threads 帳號 →{" "}
                <Link href="/admin/fb/identities" style={{ color: CIS.blueSoft }}>
                  發文身分
                </Link>
              </div>
            ) : (
              <div className={styles.checkGrid}>
                {apiAccounts.map((p) => {
                  const on = apiPicked.has(p.id);
                  const label = p.kind === "page" ? "粉專動態" : p.kind === "ig" ? "Instagram" : "Threads";
                  const hint =
                    p.kind === "page"
                      ? "內文＝一般貼文；照片最多 10 張"
                      : p.kind === "ig"
                        ? "內文＝貼文庫那則的 Instagram 分頁；一定要有照片、最多 10 張"
                        : "內文＝貼文庫那則的 Threads 分頁（500 字內）；可以純文字";
                  return (
                    <label
                      key={p.id}
                      className={styles.checkBox}
                      style={{
                        background: CIS.bgSoft,
                        border: `1px solid ${on ? "rgba(90,145,225,0.4)" : CIS.cardBorder}`,
                        opacity: p.ready ? 1 : 0.6,
                        cursor: p.ready ? "pointer" : "not-allowed",
                      }}
                    >
                      <input type="checkbox" checked={on && p.ready} disabled={!p.ready} onChange={() => toggleApi(p.id)} />
                      <span style={{ minWidth: 0 }}>
                        <strong>{p.name}</strong>
                        <span style={{ color: CIS.textMute, fontSize: 12 }}>
                          　{label}
                          {p.sub ? ` ${p.sub}` : ""}
                        </span>
                        <div style={{ fontSize: 12, color: p.ready ? CIS.textMute : "#b45309", marginTop: 2 }}>
                          {p.ready ? hint : "授權鑰匙不見了，到「發文身分」頁重新連結"}
                        </div>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className={styles.field} style={{ marginTop: 14 }}>
            <label className={styles.label} style={{ color: CIS.textSub }}>
              {isMainIdentity ? "" : isPageIdentity ? `以粉專「${currentIdentity?.name}」發到「${currentIdentity?.viaName}」的` : `「${currentIdentity?.name}」的`}社團（{visibleGroups.length} 個收這種文）—— 橘色的是距離上次貼太近，預設不勾
            </label>
            {visibleGroups.length === 0 ? (
              <div style={{ fontSize: 13, color: CIS.textMute }}>
                {isMainIdentity ? (
                  "這個通路還沒有啟用的社團。去「社團清單」加幾個。"
                ) : (
                  <>
                    「{currentIdentity?.name}」還沒有啟用的社團。先到{" "}
                    <Link href={`/admin/fb/groups?identity=${encodeURIComponent(groupOwner)}`} style={{ color: CIS.blueSoft }}>
                      這個身分的社團清單
                    </Link>{" "}
                    把它加入的社團抓進來、勾起來；只貼在自己動態的話可以不選社團。
                  </>
                )}
              </div>
            ) : (
              <div className={styles.checkGrid}>
                {visibleGroups.map((g) => {
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
              disabled={pending || ((!timeline || isPageIdentity) && chosen.length === 0 && ![...apiPicked].some((id) => apiAccounts.some((a) => a.id === id && a.ready)))}
              onClick={() => submit(false)}
            >
              <Icon name={pending ? "loading" : "calendar"} size={15} />
              {pending ? "排程中…" : "排進排程"}
            </button>
            <button
              type="button"
              className={styles.btn}
              style={{ background: "rgba(15,23,42,0.06)", color: CIS.text, borderColor: CIS.cardBorder }}
              disabled={pending || ((!timeline || isPageIdentity) && chosen.length === 0 && ![...apiPicked].some((id) => apiAccounts.some((a) => a.id === id && a.ready)))}
              onClick={() => submit(true)}
            >
              <Icon name={pending ? "loading" : "zap"} size={15} />
              立即發佈
            </button>
            <span style={{ fontSize: 13, color: CIS.textMute }}>
              共 {(timeline && !isPageIdentity ? 1 : 0) + chosen.length + apiAccounts.filter((x) => x.ready && apiPicked.has(x.id)).length} 個地方
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
