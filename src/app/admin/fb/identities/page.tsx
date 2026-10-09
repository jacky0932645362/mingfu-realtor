/**
 * 發文身分（2026-10-07）。對應同業「設定 → 發文身分」：排程時「用哪個身分發」的選項都從這裡來。
 *
 * 2026-10-09：
 *   ・粉絲專頁／Instagram／Threads 也都是身分，舊的「IG／Threads 帳號」頁併進來
 *   ・本人貼同業截圖「發文身分可以這樣顯示」→ 改成一張表格：名稱（FB 上顯示的）｜類型｜狀態｜備註｜✕，
 *     最下面「＋ 新增身分」。名稱、備註直接在格子裡改。
 * 登入檔在桌機上（網站在 Vercel 讀不到），個人帳號登入有沒有效是桌機 runner 每一輪回報的。
 */
import { listIdentities, identityTokenStatus } from "@/lib/fb-identity";
import { identityUsage, apiIdentityUsage, fmtDateTime } from "@/lib/fb-factory";
import { identityIdForDisplay, loginStateOf, loginStateLabel, LOGIN_REPORT_STALE_HOURS } from "@/lib/fb-identity-core";
import { socialAppConfig, socialRedirectUri, socialSiteBase } from "@/lib/social-publish";
import { CIS } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import { IdentityTable, type IdentityRowData } from "./IdentityTable";
import styles from "../fb.module.css";

export const dynamic = "force-dynamic";

const KIND_ORDER = { personal: 0, page: 1, ig: 2, threads: 3 } as const;

