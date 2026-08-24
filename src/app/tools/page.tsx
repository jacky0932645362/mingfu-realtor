/**
 * /tools — 工具網站（2026-08-24）
 *
 * 定位是「引流＋建立專業信任」，不是賣房頁。客戶為了算稅進來，
 * 算完發現這個人好像真的懂，才會想到要找他談。所以這頁不塞銷售話術。
 *
 * 工具本身是 public/tools/ 底下的靜態 HTML（不是 React 頁面）：
 * 房地合一稅試算器是 69KB 的單檔、含 76 處 script，已經測試過能用，
 * 重寫成元件的風險遠大於好處。列表頁負責導覽與 SEO，工具負責算。
 *
 * ⚠️ 靜態檔是由 Agent-OS/tools/land-tax-calculator.html 包裝產生的，
 *    要改內容改原檔再重新產生，不要直接改 public/ 裡那份。
 *
 * 2026-08-24 分成兩類：CALCULATORS（自己架的試算工具）與
 * EXTERNAL_TOOLS（連到政府官方網站的查詢系統，例如地籍圖資）。
 * 不要混在同一組陣列裡——外部連結一定要新分頁開、要清楚標主辦單位，
 * 不能讓人誤會地籍圖資是本人做的。
 */
import type { Metadata } from "next";
import Link from "next/link";
import { OWNER, SITE_URL } from "@/config/owner";
import SiteNav from "../_components/SiteNav";
import home from "../home.module.css";
import styles from "./tools.module.css";

const BRAND = OWNER.company || OWNER.name;

const DESCRIPTION =
  "免費房產工具：房地合一稅試算（算稅金與實拿、反推該開多少價），" +
  "以及內政部地籍圖資、實價登錄等官方查詢系統連結。" +
  `由${OWNER.name}（${OWNER.brandPersona}）整理，台中海線房產顧問。`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `房產工具｜房地合一稅試算・地籍圖資查詢｜${OWNER.name}`,
  description: DESCRIPTION,
  keywords: [
    "房地合一稅試算", "房地合一稅計算", "房地合一稅2.0", "賣房要繳多少稅",
    "房屋稅務試算", "自住400萬免稅額", "重購退稅", "持有期間稅率",
    "地籍圖資查詢", "地籍圖資網路便民服務系統", "地號查詢", "土地使用分區查詢",
    "台中海線房產顧問", OWNER.name, "房仲蕭邦",
  ],
  alternates: { canonical: `${SITE_URL}/tools` },
  openGraph: {
    type: "website",
    title: `房產工具｜房地合一稅試算・地籍圖資查詢｜${OWNER.name}`,
    description: DESCRIPTION,
    url: `${SITE_URL}/tools`,
    siteName: BRAND,
    locale: "zh_TW",
  },
};

/**
 * 自製試算工具。
 * `href` 為 null＝還沒做好，卡片會變成不可點的「準備中」樣式 ——
 * 列出來讓人知道之後會有，但不要給一個點下去 404 的連結。
 */
const CALCULATORS = [
  {
    tag: "稅務",
    title: "房地合一稅試算",
    href: "/tools/land-tax-calculator.html",
    desc: "賣掉這間到底要繳多少稅、實際能拿回多少錢。也可以反過來算：想淨賺這個數，該開多少價。",
    points: [
      "兩種算法：輸入買賣價算稅金／輸入目標淨利反推賣價",
      "持有期間可直接點稅率（45／35／20／15%）",
      "填日期會算出「再撐 N 天稅率降到 X%、少繳多少」",
    ],
  },
  {
    tag: "貸款",
    title: "房貸月付金試算",
    href: null,
    desc: "算每月要繳多少、總利息多少，以及寬限期結束後月付會跳多少。",
    points: [],
  },
  {
    tag: "買房",
    title: "購屋總費用試算",
    href: null,
    desc: "除了房價之外，代書費、規費、契稅、裝潢、家電這些一次列清楚，避免預算抓太緊。",
    points: [],
  },
] as const;

/**
 * 外部政府查詢系統。這些不是本人架的，是連到官方網站 ——
 * 跟上面的自製工具分開放，卡片上要清楚標「內政部」而不是讓人誤會是自己做的，
 * 連結一律開新分頁（離開官網去外部網站，不能佔用原本這個分頁）。
 *
 * ⚠️ 每個網址上線前都要先用 WebFetch 驗證過是官方現行網址（政府網站偶爾會換網域），
 *    不能用記憶裡的網址直接放，寫錯政府單位的網址比沒有連結還糟。
 */
