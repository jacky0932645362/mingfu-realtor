import Link from "next/link";
import { listDeletableGroups, fmtDateTime } from "@/lib/fb-factory";
import { CIS } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import { GroupDeleteRow } from "./GroupDeleteRow";
import styles from "../../fb.module.css";

export const dynamic = "force-dynamic";

export default async function DeleteByGroupPage() {
  const groups = await listDeletableGroups();

  return (
    <>
      <Link
        href="/admin/fb/delete"
        className={styles.btn}
        style={{ background: "transparent", color: CIS.textSub, borderColor: CIS.cardBorder }}
      >
        <Icon name="chevronLeft" size={14} />
        返回方式選擇
      </Link>

      <div className={styles.eyebrow} style={{ color: CIS.textMute, marginTop: 18 }}>
        Cleanup
      </div>
      <h1 className={styles.pageTitle}>自動刪文．按社團清空</h1>
      <p className={styles.pageLead} style={{ color: CIS.textSub }}>
        這些是曾經自動發過貼文的社團。點任一則的「清空」，桌機 runner（每 5 分鐘撈一輪）會開這個社團的
        「你的內容」頁，找到我們發的那幾則、逐一進貼文按刪除——每篇之間隔 6～8 秒、每 20 篇停 15 秒，跟平常批次刪文同一套節奏。
        還在「處理中」等管理員審核的貼文不在「你的內容 → 已發佈」裡，這條路刪不到，執行結果會註明。
      </p>

      {groups.length === 0 ? (
        <div className={styles.empty} style={{ borderColor: CIS.cardBorder, color: CIS.textMute }}>
          還沒有任何社團被自動發過貼文——先在「排程任務」發一篇出去，這裡才有得清。
        </div>
      ) : (
        groups.map((g) => (
          <GroupDeleteRow
            key={g.groupId}
            group={{
              groupId: g.groupId,
              groupName: g.groupName,
              groupUrl: g.groupUrl,
              postedCount: g.postedCount,
              draftCount: g.drafts.length,
              lastPostedLabel: fmtDateTime(g.lastPostedAt),
              hidden: g.hidden,
              alreadyQueued: g.alreadyQueued,
            }}
          />
        ))
      )}
    </>
  );
}
