"use client";
/**
 * 側邊欄導覽。做成 client component 只是為了 `usePathname` 標出目前在哪一頁 ——
 * 其餘（權限、資料）都留在 layout 的 server component 裡。
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CIS } from "@/app/admin/fb/_ui/theme";
import { Icon, type IconName } from "@/app/admin/_ui/icons";
import styles from "./fb.module.css";

const NAV: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/admin/fb", label: "總覽", icon: "chart" },
  // 2026-10-05：照同業 EZup好上架的四分頁排版，一眼看每戶在哪個階段
  { href: "/admin/fb/board", label: "上架／下架", icon: "list" },
  { href: "/admin/fb/compose", label: "產生文案", icon: "ai" },
  { href: "/admin/fb/library", label: "貼文庫", icon: "megaphone" },
  { href: "/admin/fb/groups", label: "社團清單", icon: "users" },
  { href: "/admin/fb/schedule", label: "排程任務", icon: "calendar" },
  { href: "/admin/fb/activity", label: "執行紀錄", icon: "log" },
  { href: "/admin/fb/delete", label: "自動刪文", icon: "trash" },
  // 2026-10-07：多帳號排程（本人看同業「用哪個身分發」要的）
  // 2026-10-09：粉專／IG／Threads 帳號都併進「發文身分」（舊的 /admin/fb/social 會轉過去）
  { href: "/admin/fb/identities", label: "發文身分（帳號／粉專／IG／Threads）", icon: "user" },
  // 物件庫不在 /admin/fb 底下，但「先建物件才有 Marketplace 版本」是整條流程的第一步。
  // 本人 2026-09-22 在工廠裡翻不到「新增物件」，所以把入口放進這裡。
  { href: "/admin/properties", label: "物件庫（新增物件）", icon: "building" },
];

export function FbNav({ dueCount, dueDeleteCount }: { dueCount: number; dueDeleteCount: number }) {
  const pathname = usePathname();

  return (
    <nav className={styles.nav}>
      {NAV.map((item) => {
        // 「總覽」要精準比對，否則每一頁都會把它一起點亮。
        const active = item.href === "/admin/fb" ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={styles.navItem}
            style={{
              background: active ? "rgba(90,145,225,0.16)" : "transparent",
              borderColor: active ? "rgba(90,145,225,0.4)" : "transparent",
              color: active ? CIS.text : CIS.textSub,
            }}
          >
            <Icon name={item.icon} size={16} color={active ? CIS.blueSoft : CIS.textMute} />
            {item.label}
            {item.href === "/admin/fb/schedule" && dueCount > 0 ? (
              <span
                className={styles.navBadge}
                style={{ background: "rgba(245,158,11,0.2)", color: "#b45309" }}
              >
                {dueCount}
              </span>
            ) : null}
            {item.href === "/admin/fb/delete" && dueDeleteCount > 0 ? (
              <span
                className={styles.navBadge}
                style={{ background: "rgba(244,63,94,0.2)", color: "#e11d48" }}
              >
                {dueDeleteCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
