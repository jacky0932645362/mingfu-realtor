import Link from "next/link";
import { propertyStats } from "@/lib/property";
import {
  fbDashboardStats,
  listFbDrafts,
  dueFbTasks,
  listFbTasks,
  getFbDraft,
  getTaskItems,
  getTaskRun,
  fmtDateTime,
  channelLabel,
} from "@/lib/fb-factory";
import { CIS, CHIP } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import styles from "./fb.module.css";

export const dynamic = "force-dynamic";

export default async function FbDashboard() {
  const [props, stats, drafts, due, pending] = await Promise.all([
    propertyStats(),
    fbDashboardStats(),
    listFbDrafts({ channel: "post", limit: 5 }),
    dueFbTasks(),
    listFbTasks({ status: "pending", limit: 5 }),
  ]);

  const dueDetail = await Promise.all(
    due.slice(0, 3).map(async (t) => ({
      task: t,
      draft: await getFbDraft(t.draft_id),
      items: await getTaskItems(t.id),
      run: await getTaskRun(t.id),
    })),
  );

  const runnerReady = Boolean(process.env.FB_RUNNER_TOKEN && process.env.FB_RUNNER_TOKEN.length >= 16);
  const nextTask = pending[0];

  return (
    <>
      <div className={styles.eyebrow} style={{ color: CIS.textMute }}>
        Dashboard
      </div>
      <h1 className={styles.pageTitle}>總覽</h1>

      <section
        className={styles.card}
        style={{
          background: "linear-gradient(135deg, rgba(90,145,225,0.12), rgba(90,145,225,0.04))",
          border: "1px solid rgba(90,145,225,0.3)",
        }}
      >
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: CIS.blueSoft, letterSpacing: "0.06em" }}>
              第一原則
            </div>
            <h2 style={{ fontSize: 21, fontWeight: 900, margin: "6px 0 10px" }}>
              排程在網站上排，發文在桌機上跑
            </h2>
            <p style={{ fontSize: 14, lineHeight: 1.85, color: CIS.textSub, margin: 0, maxWidth: "72ch" }}>
              你在這裡挑物件、產文案、排時間。到點的時候，是桌機上的 runner 開瀏覽器、
              打字、上傳照片、按發布 —— 全程不用你在。
              <br />
              網站本身發不了文（Vercel 上跑不了瀏覽器，也沒有你的 FB 登入），
              所以<strong style={{ color: CIS.text }}>那台桌機要開著</strong>，這是整套唯一的前提。
            </p>
          </div>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 999,
              background: runnerReady ? "rgba(34,197,94,0.16)" : "rgba(245,158,11,0.16)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name={runnerReady ? "success" : "warning"} size={22} color={runnerReady ? "#16a34a" : "#b45309"} />
          </div>
        </div>
      </section>

      {/* 四步流程。第 ① 步的「新增物件」在物件庫（/admin/properties），不在工廠裡 ——
          本人 2026-09-22 在這裡翻不到，所以直接把入口擺在總覽最上面。 */}
      <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
        <h3 className={styles.cardTitle}>
          <Icon name="building" size={16} color={CIS.blueSoft} />
          從零到發出去，順序固定四步
        </h3>
        <div className={styles.entryGrid} style={{ marginBottom: 0 }}>
          <div
            className={styles.entryCard}
            style={{ background: "rgba(90,145,225,0.08)", border: "1px solid rgba(90,145,225,0.3)" }}
          >
            <div className={styles.entryCardTitle} style={{ color: CIS.text }}>
              ① 物件庫建物件
            </div>
            <div className={styles.entryCardDesc} style={{ color: CIS.textMute }}>
              在「物件庫」、不在工廠裡。總價、格局、坪數、行政區、社區、照片都填在那邊。
              沒有物件就沒有 Marketplace 版本。
            </div>
            <div className={styles.btnRow} style={{ marginTop: 4 }}>
              <Link href="/admin/properties/new" className={styles.btn} style={{ background: CIS.blue, color: "#fff" }}>
                <Icon name="add" size={15} />
                新增物件
              </Link>
              <Link href="/admin/properties" style={{ fontSize: 13, fontWeight: 700, color: CIS.blueSoft }}>
                看物件庫（{props.total} 件）→
              </Link>
            </div>
          </div>

          <Link
            href="/admin/fb/compose"
            className={styles.entryCard}
            style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}
          >
            <div className={styles.entryCardTitle} style={{ color: CIS.text }}>
              ② 產生文案
            </div>
            <div className={styles.entryCardDesc} style={{ color: CIS.textMute }}>
              用「從物件庫挑一筆」。「手動填一筆」只有一般貼文，永遠不會出現在 Marketplace。
            </div>
            <span className={styles.entryCardLink} style={{ color: CIS.blueSoft }}>
              去產文案 →
            </span>
          </Link>

          <Link
            href="/admin/fb/library"
            className={styles.entryCard}
            style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}
          >
            <div className={styles.entryCardTitle} style={{ color: CIS.text }}>
              ③ 貼文庫補 Marketplace 欄位
            </div>
            <div className={styles.entryCardDesc} style={{ color: CIS.textMute }}>
              那則的 Marketplace 分頁：選「狀況」（沒選桌機會擋）、看價格地點、勾打算上架的社團。
            </div>
            <span className={styles.entryCardLink} style={{ color: CIS.blueSoft }}>
              去貼文庫 →
            </span>
          </Link>

          <Link
            href="/admin/fb/schedule"
            className={styles.entryCard}
            style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}
          >
            <div className={styles.entryCardTitle} style={{ color: CIS.text }}>
              ④ 排程
            </div>
            <div className={styles.entryCardDesc} style={{ color: CIS.textMute }}>
              Marketplace 分頁「立即發佈」或排定時間，桌機 runner 到點自己發。
            </div>
            <span className={styles.entryCardLink} style={{ color: CIS.blueSoft }}>
              去排程 →
            </span>
          </Link>
        </div>
      </section>

      {!runnerReady ? (
        <div
          className={styles.notice}
          style={{ background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.3)", color: CIS.textSub }}
        >
          <Icon name="warning" size={16} color="#e11d48" className={styles.noticeIcon} />
          <div>
            <strong style={{ color: "#e11d48" }}>自動發文還沒接通。</strong> <code>.env.local</code> 裡還沒有{" "}
            <code>FB_RUNNER_TOKEN</code>，桌機的 runner 拿不到工作。設定方法看{" "}
            <code>tools/fb-autopost/README.md</code>。
          </div>
        </div>
      ) : null}

      {dueDetail.length > 0 ? (
        <div
          className={styles.notice}
          style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", color: CIS.textSub }}
        >
          <Icon name="clock" size={16} color="#b45309" className={styles.noticeIcon} />
          <div style={{ minWidth: 0 }}>
            <strong style={{ color: "#b45309" }}>有 {due.length} 個排程時間到了。</strong>
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              {dueDetail.map(({ task, draft, items, run }) => {
                const groups = items.filter((i) => i.channel === "group").length;
                const self = items.some((i) => i.channel === "self");
                const where = [
                  self ? "自己的動態" : "",
                  items.some((i) => i.channel === "ig") ? "Instagram" : "",
                  items.some((i) => i.channel === "threads") ? "Threads" : "",
                  groups > 0 ? `${groups} 個社團` : "",
                ]
                  .filter(Boolean)
                  .join(" + ");
                return (
                  <div key={task.id}>
                    <Link href="/admin/fb/schedule" style={{ color: CIS.blueSoft }}>
                      [{channelLabel(task.channel)}] {draft?.title || "（文案已刪）"}
                    </Link>
                    <span style={{ color: CIS.textMute }}>
                      {" "}
                      —— {where}
                      {task.channel === "post"
                        ? run?.auto_publish === 1
                          ? "（桌機會自己發）"
                          : "（桌機備好、你按發布）"
                        : "（桌機 runner 自動發）"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      <div className={styles.statRow}>
        {[
          { value: props.published, label: "上架中物件", tone: CIS.text },
          { value: stats.drafts, label: "文案總數", tone: CIS.text },
          { value: stats.groups, label: "啟用中社團", tone: CIS.text },
          { value: stats.pendingTasks, label: "待辦排程", tone: stats.dueTasks > 0 ? "#b45309" : CIS.text },
        ].map((s) => (
          <div key={s.label} className={styles.stat} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
            <div className={styles.statValue} style={{ color: s.tone }}>
              {s.value}
            </div>
            <div className={styles.statLabel} style={{ color: CIS.textMute }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
          <h3 className={styles.cardTitle}>
            <Icon name="ai" size={16} color={CIS.blueSoft} />
            最近的文案
          </h3>
          {drafts.length === 0 ? (
            <div className={styles.empty} style={{ borderColor: CIS.cardBorder, color: CIS.textMute }}>
              還沒有文案。
              <br />
              <Link href="/admin/fb/compose" style={{ color: CIS.blueSoft }}>
                去挑一個物件產第一篇 →
              </Link>
            </div>
          ) : (
            drafts.map((d) => (
              <div
                key={d.id}
                style={{
                  padding: "10px 0",
                  borderBottom: `1px solid ${CIS.divider}`,
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: 1, minWidth: 180 }}>
                  <Link
                    href={`/admin/fb/library/${d.id}`}
                    style={{ fontSize: 14, fontWeight: 700, color: CIS.text, textDecoration: "none" }}
                  >
                    {d.title}
                  </Link>
                  <div style={{ fontSize: 12, color: CIS.textMute, marginTop: 3 }}>
                    {fmtDateTime(d.created_at)} · {(d.post_text || "").length} 字
                  </div>
                </div>
                <div className={styles.chipRow}>
                  <span
                    className={styles.chip}
                    style={
                      d.post_status === "draft"
                        ? { background: CHIP.neutral.bg, color: CHIP.neutral.color, borderColor: CHIP.neutral.border }
                        : d.post_status === "posted"
                          ? { background: CHIP.success.bg, color: CHIP.success.color, borderColor: CHIP.success.border }
                          : { background: CHIP.info.bg, color: CHIP.info.color, borderColor: CHIP.info.border }
                    }
                  >
                    一般貼文 · {d.post_status === "draft" ? "還沒貼" : d.post_status === "posted" ? "已發" : "排程中"}
                  </span>
                  {d.marketplace_json ? (
                    <span
                      className={styles.chip}
                      style={{ background: CHIP.neutral.bg, color: CHIP.neutral.color, borderColor: CHIP.neutral.border }}
                    >
                      Marketplace · {d.marketplace_status === "draft" ? "還沒貼" : "已處理"}
                    </span>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </section>

        <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
          <h3 className={styles.cardTitle}>
            <Icon name="file" size={16} color={CIS.textMute} />
            合規備忘
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {[
              {
                title: "Marketplace 到點是桌機 runner 在發。",
                body: "排定時間或「立即發佈」，桌機 runner 會開瀏覽器填表單、上傳照片、（選擇性）勾社團、按發佈。前提是那台桌機開著、runner 在跑。手動要發也可以點桌面的 FB-Marketplace.bat。",
              },
              {
                title: "經紀業名稱自動附上。",
                body: "不動產經紀業管理條例 §21 要求廣告要註明經紀業名稱，所以每篇文案結尾一定帶「太平洋房屋 梧棲新市鎮加盟店」。",
              },
              {
                title: "地址只帶「對外地址」。",
                body: "物件庫的完整門牌是內部欄位。產生文案後會回頭掃一次，「四樓之８」這種樓層段真的漏出來會在警告欄用紅字擋你。",
              },
              {
                title: "FB 不吃 Markdown。",
                body: "寫 ** 只會原樣印出星號。產生文案時會擋，桌機那邊也擋一次。",
              },
              {
                title: "節奏（2026-09-19 你拍板的版本）。",
                body: "同一篇發社團每則隔 3～5 分、兩篇不同文案至少隔 90 分、同一個社團有冷卻天數；每日次數不設限、Marketplace 一次上架不受間隔管（本來就能一次勾 20 個社團）。桌機一次只開一個瀏覽器，排到同一時間是排隊不是同時。",
              },
              {
                title: "擬真模式內建、預設開。",
                body: "排定時間就是開跑時間（不會多加抖動，這是你拍板的；runner 每 5 分鐘撈一輪所以最多晚 5 分）、社團之間隨機隔 3～5 分鐘、冷卻天數每輪隨機加碼；桌機發文時游標沿曲線移動、打字分段有停頓、進頁面先看一下再動手。全是節奏層面的擬真（不改瀏覽器指紋、不換 IP），目的是不要一眼看穿是排程器，不是讓你可以灌更多。",
              },
            ].map((n) => (
              <div key={n.title} style={{ display: "flex", gap: 10 }}>
                <Icon name="info" size={14} color={CIS.textMute} style={{ marginTop: 3, flexShrink: 0 }} />
                <div style={{ fontSize: 13, lineHeight: 1.7, color: CIS.textSub }}>
                  <strong style={{ color: CIS.text }}>{n.title}</strong> {n.body}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {nextTask ? (
        <div style={{ marginTop: 6, fontSize: 13, color: CIS.textMute }}>
          下一個排程：{fmtDateTime(nextTask.run_at)}（{channelLabel(nextTask.channel)}）
        </div>
      ) : null}
    </>
  );
}
