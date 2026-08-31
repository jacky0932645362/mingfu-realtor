/**
 * /about — 完整版「關於我」（2026-09-01）
 *
 * 首頁的關於我區塊只放三段，這頁是點「更多關於我」之後的完整版。
 *
 * ⚠️ 這頁**沒有任何一句新的事實**。所有內容都是首頁那八塊裡已經確認過的素材
 *    （本人 2026-08-24 親口提供的年資、成交件數、理念原話、真實客戶評價、
 *    服務區域與服務項目），只是排成一頁可以慢慢讀的版本。
 *    要加東西進來一定要問過本人 —— 房仲的自我介紹寫錯等於執業信譽風險。
 *
 * ⚠️ 沿用首頁的兩條禁忌：
 *    ・TOP1 只能寫「連續三年年度TOP1」，不可加全台／全國／冠軍
 *    ・不對外宣稱知道未來的建設／重劃／哪裡會漲
 */
import type { Metadata } from "next";
import Link from "next/link";
import { OWNER, SOCIAL, SITE_URL } from "@/config/owner";
import SiteNav from "../_components/SiteNav";
import styles from "./about.module.css";

const BRAND = OWNER.company || OWNER.name;

/** 與首頁同一組數字，改一定要兩邊一起改（本人 2026-08-24 提供）。 */
const YEARS_IN_TRADE = 8;
const CLOSED_DEALS = 200;

const AREAS = ["沙鹿", "龍井", "清水", "梧棲"] as const;

/** 本人原話，一字不改。理由見首頁 page.tsx 的 ABOUT_CREED 註解。 */
const CREED =
  "我做房仲，不只是為了成交，而是希望用我的專業，讓客戶在買房這件人生大事上，" +
  "少走一點冤枉路，找到真正適合自己的家。";

const STORY = [
  `入行邁入第 ${YEARS_IN_TRADE} 年，這 ${YEARS_IN_TRADE} 年我都待在同一個地方——台中海線。`,
  "沙鹿、龍井、清水、梧棲，每個生活圈的行情怎麼走、哪個社區的買方最在意什麼，" +
    "不是查資料查來的，是一間一間走出來的。",
  "所以帶看的時候，好的壞的我都會講完。寧可您當下多考慮一下，也不要簽完約才發現。",
] as const;

/** 客戶原始訊息，只做長度修剪。身份是本人逐則確認過的，不要自己從內容猜。 */
const TESTIMONIALS = [
  {
    quote:
      "每次問你問題你都很有耐心，也會站在我們的角度幫忙分析，不會只想著成交，這點讓我們很感動。" +
      "買房真的不是一件簡單的事情，很幸運可以遇到你這麼認真的房仲。",
    role: "換屋族",
  },
  {
    quote:
      "從看房、比較、議價到後面的流程，你都很細心幫我們處理，有問題也都會第一時間協助。" +
      "整個過程讓我們安心很多，這次買房能遇到你真的很幸運！",
    role: "首購族",
  },
  {
    quote:
      "帶我們看房很有耐心，也會把房子的優缺點都跟我們說清楚，不會一直推銷，讓我們覺得很放心。" +
      "有你幫忙一起分析，找房真的輕鬆很多。",
    role: "首購族",
  },
] as const;

const SERVICES = [
  {
    title: "房屋土地買賣",
    desc: "自住、換屋、投資、土地開發都能談。從估價、開價策略到議價與過戶流程全程把關，不讓您在資訊落差裡吃虧。",
  },
  {
    title: "資產配置",
    desc: "手上這筆錢該買、該換，還是先不要動？依您的收入與家庭階段，把不動產放進整體資產一起算，而不是只看單一間房。",
  },
  {
    title: "稅務諮詢",
    desc: "買賣、繼承、贈與各有各的稅。房地合一、土增稅、自用住宅優惠怎麼算，事前先弄清楚，避免交屋後才發現多繳一筆。",
  },
  {
    title: "簡易裝潢",
    desc: "中古屋不用整間打掉。哪裡該花、哪裡可以省，用合理預算先把採光、動線、收納處理好，住得舒服，將來也比較好脫手。",
  },
] as const;

/** 民國年。110 + 1911 = 2021 */
const YEARS = ["110年", "111年", "112年"] as const;

const AREA_TEXT = AREAS.join("、");
const CANONICAL = `${SITE_URL.replace(/\/$/, "")}/about`;

const DESCRIPTION =
  `${OWNER.name}（${OWNER.brandPersona}）｜${BRAND}。深耕台中海線第 ${YEARS_IN_TRADE} 年，` +
  `累積成交 ${CLOSED_DEALS} 件，110、111、112年連續三年年度TOP1。` +
  `專營${AREA_TEXT}房屋與土地買賣，這頁是完整的自我介紹與服務說明。`;

export const metadata: Metadata = {
  title: `關於${OWNER.alias}｜${OWNER.name}・台中海線房仲`,
  description: DESCRIPTION,
  alternates: { canonical: CANONICAL },
  openGraph: {
    type: "profile",
    title: `關於${OWNER.alias}｜${OWNER.name}`,
    description: DESCRIPTION,
    url: CANONICAL,
    siteName: BRAND,
    locale: "zh_TW",
    images: [{ url: `${SITE_URL}/profile.jpg`, alt: `${OWNER.name} 形象照` }],
  },
};

