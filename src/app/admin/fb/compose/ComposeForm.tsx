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
