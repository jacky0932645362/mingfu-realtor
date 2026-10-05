import Link from "next/link";
import {
  listFbDrafts,
  channelLabel,
  fmtDate,
  parseFacts,
  parseMarketplace,
  isChannel,
  FB_CHANNELS,
  type FbChannel,
  type DraftQueue,
} from "@/lib/fb-factory";
import { findMarkdownSyntax } from "@/lib/fb-copy";
import { CIS, CHIP } from "@/app/admin/fb/_ui/theme";
import { Icon, type IconName } from "@/app/admin/_ui/icons";
import { CopyButton } from "../_ui/CopyButton";
import styles from "../fb.module.css";

export const dynamic = "force-dynamic";

const QUEUES: Array<{ key: DraftQueue; label: string }> = [
  { key: "all", label: "全部" },
  { key: "todo", label: "還沒貼" },
  { key: "done", label: "已處理" },
];

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; queue?: string }>;
}) {
  const sp = await searchParams;
  const channel: FbChannel = isChannel(sp.channel) ? sp.channel : "post";
  const queue: DraftQueue = QUEUES.some((q) => q.key === sp.queue) ? (sp.queue as DraftQueue) : "all";

  const [drafts, postTodo, mpTodo, counts] = await Promise.all([
    listFbDrafts({ channel, queue }),
    listFbDrafts({ channel: "post", queue: "todo" }),
    listFbDrafts({ channel: "marketplace", queue: "todo" }),
    Promise.all(QUEUES.map((q) => listFbDrafts({ channel, queue: q.key }))),
  ]);

  const todoCount: Record<FbChannel, number> = { post: postTodo.length, marketplace: mpTodo.length };

  return (
    <>
      <div className={styles.eyebrow} style={{ color: CIS.textMute }}>
        Library
      </div>
      <h1 className={styles.pageTitle}>貼文庫</h1>
      <p className={styles.pageLead} style={{ color: CIS.textSub }}>
        兩個通路分開看、分開記進度。分頁籤上的數字是「這個通路還沒貼的筆數」。
      </p>

      <div className={styles.tabs}>
        {FB_CHANNELS.map((c) => {
          const active = c.key === channel;
          return (
            <Link
              key={c.key}
              href={`/admin/fb/library?channel=${c.key}`}
              className={styles.tab}
              style={{
                background: active ? CIS.blue : "rgba(15,23,42,0.05)",
                color: active ? "#fff" : CIS.textSub,
                border: `1px solid ${active ? CIS.blue : CIS.cardBorder}`,
              }}
            >
              <Icon name={c.icon as IconName} size={14} />
              {c.label}
              <span className={styles.tabCount}>{todoCount[c.key as FbChannel]}</span>
            </Link>
          );
        })}
      </div>

      <div className={styles.tabs}>
        {QUEUES.map((q, i) => {
          const active = q.key === queue;
          return (
            <Link
              key={q.key}
              href={`/admin/fb/library?channel=${channel}&queue=${q.key}`}
              className={styles.tab}
              style={{
                background: active ? "rgba(90,145,225,0.18)" : "transparent",
                color: active ? CIS.blueSoft : CIS.textMute,
                border: `1px solid ${active ? "rgba(90,145,225,0.42)" : CIS.cardBorder}`,
              }}
            >
              {q.label}（{counts[i].length}）
            </Link>
          );
        })}
      </div>

      {drafts.length === 0 ? (
        <div className={styles.empty} style={{ borderColor: CIS.cardBorder, color: CIS.textMute }}>
          「{channelLabel(channel)}」這裡還沒有東西。
          <br />
          <Link href="/admin/fb/compose" style={{ color: CIS.blueSoft }}>
            去產生文案 →
          </Link>
        </div>
      ) : (
        drafts.map((d) => {
          const mp = parseMarketplace(d.marketplace_json);
          const body = channel === "post" ? d.post_text || "" : mp?.description || "";
          const status = channel === "post" ? d.post_status : d.marketplace_status;
          const done = status === "posted";
          const facts = parseFacts(d.facts_json);
          const mdIssues = findMarkdownSyntax(body).length;

          return (
            <div
              key={d.id}
              className={styles.listItem}
              style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <Link
                    href={`/admin/fb/library/${d.id}?channel=${channel}`}
                    className={styles.itemTitle}
                    style={{ color: CIS.text, textDecoration: "none" }}
                  >
                    {d.title}
                  </Link>
                  <div className={styles.meta} style={{ color: CIS.textMute }}>
                    {fmtDate(d.created_at)} · {body.length} 字 ·{" "}
                    {d.source_property_id ? "來自物件庫" : "手動填的"}
                    {facts.address ? ` · ${facts.address}` : ""}
                  </div>
                </div>

                <div className={styles.chipRow}>
                  {mdIssues > 0 ? (
                    <span
                      className={styles.chip}
                      style={{ background: CHIP.danger.bg, color: CHIP.danger.color, borderColor: CHIP.danger.border }}
                    >
                      <Icon name="warning" size={11} />
                      {mdIssues} 處 Markdown
                    </span>
                  ) : null}
                  <span
                    className={styles.chip}
                    style={
                      done
                        ? { background: CHIP.success.bg, color: CHIP.success.color, borderColor: CHIP.success.border }
                        : status === "scheduled"
                          ? { background: CHIP.info.bg, color: CHIP.info.color, borderColor: CHIP.info.border }
                          : { background: CHIP.neutral.bg, color: CHIP.neutral.color, borderColor: CHIP.neutral.border }
                    }
                  >
                    {done ? "已發" : status === "scheduled" ? "排程中" : "還沒貼"}
                  </span>
                </div>
              </div>

              <div className={styles.btnRow} style={{ marginTop: 12 }}>
                <CopyButton text={body} label="複製整篇" />
                <Link
                  href={`/admin/fb/library/${d.id}?channel=${channel}`}
                  className={styles.btn}
                  style={{ background: "rgba(15,23,42,0.05)", color: CIS.textSub, borderColor: CIS.cardBorder }}
                >
                  <Icon name="eye" size={14} />
                  看完整內容
                </Link>
                <Link
                  href={`/admin/fb/schedule?draft=${d.id}&channel=${channel}`}
                  className={styles.btn}
                  style={{ background: "rgba(15,23,42,0.05)", color: CIS.textSub, borderColor: CIS.cardBorder }}
                >
                  <Icon name="calendar" size={14} />
                  排程發文
                </Link>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
