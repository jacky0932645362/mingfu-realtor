import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminCheckArgs, isCurrentUserAdmin } from "@/lib/admin-check";
import { fbDashboardStats, ensureFbCoreTables } from "@/lib/fb-factory";
import { OWNER } from "@/config/owner";
import { CIS } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import { FbNav } from "./FbNav";
import styles from "./fb.module.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "FB 貼文工廠",
};

export default async function FbLayout({ children }: { children: React.ReactNode }) {
  const { email } = await getAdminCheckArgs();
  if (!email) redirect("/api/auth/signin?callbackUrl=%2Fadmin%2Ffb");
  if (!(await isCurrentUserAdmin())) throw new Error("權限不足");

  await ensureFbCoreTables();
  const stats = await fbDashboardStats();

  return (
    <div
      className={styles.shell}
      style={
        {
          background: CIS.bg,
          color: CIS.text,
          fontFamily: CIS.font,
          colorScheme: "light",
          // 共用小元件（照片／影片／時間選擇器）吃這組變數換成淺色，見 _components/cis.ts 的 CIS_VAR
          "--cis-bg": CIS.bg,
          "--cis-bgSoft": CIS.bgSoft,
          "--cis-card": CIS.card,
          "--cis-cardBorder": CIS.cardBorder,
          "--cis-text": CIS.text,
          "--cis-textSub": CIS.textSub,
          "--cis-textMute": CIS.textMute,
          "--cis-blue": CIS.blue,
          "--cis-warn": "#b45309",
          "--cis-danger": "#e11d48",
        } as React.CSSProperties
      }
    >
      <aside className={styles.sidebar} style={{ background: CIS.bgSoft }}>
        <div className={styles.brand}>
          <div className={styles.brandMark} style={{ background: CIS.blue }}>
            <Icon name="megaphone" size={18} color="#fff" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className={styles.brandName}>FB 貼文工廠</div>
            <div className={styles.brandSub} style={{ color: CIS.textMute }}>
              {OWNER.company}
            </div>
          </div>
        </div>

        <FbNav dueCount={stats.dueTasks} dueDeleteCount={stats.dueDeleteTasks} />

        {/* 這塊字是整套工具最重要的一句話。screenshot 版本寫的是「系統不會自己發文」，
            但本人要的是自動 —— 所以改成講清楚「自動是誰在跑、什麼情況會停」。 */}
        <div
          className={styles.sideNote}
          style={{
            background: "rgba(245,158,11,0.1)",
            border: "1px solid rgba(245,158,11,0.28)",
            color: CIS.textSub,
          }}
        >
          <div className={styles.sideNoteTitle} style={{ color: "#b45309" }}>
            <Icon name="desktop" size={13} />
            發文的是桌機
          </div>
          網站只負責排程。到點是桌機上的 runner 開瀏覽器去發 —— 那台關機就不會發。
        </div>

        <Link href="/admin/appointments" className={styles.backLink} style={{ color: CIS.textMute }}>
          <Icon name="chevronLeft" size={14} />
          回後台
        </Link>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.crumb} style={{ color: CIS.textMute }}>
            後台 <span style={{ opacity: 0.5 }}>/</span>{" "}
            <span style={{ color: CIS.textSub }}>FB 貼文工廠</span>
          </div>
          <div className={styles.who} style={{ color: CIS.textSub }}>
            <span className={styles.avatar} style={{ background: "rgba(90,145,225,0.2)", color: CIS.blueSoft }}>
              {OWNER.name.slice(-2, -1)}
            </span>
            {OWNER.name}
          </div>
        </header>

        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