const EXTERNAL_TOOLS = [
  {
    tag: "地政",
    title: "地籍圖資網路便民服務系統",
    href: "https://easymap.moi.gov.tw/Z10Web/Index",
    org: "內政部地政司",
    desc: "用地號、門牌或村里查地籍圖，看地段範圍、面積、使用分區，議價或確認範圍時很好用。",
  },
] as const;

export default function ToolsPage() {
  return (
    <main className={home.page}>
      <SiteNav />

      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.heroEyebrow}>TOOLS</p>
          <h1 className={styles.heroTitle}>房產工具</h1>
          <p className={styles.heroSub}>
            買房賣房會用到的計算與查詢，先自己看一遍再談，心裡比較有底。
            <br />
            免費使用，不用留資料。
          </p>
        </div>
      </section>

      <section className={home.section} aria-labelledby="tools-title">
        <div className={home.sectionInner}>
          <p className={home.eyebrow}>CALCULATORS</p>
          <h2 id="tools-title" className={home.title}>試算工具</h2>
          <p className={home.sub}>灰色的是還在做，之後會陸續補上。</p>

          <div className={styles.grid}>
            {CALCULATORS.map((t) =>
              t.href ? (
                <a key={t.title} href={t.href} className={styles.card}>
                  <span className={styles.cardTag}>{t.tag}</span>
                  <h3 className={styles.cardTitle}>{t.title}</h3>
                  <p className={styles.cardDesc}>{t.desc}</p>
                  {t.points.length > 0 ? (
                    <ul className={styles.cardList}>
                      {t.points.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  ) : null}
                  <span className={styles.cardGo}>開始試算</span>
                </a>
              ) : (
                <div key={t.title} className={`${styles.card} ${styles.cardSoon}`}>
                  <span className={`${styles.cardTag} ${styles.cardSoonTag}`}>{t.tag}・準備中</span>
                  <h3 className={styles.cardTitle}>{t.title}</h3>
                  <p className={styles.cardDesc}>{t.desc}</p>
                </div>
              ),
            )}
          </div>

          {/* ⚠️ 試算工具一定要有這段。稅額最終以國稅局核定為準，
              算出來的數字被當成保證會出事。 */}
          <p className={styles.note}>
            ※ 試算結果僅供參考，實際稅額以國稅局核定為準，個案還會受自住優惠、重購退稅、
            繼承或受贈取得等因素影響。金額較大或情況特殊時，請務必找地政士或稅務專業人員確認。
            有不確定的地方也可以直接問我，我幫您一起看。
          </p>
        </div>
      </section>

      {/* ---------- 外部政府查詢系統 ----------
           不是本人做的，卡片上一律標主辦單位，連結一律新分頁開。 */}
      <section className={`${home.section} ${home.sectionSoft}`} aria-labelledby="external-title">
        <div className={home.sectionInner}>
          <p className={home.eyebrow}>OFFICIAL LOOKUP</p>
          <h2 id="external-title" className={home.title}>官方查詢系統</h2>
          <p className={home.sub}>政府提供的公開查詢工具，直接連過去，不用另外註冊。</p>

          <div className={styles.grid}>
            {EXTERNAL_TOOLS.map((t) => (
              <a
                key={t.title}
                href={t.href}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.card}
              >
                <span className={styles.cardTag}>{t.tag}</span>
                <h3 className={styles.cardTitle}>{t.title}</h3>
                <p className={styles.cardDesc}>{t.desc}</p>
                <span className={styles.cardOrg}>{t.org}　提供</span>
                <span className={styles.cardGo}>前往查詢（新分頁開啟）</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <footer className={home.footer}>
        <p className={home.footerName}>
          {OWNER.name}｜{BRAND}
        </p>
        <p>{OWNER.address}｜電話：{OWNER.phone}</p>
        <p>
          <Link href="/" style={{ color: "inherit" }}>回首頁</Link>
          {"　"}
          <Link href="/property" style={{ color: "inherit" }}>銷售物件</Link>
          {"　"}
          <Link href="/sell" style={{ color: "inherit" }}>委託賣房</Link>
        </p>
      </footer>
    </main>
  );
}
