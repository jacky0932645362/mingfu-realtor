"use client";
/**
 * 發文身分表格（2026-10-09，本人貼同業截圖「發文身分可以這樣顯示」）：
 *   名稱（FB 上顯示的）｜類型｜狀態｜備註｜✕，最下面「＋ 新增身分」。
 * 名稱、備註直接在格子裡改（離開格子就存）。
 * 跟同業不一樣的地方：粉專／IG／Threads 要到 Meta 授權才拿得到發文權限，所以選這三種按「前往授權」會跳去授權畫面，
 * 名稱由授權回來的資料帶入；個人帳號則是新增後到桌機登入一次（列下方會展開步驟）。
 */
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createIdentityAction,
  renameIdentityAction,
  setIdentityNoteAction,
  setIdentityActiveAction,
  deleteIdentityAction,
  setPageParentAction,
} from "@/lib/actions/identity-actions";
import { CIS, CHIP } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import styles from "./identities.module.css";

export type IdentityKindKey = "personal" | "page" | "ig" | "threads";

export type IdentityRowData = {
  id: string;
  kind: IdentityKindKey;
  name: string;
  note: string;
  isDefault: boolean;
  isActive: boolean;
  /** 登入／授權狀態 */
  statusText: string;
  statusTone: "success" | "warn" | "danger" | "neutral";
  /** 補充一行（@帳號、粉專網址、名下社團數…） */
  detail: string | null;
  link: string | null;
  /** 個人帳號：還沒登入時要顯示的登入代號 */
  loginKey: string | null;
  /** 粉專：借哪個個人帳號發社團 */
  parentId: string | null;
  pageCheck: { ok: boolean; text: string } | null;
  groupsHref: string | null;
};

const KIND_LABEL: Record<IdentityKindKey, string> = { personal: "帳號", page: "粉專", ig: "Instagram", threads: "Threads" };
const OAUTH: Record<Exclude<IdentityKindKey, "personal">, "fb" | "ig" | "threads"> = { page: "fb", ig: "ig", threads: "threads" };

