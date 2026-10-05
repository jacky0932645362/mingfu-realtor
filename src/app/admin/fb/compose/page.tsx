import Link from "next/link";
import { listProperties, statusLabel, propertyTypeLabel } from "@/lib/property";
import { SCENARIOS } from "@/lib/fb-copy";
import { ensureFbCoreTables } from "@/lib/fb-factory";
import { cloudinaryEnabled } from "@/lib/cloudinary";
import { CIS } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import { ComposeForm } from "./ComposeForm";
import styles from "../fb.module.css";

export const dynamic = "force-dynamic";

export default async function ComposePage() {
  await ensureFbCoreTables();
  const properties = await listProperties({ limit: 300 });

  const options = properties.map((p) => ({
    id: p.id,
    label:
      `${p.district || "未填區域"}・${p.community || p.title}・` +
      `${[p.layout, propertyTypeLabel(p)].filter(Boolean).join(" ")}` +
      `${p.price != null ? `（${p.price} 萬）` : ""}` +
      `${p.status !== "published" ? ` — ${statusLabel(p.status)}` : ""}`,
    published: p.status === "published",
  }));

  return (
    <>
      <div className={styles.eyebrow} style={{ color: CIS.textMute }}>
        Compose
      </div>
      <h1 className={styles.pageTitle}>產生文案</h1>
      <p className={styles.pageLead} style={{ color: CIS.textSub }}>
        挑一個物件、挑一個情境，一次產出「一般貼文」與「Marketplace 欄位」兩種版本。
        產完進貼文庫，排程的時候從那裡挑。
        <br />
        物件不在下拉裡？先去{" "}
        <Link href="/admin/properties/new" style={{ color: CIS.blueSoft, fontWeight: 700 }}>
          物件庫新增物件 →
        </Link>
        （物件庫在後台另一頁，不在工廠裡）
      </p>

      <ComposeForm properties={options} scenarios={[...SCENARIOS]} uploadEnabled={cloudinaryEnabled()} />

      <div
        className={styles.notice}
        style={{ background: "rgba(245,158,11,0.09)", border: "1px solid rgba(245,158,11,0.26)", color: CIS.textSub }}
      >
        <Icon name="camera" size={16} color="#b45309" className={styles.noticeIcon} />
        <div>
          <strong style={{ color: "#b45309" }}>桌機發文前會自己把照片抓成本機檔再傳（上限 10 張）。</strong>{" "}
          「從物件庫挑一筆」的照片跟著那筆物件；「手動填一筆」的照片就在下面那格編排，不用跑去物件庫。
          兩種都是純文字貼文的話觸及差很多，能放圖就放。
        </div>
      </div>
    </>
  );
}
