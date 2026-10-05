import {
  listFbGroups,
  lastPostedByGroup,
  daysSince,
  effectiveCooldownDays,
  fmtMemberCount,
  isChannel,
  HAILINE_KEYWORDS,
  FB_CHANNELS,
  type FbChannel,
} from "@/lib/fb-factory";
import { CIS } from "@/app/admin/fb/_ui/theme";
import { Icon, type IconName } from "@/app/admin/_ui/icons";
import Link from "next/link";
import { GroupsPanel } from "./GroupsPanel";
import styles from "../fb.module.css";

export const dynamic = "force-dynamic";

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const channel: FbChannel = isChannel(sp.channel) ? sp.channel : "post";
  const viewingArchived = sp.view === "archived";

  const [groups, postGroups, mpGroups, archived, lastPosted] = await Promise.all([
    listFbGroups({ channel, hidden: viewingArchived }),
    listFbGroups({ channel: "post" }),
    listFbGroups({ channel: "marketplace" }),
    listFbGroups({ hidden: true }),
    lastPostedByGroup(),
  ]);

  const counts: Record<FbChannel, number> = { post: postGroups.length, marketplace: mpGroups.length };
  const scanned = groups.filter((g) => g.scanned_at).length;

  const rows = groups.map((g) => {
    const last = lastPosted.get(g.id);
    const gap = daysSince(last);
    const eff = effectiveCooldownDays(g.id, g.cooldown_days, last);
    const canPost = g.has_discussion == null ? g.accepts !== "marketplace" : g.has_discussion === 1;
    const canMarket = g.has_marketplace == null ? g.accepts !== "post" : g.has_marketplace === 1;
    return {
      id: g.id,
      name: g.name,
      url: g.url,
      accepts: g.accepts,
      cooldownDays: g.cooldown_days,
      active: g.is_active === 1,
      memberCount: g.member_count,
      memberLabel: fmtMemberCount(g.member_count),
      privacy: g.privacy,
      needsApproval: g.needs_approval === 1,
      canPost,
      canMarket,
      capability: (canPost && canMarket
        ? "both"
        : canPost
          ? "post"
          : canMarket
            ? "marketplace"
            : "none") as "both" | "post" | "marketplace" | "none",
      scanned: Boolean(g.scanned_at),
      hailine: HAILINE_KEYWORDS.some((k) => g.name.includes(k)),
      lastPostedDays: gap,
      // 擬真：冷卻天數＝設定值＋這一輪的隨機加碼（見 effectiveCooldownDays）
      effectiveCooldown: eff,
      cooling: gap != null && eff > 0 && gap < eff,
    };
  });

  const activeCount = rows.filter((r) => r.active).length;

  return (
    <>
      <div className={styles.eyebrow} style={{ color: CIS.textMute }}>
        Groups
      </div>
      <h1 className={styles.pageTitle}>社團清單</h1>
      <p className={styles.pageLead} style={{ color: CIS.textSub }}>
        你加入的 FB 社團全都在這。<strong style={{ color: CIS.text }}>勾起來 → 上面工具列選「封存」或「加入發文清單」</strong>，
        可以一次處理一批。用不到的封存起來，重抓社團不會把它叫回來。
      </p>

      {/* 通路 + 檢視 */}
      <div className={styles.tabs}>
        {FB_CHANNELS.map((c) => {
          const active = c.key === channel && !viewingArchived;
          return (
            <Link
              key={c.key}
              href={`/admin/fb/groups?channel=${c.key}`}
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
        <Link
          href={viewingArchived ? `/admin/fb/groups?channel=${channel}` : "/admin/fb/groups?view=archived"}
          className={styles.tab}
          style={{
            background: viewingArchived ? "rgba(146,152,166,0.2)" : "transparent",
            color: viewingArchived ? CIS.text : CIS.textMute,
            border: `1px solid ${viewingArchived ? CIS.textMute : CIS.cardBorder}`,
            marginLeft: "auto",
          }}
        >
          <Icon name="package" size={13} />
          已封存
          <span className={styles.tabCount}>{archived.length}</span>
        </Link>
      </div>

      {!viewingArchived ? (
        <div
          className={styles.notice}
          style={{ background: "rgba(90,145,225,0.09)", border: `1px solid rgba(90,145,225,0.26)`, color: CIS.textSub }}
        >
          <Icon name="refresh" size={16} color={CIS.blueSoft} className={styles.noticeIcon} />
          <div>
            清單裡 <strong style={{ color: CIS.text }}>{groups.length}</strong> 個（
            {scanned > 0 ? `${scanned} 個抓到人數` : "還沒抓過人數"}），發文清單裡{" "}
            <strong style={{ color: CIS.text }}>{activeCount}</strong> 個，已封存 {archived.length} 個。
            <br />
            要重抓（更新人數、加新社團）：桌機 <code>tools/fb-autopost/</code> 跑 <code>npm run groups</code>。
            封存的社團重抓後還是封存的。
          </div>
        </div>
      ) : (
        <div
          className={styles.notice}
          style={{ background: "rgba(146,152,166,0.1)", border: `1px solid ${CIS.cardBorder}`, color: CIS.textSub }}
        >
          <Icon name="package" size={16} color={CIS.textMute} className={styles.noticeIcon} />
          <div>
            這裡是封存起來的 {archived.length} 個社團。要拿回清單就按「取消封存」。
            <br />
            <span style={{ color: CIS.textMute }}>封存 ≠ 退出社團 —— 只是後台清單不顯示、排程選不到。</span>
          </div>
        </div>
      )}

      <GroupsPanel groups={rows} channel={channel} viewingArchived={viewingArchived} />
    </>
  );
}
