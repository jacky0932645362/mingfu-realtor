/**
 * IG／Threads 帳號連結（2026-09-21）。
 *
 * 這頁只管「帳號綁好沒、token 還活著沒」。文案的 IG／Threads 版本在貼文庫那則的分頁改，
 * 要不要一起發在排程頁勾。
 */
import { fmtDateTime } from "@/lib/fb-factory";
import { allSocialAccountStatus, socialSiteBase } from "@/lib/social-publish";
import { CIS } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import { SocialAccountCard, type SocialCardData } from "./SocialAccountCard";
import styles from "../fb.module.css";

export const dynamic = "force-dynamic";

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; user?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const st = await allSocialAccountStatus();
  const site = socialSiteBase();

  const toCard = (platform: "ig" | "threads"): SocialCardData => {
    const s = st[platform];
    return {
      platform,
      label: s.label,
      appConfigured: s.appConfigured,
      connected: s.connected,
      username: s.username,
      userId: s.userId,
      expiresAtText: s.expiresAt ? fmtDateTime(s.expiresAt) : null,
      daysLeft: s.daysLeft,
      connectedAtText: s.connectedAt ? fmtDateTime(s.connectedAt) : null,
      refreshedAtText: s.refreshedAt ? fmtDateTime(s.refreshedAt) : null,
      redirectUri: s.redirectUri,
      scopes: s.scopes,
      envKeys: platform === "ig" ? ["IG_APP_ID", "IG_APP_SECRET"] : ["THREADS_APP_ID", "THREADS_APP_SECRET"],
    };
  };

  // Meta 只收 https 的重新導向網址 —— 根網址不是 https（本機 dev）就提醒去線上按
  const isLocal = !/^https:\/\//i.test(site);

  return (
    <>
      <div className={styles.eyebrow} style={{ color: CIS.textMute }}>
        Accounts
      </div>
      <h1 className={styles.pageTitle}>IG／Threads 帳號</h1>
      <p className={styles.pageLead} style={{ color: CIS.textSub }}>
        一般貼文排程時可以勾「同時發到 Instagram／Threads」，到點桌機 runner 用<strong>官方 API</strong>發（不開瀏覽器）；
        貼文庫每一則也有「現在就發」。前提是這裡的帳號連結好。FB 個人主頁沒有官方 API 所以才用瀏覽器模擬，IG 跟 Threads 不用冒那個險。
      </p>

      {sp.ok ? (
        <div className={styles.notice} style={{ background: "rgba(34,197,94,0.09)", border: "1px solid rgba(34,197,94,0.3)", color: CIS.textSub }}>
          <Icon name="success" size={16} color="#16a34a" className={styles.noticeIcon} />
          <div>
            <strong style={{ color: "#16a34a" }}>{sp.ok === "ig" ? "Instagram" : "Threads"} 連結成功</strong>
            {sp.user ? `：@${sp.user}` : ""}。長效 token 60 天，發文前會自動續。
          </div>
        </div>
      ) : null}
      {sp.error ? (
        <div className={styles.notice} style={{ background: "rgba(244,63,94,0.09)", border: "1px solid rgba(244,63,94,0.3)", color: CIS.textSub }}>
          <Icon name="error" size={16} color="#e11d48" className={styles.noticeIcon} />
          <div style={{ whiteSpace: "pre-wrap" }}>{sp.error}</div>
        </div>
      ) : null}
      {isLocal ? (
        <div className={styles.notice} style={{ background: "rgba(245,158,11,0.09)", border: "1px solid rgba(245,158,11,0.26)", color: CIS.textSub }}>
          <Icon name="warning" size={16} color="#b45309" className={styles.noticeIcon} />
          <div>
            現在網站根網址是 <code>{site}</code>（不是 https）。Meta 只接受 https 的重新導向網址，<strong>連結帳號要在線上（Vercel）那邊按</strong>；
            連好之後 token 存在資料庫，桌機 runner 跟本機 dev server 都讀得到。
          </div>
        </div>
      ) : null}

      <div className={styles.grid2}>
        <SocialAccountCard data={toCard("ig")} />
        <SocialAccountCard data={toCard("threads")} />
      </div>

      <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}`, marginTop: 16 }}>
        <h3 className={styles.cardTitle}>
          <Icon name="list" size={16} color={CIS.blueSoft} />
          第一次設定要做的事（只做一次）
        </h3>
        <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13.5, lineHeight: 1.95, color: CIS.textSub }}>
          <li>
            IG 帳號要是<strong>專業帳號</strong>（商業或創作者）：IG App → 設定 → 帳號類型和工具 → 切換為專業帳號。個人帳號 API 不給發文。
          </li>
          <li>
            到 <code>developers.facebook.com</code> 建一個應用程式（類型選「商家」或「其他」都可），加兩個產品／使用案例：<strong>Instagram</strong>（選「Instagram 登入」那條，不用 FB 粉專）與 <strong>Threads</strong>。
          </li>
          <li>
            Instagram → API 設定 → 產生 <strong>Instagram 應用程式 ID／密鑰</strong>（不是最上面那組 Meta 應用程式 ID）→ 填進 <code>IG_APP_ID</code>／<code>IG_APP_SECRET</code>；
            Threads 使用案例 → 設定 → <strong>Threads 應用程式 ID／密鑰</strong> → 填進 <code>THREADS_APP_ID</code>／<code>THREADS_APP_SECRET</code>。
            兩邊各把上面卡片裡的「重新導向網址」貼進 OAuth 重新導向 URI。
          </li>
          <li>
            應用程式角色 → 新增人員：把自己的 IG 帳號加成 <strong>Instagram 測試人員</strong>、Threads 帳號加成 <strong>Threads 測試人員</strong>，然後到 IG／Threads App 的「應用程式和網站 → 測試人員邀請」接受。
            自己的帳號當測試人員就能發，<strong>不用送審</strong>；應用程式留在「開發中」模式即可。
          </li>
          <li>環境變數填好（Vercel 專案設定＋桌機 <code>card-booking/.env.local</code>）、重新部署，回到這頁按「連結帳號」。</li>
        </ol>
        <div style={{ marginTop: 12, fontSize: 12.5, color: CIS.textMute, lineHeight: 1.8 }}>
          規格提醒：IG 圖片只吃 JPEG（Cloudinary 的照片會自動轉）、說明 2,200 字、一天 100 篇；Threads 內文 500 字、一天 250 篇；
          兩邊照片都要是<strong>公開網址</strong>，桌機資料夾路徑的照片發不出去。
        </div>
      </section>
    </>
  );
}
