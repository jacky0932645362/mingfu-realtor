import Link from "next/link";
import { listDeletableDrafts, fmtDateTime } from "@/lib/fb-factory";
import { CIS } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import { DraftDeleteRow } from "./DraftDeleteRow";
import styles from "../../fb.module.css";

export const dynamic = "force-dynamic";

export default async function DeleteByDraftPage() {
  const drafts = await listDeletableDrafts();

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
      <h1 className={styles.pageTitle}>自動刪文．按工作流清空</h1>
      <p className={styles.pageLead} style={{ color: CIS.textSub }}>
        這些是曾經自動發過的文案（一則文案＝一個工作流）。點任一則的「清空」，桌機會把它發到的每一個社團
        各開一次「你的內容」，找到這篇、逐一進貼文按刪除；比對字是系統從內文反推的，不用手打。
        發在自己動態上的那篇不在這條路裡（會標出來），要自己手動刪。
      </p>

      {drafts.length === 0 ? (
        <div className={styles.empty} style={{ borderColor: CIS.cardBorder, color: CIS.textMute }}>
          還沒有任何文案發出去過——先在「排程任務」發一篇，這裡才有得清。
        </div>
      ) : (
        drafts.map((d) => (
          <DraftDeleteRow
            key={d.draftId}
            draft={{
              draftId: d.draftId,
              title: d.title,
              matchPreview: d.matchPreview,
              groupPostedCount: d.groupPostedCount,
              selfCount: d.selfCount,
              groupCount: d.groupCount,
              lastPostedLabel: fmtDateTime(d.lastPostedAt),
              alreadyQueued: d.alreadyQueued,
            }}
          />
        ))
      )}
    </>
  );
}
