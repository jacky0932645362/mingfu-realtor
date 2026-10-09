"use client";
/**
 * 產生文案的表單。兩條路：從物件庫挑一筆，或手動填一筆（物件庫裡沒有的）。
 *
 * 產完直接導去貼文庫的那一則，不是留在原頁顯示「成功」——
 * 因為產完之後八成要做的事是「看一下文案對不對」，不是再產一篇。
 */
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateFromPropertyAction, generateManualAction } from "@/lib/actions/fb-actions";
import { importListingCopyAction } from "@/lib/actions/listing-import-actions";
import { CIS } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import { PhotoPicker } from "@/app/admin/_ui/PhotoPicker";
import { VideoPicker } from "@/app/admin/_ui/VideoPicker";
import styles from "../fb.module.css";

type PropertyOption = { id: string; label: string; published: boolean };
type Scenario = { key: string; label: string; hint: string };

const inputStyle = {
  background: CIS.bgSoft,
  border: `1px solid ${CIS.cardBorder}`,
  color: CIS.text,
};

export function ComposeForm({
  properties,
  scenarios,
  uploadEnabled,
}: {
  properties: PropertyOption[];
  scenarios: Scenario[];
  uploadEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [propertyId, setPropertyId] = useState(properties[0]?.id || "");
  const [scenario, setScenario] = useState(scenarios[0]?.key || "new");

  const [manualOpen, setManualOpen] = useState(false);
  const [mTitle, setMTitle] = useState("");
  const [mBody, setMBody] = useState("");
  const [mPhotos, setMPhotos] = useState("");
  const [mVideo, setMVideo] = useState("");

  // 貼連結／案號自動產生文案（2026-10-07）：帶進下面「手動填一筆」那幾格，改完再存
  const [importRaw, setImportRaw] = useState("");
  const [importing, startImport] = useTransition();
  const [importMsg, setImportMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [catalogPhotos, setCatalogPhotos] = useState<string[]>([]);

  const PHOTO_MAX = 10;

  const doImport = () => {
    setImportMsg(null);
    setImportWarnings([]);
    if (!importRaw.trim()) return setImportMsg({ tone: "bad", text: "先貼愛屋連結、591／樂屋連結，或愛屋案號" });
    if (mBody.trim() && !window.confirm("下面「手動填一筆」已經有內文了，帶入會把標題跟內文換成新的（照片不動）。確定？")) return;
    startImport(async () => {
      const res = await importListingCopyAction(importRaw);
      if (!res.ok) return setImportMsg({ tone: "bad", text: res.error });
      setMTitle(res.title);
      setMBody(res.body);
      setCatalogPhotos(res.photos);
      setImportWarnings(res.warnings);
      setManualOpen(true);
      setImportMsg({
        tone: "ok",
        text: `已帶入（${res.via}${res.no ? `，物件編號 ${res.no}` : ""}）。下面「手動填一筆」是可以改的草稿，改完按「存進貼文庫」。`,
      });
    });
  };

  /** 把型錄照片接在現有圖片後面，總數最多 PHOTO_MAX 張、已經有的不重複加。 */
  const addCatalogPhotos = () => {
    const current = mPhotos.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const room = Math.max(0, PHOTO_MAX - current.length);
    const fresh = catalogPhotos.filter((u) => !current.includes(u)).slice(0, room);
    if (room === 0) return setImportMsg({ tone: "bad", text: `照片已經滿 ${PHOTO_MAX} 張了，先刪幾張再帶入` });
    if (fresh.length === 0) return setImportMsg({ tone: "bad", text: "型錄的照片都已經在清單裡了" });
    setMPhotos([...current, ...fresh].join("\n"));
    setManualOpen(true);
    setImportMsg({ tone: "ok", text: `已帶入 ${fresh.length} 張型錄照片（照片欄現在共 ${current.length + fresh.length} 張，上限 ${PHOTO_MAX}）` });
  };

  const hint = scenarios.find((s) => s.key === scenario)?.hint || "";

  const fromProperty = () => {
    setError(null);
    if (!propertyId) return setError("先挑一筆物件");
    start(async () => {
      const res = await generateFromPropertyAction(propertyId, scenario);
      if (!res.ok) return setError(res.error || "產生失敗");
      router.push(`/admin/fb/library/${res.id}`);
    });
  };

  const fromManual = () => {
    setError(null);
    start(async () => {
      const res = await generateManualAction({ title: mTitle, body: mBody, photos: mPhotos, video: mVideo });
      if (!res.ok) return setError(res.error || "存檔失敗");
      router.push(`/admin/fb/library/${res.id}`);
    });
  };

  return (
    <>
      {error ? (
        <div
          className={styles.notice}
          style={{ background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.3)", color: "#e11d48" }}
        >
          <Icon name="error" size={16} className={styles.noticeIcon} />
          <div>{error}</div>
        </div>
      ) : null}

      {/* ── 從物件庫挑一筆 ── */}
      <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
        <h3 className={styles.cardTitle}>
          <Icon name="building" size={16} color={CIS.blueSoft} />
          從物件庫挑一筆
          {/* 「新增物件」在物件庫那頁，不在工廠裡；本人 2026-09-22 找不到，直接擺一顆在這。 */}
          <Link
            href="/admin/properties/new"
            className={styles.btn}
            style={{
              marginLeft: "auto",
              minHeight: 32,
              padding: "5px 12px",
              fontSize: 13,
              background: "rgba(90,145,225,0.14)",
              color: CIS.blueSoft,
              border: "1px solid rgba(90,145,225,0.35)",
            }}
          >
            <Icon name="add" size={14} />
            去物件庫新增物件
          </Link>
        </h3>

        {properties.length === 0 ? (
          <div className={styles.empty} style={{ borderColor: CIS.cardBorder, color: CIS.textMute }}>
            物件庫是空的。先去{" "}
            <Link href="/admin/properties/new" style={{ color: CIS.blueSoft, fontWeight: 700 }}>
              物件庫新增一筆 →
            </Link>
          </div>
        ) : (
          <>
            <div className={styles.grid2}>
              <div className={styles.field}>
                <label className={styles.label} style={{ color: CIS.textSub }}>
                  挑一筆物件
                </label>
                <select
                  className={styles.select}
                  style={inputStyle}
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value)}
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.field}>
                <label className={styles.label} style={{ color: CIS.textSub }}>
                  要發哪一種文
                </label>
                <select
                  className={styles.select}
                  style={inputStyle}
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value)}
                >
                  {scenarios.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {hint ? (
              <div style={{ fontSize: 12.5, color: CIS.textMute, marginTop: 8 }}>{hint}</div>
            ) : null}

            <div className={styles.btnRow} style={{ marginTop: 16 }}>
              <button
                type="button"
                className={styles.btn}
                style={{ background: CIS.blue, color: "#fff" }}
                disabled={pending}
                onClick={fromProperty}
              >
                <Icon name={pending ? "loading" : "ai"} size={16} />
                {pending ? "產生中…" : "產生文案"}
              </button>
            </div>

            <p style={{ fontSize: 12.5, color: CIS.textMute, marginTop: 12, lineHeight: 1.75 }}>
              亮點會從物件的「賣點」欄位帶進來。地址只帶「對外地址」（完整門牌是內部欄位，不會出現在 FB
              上）。物件狀態是「上架中」的才會附上物件頁連結。
              <br />
              缺的資料一律留成看得見的空格，程式不會替你編 —— 降價文的原價、看屋文的時間都要自己填。
            </p>
          </>
        )}
      </section>

      {/* ── 貼連結／案號，自動產生文案（2026-10-07：照同業「從愛屋帶入」） ── */}
      <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
        <h3 className={styles.cardTitle}>
          <Icon name="link" size={16} color={CIS.blueSoft} />
          從愛屋帶入（貼物件連結或案號）
        </h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            className={styles.input}
            style={{ ...inputStyle, flex: "1 1 320px" }}
            value={importRaw}
            onChange={(e) => setImportRaw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && importRaw.trim() && !importing) doImport();
            }}
            placeholder="貼愛屋連結、591／樂屋連結，或愛屋案號（像 AA6345420）"
            disabled={importing}
          />
          <button
            type="button"
            className={styles.btn}
            style={{ background: CIS.blue, color: "#fff" }}
            disabled={importing || !importRaw.trim()}
            onClick={doImport}
          >
            <Icon name={importing ? "loading" : "magic"} size={15} />
            {importing ? "讀取中…" : "帶入"}
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: CIS.textMute, lineHeight: 1.75, margin: "8px 0 0" }}>
          會帶入案名、開價、路名、格局、登記坪數、主＋附屬、樓別／樓高、屋齡、車位型式、環境特色，帶進來就是可以改的草稿。
          地址只到路名（FB 貼文不放門牌）。型錄沒有的欄位整行省略，不會替你編。
          591／樂屋連結會從頁面描述裡反查這戶的愛屋編號；樂屋會擋程式讀取（讀不進來）、591 出售通常也沒寫編號——
          那種情況會明講，請改貼愛屋連結或案號。也可以直接把樂屋描述尾巴那行「編號：AD…」或愛屋連結複製貼上來。
        </p>

        {importMsg ? (
          <div
            style={{
              marginTop: 10,
              fontSize: 13,
              lineHeight: 1.7,
              color: importMsg.tone === "ok" ? "#16a34a" : "#e11d48",
            }}
          >
            {importMsg.tone === "ok" ? "✅ " : "❌ "}
            {importMsg.text}
          </div>
        ) : null}
        {importWarnings.length > 0 ? (
          <ul style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: 12.5, color: "#b45309", lineHeight: 1.75 }}>
            {importWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}

        {catalogPhotos.length > 0 ? (
          <div className={styles.btnRow} style={{ marginTop: 12 }}>
            <button
              type="button"
              className={styles.btn}
              style={{ background: "transparent", color: CIS.textSub, borderColor: CIS.cardBorder }}
              onClick={addCatalogPhotos}
            >
              <Icon name="camera" size={15} />
              帶入型錄照片（{catalogPhotos.length} 張）
            </button>
            <span style={{ fontSize: 12.5, color: CIS.textMute }}>最多再帶到 {PHOTO_MAX} 張，會接在現有圖片後面</span>
          </div>
        ) : null}
      </section>

      {/* ── 手動填一筆 ── */}
      <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}` }}>
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          style={{
            all: "unset",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 15,
            fontWeight: 800,
            color: CIS.text,
            width: "100%",
          }}
        >
          <Icon name="edit" size={16} color={CIS.textMute} />
          手動填一筆（物件庫裡沒有的）
          <Icon name={manualOpen ? "chevronUp" : "chevronDown"} size={15} color={CIS.textMute} style={{ marginLeft: "auto" }} />
        </button>

        {manualOpen ? (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <div className={styles.field}>
              <label className={styles.label} style={{ color: CIS.textSub }}>
                這篇叫什麼（只有你看得到，用來在貼文庫裡找）
              </label>
              <input
                className={styles.input}
                style={inputStyle}
                value={mTitle}
                onChange={(e) => setMTitle(e.target.value)}
                placeholder="例：青安貸款懶人包"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} style={{ color: CIS.textSub }}>
                內文
              </label>
              <textarea
                className={styles.textarea}
                style={inputStyle}
                value={mBody}
                onChange={(e) => setMBody(e.target.value)}
                placeholder={"第一行是鉤子 —— 只回答一件事：讀者為什麼不能滑走。\nFB 只給前三行就折疊成「查看更多」。\n\n⚠️ 不要用 Markdown（** # []() `），FB 會原樣印出符號。"}
              />
              <div style={{ fontSize: 12, color: CIS.textMute }}>
                {mBody.length} 字　· 存檔時會自動附上經紀業名稱、也會檢查 Markdown 與外洩風險
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} style={{ color: CIS.textSub }}>
                照片（選填 —— 就在這裡編排，不用跑去物件庫）
              </label>
              <PhotoPicker
                value={mPhotos}
                onChange={setMPhotos}
                uploadEnabled={uploadEnabled}
                max={10}
                allowLocalPaths
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} style={{ color: CIS.textSub }}>
                影片（選填，一支就好）
              </label>
              <VideoPicker value={mVideo} onChange={setMVideo} uploadEnabled={uploadEnabled} />
            </div>

            <div className={styles.btnRow}>
              <button
                type="button"
                className={styles.btn}
                style={{ background: CIS.blue, color: "#fff" }}
                disabled={pending}
                onClick={fromManual}
              >
                <Icon name={pending ? "loading" : "save"} size={16} />
                {pending ? "存檔中…" : "存進貼文庫"}
              </button>
            </div>

            <p style={{ fontSize: 12.5, color: CIS.textMute, lineHeight: 1.75, margin: 0 }}>
              手動填的只有「一般貼文」版本，沒有 Marketplace 欄位（那些要結構化物件資料才組得出來）。
              照片、影片存好之後在貼文庫那則也還能改。
            </p>
          </div>
        ) : null}
      </section>
    </>
  );
}