export function IdentityTable({
  rows,
  personalOptions,
  oauthReady,
}: {
  rows: IdentityRowData[];
  personalOptions: Array<{ id: string; name: string }>;
  /** 各平台有沒有設定 App ID（沒設定就不能跳授權） */
  oauthReady: { fb: boolean; ig: boolean; threads: boolean };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<IdentityKindKey>("personal");
  const [newNote, setNewNote] = useState("");
  const [openLogin, setOpenLogin] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { tone: "ok", text: r.message || "好了" } : { tone: "bad", text: r.error || "失敗" });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  const create = () => {
    if (newKind !== "personal") {
      const p = OAUTH[newKind];
      if (!oauthReady[p]) {
        setMsg({ tone: "bad", text: `還沒設定 ${p === "fb" ? "FB_APP_ID／FB_APP_SECRET" : p === "ig" ? "IG_APP_ID／IG_APP_SECRET" : "THREADS_APP_ID／THREADS_APP_SECRET"}，先照最下面「第一次設定」做完` });
        return;
      }
      // 粉專／IG／Threads：到 Meta 授權，回來自動多一列（名稱用平台上顯示的）
      window.location.href = `/api/social/oauth/${p}/start`;
      return;
    }
    run(
      () => createIdentityAction(newName, newNote),
      () => {
        setAdding(false);
        setNewName("");
        setNewNote("");
      },
    );
  };

  return (
    <div>
      <div className={styles.tableBox} style={{ borderColor: CIS.cardBorder, background: CIS.card }}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: "34%" }}>名稱（FB 上顯示的）</th>
              <th style={{ width: 110 }}>類型</th>
              <th style={{ width: 170 }}>狀態</th>
              <th>備註</th>
              <th style={{ width: 92 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const tone = CHIP[r.statusTone];
              const showLogin = r.kind === "personal" && r.loginKey && openLogin === r.id;
              return (
                <Fragment key={r.id}>
                  <tr style={{ opacity: r.isActive ? 1 : 0.55 }}>
                    <td>
                      <input
                        className={styles.cellInput}
                        defaultValue={r.name}
                        maxLength={100}
                        aria-label="名稱"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== r.name) run(() => renameIdentityAction(r.id, v));
                          else e.target.value = r.name;
                        }}
                      />
                      <div className={styles.detail}>
                        {r.isDefault ? <strong style={{ color: CIS.blueSoft }}>主帳號 · </strong> : null}
                        {r.link ? (
                          <a href={r.link} target="_blank" rel="noreferrer" style={{ color: CIS.blueSoft }}>
                            {r.detail || r.link}
                          </a>
                        ) : (
                          r.detail
                        )}
                        {r.groupsHref ? (
                          <>
                            {" · "}
                            <Link href={r.groupsHref} style={{ color: CIS.blueSoft }}>
                              社團清單
                            </Link>
                          </>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span className={styles.kind}>{KIND_LABEL[r.kind]}</span>
                    </td>
                    <td>
                      <span className={styles.status} style={{ background: tone.bg, color: tone.color, borderColor: tone.border }}>
                        {r.statusText}
                      </span>
                      {r.kind === "personal" && r.loginKey ? (
                        <button type="button" className={styles.linkBtn} onClick={() => setOpenLogin(openLogin === r.id ? null : r.id)}>
                          {openLogin === r.id ? "收起" : "怎麼登入"}
                        </button>
                      ) : null}
                    </td>
                    <td>
                      <input
                        className={styles.cellInput}
                        defaultValue={r.note}
                        maxLength={200}
                        placeholder="例：主帳號、公司粉專"
                        aria-label="備註"
                        onBlur={(e) => {
                          if (e.target.value.trim() !== r.note) run(() => setIdentityNoteAction(r.id, e.target.value));
                        }}
                      />
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {!r.isDefault ? (
                        <>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            title={r.isActive ? "停用（排程選單不會再出現）" : "重新啟用"}
                            disabled={pending}
                            onClick={() => run(() => setIdentityActiveAction(r.id, !r.isActive))}
                          >
                            <Icon name={r.isActive ? "pause" : "check"} size={15} />
                          </button>
                          <button
                            type="button"
                            className={styles.delBtn}
                            title="刪除"
                            aria-label={`刪除 ${r.name}`}
                            disabled={pending}
                            onClick={() => {
                              if (!window.confirm(`刪掉「${r.name}」？\n\n${r.kind === "personal" ? "只刪這個身分本身（桌機上的登入檔不會被刪）。" : "會一起刪掉存著的授權鑰匙。"}有發文紀錄或社團的會被擋下來，那種請按旁邊的「停用」。`)) return;
                              run(() => deleteIdentityAction(r.id));
                            }}
                          >
                            <Icon name="close" size={15} />
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                  {r.kind === "page" ? (
                    <tr className={styles.subRow}>
                      <td colSpan={5}>
                        <div className={styles.subLine}>
                          <span>
                            ① 發粉專自己的動態：<strong style={{ color: "#16a34a" }}>可以</strong>（官方 API）
                          </span>
                          <span>
                            ② 以粉專身分發社團，用這個帳號切換：
                            <select
                              className={styles.cellSelect}
                              value={r.parentId || ""}
                              disabled={pending}
                              onChange={(e) => run(() => setPageParentAction(r.id, e.target.value))}
                            >
                              <option value="">不發社團</option>
                              {personalOptions.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.name}
                                </option>
                              ))}
                            </select>
                          </span>
                          {r.parentId ? (
                            <span style={{ color: r.pageCheck ? (r.pageCheck.ok ? "#16a34a" : "#e11d48") : "#b45309", fontWeight: 700 }}>
                              {r.pageCheck ? r.pageCheck.text : "還沒檢查 → 桌機雙擊「FB檢查粉專身分.bat」"}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {showLogin ? (
                    <tr className={styles.subRow}>
                      <td colSpan={5}>
                        <ol className={styles.steps}>
                          <li>
                            在桌機雙擊 <code>桌面\批次檔案\FB其他帳號-1登入.bat</code>，登入代號輸入 <strong style={{ color: CIS.text }}>{r.loginKey}</strong>
                          </li>
                          <li>在跳出的瀏覽器登入<strong>這個帳號</strong>（含二階段驗證），登入完回黑色視窗按 Enter</li>
                          <li>
                            再雙擊 <code>FB其他帳號-2抓社團.bat</code>、輸入同一個代號，把這個帳號加入的社團抓進清單
                          </li>
                          <li>桌機下一輪（最多 5 分鐘）回報後，狀態會變成「登入有效」</li>
                        </ol>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}

            {adding ? (
              <tr className={styles.newRow}>
                <td>
                  <input
                    className={styles.cellInput}
                    autoFocus
                    value={newKind === "personal" ? newName : ""}
                    disabled={newKind !== "personal"}
                    maxLength={100}
                    placeholder={newKind === "personal" ? "取個認得出來的名字" : "授權後自動帶入平台上的名稱"}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") create();
                    }}
                  />
                </td>
                <td>
                  <select className={styles.cellSelect} value={newKind} onChange={(e) => setNewKind(e.target.value as IdentityKindKey)}>
                    <option value="personal">帳號</option>
                    <option value="page">粉專</option>
                    <option value="ig">Instagram</option>
                    <option value="threads">Threads</option>
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className={styles.okBtn}
                    disabled={pending || (newKind === "personal" && !newName.trim())}
                    onClick={create}
                  >
                    {newKind === "personal" ? "建立" : "前往授權"}
                  </button>
                </td>
                <td>
                  <input
                    className={styles.cellInput}
                    value={newNote}
                    maxLength={200}
                    disabled={newKind !== "personal"}
                    placeholder={newKind === "personal" ? "例：主帳號、公司粉專" : "授權回來後再寫"}
                    onChange={(e) => setNewNote(e.target.value)}
                  />
                </td>
                <td style={{ textAlign: "right" }}>
                  <button type="button" className={styles.delBtn} title="取消" onClick={() => setAdding(false)}>
                    <Icon name="close" size={15} />
                  </button>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.addBtn} onClick={() => setAdding(true)} disabled={adding}>
          <Icon name="add" size={15} />
          新增身分
        </button>
        {adding && newKind !== "personal" ? (
          <span className={styles.hint}>
            {newKind === "page"
              ? "授權畫面勾選要管理的粉專，一次可以勾好幾個，回來會各多一列。"
              : newKind === "ig"
                ? "在 Instagram 授權畫面切換成要加的那個帳號。"
                : "要加第二組 Threads：先在這個瀏覽器登出 threads.net（或用無痕視窗開後台）。"}
          </span>
        ) : null}
        {msg ? <span style={{ fontSize: 13, color: msg.tone === "ok" ? "#16a34a" : "#e11d48" }}>{msg.text}</span> : null}
      </div>
    </div>
  );
}
