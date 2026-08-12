/**
 * / — 蕭茗馥個人官網首頁（太平洋房屋 梧棲市鎮加盟店）
 *
 * 2026-08-12：原本這裡只是 redirect 到 /card。改成把個人官網搬進來，
 *   讓官網、名片、預約系統變成同一個站台、同一個網址：
 *     /              官網（這頁）
 *     /card          數位名片
 *     /card/booking  線上預約
 *   官網的「預約」區塊直接連到 /card/booking（相對路徑，換網域也不用改）。
 *   原本的假表單（送出只是複製文字 + 跳 LINE）已移除，改成導向真正的預約系統。
 */
import type { Metadata } from "next";
import Link from "next/link";
import { OWNER, SOCIAL, SITE_URL } from "@/config/owner";
import styles from "./home.module.css";

const BRAND = OWNER.company || OWNER.name;
const AREAS = ["沙鹿", "龍井", "清水", "梧棲"] as const;
const YEARS = ["111年", "112年", "113年"] as const;

const SERVICES = [
  {
    title: "資產配置",
    desc: "依您的財務狀況與人生階段，規劃最適合的不動產資產配置方案，兼顧保值與獲利。",
    icon: (
      <svg viewBox="0 0 48 48" fill="none">
        <path d="M6 26 L24 10 L42 26" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 22 V40 H36 V22" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20 40 V28 H28 V40" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "稅務諮詢",
    desc: "不動產買賣、繼承、贈與相關稅務問題，提供清楚易懂的專業諮詢，避免多繳冤枉稅。",
    icon: (
      <svg viewBox="0 0 48 48" fill="none">
        <rect x="9" y="6" width="30" height="36" rx="2" stroke="currentColor" strokeWidth="3" />
        <path d="M16 16 H32 M16 24 H32 M16 32 H26" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "簡易裝潢",
    desc: "新成屋、中古屋簡易裝修規劃建議，用合理預算打造舒適理想的居住空間。",
    icon: (
      <svg viewBox="0 0 48 48" fill="none">
        <path d="M8 40 L40 40" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M12 40 V20 L24 8 L36 20 V40" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="20" y="28" width="8" height="12" stroke="currentColor" strokeWidth="3" />
      </svg>
    ),
  },
] as const;

const DESCRIPTION = `${OWNER.name}｜${BRAND}。專營台中海線（沙鹿、龍井、清水、梧棲）房地產服務，連續三年（111、112、113年）榮獲年度TOP1業績肯定。提供資產配置、稅務諮詢、簡易裝潢等服務，可線上預約或加LINE諮詢。`;

export const metadata: Metadata = {
  title: `${OWNER.name}｜${BRAND}｜台中海線房仲 沙鹿龍井清水梧棲`,
  description: DESCRIPTION,
  keywords: [
    "台中房仲", "沙鹿房仲", "龍井房仲", "清水房仲", "梧棲房仲",
    "太平洋房屋", "太平洋房屋梧棲", "台中海線房屋買賣",
    "資產配置", "不動產稅務諮詢", OWNER.name,
  ],
  authors: [{ name: OWNER.name }],
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: "website",
    title: `${OWNER.name}｜${BRAND}｜台中海線房仲`,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: BRAND,
    locale: "zh_TW",
    images: [{ url: `${SITE_URL}/profile.jpg`, alt: `${OWNER.name} 形象照` }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${OWNER.name}｜${BRAND}｜台中海線房仲`,
    description: DESCRIPTION,
    images: [`${SITE_URL}/profile.jpg`],
  },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "RealEstateAgent",
  name: OWNER.name,
  worksFor: { "@type": "Organization", name: BRAND },
  image: `${SITE_URL}/profile.jpg`,
  telephone: `+886-${OWNER.phoneRaw.slice(1)}`,
  // 沒設定信箱就不寫進 SEO 結構化資料（空字串會被 Google 判成無效欄位）
  ...(OWNER.email ? { email: OWNER.email } : {}),
  url: SITE_URL,
  areaServed: AREAS.map((a) => ({ "@type": "City", name: `台中市${a}區` })),
  address: {
    "@type": "PostalAddress",
    streetAddress: "四維中路338號",
    addressLocality: "梧棲區",
    addressRegion: "台中市",
    addressCountry: "TW",
  },
  makesOffer: SERVICES.map((s) => ({
    "@type": "Offer",
    itemOffered: { "@type": "Service", name: s.title },
  })),
  award: "111、112、113年連續三年榮獲年度TOP1",
};

export default function HomePage() {
  return (
    <main className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      <header className={styles.nav}>
        <div className={styles.navInner}>
          <a href="#top" className={styles.navLogo}>
            {OWNER.name}
            <span>・{BRAND}</span>
          </a>
          <nav className={styles.navLinks}>
            <a href="#service-area">服務區域</a>
            <a href="#achievements">戰績</a>
            <a href="#services">服務項目</a>
            <a href="#booking">預約諮詢</a>
          </nav>
          <a href={`tel:${OWNER.phoneRaw}`} className={styles.navCta}>立即致電</a>
        </div>
      </header>

      {/* 1. 形象照 */}
      <section id="top" className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroPhoto}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/profile.jpg" alt={`${OWNER.name} - 台中海線房仲個人形象照`} width={480} height={600} />
          </div>
          <div>
            <p className={styles.heroEyebrow}>{BRAND}</p>
            <h1 className={styles.heroName}>{OWNER.name}</h1>
            <p className={styles.heroTagline}>專營台中海線・沙鹿・龍井・清水・梧棲</p>
            <p className={styles.heroDesc}>
              連續三年（111、112、113年）榮獲年度TOP1肯定，深耕在地不動產市場，提供資產配置、稅務諮詢、簡易裝潢等一站式服務，用專業陪您做出最安心的決定。
            </p>
            <div className={styles.heroActions}>
              <Link href="/card/booking" className={`${styles.btn} ${styles.btnPrimary}`}>線上預約諮詢</Link>
              <a href={SOCIAL.line} target="_blank" rel="noopener noreferrer" className={`${styles.btn} ${styles.btnLine}`}>加LINE諮詢</a>
            </div>
          </div>
        </div>
      </section>

      {/* 2. 服務區域 */}
      <section id="service-area" className={styles.section}>
        <div className={styles.sectionInner}>
          <p className={styles.eyebrow}>SERVICE AREA</p>
          <h2 className={styles.title}>我服務的區域</h2>
          <p className={styles.sub}>專營台中海線，深耕地方多年，熟悉每一個生活圈的行情與需求</p>
          <div className={styles.areaGrid}>
            {AREAS.map((area) => (
              <div key={area} className={styles.areaCard}>
                <span className={styles.areaName}>{area}</span>
              </div>
            ))}
          </div>
          <p className={styles.areaNote}>台中市沙鹿・龍井・清水・梧棲｜專營台中海線</p>
        </div>
      </section>

      {/* 3. 戰績 */}
      <section id="achievements" className={`${styles.section} ${styles.achvSection}`}>
        <div className={styles.sectionInner}>
          <p className={`${styles.eyebrow} ${styles.eyebrowLight}`}>ACHIEVEMENTS</p>
          <h2 className={`${styles.title} ${styles.titleLight}`}>我的戰績</h2>
          <p className={`${styles.sub} ${styles.subLight}`}>用實績說話，感謝每一位客戶的信任</p>
          <div className={styles.achvGrid}>
            {YEARS.map((year) => (
              <div key={year} className={styles.achvCard}>
                <div className={styles.achvYear}>{year}</div>
                <div className={styles.achvRank}>年度 TOP 1</div>
              </div>
            ))}
          </div>
          <p className={styles.achvHighlight}>連續三年榮獲年度TOP1</p>
        </div>
      </section>

      {/* 4. 服務項目 */}
      <section id="services" className={styles.section}>
        <div className={styles.sectionInner}>
          <p className={styles.eyebrow}>SERVICES</p>
          <h2 className={styles.title}>我提供的服務項目</h2>
          <p className={styles.sub}>不只是買賣房子，更是您資產規劃的長期夥伴</p>
          <div className={styles.servicesGrid}>
            {SERVICES.map((s) => (
              <div key={s.title} className={styles.serviceCard}>
                <div className={styles.serviceIcon} aria-hidden="true">{s.icon}</div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. 預約系統入口 */}
      <section id="booking" className={`${styles.section} ${styles.bookingSection}`}>
        <div className={`${styles.sectionInner} ${styles.bookingInner}`}>
          <div>
            <p className={`${styles.eyebrow} ${styles.eyebrowLight}`}>BOOKING</p>
            <h2 className={`${styles.title} ${styles.titleLight}`}>預約諮詢</h2>
            <p className={`${styles.sub} ${styles.subLight}`}>
              線上挑好時間就完成預約，不用來回訊息喬時間；也可以直接加LINE快速對談。
            </p>

            <div className={styles.contactList}>
              <a href={`tel:${OWNER.phoneRaw}`} className={styles.contactItem}>
                <span className={styles.contactIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M6 3 L9 3 L11 8 L8.5 9.5 C9.5 12 12 14.5 14.5 15.5 L16 13 L21 15 L21 18 C21 19.7 19.5 21 18 21 C10 21 3 14 3 6 C3 4.5 4.3 3 6 3 Z" fill="currentColor" />
                  </svg>
                </span>
                <span>{OWNER.phone}</span>
              </a>
              <a href={SOCIAL.line} target="_blank" rel="noopener noreferrer" className={styles.contactItem}>
                <span className={styles.contactIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="16" rx="4" fill="currentColor" /></svg>
                </span>
                <span>LINE：{OWNER.phoneRaw}</span>
              </a>
              <span className={styles.contactItem}>
                <span className={styles.contactIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 21 C12 21 5 14.5 5 9.5 C5 5.9 8 3 12 3 C16 3 19 5.9 19 9.5 C19 14.5 12 21 12 21 Z" stroke="currentColor" strokeWidth="2" />
                    <circle cx="12" cy="9.5" r="2.5" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </span>
                <span>{BRAND}｜{OWNER.address}</span>
              </span>
            </div>
          </div>

          <div className={styles.bookingCard}>
            <h3 className={styles.bookingCardTitle}>線上預約系統</h3>
            <p className={styles.bookingCardDesc}>自己挑時段，送出就完成，不用等回覆</p>
            <ol className={styles.bookingSteps}>
              <li><span className={styles.stepNum}>1</span><span>選擇要談的內容（買房／賣房／租賃／房產法律）</span></li>
              <li><span className={styles.stepNum}>2</span><span>選見面方式：門市面談、電話或線上視訊</span></li>
              <li><span className={styles.stepNum}>3</span><span>挑日期與時段，週六日也開放</span></li>
              <li><span className={styles.stepNum}>4</span><span>留下聯絡方式，送出即完成預約</span></li>
            </ol>
            <Link href="/card/booking" className={`${styles.btn} ${styles.btnPrimary} ${styles.btnBlock}`}>
              開始預約
            </Link>
            <p className={styles.bookingNote}>每天 10:00–18:00（含週六日）｜門市面談請提前 4 小時預約</p>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <p>{OWNER.name}｜{BRAND}</p>
        <p>專營台中海線・沙鹿・龍井・清水・梧棲</p>
        <p>{OWNER.address}｜電話：{OWNER.phone}｜LINE：{OWNER.phoneRaw}</p>
        <p className={styles.copyright}>&copy; 2026 {OWNER.name}・{BRAND}. All rights reserved.</p>
      </footer>

      <a href={SOCIAL.line} target="_blank" rel="noopener noreferrer" className={styles.floatLine} aria-label="加LINE諮詢">
        <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
          <path d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.5s5.8-3.4 8-5.9C21.4 14.1 22 12.6 22 11c0-4.4-4.5-8-10-8z" fill="currentColor" />
        </svg>
      </a>
    </main>
  );
}