export default async function IdentitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; user?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const [rows, usage, apiUsage, tokens] = await Promise.all([
    listIdentities(),
    identityUsage(),
    apiIdentityUsage(),
    identityTokenStatus(),
  ]);
  const now = new Date();
  const personalOptions = rows
    .filter((r) => r.kind === "personal" && r.is_active === 1)
    .map((r) => ({ id: r.id, name: r.name }));

  const tableRows: IdentityRowData[] = rows
    .filter((r) => r.kind in KIND_ORDER)
    .sort((a, b) => {
      const k = KIND_ORDER[a.kind as keyof typeof KIND_ORDER] - KIND_ORDER[b.kind as keyof typeof KIND_ORDER];
      return k || b.is_default - a.is_default || a.sort_order - b.sort_order;
    })
    .map((r): IdentityRowData => {
      const kind = r.kind as IdentityRowData["kind"];
      const base = {
        id: r.id,
        kind,
        name: r.name,
        note: r.note || "",
        isDefault: r.is_default === 1,
        isActive: r.is_active === 1,
      };
      if (kind === "personal") {
        const u = usage.get(identityIdForDisplay(r.id));
        const state = loginStateOf(r, now);
        const statusText = !r.is_active ? "已停用" : r.is_default === 1 && state === "unknown" ? "原本的帳號" : loginStateLabel(state);
        return {
          ...base,
          statusText,
          statusTone: !r.is_active ? "neutral" : state === "ok" ? "success" : state === "missing" ? "danger" : state === "stale" ? "warn" : "neutral",
          detail: `社團 ${u?.groups ?? 0} 個 · 排程中 ${u?.pendingTasks ?? 0} · 已發 ${u?.doneTasks ?? 0}${u?.lastDoneAt ? ` · 最近 ${fmtDateTime(u.lastDoneAt)}` : ""}`,
          link: null,
          loginKey: r.is_default !== 1 && r.auth_key && state !== "ok" ? r.auth_key : null,
          parentId: null,
          pageCheck: null,
          groupsHref: `/admin/fb/groups?identity=${encodeURIComponent(identityIdForDisplay(r.id))}`,
        };
      }
      const t = tokens.get(r.id);
      const u = apiUsage.get(r.id);
      const days = t?.expiresAt ? Math.floor((new Date(t.expiresAt).getTime() - now.getTime()) / 86_400_000) : null;
      const statusText = !r.is_active
        ? "已停用"
        : !t
          ? "沒有授權，重新連結"
          : days == null
            ? "授權有效"
            : days < 0
              ? "授權過期，重新連結"
              : `授權剩 ${days} 天`;
      const statusTone: IdentityRowData["statusTone"] = !r.is_active
        ? "neutral"
        : !t || (days != null && days < 0)
          ? "danger"
          : days != null && days < 10
            ? "warn"
            : "success";
      const counts = `排程中 ${u?.pending ?? 0} · 已發 ${u?.posted ?? 0}${u?.failed ? ` · 失敗 ${u.failed}` : ""}`;
      const handle = r.ext_username ? `@${r.ext_username}` : null;
      return {
        ...base,
        statusText,
        statusTone,
        detail: kind === "page" ? `${r.page_url || ""}　${counts}` : `${handle || ""}　${counts}`,
        link:
          kind === "page"
            ? r.page_url
            : r.ext_username
              ? kind === "ig"
                ? `https://www.instagram.com/${r.ext_username}/`
                : `https://www.threads.net/@${r.ext_username}`
              : null,
        loginKey: null,
        parentId: kind === "page" ? r.parent_identity_id ?? null : null,
        pageCheck:
          kind === "page" && r.login_checked_at
            ? { ok: r.login_ok === 1, text: `${r.login_ok === 1 ? "✅ 切換成功" : "❌ 切換失敗"}（${fmtDateTime(r.login_checked_at)}）` }
            : null,
        groupsHref: null,
      };
    });

  const site = socialSiteBase();
  const isLocal = !/^https:\/\//i.test(site);

  return (
    <>
      <div className={styles.eyebrow} style={{ color: CIS.textMute }}>
        Identities
      </div>
      <h1 className={styles.pageTitle}>發文身分（可以放好幾個粉專／帳號）</h1>
      <p className={styles.pageLead} style={{ color: CIS.textSub }}>
        排程時自己挑：FB 那一段用哪個身分發（個人帳號，或以粉專身分發社團），另外要同時發到哪幾個<strong style={{ color: CIS.text }}>粉專動態／Instagram／Threads</strong>
        （每一組都能單獨勾）。名稱、備註直接在格子裡改，離開格子就存。
      </p>

      {sp.ok ? (
        <div className={styles.notice} style={{ background: "rgba(34,197,94,0.09)", border: "1px solid rgba(34,197,94,0.3)", color: CIS.textSub }}>
          <Icon name="success" size={16} color="#16a34a" className={styles.noticeIcon} />
          <div>
            <strong style={{ color: "#16a34a" }}>{sp.ok === "fb" ? "粉專" : sp.ok === "ig" ? "Instagram" : "Threads"} 連結成功</strong>
            {sp.user ? `：${sp.user}` : ""}
          </div>
        </div>
      ) : null}
      {sp.error ? (
        <div className={styles.notice} style={{ background: "rgba(244,63,94,0.09)", border: "1px solid rgba(244,63,94,0.3)", color: CIS.textSub }}>
          <Icon name="error" size={16} color="#e11d48" className={styles.noticeIcon} />
          <div style={{ whiteSpace: "pre-wrap" }}>{sp.error}</div>
        </div>
      ) : null}

      <div className={styles.notice} style={{ background: "rgba(245,158,11,0.09)", border: "1px solid rgba(245,158,11,0.26)", color: CIS.textSub }}>
        <Icon name="warning" size={16} color="#b45309" className={styles.noticeIcon} />
        <div>
          <strong style={{ color: "#b45309" }}>兩三個不同帳號的用法：</strong>
          網站<strong>不會也不能</strong>替你輸入密碼。個人帳號是新增後到桌機登入一次（列上按「怎麼登入」看步驟）；粉專／IG／Threads 是到 Meta 授權一次。
          發文時桌機會先確認身分對不對，<strong>對不上就整份不發，不會用錯帳號發出去</strong>。同一台電腦跑好幾個個人帳號，FB 比較容易把它們認成同一人，
          所以桌機一次只開一個瀏覽器、不同身分不會同時發；最安全的是「發到粉專自己的動態」（官方 API）。
        </div>
      </div>

      <IdentityTable
        rows={tableRows}
        personalOptions={personalOptions}
        oauthReady={{ fb: Boolean(socialAppConfig("fb")), ig: Boolean(socialAppConfig("ig")), threads: Boolean(socialAppConfig("threads")) }}
      />

      <details className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}`, marginTop: 20 }}>
        <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 15 }}>第一次設定（粉專／IG／Threads 要先做一次，個人帳號不用）</summary>
        {isLocal ? (
          <div style={{ fontSize: 13, color: "#b45309", margin: "10px 0" }}>
            現在網站根網址是 <code>{site}</code>（不是 https）。Meta 只接受 https，<strong>連結帳號要在線上（Vercel）那邊按</strong>。
          </div>
        ) : null}
        <ol style={{ margin: "10px 0 0", paddingLeft: 22, fontSize: 13.5, lineHeight: 1.95, color: CIS.textSub }}>
          <li>
            到 <code>developers.facebook.com</code> 建一個應用程式，使用案例勾：<strong>管理粉絲專頁上的所有內容</strong>（粉專）、
            <strong>管理 Instagram 的訊息和內容</strong>（IG）、<strong>存取 Threads API</strong>（Threads）。
          </li>
          <li>
            三組編號：應用程式本身的「應用程式編號／密鑰」→ <code>FB_APP_ID</code>／<code>FB_APP_SECRET</code>；Instagram 那組 →{" "}
            <code>IG_APP_ID</code>／<code>IG_APP_SECRET</code>；Threads 那組 → <code>THREADS_APP_ID</code>／<code>THREADS_APP_SECRET</code>。
          </li>
          <li>
            三個「重新導向網址」各貼進對應的 OAuth 設定：
            <div style={{ fontFamily: "monospace", fontSize: 12.5, color: CIS.text, margin: "4px 0", wordBreak: "break-all" }}>
              <div>粉專：{socialRedirectUri("fb")}</div>
              <div>IG：{socialRedirectUri("ig")}</div>
              <div>Threads：{socialRedirectUri("threads")}</div>
            </div>
          </li>
          <li>
            應用程式角色：自己（以及要連的 IG／Threads 帳號）加成管理員／測試人員並接受邀請。<strong>自己的粉專、自己的帳號不用送審</strong>，應用程式留在「開發中」即可。
          </li>
          <li>環境變數填好（Vercel 專案設定＋桌機 <code>card-booking/.env.local</code>）、重新部署，回到這頁按「＋ 新增身分」選粉專／IG／Threads。</li>
        </ol>
        <div style={{ marginTop: 10, fontSize: 12.5, color: CIS.textMute, lineHeight: 1.8 }}>
          規格提醒：照片要是<strong>公開網址</strong>（Cloudinary 的會自動轉 JPEG），桌機資料夾路徑發不出去。IG 說明 2,200 字、一定要有照片；Threads 500 字；
          粉專一則最多帶 10 張。IG／Threads 授權 60 天、發文前自動續；粉專授權不會過期。
        </div>
      </details>

      <div style={{ marginTop: 14, fontSize: 12.5, color: CIS.textMute, lineHeight: 1.8 }}>
        個人帳號的登入狀態是桌機 runner 每一輪（約 5 分鐘）回報的；超過 {LOGIN_REPORT_STALE_HOURS} 小時沒回報會顯示「桌機超過一天沒回報」——多半是 runner 沒在跑。
      </div>
    </>
  );
}
