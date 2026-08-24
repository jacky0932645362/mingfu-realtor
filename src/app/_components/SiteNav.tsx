"use client";

/**
 * 全站共用導覽列（2026-08-24）。
 *
 * 為什麼要抽出來：原本導覽列寫死在首頁 page.tsx 裡，而且六個項目全是首頁內的錨點
 * （#about、#achievements…）。加了 /property、/sell、/tools 這些**獨立頁面**之後，
 * 每頁各自長一條頂欄的話，客戶在站內移動時會看到不一樣的選單，也回不了其他分頁。
 *
 * 兩種連結混在同一條列上，處理方式不同：
 *   ・頁面連結（/property）→ 直接用 Link
 *   ・首頁錨點（#about）  → 在首頁是純錨點捲動；**不在首頁時要變成 /#about**，
 *                          否則在 /property 按「關於我」會變成找不到的同頁錨點，
 *                          畫面完全沒反應。
 *
 * 手機版另外補了漢堡選單：原本 860px 以下選單直接消失又沒有替代入口。
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { OWNER } from "@/config/owner";
import styles from "./SiteNav.module.css";

const BRAND = OWNER.company || OWNER.name;

type NavItem = {
  label: string;
  /** 頁面路徑（"/property"）或首頁錨點（"#about"） */
  href: string;
};

/**
 * 選單內容。
 *
 * ⚠️ 順序照客戶的動線排：先看物件（我有什麼）→ 再看委託（我能幫你賣）→
 *    工具與文章（我懂什麼）→ 最後關於我。不要照「我們內部覺得重要」的順序排。
 * ⚠️ 每加一項就離「擠爆」更近一步。桌面版 980px 以下就整列收進漢堡，
 *    真的要再加項目請優先考慮做成下拉，不要無限往後接。
 */
const NAV_ITEMS: NavItem[] = [
  { label: "銷售物件", href: "/property" },
  { label: "委託賣房", href: "/sell" },
  { label: "工具網站", href: "/tools" },
  { label: "關於我", href: "#about" },
];

export default function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isHome = pathname === "/";

  /** 錨點在非首頁時要補上 "/"，否則按了完全沒反應。 */
  function resolve(href: string): string {
    if (!href.startsWith("#")) return href;
    return isHome ? href : `/${href}`;
  }

  /** 目前在哪一頁。首頁錨點不算「所在頁」（一頁裡有很多錨點，標哪個都不對）。 */
  function isActive(href: string): boolean {
    if (href.startsWith("#")) return false;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const links = NAV_ITEMS.map((item) => ({
    ...item,
    resolved: resolve(item.href),
    active: isActive(item.href),
  }));

  return (
    <header className={styles.nav}>
      <div className={styles.navInner}>
        <Link href="/" className={styles.navLogo} onClick={() => setOpen(false)}>
          {OWNER.name}
          <span>・{BRAND}</span>
        </Link>

        <nav className={styles.navLinks} aria-label="主選單">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.resolved}
              className={l.active ? styles.navLinkActive : undefined}
              aria-current={l.active ? "page" : undefined}
            >
              {l.label}
            </Link>
          ))}
          <Link href="/card/booking">預約諮詢</Link>
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <a href={`tel:${OWNER.phoneRaw}`} className={styles.navCta}>
            立即致電
          </a>
          <button
            type="button"
            className={styles.burger}
            aria-label={open ? "關閉選單" : "打開選單"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span className={styles.burgerBars}>
              <span />
            </span>
          </button>
        </div>
      </div>

      <div className={`${styles.mobilePanel} ${open ? styles.mobilePanelOpen : ""}`}>
        <nav className={styles.mobileLinks} aria-label="手機選單">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.resolved}
              className={l.active ? styles.navLinkActive : undefined}
              aria-current={l.active ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {l.label}
            </Link>
          ))}
          <Link href="/card/booking" onClick={() => setOpen(false)}>
            預約諮詢
          </Link>
          <Link href="/card" onClick={() => setOpen(false)}>
            數位名片
          </Link>
        </nav>
      </div>
    </header>
  );
}
