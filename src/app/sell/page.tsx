/**
 * /sell — 委託賣房（2026-08-24）
 *
 * 這頁的目的只有一個：讓「在想要不要賣房」的屋主願意先跟本人聊一次。
 * 所以內容重心不是自誇，是回答屋主真正卡住的三件事：
 *   ① 現在到底值多少 ② 委託會不會被綁住 ③ 委託之後你會做什麼
 *
 * 🚫 這頁絕對不能出現的東西（房仲廣告最常踩的線，也是本人的硬禁忌）：
 *   ・「保證賣掉」「保證最高價」「幾天成交」——做不到的承諾，且涉及不實廣告
 *   ・捏造的建設、重劃、學區、政策
 *   ・具體的區域行情數字（要講行情就講「幫你查實登」，不要自己編一個數字）
 *
 * 頁面上的數字（8 年、200 件）與服務項目描述都來自已確認的來源：
 * 年資與成交件數是本人 2026-08-24 親口提供，服務描述沿用首頁既有文案。
 */
import type { Metadata } from "next";
import Link from "next/link";
import { OWNER, SOCIAL, SITE_URL } from "@/config/owner";
import SiteNav from "../_components/SiteNav";
import home from "../home.module.css";
import styles from "./sell.module.css";

const BRAND = OWNER.company || OWNER.name;
const AREA_TEXT = "沙鹿、龍井、清水、梧棲";

/** ⚠️ 跟首頁 page.tsx 的 YEARS_IN_TRADE／CLOSED_DEALS 是同一組數字，改要一起改。 */
const YEARS_IN_TRADE = 8;
const CLOSED_DEALS = 200;

const DESCRIPTION =
  `想在台中海線（${AREA_TEXT}）賣房子？${OWNER.name}（${OWNER.brandPersona}）深耕海線第 ${YEARS_IN_TRADE} 年、` +
  `累積成交 ${CLOSED_DEALS} 件。免費估價、委託類型怎麼選、從開價策略到議價過戶的完整流程，先聊過再決定要不要委託。`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `委託賣房｜台中海線${AREA_TEXT}房屋土地委託｜${OWNER.name}`,
  description: DESCRIPTION,
  keywords: [
    "台中海線賣房", "沙鹿賣房", "龍井賣房", "清水賣房", "梧棲賣房",
    "台中海線委託賣房", "房屋委託", "專任委託", "一般委託", "免費估價",
    "沙鹿房屋估價", "梧棲房屋估價", "土地委託", OWNER.name, "房仲蕭邦",
  ],
  alternates: { canonical: `${SITE_URL}/sell` },
  openGraph: {
    type: "website",
    title: `委託賣房｜台中海線${AREA_TEXT}｜${OWNER.name}`,
    description: DESCRIPTION,
    url: `${SITE_URL}/sell`,
    siteName: BRAND,
    locale: "zh_TW",
    images: [{ url: `${SITE_URL}/profile.jpg`, width: 1200, height: 1500, alt: `${OWNER.name} 形象照` }],
  },
};

/** 為什麼找我 —— 只放能被查證的東西，不寫「服務最好」這種形容詞。 */
const WHY = [
  {
    num: YEARS_IN_TRADE,
    unit: "年",
    label: "只做台中海線",
    desc: `入行到現在都在${AREA_TEXT}。您這間在哪個路段、附近最近成交什麼價，不用從頭查。`,
  },
  {
    num: CLOSED_DEALS,
    unit: "件",
    label: "累積成交",
    desc: "從首購小宅到透天、土地都經手過。知道哪種買方會出價、哪種只是來看看。",
  },
  {
    num: 3,
    unit: "年",
    label: "連續年度TOP1",
    desc: "110、111、112年。不是靠一兩件大案衝出來的，是每年都維持住。",
  },
] as const;

/**
 * 賣房流程。這是台灣不動產交易的標準程序，不是本人獨創的服務，
 * 所以可以照實寫；但每一步的說明要用屋主聽得懂的話，不要寫成法條。
 */
const STEPS = [
  {
    title: "先估價，不用先決定要不要賣",
    desc: "看過房子、查過附近實登之後，給您一個有依據的區間，並說明為什麼是這個數字。這一步免費，估完您說不賣也完全沒關係。",
  },
  {
    title: "談開價策略",
    desc: "開多少不是越高越好。開太高會讓房子在市場上「掛久了」，之後買方反而會覺得有問題、更難談。我們會一起決定開價與您心裡的底價。",
  },
  {
    title: "簽委託",
    desc: "選專任或一般、委託多久、服務費怎麼算，白紙黑字寫清楚再簽。有不懂的地方當場問，不要簽了才回去研究。",
  },
  {
    title: "上架與行銷",
    desc: "拍照、寫文案、上架 591 與官網物件頁，再依物件條件決定要不要投社群廣告。物件頁的網址可以直接傳給您的親友看。",
  },
  {
    title: "帶看與回報",
    desc: "每次帶看完回報買方的實際反應——包括嫌了什麼。市場的回饋是調整策略的依據，只報喜不報憂對您沒有幫助。",
  },
  {
    title: "議價、簽約、過戶交屋",
    desc: "買方出價後幫您分析要不要接、還能爭取什麼。簽約後的代書、稅費、貸款塗銷、點交，一路跟到交屋。",
  },
] as const;

