import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getPublicPropertyBySlug,
  incrementPropertyView,
  propertyTypeLabel,
  type PropertyRow,
} from "@/lib/property";
import { directImageUrl, parseImageList, parseVideoList } from "@/lib/media-url";
import { OWNER, SOCIAL, SITE_URL } from "@/config/owner";
import VideoPlayer from "../VideoPlayer";
import styles from "../property.module.css";

export const dynamic = "force-dynamic";

/* ────────────────── 顯示用小工具 ────────────────── */

/** 坪數欄位是字串（資料層把 Decimal 轉掉了），這裡轉回數字才好算。 */
function ping(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pingText(value: string | null): string | null {
  const n = ping(value);
  if (n == null) return null;
  // 32.00 顯示成 32，32.55 保留兩位
  return `${Number.isInteger(n) ? n : n.toFixed(2)} 坪`;
}

/** 公開頁顯示的位置：優先用「公開顯示位置」，沒填就只給區域，絕不漏門牌。 */
function publicLocation(p: PropertyRow): string {
  if (p.address_public?.trim()) return p.address_public.trim();
  return p.district ? `台中市${p.district}區` : "";
}

function lines(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ────────────────── 分享預覽（LINE／FB 貼連結時的卡片） ────────────────── */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const p = await getPublicPropertyBySlug(slug);
  if (!p) return { title: "找不到這個物件" };

  const location = publicLocation(p);
  const title = p.headline?.trim() || `${p.price ? `${p.price}萬｜` : ""}${p.title}`;
  const description = [
    p.price ? `總價 ${p.price} 萬` : null,
    p.layout,
    pingText(p.size_ping),
    p.floor_info,
    p.parking,
    location,
  ]
    .filter(Boolean)
    .join("．");

  const cover = p.cover_url ? directImageUrl(p.cover_url) : parseImageList(p.photo_urls)[0];
  const url = `${SITE_URL.replace(/\/$/, "")}/property/${p.slug}`;

  return {
    title: `${title}｜${OWNER.brandPersona}`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      images: cover ? [{ url: cover }] : undefined,
    },
  };
}

/* ────────────────── 頁面 ────────────────── */

