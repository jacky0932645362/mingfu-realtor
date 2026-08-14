/**
 * / — 蕭茗馥個人官網首頁（太平洋房屋 梧棲市鎮加盟店）
 *
 * 站台結構（官網、名片、預約系統同一個網址）：
 *   /              官網（這頁）
 *   /card          數位名片
 *   /card/booking  線上預約
 *
 * 頁面區塊順序（本人指定，不要自己調換）：
 *   1 形象照 → 2 服務區域 → 3 戰績 → 4 服務項目 → 5 預約系統(含LINE)
 *
 * 2026-08-13 修正：
 *   ・戰績年份改為 110、111、112 年（先前寫成 111～113 是錯的）
 *   ・服務項目補上「房屋土地買賣」，共四項
 *   ・配色改用 Foresight CIS（深藍/橘/金），色票在 home.module.css 檔頭
 *
 * ⚠️ TOP1 措辭禁忌：只能寫「連續三年年度TOP1」，
 *    不可加「全台 / 全國 / 冠軍」——排名範圍未經本人確認。
 */
import type { Metadata } from "next";
import Link from "next/link";
import { OWNER, SOCIAL, SITE_URL } from "@/config/owner";
import styles from "./home.module.css";

const BRAND = OWNER.company || OWNER.name;

/** 服務區域 —— 台中海線四個行政區 */
const AREAS = [
  { name: "沙鹿", full: "台中市沙鹿區" },
  { name: "龍井", full: "台中市龍井區" },
  { name: "清水", full: "台中市清水區" },
  { name: "梧棲", full: "台中市梧棲區" },
] as const;

/** 戰績年份（民國）—— 110 + 1911 = 2021 */
const YEARS = ["110年", "111年", "112年"] as const;

