import Link from "next/link";
import {
  listActivity,
  activityStats,
  groupScoreboard,
  fmtDateTime,
  channelLabel,
  isChannel,
  FB_CHANNELS,
  type FbChannel,
} from "@/lib/fb-factory";
import { CIS, CHIP } from "@/app/admin/fb/_ui/theme";
import { Icon, type IconName } from "@/app/admin/_ui/icons";
import styles from "../fb.module.css";

export const dynamic = "force-dynamic";

const RESULTS = [
  { key: "all", label: "全部" },
  { key: "posted", label: "成功" },
  { key: "failed", label: "失敗" },
  { key: "skipped", label: "跳過" },
];

const RESULT_STYLE: Record<string, { label: string; tone: keyof typeof CHIP; icon: IconName }> = {
  posted: { label: "成功", tone: "success", icon: "success" },
  failed: { label: "失敗", tone: "danger", icon: "error" },
  skipped: { label: "跳過", tone: "neutral", icon: "pause" },
};

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; result?: string }>;
}) {
  const sp = await searchParams;
  const channel: FbChannel = isChannel(sp.channel) ? sp.channel : "post";
  const result = RESULTS.some((r) => r.key === sp.result) ? sp.result! : "all";

  const [logs, stats, postStats, mpStats, scoreboard] = await Promise.all([
    listActivity({ channel, result }),
    activityStats(channel),
    activityStats("post"),
    activityStats("marketplace"),
    groupScoreboard(),
  ]);

  const counts: Record<FbChannel, number> = { post: postStats.total, marketplace: mpStats.total };
  const badGroups = scoreboard.filter((g) => g.failed > 0).slice(0, 6);

  return (
    <>
      <div className={styles.eyebrow} style={{ color: CIS.textMute }}>
        Activity
      </div>
      <h1 className={styles.pageTitle}>執行紀錄</h1>
      <p className={styles.pageLead} style={{ color: CIS.textSub }}>
        每一次真的貼出去（或跳過、或失敗）都在這裡，兩個通路分開看。
        「失敗」記的是被管理員刪文或被退回 —— 累積三個月，你就知道
        <strong style={{ color: CIS.text }}>哪些社團值得繼續貼、哪些貼了也是白貼</strong>。
      </p>

      <div className={styles.tabs}>
        {FB_CHANNELS.map((c) => {
          const active = c.key === channel;
          return (
            <Link
              key={c.key}
              href={`/admin/fb/activity?channel=${c.key}`}
              className={styles.tab}
              style={{
                background: active ? CIS.blue : "rgba(15,23,42,0.05)",
                color: active ? "#fff" : CIS.textSub,
                border: `1px solid ${active ? CIS.blue : CIS.cardBorder}`,
              }}
            >
              <Icon name={c.icon as IconName} size={14} />
              {c.label}
              <span className={styles.tabCount}>{counts[c.key as FbChannel]}</span>
            </Link>
          );
        })}
      </div>

      <div className={styles.statRow}>
        {[
          { value: String(stats.total), label: "總筆數", color: CIS.text },
          { value: String(stats.posted), label: "成功", color: "#16a34a" },
          { value: String(stats.failed), label: "失敗", color: "#e11d48" },
          {
            value: stats.survival == null ? "—" : `${stats.survival}%`,
            label: "存活率",
            color: stats.survival == null ? CIS.textMute : stats.survival >= 80 ? "#16a34a" : "#b45309",
          },
        ].map((s) => (
          <div key={s.label} className={styles.stat} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
            <div className={styles.statValue} style={{ color: s.color }}>
              {s.value}
            </div>
            <div className={styles.statLabel} style={{ color: CIS.textMute }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.tabs}>
        {RESULTS.map((r) => {
          const active = r.key === result;
          const n =
            r.key === "all" ? stats.total : r.key === "posted" ? stats.posted : r.key === "failed" ? stats.failed : stats.skipped;
          return (
            <Link
              key={r.key}
              href={`/admin/fb/activity?channel=${channel}&result=${r.key}`}
              className={styles.tab}
              style={{
                background: active ? "rgba(90,145,225,0.18)" : "transparent",
                color: active ? CIS.blueSoft : CIS.textMute,
                border: `1px solid ${active ? "rgba(90,145,225,0.42)" : CIS.cardBorder}`,
              }}
            >
              {r.label}（{n}）
            </Link>
          );
        })}
      </div>

      {badGroups.length > 0 ? (
        <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
          <h3 className={styles.cardTitle}>
            <Icon name="radar" size={16} color="#b45309" />
            這幾個社團貼了會被刪
          </h3>
          {badGroups.map((g) => {
            const total = g.posted + g.failed;
            const rate = total > 0 ? Math.round((g.posted / total) * 100) : 0;
            return (
              <div key={g.groupId} className={styles.kv} style={{ borderBottom: `1px solid ${CIS.divider}` }}>
                <div style={{ color: CIS.text, fontWeight: 700, fontSize: 13.5 }}>{g.groupName}</div>
                <div style={{ color: CIS.textMute, fontSize: 13 }}>
                  成功 {g.posted}　失敗 {g.failed}
                </div>
                <span
                  className={styles.chip}
                  style={
                    rate >= 80
                      ? { background: CHIP.success.bg, color: CHIP.success.color, borderColor: CHIP.success.border }
                      : { background: CHIP.danger.bg, color: CHIP.danger.color, borderColor: CHIP.danger.border }
                  }
                >
                  存活 {rate}%
                </span>
              </div>
            );
          })}
        </section>
      ) : null}

      {logs.length === 0 ? (
        <div className={styles.empty} style={{ borderColor: CIS.cardBorder, color: CIS.textMute }}>
          「{channelLabel(channel)}」還沒有任何紀錄。
          <br />
          排一個任務，桌機發完就會出現在這裡。
          <div style={{ marginTop: 14 }}>
            <Link
              href={`/admin/fb/schedule?channel=${channel}`}
              className={styles.btn}
              style={{ background: CIS.blue, color: "#fff" }}
            >
              <Icon name="calendar" size={15} />
              去排程
            </Link>
          </div>
        </div>
      ) : (
        logs.map((l) => {
          const r = RESULT_STYLE[l.status] || RESULT_STYLE.skipped;
          return (
            <div
              key={l.itemId}
              className={styles.listItem}
              style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}`, padding: "12px 15px" }}
            >
              <div style={{ display: "flex", gap: 11, alignItems: "flex-start", flexWrap: "wrap" }}>
                <Icon name={r.icon} size={15} color={CHIP[r.tone].color} style={{ marginTop: 3 }} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{l.targetName}</div>
                  <div className={styles.meta} style={{ color: CIS.textMute }}>
                    {l.postTitle} · {fmtDateTime(l.at)}
                  </div>
                  {l.note ? <div style={{ fontSize: 12.5, color: CIS.textMute, marginTop: 4 }}>{l.note}</div> : null}
                </div>
                <span
                  className={styles.chip}
                  style={{ background: CHIP[r.tone].bg, color: CHIP[r.tone].color, borderColor: CHIP[r.tone].border }}
                >
                  {r.label}
                </span>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
