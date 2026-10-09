/**
 * 發文身分（2026-10-07）。對應同業「設定 → 發文身分」：排程時「用哪個身分發」的選項都從這裡來。
 *
 * 這頁只管「有哪些身分、各自登入有沒有效、名下有幾個社團／排程」。
 * 登入檔在桌機上（網站在 Vercel 讀不到），登入有沒有效是桌機 runner 每一輪回報的。
 */
import { listIdentities } from "@/lib/fb-identity";
import { identityUsage, fmtDateTime } from "@/lib/fb-factory";
import {
  identityKindLabel,
  identityIdForDisplay,
  loginStateOf,
  loginStateLabel,
  LOGIN_REPORT_STALE_HOURS,
} from "@/lib/fb-identity-core";
import { CIS } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import { IdentityCard, type IdentityCardData } from "./IdentityCard";
import { NewIdentityForm } from "./NewIdentityForm";
import styles from "../fb.module.css";

export const dynamic = "force-dynamic";

export default async function IdentitiesPage() {
  const [rows, usage] = await Promise.all([listIdentities(), identityUsage()]);
  const now = new Date();

  const cards: IdentityCardData[] = rows.map((r) => {
    const key = identityIdForDisplay(r.id);
    const u = usage.get(key);
    const state = loginStateOf(r, now);
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      kindLabel: identityKindLabel(r.kind),
      isDefault: r.is_default === 1,
      isActive: r.is_active === 1,
      authKey: r.auth_key,
      loginState: state,
      loginLabel: loginStateLabel(state),
      loginCheckedText: r.login_checked_at ? fmtDateTime(r.login_checked_at) : null,
      loginNote: r.login_note,
      groups: u?.groups ?? 0,
      activeGroups: u?.activeGroups ?? 0,
      pendingTasks: u?.pendingTasks ?? 0,
      doneTasks: u?.doneTasks ?? 0,
      lastDoneText: u?.lastDoneAt ? fmtDateTime(u.lastDoneAt) : null,
    };
  });

  const extra = cards.filter((c) => !c.isDefault);

  return (
    <>
      <div className={styles.eyebrow} style={{ color: CIS.textMute }}>
        Identities
      </div>
      <h1 className={styles.pageTitle}>發文身分</h1>
      <p className={styles.pageLead} style={{ color: CIS.textSub }}>
        排程時可以挑「用哪個身分發」。每個個人帳號<strong style={{ color: CIS.text }}>各自一份登入檔、各自一份社團清單</strong>
        （各帳號加入的社團本來就不一樣），到點桌機 runner 照身分用對的登入去發。原本的帳號就是「主帳號」，沒新增其他身分時一切跟以前一樣。
      </p>

      <div
        className={styles.notice}
        style={{ background: "rgba(245,158,11,0.09)", border: "1px solid rgba(245,158,11,0.26)", color: CIS.textSub }}
      >
        <Icon name="warning" size={16} color="#b45309" className={styles.noticeIcon} />
        <div>
          <strong style={{ color: "#b45309" }}>多個個人帳號要先知道的事：</strong>
          同一台電腦、同一個網路出口跑好幾個帳號，FB 比較容易把它們認成同一個人；<strong>其中一個被限制，可能連帶其他帳號</strong>。
          而且 FB 規定一個人只能有一個個人帳號。所以這裡刻意這樣設計：桌機<strong>一次只開一個瀏覽器</strong>（不同身分不會同時發）、
          各帳號登入檔與社團清單完全分開、不做任何指紋偽裝。建議：<strong>不同身分不要在同一段時間貼同一則文案到同一批社團</strong>。
          想多一個「身分」又怕連累主帳號，粉絲專頁（下面第二段）是比較安全的選擇。
        </div>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        {cards.map((c) => (
          <IdentityCard key={c.id} data={c} />
        ))}
      </div>

      <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}`, marginTop: 16 }}>
        <h3 className={styles.cardTitle}>
          <Icon name="add" size={16} color={CIS.blueSoft} />
          新增個人帳號
        </h3>
        <NewIdentityForm />
        <div style={{ marginTop: 10, fontSize: 12.5, color: CIS.textMute, lineHeight: 1.8 }}>
          新增之後要在桌機登入那個帳號一次（網站不會、也看不到你的帳號密碼）。登入檔等同帳號鑰匙，只存在桌機
          <code> tools/fb-autopost/auth/ </code>，不進版控、不上傳。
          {extra.length === 0 ? "" : ` 目前除了主帳號還有 ${extra.length} 個身分。`}
        </div>
      </section>

      <section
        className={styles.card}
        style={{ background: CIS.card, border: `1px dashed ${CIS.cardBorder}`, marginTop: 16, opacity: 0.85 }}
      >
        <h3 className={styles.cardTitle}>
          <Icon name="megaphone" size={16} color={CIS.textMute} />
          粉絲專頁（第二段，還沒開放）
        </h3>
        <div style={{ fontSize: 13.5, color: CIS.textSub, lineHeight: 1.85 }}>
          粉絲專頁會走 Meta 官方 API 發文，<strong>不開瀏覽器、不用登入檔</strong>，也不會有帳號被關聯的風險。
          前提是要先到 Meta 開發者後台建一個應用程式、授權一次（跟 IG／Threads 那頁同一種流程）。
          決定好粉專要發到哪裡之後會接在這裡。
        </div>
      </section>

      <div style={{ marginTop: 14, fontSize: 12.5, color: CIS.textMute, lineHeight: 1.8 }}>
        登入狀態是桌機 runner 每一輪（約 5 分鐘）回報的；超過 {LOGIN_REPORT_STALE_HOURS} 小時沒回報會顯示「桌機超過一天沒回報」——多半是 runner 沒在跑。
        「登入有效」只代表登入檔裡有帳號身分的 cookie，真正發文時 FB 要求重新驗證的話，那一輪會失敗並在「排程任務」寫明原因。
      </div>
    </>
  );
}