const SERVICES = [
  {
    title: "房屋土地買賣",
    desc: "自住、換屋、投資、土地開發都能談。從估價、開價策略到議價與過戶流程全程把關，不讓您在資訊落差裡吃虧。",
    icon: (
      <svg viewBox="0 0 48 48" fill="none">
        <path d="M6 22 L24 8 L42 22" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11 19 V40 H37 V19" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M19 40 V29 H29 V40" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="27" cy="34" r="1.6" fill="currentColor" />
      </svg>
    ),
  },
  {
    title: "資產配置",
    desc: "手上這筆錢該買、該換，還是先不要動？依您的收入與家庭階段，把不動產放進整體資產一起算，而不是只看單一間房。",
    icon: (
      <svg viewBox="0 0 48 48" fill="none">
        <path d="M7 40 H41" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <rect x="10" y="26" width="8" height="14" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
        <rect x="20" y="18" width="8" height="22" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
        <rect x="30" y="9" width="8" height="31" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "稅務諮詢",
    desc: "買賣、繼承、贈與各有各的稅。房地合一、土增稅、自用住宅優惠怎麼算，事前先弄清楚，避免交屋後才發現多繳一筆。",
    icon: (
      <svg viewBox="0 0 48 48" fill="none">
        <rect x="9" y="6" width="30" height="36" rx="2" stroke="currentColor" strokeWidth="3" />
        <path d="M16 16 H32 M16 24 H32 M16 32 H26" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "簡易裝潢",
    desc: "中古屋不用整間打掉。哪裡該花、哪裡可以省，用合理預算先把採光、動線、收納處理好，住得舒服，將來也比較好脫手。",
    icon: (
      <svg viewBox="0 0 48 48" fill="none">
        <path d="M8 40 L40 40" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M12 40 V20 L24 8 L36 20 V40" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M18 32 H30" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <rect x="20" y="24" width="8" height="6" stroke="currentColor" strokeWidth="3" />
      </svg>
    ),
  },
] as const;

const AREA_TEXT = AREAS.map((a) => a.name).join("、");
const SERVICE_TEXT = SERVICES.map((s) => s.title).join("、");

const DESCRIPTION =
  `${OWNER.name}（${OWNER.brandPersona}）｜${BRAND}。專營台中海線（${AREA_TEXT}）房屋與土地買賣，` +
  `110、111、112年連續三年榮獲年度TOP1。提供${SERVICE_TEXT}等服務，` +
  `可線上預約諮詢或加LINE（${OWNER.phoneRaw}）直接聊。`;

const OG_IMAGE = `${SITE_URL}/profile.jpg`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${OWNER.name}｜台中海線房仲 ${AREA_TEXT}房屋土地買賣`,
  description: DESCRIPTION,
  keywords: [
    // 地區 + 職業（客戶最常搜的組合）
    "台中海線房仲", "沙鹿房仲", "龍井房仲", "清水房仲", "梧棲房仲",
    "沙鹿房屋買賣", "龍井房屋買賣", "清水房屋買賣", "梧棲房屋買賣",
    "台中海線土地買賣", "沙鹿土地", "龍井土地", "清水土地", "梧棲土地",
    // 品牌
    "太平洋房屋", "太平洋房屋梧棲", "太平洋房屋梧棲市鎮加盟店",
    // 服務
    "不動產資產配置", "房地合一稅諮詢", "房屋稅務諮詢", "中古屋簡易裝潢",
    // 人名
    OWNER.name, "房仲蕭邦",
  ],
  authors: [{ name: OWNER.name }],
  creator: OWNER.name,
  publisher: BRAND,
  alternates: { canonical: SITE_URL },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  openGraph: {
    type: "profile",
    title: `${OWNER.name}｜台中海線房仲 ${AREA_TEXT}`,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: BRAND,
    locale: "zh_TW",
    images: [{ url: OG_IMAGE, width: 1200, height: 1500, alt: `${OWNER.name} 形象照` }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${OWNER.name}｜台中海線房仲 ${AREA_TEXT}`,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

/**
 * 結構化資料（JSON-LD）—— 讓 Google 認得「這是一位在台中海線執業的房仲」，
 * 而不只是一堆文字。用 @graph 把「人／網站／頁面」串起來，彼此互相指認。
 *
 * ⚠️ 只放確定為真的資料。沒有的欄位（座標、評價、成交數）一律不寫，
 *    寫假的會被 Google 判定為 spam，比沒寫還糟。
 */
const AGENT_ID = `${SITE_URL}/#agent`;
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "RealEstateAgent",
      "@id": AGENT_ID,
      name: `${OWNER.name}｜${BRAND}`,
      // 讓 Google 知道「蕭茗馥」和「房仲蕭邦」是同一個人，
      // 客戶搜個人品牌名也找得到官網。
      alternateName: OWNER.brandPersona,
      description: DESCRIPTION,
      image: OG_IMAGE,
      url: SITE_URL,
      telephone: `+886-${OWNER.phoneRaw.slice(1)}`,
      // 沒設定信箱就不寫進 SEO 結構化資料（空字串會被 Google 判成無效欄位）
      ...(OWNER.email ? { email: OWNER.email } : {}),
      sameAs: [SOCIAL.line],
      address: {
        "@type": "PostalAddress",
        streetAddress: "四維中路338號",
        addressLocality: "梧棲區",
        addressRegion: "台中市",
        addressCountry: "TW",
      },
      areaServed: AREAS.map((a) => ({ "@type": "City", name: a.full })),
      knowsLanguage: ["zh-Hant", "zh-TW"],
      award: "110、111、112年連續三年榮獲年度TOP1",
      // 每天 10:00–18:00（含週六日）—— 與線上預約系統開放時段一致
      openingHoursSpecification: [
        {
          "@type": "OpeningHoursSpecification",
          dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
          opens: "10:00",
          closes: "18:00",
        },
      ],
      hasOfferCatalog: {
        "@type": "OfferCatalog",
        name: "服務項目",
        itemListElement: SERVICES.map((s) => ({
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: s.title, description: s.desc },
        })),
      },
      employee: {
        "@type": "Person",
        name: OWNER.name,
        alternateName: OWNER.brandPersona,
        jobTitle: OWNER.title,
        image: OG_IMAGE,
        telephone: `+886-${OWNER.phoneRaw.slice(1)}`,
      },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: `${OWNER.name}｜${BRAND}`,
      inLanguage: "zh-Hant-TW",
      publisher: { "@id": AGENT_ID },
    },
    {
      "@type": "ProfilePage",
      "@id": `${SITE_URL}/#webpage`,
      url: SITE_URL,
      name: `${OWNER.name}｜台中海線房仲`,
      description: DESCRIPTION,
      isPartOf: { "@id": `${SITE_URL}/#website` },
      about: { "@id": AGENT_ID },
      primaryImageOfPage: OG_IMAGE,
      inLanguage: "zh-Hant-TW",
    },
  ],
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
          <nav className={styles.navLinks} aria-label="主選單">
            <a href="#service-area">服務區域</a>
            <a href="#achievements">我的戰績</a>
            <a href="#services">服務項目</a>
            <a href="#booking">預約諮詢</a>
          </nav>
          <a href={`tel:${OWNER.phoneRaw}`} className={styles.navCta}>立即致電</a>
        </div>
      </header>

      {/* ---------- 1. 形象照 ---------- */}
      <section id="top" className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroPhoto}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/profile.jpg"
              alt={`${OWNER.name}－台中海線房仲（沙鹿、龍井、清水、梧棲）個人形象照`}
              width={1200}
              height={1500}
              fetchPriority="high"
            />
            <span className={styles.heroBadge}>
              110–112年　<strong>連續三年 年度TOP1</strong>
            </span>
          </div>

          <div>
            <p className={styles.heroEyebrow}>{BRAND}</p>
            {/* 姓名後面掛品牌人設「房仲蕭邦」——本人在經營的個人品牌，
                要讓客戶把「蕭茗馥」和「房仲蕭邦」連在一起記。 */}
            <h1 className={styles.heroName}>
              {OWNER.name}
              <span className={styles.heroPersona}>({OWNER.brandPersona})</span>
            </h1>
            <p className={styles.heroTitle}>{OWNER.title}</p>
            <p className={styles.heroTagline}>
              專營台中海線・沙鹿・龍井・清水・梧棲<br />
              <em>房屋 ‧ 土地買賣</em>
            </p>
            <p className={styles.heroDesc}>
              在海線市場一路做到 110、111、112 年連續三年年度TOP1。
              買房賣房不只是喊個價格，我會把行情、稅、貸款、後續怎麼處理一次講清楚，
              讓您在簽名之前，就知道自己在決定什麼。
            </p>
            <div className={styles.heroActions}>
              <Link href="/card/booking" className={`${styles.btn} ${styles.btnPrimary}`}>線上預約諮詢</Link>
              <a
                href={SOCIAL.line}
                target="_blank"
                rel="noopener noreferrer"
                className={`${styles.btn} ${styles.btnLine}`}
              >
                加LINE諮詢
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- 2. 服務區域 ---------- */}
      <section id="service-area" className={styles.section} aria-labelledby="service-area-title">
        <div className={styles.sectionInner}>
          <p className={styles.eyebrow}>SERVICE AREA</p>
          <h2 id="service-area-title" className={styles.title}>我服務的區域</h2>
          <p className={styles.sub}>
            專營台中海線，只做熟的地方。每一個生活圈的行情、路段差異與買方在意什麼，都在腦子裡。
          </p>
          <div className={styles.areaGrid}>
            {AREAS.map((area) => (
              <div key={area.name} className={styles.areaCard}>
                <span className={styles.areaName}>{area.name}</span>
                <span className={styles.areaSub}>{area.full}</span>
              </div>
            ))}
          </div>
          <p className={styles.areaNote}>
            台中海線・沙鹿・龍井・清水・梧棲｜專營<strong>房屋</strong>與<strong>土地</strong>
          </p>
        </div>
      </section>

      {/* ---------- 3. 戰績 ---------- */}
      <section id="achievements" className={`${styles.section} ${styles.achvSection}`} aria-labelledby="achievements-title">
        <div className={styles.sectionInner}>
          <p className={`${styles.eyebrow} ${styles.eyebrowLight}`}>ACHIEVEMENTS</p>
          <h2 id="achievements-title" className={`${styles.title} ${styles.titleLight}`}>我的戰績</h2>
          <p className={`${styles.sub} ${styles.subLight}`}>用實績說話，感謝每一位客戶的信任</p>

          <div className={styles.achvGrid}>
            {YEARS.map((year) => (
              <div key={year} className={styles.achvCard}>
                <div className={styles.achvYear}>{year}</div>
                <div className={styles.achvRank}>年度 TOP 1</div>
              </div>
            ))}
          </div>

          <div className={styles.statRow}>
            <div>
              <span className={styles.statNum}>3</span>
              <span className={styles.statLabel}>連續三年年度TOP1</span>
            </div>
            <div>
              <span className={styles.statNum}>4</span>
              <span className={styles.statLabel}>深耕行政區（沙鹿・龍井・清水・梧棲）</span>
            </div>
            <div>
              <span className={styles.statNum}>2</span>
              <span className={styles.statLabel}>專營類型（房屋・土地）</span>
            </div>
          </div>

          <p className={styles.achvHighlight}>110、111、112年　連續三年榮獲年度TOP1</p>
          <p className={styles.achvFootnote}>※ 年份為民國年（110年＝2021年）</p>
        </div>
      </section>

      {/* ---------- 4. 服務項目 ---------- */}
      <section id="services" className={`${styles.section} ${styles.sectionSoft}`} aria-labelledby="services-title">
        <div className={styles.sectionInner}>
          <p className={styles.eyebrow}>SERVICES</p>
          <h2 id="services-title" className={styles.title}>我提供的服務項目</h2>
          <p className={styles.sub}>不只是幫您買賣一間房，而是陪您把整件事想完整</p>
          <div className={styles.servicesGrid}>
            {SERVICES.map((s) => (
              <article key={s.title} className={styles.serviceCard}>
                <div className={styles.serviceIcon} aria-hidden="true">{s.icon}</div>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 5. 預約系統（含 LINE） ---------- */}
      <section id="booking" className={`${styles.section} ${styles.bookingSection}`} aria-labelledby="booking-title">
        <div className={`${styles.sectionInner} ${styles.bookingInner}`}>
          <div>
            <p className={`${styles.eyebrow} ${styles.eyebrowLight}`}>BOOKING</p>
            <h2 id="booking-title" className={`${styles.title} ${styles.titleLight}`}>預約諮詢</h2>
            <p className={`${styles.sub} ${styles.subLight}`}>
              線上挑好時間就完成預約，不用來回訊息喬時間；想先隨口問一句，直接加LINE也可以。
            </p>

            <div className={styles.contactList}>
              <a href={`tel:${OWNER.phoneRaw}`} className={styles.contactItem}>
                <span className={styles.contactIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M6 3 L9 3 L11 8 L8.5 9.5 C9.5 12 12 14.5 14.5 15.5 L16 13 L21 15 L21 18 C21 19.7 19.5 21 18 21 C10 21 3 14 3 6 C3 4.5 4.3 3 6 3 Z" fill="currentColor" />
                  </svg>
                </span>
                <span>電話：{OWNER.phone}</span>
              </a>
              <a href={SOCIAL.line} target="_blank" rel="noopener noreferrer" className={styles.contactItem}>
                <span className={styles.contactIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.5s5.8-3.4 8-5.9C21.4 14.1 22 12.6 22 11c0-4.4-4.5-8-10-8z" fill="currentColor" />
                  </svg>
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
        <p className={styles.footerName}>{OWNER.name}｜{BRAND}</p>
        <p>專營台中海線・沙鹿・龍井・清水・梧棲｜房屋・土地買賣</p>
        <p>{OWNER.address}｜電話：{OWNER.phone}｜LINE：{OWNER.phoneRaw}</p>
        <p className={styles.copyright}>&copy; 2026 {OWNER.name}・{BRAND}. All rights reserved.</p>
      </footer>

      <a
        href={SOCIAL.line}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.floatLine}
        aria-label="加LINE諮詢"
      >
        <svg viewBox="0 0 24 24" fill="none" width="28" height="28" aria-hidden="true">
          <path d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.5s5.8-3.4 8-5.9C21.4 14.1 22 12.6 22 11c0-4.4-4.5-8-10-8z" fill="currentColor" />
        </svg>
      </a>
    </main>
  );
}