export default function SellPage() {
  return (
    <main className={home.page}>
      <SiteNav />

      {/* ---------- 首屏 ---------- */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.heroEyebrow}>SELL YOUR PROPERTY</p>
          <h1 className={styles.heroTitle}>
            想賣房子，第一步不是急著開價
          </h1>
          <p className={styles.heroSub}>
            是先知道「現在到底值多少」，以及「這個價格為什麼是這個價格」。
            <br />
            台中海線・{AREA_TEXT}｜房屋與土地委託
          </p>
          <div className={styles.heroActions}>
            <Link href="/card/booking" className={`${home.btn} ${home.btnPrimary}`}>
              預約免費估價
            </Link>
            <a
              href={SOCIAL.line}
              target="_blank"
              rel="noopener noreferrer"
              className={`${home.btn} ${home.btnLine}`}
            >
              先加LINE問問
            </a>
          </div>
        </div>
      </section>

      {/* ---------- 為什麼找我 ---------- */}
      <section className={home.section} aria-labelledby="why-title">
        <div className={home.sectionInner}>
          <p className={home.eyebrow}>WHY ME</p>
          <h2 id="why-title" className={home.title}>為什麼把房子交給我</h2>
          <p className={home.sub}>不講形容詞，講可以查證的事。</p>

          <div className={styles.whyGrid}>
            {WHY.map((w) => (
              <div key={w.label} className={styles.whyCard}>
                <span className={styles.whyNum}>{w.num}</span>
                <span className={styles.whyUnit}>{w.unit}</span>
                <span className={styles.whyLabel}>{w.label}</span>
                <span className={styles.whyDesc}>{w.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 流程 ---------- */}
      <section className={`${home.section} ${home.sectionSoft}`} aria-labelledby="steps-title">
        <div className={home.sectionInner}>
          <p className={home.eyebrow}>PROCESS</p>
          <h2 id="steps-title" className={home.title}>從估價到交屋，會經過這六步</h2>
          <p className={home.sub}>每一步您都會知道現在在哪、下一步要做什麼。</p>

          <div className={styles.steps}>
            {STEPS.map((s) => (
              <div key={s.title} className={styles.step}>
                <h3 className={styles.stepTitle}>{s.title}</h3>
                <p className={styles.stepDesc}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 專任 vs 一般 ----------
           屋主最常卡在這裡，而且很多人簽完才知道差別。
           ⚠️ 這裡只寫兩種委託的「機制差異」，不寫「哪個比較好」——
              哪個適合要看物件與屋主的狀況，一概而論就是話術。 */}
      <section className={home.section} aria-labelledby="type-title">
        <div className={home.sectionInner}>
          <p className={home.eyebrow}>CONTRACT</p>
          <h2 id="type-title" className={home.title}>專任委託 vs 一般委託</h2>
          <p className={home.sub}>簽之前先搞懂差在哪，不要簽完才回去查。</p>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">　</th>
                  <th scope="col">專任委託</th>
                  <th scope="col">一般委託</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">可以委託幾家</th>
                  <td>只能委託一家</td>
                  <td>可以同時委託多家</td>
                </tr>
                <tr>
                  <th scope="row">屋主自己賣</th>
                  <td>依契約約定，通常受限制</td>
                  <td>可以自己找買方</td>
                </tr>
                <tr>
                  <th scope="row">實務上的差別</th>
                  <td>受託方投入的行銷資源通常較集中，聯絡窗口單一</td>
                  <td>曝光管道較多，但資訊分散、各家開價不一致時買方容易觀望</td>
                </tr>
                <tr>
                  <th scope="row">委託期間</th>
                  <td colSpan={2}>兩種都是雙方約定起訖日，到期未成交即終止，不會自動續約</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className={styles.tableNote}>
            ※ 兩種沒有絕對的好壞，要看物件條件與您的時間壓力。實際權利義務一律以簽署的
            委託契約書內容為準，簽約前請逐條看過，有疑問當場問到懂為止。
          </p>
        </div>
      </section>

      {/* ---------- 收尾 CTA ---------- */}
      <section className={styles.cta}>
        <div className={styles.ctaInner}>
          <h2 className={styles.ctaTitle}>先估個價，再決定要不要賣</h2>
          <p className={styles.ctaSub}>
            估價不收費，也不用當場決定。您把地址與坪數給我，
            我查完實登與目前在售的競爭物件再跟您說明。
          </p>
          <div className={styles.ctaActions}>
            <Link href="/card/booking" className={`${home.btn} ${home.btnPrimary}`}>
              線上預約估價
            </Link>
            <a
              href={SOCIAL.line}
              target="_blank"
              rel="noopener noreferrer"
              className={`${home.btn} ${home.btnLine}`}
            >
              加LINE（{OWNER.phone}）
            </a>
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
          <Link href="/card" style={{ color: "inherit" }}>數位名片</Link>
        </p>
      </footer>
    </main>
  );
}