export default function AboutPage() {
  return (
    <div className={styles.page}>
      <SiteNav />

      <div className={styles.shell}>
        {/* ---------- 開頭：照片 + 身份 ---------- */}
        <header className={styles.head}>
          <div className={styles.headPhoto}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/profile.jpg"
              alt={`${OWNER.name}－台中海線房仲（${AREA_TEXT}）個人形象照`}
              width={1200}
              height={1500}
            />
          </div>

          <div className={styles.headText}>
            <p className={styles.eyebrow}>ABOUT ME</p>
            <h1 className={styles.name}>
              {OWNER.name}
              <span className={styles.persona}>（{OWNER.brandPersona}）</span>
            </h1>
            <p className={styles.role}>
              {OWNER.title}｜{BRAND}
            </p>
            <p className={styles.tagline}>
              專營台中海線・{AREA_TEXT}
              <br />
              <em>房屋 ‧ 土地買賣</em>
            </p>

            <div className={styles.headActions}>
              <Link href="/card/booking" className={`${styles.btn} ${styles.btnPrimary}`}>
                線上預約諮詢
              </Link>
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
        </header>

        {/* ---------- 我這 8 年 ---------- */}
        <section className={styles.block} aria-labelledby="story-title">
          <h2 id="story-title" className={styles.blockTitle}>我這 {YEARS_IN_TRADE} 年</h2>
          <div className={styles.prose}>
            {STORY.map((para) => (
              <p key={para}>{para}</p>
            ))}
          </div>
          <blockquote className={styles.creed}>{CREED}</blockquote>
        </section>

        {/* ---------- 數字 ---------- */}
        <section className={styles.block} aria-labelledby="stats-title">
          <h2 id="stats-title" className={styles.blockTitle}>用數字說明我在哪裡</h2>
          <div className={styles.statGrid}>
            <div className={styles.stat}>
              <span className={styles.statNum}>{YEARS_IN_TRADE}</span>
              <span className={styles.statUnit}>年</span>
              <span className={styles.statLabel}>海線深耕年資</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statNum}>{CLOSED_DEALS}</span>
              <span className={styles.statUnit}>件</span>
              <span className={styles.statLabel}>累積成交件數</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statNum}>{AREAS.length}</span>
              <span className={styles.statUnit}>區</span>
              <span className={styles.statLabel}>深耕行政區</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statNum}>{YEARS.length}</span>
              <span className={styles.statUnit}>年</span>
              {/* ⚠️ 措辭禁忌：不可加全台／全國／冠軍 */}
              <span className={styles.statLabel}>連續年度TOP1</span>
            </div>
          </div>
          <p className={styles.statNote}>
            {YEARS.join("、")}　連續三年榮獲年度TOP1　※ 年份為民國年（110年＝2021年）
          </p>
        </section>

        {/* ---------- 服務區域 ---------- */}
        <section className={styles.block} aria-labelledby="area-title">
          <h2 id="area-title" className={styles.blockTitle}>我服務的區域</h2>
          <p className={styles.blockSub}>
            專營台中海線，只做熟的地方。每一個生活圈的行情、路段差異與買方在意什麼，都在腦子裡。
          </p>
          <div className={styles.areaRow}>
            {AREAS.map((a) => (
              <span key={a} className={styles.areaChip}>
                {a}
                <em>台中市{a}區</em>
              </span>
            ))}
          </div>
        </section>

        {/* ---------- 服務項目 ---------- */}
        <section className={styles.block} aria-labelledby="services-title">
          <h2 id="services-title" className={styles.blockTitle}>我能幫您做什麼</h2>
          <p className={styles.blockSub}>不只是幫您買賣一間房，而是陪您把整件事想完整。</p>
          <div className={styles.serviceList}>
            {SERVICES.map((s) => (
              <article key={s.title} className={styles.serviceCard}>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ---------- 客戶評價 ---------- */}
        <section className={styles.block} aria-labelledby="tm-title">
          <h2 id="tm-title" className={styles.blockTitle}>客戶怎麼說</h2>
          <p className={styles.blockSub}>以下是客戶傳來的訊息原文，只做了長度修剪，沒有潤飾。</p>
          <div className={styles.tmList}>
            {TESTIMONIALS.map((t) => (
              <figure key={t.quote} className={styles.tmCard}>
                <blockquote>{t.quote}</blockquote>
                <figcaption>{t.role}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* ---------- 收尾 CTA ---------- */}
        <section className={styles.cta} aria-labelledby="cta-title">
          <h2 id="cta-title" className={styles.ctaTitle}>想聊聊，隨時找我</h2>
          <p className={styles.ctaSub}>
            線上挑好時間就完成預約，不用來回訊息喬時間；想先隨口問一句，直接加LINE也可以。
          </p>
          <div className={styles.ctaActions}>
            <Link href="/card/booking" className={`${styles.btn} ${styles.btnPrimary}`}>
              線上預約諮詢
            </Link>
            <a
              href={SOCIAL.line}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.btn} ${styles.btnLine}`}
            >
              加LINE諮詢
            </a>
            <a href={`tel:${OWNER.phoneRaw}`} className={`${styles.btn} ${styles.btnOutline}`}>
              撥打 {OWNER.phone}
            </a>
          </div>
          <p className={styles.ctaMeta}>
            {BRAND}｜{OWNER.address}
          </p>
        </section>

        <div className={styles.backRow}>
          <Link href="/property" className={styles.backLink}>
            看目前在售的物件 →
          </Link>
        </div>
      </div>
    </div>
  );
}