export default async function PropertyPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const p = await getPublicPropertyBySlug(slug);
  if (!p) notFound();

  await incrementPropertyView(p.id);

  const photos = [
    ...(p.cover_url ? [directImageUrl(p.cover_url)] : []),
    ...parseImageList(p.photo_urls),
  ].filter((url, i, arr) => arr.indexOf(url) === i);
  const videos = parseVideoList(p.video_urls);
  const highlightList = lines(p.highlights);
  const location = publicLocation(p);
  const typeText = propertyTypeLabel(p);

  const registered = ping(p.size_ping);
  const mainBuilding = ping(p.main_building_ping);
  const bookingUrl = "/card/booking";

  const specs: Array<{ label: string; value: string }> = [
    { label: "格局", value: p.layout || "" },
    { label: "建物登記", value: pingText(p.size_ping) || "" },
    { label: "主建物", value: pingText(p.main_building_ping) || "" },
    { label: "土地", value: pingText(p.land_ping) || "" },
    { label: "樓層", value: p.floor_info || "" },
    { label: "屋齡", value: p.age_years != null ? `${p.age_years} 年` : "" },
    { label: "車位", value: p.parking || "" },
    { label: "朝向", value: p.direction || "" },
    { label: "類型", value: typeText },
    { label: "社區", value: p.community || "" },
    { label: "建設公司", value: p.builder || "" },
  ].filter((s) => s.value);

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <div className={styles.topbarInner}>
          <Link href="/" className={styles.brandLink}>
            {OWNER.brandPersona}
          </Link>
          <span className={styles.topbarSub}>{OWNER.title}</span>
        </div>
      </div>

      {p.status === "reserved" ? (
        <div className={`${styles.statusBanner} ${styles.statusReserved}`}>
          這間目前已有買方下斡旋，仍可預約看屋排候補
        </div>
      ) : null}
      {p.status === "sold" ? (
        <div className={`${styles.statusBanner} ${styles.statusSold}`}>
          這間已經成交了。想找類似條件的物件，歡迎直接與{OWNER.alias}聯絡
        </div>
      ) : null}

      {/* ---- 照片 ---- */}
      {photos.length > 0 ? (
        <>
          <div className={styles.gallery}>
            {photos.map((url, i) => (
              <div className={styles.galleryItem} key={`${url}-${i}`}>
                {/* 這裡刻意不用 loading="lazy"（2026-08-23 實測）：
                    瀏覽器的 lazy 判定是看「圖片有沒有進入 document viewport」，
                    橫向 scroll container 內部的捲動不會重新觸發它 ——
                    實測第 2 張之後就算滑到畫面正中央也永遠停在未載入狀態，
                    客戶滑過去只會看到一片空白。照片是這頁的主角，寧可一次載好。
                    只有第一張標成高優先，其餘讓瀏覽器自己排隊。 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`${p.title} 照片 ${i + 1}`}
                  decoding="async"
                  fetchPriority={i === 0 ? "high" : "auto"}
                />
              </div>
            ))}
          </div>
          {photos.length > 1 ? (
            <div className={styles.galleryHint}>← 左右滑看更多照片（共 {photos.length} 張）</div>
          ) : null}
        </>
      ) : (
        <div className={styles.noPhoto}>照片整理中</div>
      )}

      <div className={styles.shell}>
        {/* ---- 標題 ---- */}
        <div className={styles.head}>
          <h1 className={styles.headline}>{p.headline?.trim() || p.title}</h1>
          {p.headline?.trim() ? <p className={styles.title}>{p.title}</p> : null}
          {location ? <div className={styles.locationRow}>📍 {location}</div> : null}
        </div>

        {/* ---- 總價 ---- */}
        <div className={styles.priceRow}>
          {p.price ? (
            <>
              <span className={styles.price}>{p.price}</span>
              <span className={styles.priceUnit}>萬</span>
            </>
          ) : (
            <span className={styles.priceAsk}>價格請洽詢</span>
          )}
          {p.price_note ? <span className={styles.priceNote}>{p.price_note}</span> : null}
        </div>

        {/* ---- 規格 ---- */}
        {specs.length > 0 ? (
          <div className={styles.specGrid}>
            {specs.map((s) => (
              <div className={styles.specCell} key={s.label}>
                <div className={styles.specLabel}>{s.label}</div>
                <div className={styles.specValue}>{s.value}</div>
              </div>
            ))}
          </div>
        ) : null}

        {/* 房仲語言 → 客戶語言：登記坪數不等於實際能用的空間，直接替客戶算清楚 */}
        {registered && mainBuilding && mainBuilding < registered ? (
          <div className={styles.spaceHint}>
            登記 <strong>{registered} 坪</strong> 裡面，真正的室內空間（主建物）是{" "}
            <strong>{mainBuilding} 坪</strong>，
            其餘 {(registered - mainBuilding).toFixed(2)} 坪是陽台、雨遮與公共設施分攤的部分。
            實際走進去的感覺以主建物為準，看屋時可以直接對照。
          </div>
        ) : null}

        {/* ---- 核心賣點 ---- */}
        {highlightList.length > 0 ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>這間的重點</h2>
            <ul className={styles.highlights}>
              {highlightList.map((item) => (
                <li className={styles.highlightItem} key={item}>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ---- 影片 ---- */}
        {videos.length > 0 ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>影片看屋</h2>
            <div className={styles.videoList}>
              {videos.map((v, i) => (
                <VideoPlayer
                  key={v.src}
                  src={v.src}
                  thumbUrl={v.thumbUrl}
                  title={`${p.title} 影片 ${i + 1}`}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* ---- 完整文案 ---- */}
        {p.description?.trim() ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>物件介紹</h2>
            <div className={styles.prose}>{p.description.trim()}</div>
          </section>
        ) : null}

        {/* ---- 適合誰 ---- */}
        {p.suitable_for?.trim() ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>適合誰</h2>
            <div className={styles.prose}>{p.suitable_for.trim()}</div>
          </section>
        ) : null}

        {/* ---- 生活機能 ---- */}
        {p.life_info?.trim() ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>生活機能</h2>
            <div className={styles.prose}>{p.life_info.trim()}</div>
          </section>
        ) : null}

        {/* ---- 交通與建設 ---- */}
        {p.transport_info?.trim() ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>交通與重大建設</h2>
            <div className={styles.prose}>{p.transport_info.trim()}</div>
          </section>
        ) : null}

        {/* ---- CTA ---- */}
        <div className={styles.ctaBlock}>
          <h2 className={styles.ctaTitle}>想看這間房子？</h2>
          <p className={styles.ctaSub}>
            線上選時段就好，{OWNER.alias}會親自帶看並回覆你想確認的細節。
          </p>
          <div className={styles.ctaButtons}>
            <Link href={bookingUrl} className={`${styles.btn} ${styles.btnPrimary}`}>
              預約看屋
            </Link>
            <a href={`tel:${OWNER.phoneRaw}`} className={`${styles.btn} ${styles.btnGhost}`}>
              撥打 {OWNER.phone}
            </a>
            {SOCIAL.line ? (
              <a
                href={SOCIAL.line}
                target="_blank"
                rel="noreferrer"
                className={`${styles.btn} ${styles.btnLine}`}
              >
                LINE 詢問
              </a>
            ) : null}
          </div>
        </div>

        <p className={styles.disclaimer}>
          本頁物件資訊由{OWNER.company}
          提供，坪數、屋齡、格局等以地政機關登記與現場實況為準；
          價格與銷售狀態可能隨時調整，正式條件以買賣雙方簽訂之契約為準。
          若頁面資訊與現況有出入，請以現場說明為主，並歡迎直接與{OWNER.alias}確認。
        </p>

        <div className={styles.footer}>
          {OWNER.brandPersona}・{OWNER.name}｜{OWNER.company}
          <br />
          <Link href="/property" style={{ color: "inherit" }}>
            看其他物件
          </Link>
          {"　"}
          <Link href="/card" style={{ color: "inherit" }}>
            數位名片
          </Link>
        </div>
      </div>

      {/* 手機底部固定行動列 */}
      <div className={styles.stickyBar}>
        <Link href={bookingUrl} className={`${styles.btn} ${styles.btnPrimary}`}>
          預約看屋
        </Link>
        <a href={`tel:${OWNER.phoneRaw}`} className={`${styles.btn} ${styles.btnLine}`}>
          直接撥打
        </a>
      </div>
    </div>
  );
}
