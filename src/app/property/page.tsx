import type { Metadata } from "next";
import Link from "next/link";
import {
  listPublicProperties,
  propertyTypeLabel,
  DISTRICTS,
  type PropertyRow,
} from "@/lib/property";
import { directImageUrl, parseImageList } from "@/lib/media-url";
import { OWNER, SITE_URL } from "@/config/owner";
import SiteNav from "../_components/SiteNav";
import styles from "./property.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `物件精選｜${OWNER.brandPersona}`,
  description: `${OWNER.title}｜台中海線梧棲、清水、沙鹿、龍井房屋土地買賣，精選在售物件。`,
  alternates: { canonical: `${SITE_URL.replace(/\/$/, "")}/property` },
};

type SearchParams = { district?: string };

export default async function PropertyListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const district = sp.district && DISTRICTS.includes(sp.district as never) ? sp.district : "all";
  const properties = await listPublicProperties({ district });

  // 篩選列只列出「真的有物件」的區域，免得客戶點進空的分類。
  const allForChips = district === "all" ? properties : await listPublicProperties();
  const activeDistricts = DISTRICTS.filter((d) => allForChips.some((p) => p.district === d));

  return (
    <div className={styles.page}>
      {/* 2026-08-24 換成全站共用導覽。原本這裡是一條只有品牌名的簡易頂欄，
          客戶進到物件列表後就沒有任何路徑回到委託賣房／工具，只能按上一頁。 */}
      <SiteNav />

      <div className={styles.shell}>
        <div className={styles.listHead}>
          <h1 className={styles.listTitle}>物件精選</h1>
          <p className={styles.listSub}>
            台中海線在售物件，共 {properties.length} 件。點進去有完整照片、影片與說明。
          </p>
        </div>

        {activeDistricts.length > 1 ? (
          <div className={styles.filterRow}>
            <Link
              href="/property"
              className={`${styles.filterChip} ${district === "all" ? styles.filterChipActive : ""}`}
            >
              全部
            </Link>
            {activeDistricts.map((d) => (
              <Link
                key={d}
                href={`/property?district=${encodeURIComponent(d)}`}
                className={`${styles.filterChip} ${district === d ? styles.filterChipActive : ""}`}
              >
                {d}
              </Link>
            ))}
          </div>
        ) : null}

        {properties.length === 0 ? (
          <div className={styles.emptyList}>
            這個分類目前沒有物件。
            <br />
            想找的條件可以直接告訴{OWNER.alias}，有符合的第一時間通知你。
            <br />
            <br />
            <a href={`tel:${OWNER.phoneRaw}`} className={`${styles.btn} ${styles.btnPrimary}`}>
              撥打 {OWNER.phone}
            </a>
          </div>
        ) : (
          <div className={styles.cardGrid}>
            {properties.map((p: PropertyRow) => {
              const cover = p.cover_url ? directImageUrl(p.cover_url) : parseImageList(p.photo_urls)[0];
              const meta = [p.district, propertyTypeLabel(p), p.layout, p.floor_info, p.parking]
                .filter(Boolean)
                .join("．");
              return (
                <Link key={p.id} href={`/property/${p.slug}`} className={styles.card}>
                  {cover ? (
                    <div className={styles.cardCover}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={cover} alt={p.title} loading="lazy" />
                    </div>
                  ) : (
                    <div className={styles.cardNoPhoto}>照片整理中</div>
                  )}
                  <div className={styles.cardBody}>
                    <div className={styles.cardPrice}>
                      {p.price ? `${p.price} 萬` : "價格請洽詢"}
                    </div>
                    <div className={styles.cardTitle}>{p.headline?.trim() || p.title}</div>
                    {meta ? <div className={styles.cardMeta}>{meta}</div> : null}
                    {p.status === "reserved" ? (
                      <span className={styles.cardBadge}>已有斡旋</span>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <div className={styles.footer}>
          {OWNER.brandPersona}・{OWNER.name}｜{OWNER.company}
          <br />
          {OWNER.address}
          <br />
          <Link href="/card" style={{ color: "inherit" }}>
            數位名片
          </Link>
          {"　"}
          <Link href="/card/booking" style={{ color: "inherit" }}>
            線上預約
          </Link>
        </div>
      </div>
    </div>
  );
}
