import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminCheckArgs, isCurrentUserAdmin } from "@/lib/admin-check";
import {
  listProperties,
  propertyStats,
  propertyTypeLabel,
  statusLabel,
  PROPERTY_STATUSES,
  DISTRICTS,
  type PropertyQueue,
  type PropertyRow,
} from "@/lib/property";
import { directImageUrl, parseImageList, parseVideoList } from "@/lib/media-url";
import { CIS, CHIP, type ChipTone } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import styles from "../customers/customers.module.css";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  status?: string;
  district?: string;
  queue?: string;
};

const QUEUES: Array<{ key: PropertyQueue; label: string; icon: Parameters<typeof Icon>[0]["name"] }> = [
  { key: "all", label: "全部物件", icon: "home" },
  { key: "published", label: "上架中", icon: "globe" },
  { key: "draft", label: "草稿／下架", icon: "edit" },
  { key: "closed", label: "已成交", icon: "success" },
];

function statusTone(status: string): ChipTone {
  if (status === "published") return "success";
  if (status === "reserved") return "warn";
  if (status === "sold") return "info";
  return "neutral";
}

/** 卡片上顯示「照片 N ・ 影片 N」，一眼看出哪些物件還沒補素材。 */
function mediaCount(row: PropertyRow): { photos: number; videos: number } {
  const photos = parseImageList(row.photo_urls).length + (row.cover_url ? 1 : 0);
  return { photos, videos: parseVideoList(row.video_urls).length };
}

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { email } = await getAdminCheckArgs();
  if (!email) redirect("/api/auth/signin?callbackUrl=%2Fadmin%2Fproperties");
  if (!(await isCurrentUserAdmin())) throw new Error("權限不足");

  const sp = await searchParams;
  const queue = QUEUES.some((item) => item.key === sp.queue) ? (sp.queue as PropertyQueue) : "all";
  const status = sp.status || "all";
  const district = sp.district || "all";
  const search = sp.q || "";

  const [properties, stats] = await Promise.all([
    listProperties({ queue, status, district, search }),
    propertyStats(),
  ]);

  return (
    <main className={styles.page} style={{ background: CIS.bg, color: CIS.text, fontFamily: CIS.font }}>
      <div className={styles.shell}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>
              <Icon name="building" size={26} />
              房屋物件
            </h1>
            <p className={styles.subtitle} style={{ color: CIS.textSub }}>
              共 {stats.total} 件　上架中 {stats.published}　草稿／下架 {stats.draft}　已成交 {stats.sold}
              {stats.views > 0 ? `　累計瀏覽 ${stats.views}` : ""}
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link
              href="/property"
              target="_blank"
              className={styles.button}
              style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
            >
              <Icon name="externalLink" size={15} />
              看公開頁
            </Link>
            <Link
              href="/admin/sellers"
              className={styles.button}
              style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
            >
              屋主客戶
            </Link>
            <Link
              href="/admin/calendar"
              className={styles.button}
              style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
            >
              <Icon name="calendar" size={15} />
              行事曆
            </Link>
            <Link
              href="/admin/properties/new"
              className={styles.button}
              style={{ background: CIS.blue, color: "#fff" }}
            >
              <Icon name="add" size={16} />
              新增物件
            </Link>
          </div>
        </div>

        <form className={styles.toolbar} method="get">
          <input type="hidden" name="queue" value={queue} />
          <div className={styles.searchWrap}>
            <Icon name="search" size={16} color={CIS.textMute} />
            <input
              className={styles.searchInput}
              style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text }}
              type="text"
              name="q"
              defaultValue={search}
              placeholder="搜尋標題／地址／社區／短碼"
            />
          </div>
          <select
            name="status"
            defaultValue={status}
            className={styles.select}
            style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text }}
          >
            <option value="all">全部狀態</option>
            {PROPERTY_STATUSES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <select
            name="district"
            defaultValue={district}
            className={styles.select}
            style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text }}
          >
            <option value="all">全部區域</option>
            {DISTRICTS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <button type="submit" className={styles.button} style={{ background: CIS.blueDeep, color: "#fff" }}>
            <Icon name="search" size={15} />
            搜尋
          </button>
        </form>

        <div className={styles.queueTabs}>
          {QUEUES.map((item) => {
            const active = item.key === queue;
            return (
              <Link
                key={item.key}
                href={`/admin/properties?queue=${item.key}`}
                className={styles.tab}
                style={{
                  background: active ? CIS.blue : "rgba(255,255,255,0.05)",
                  color: active ? "#fff" : CIS.textSub,
                  border: `1px solid ${active ? CIS.blue : CIS.cardBorder}`,
                }}
              >
                <Icon name={item.icon} size={14} />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className={styles.list}>
          {properties.length === 0 ? (
            <div className={styles.empty} style={{ borderColor: CIS.cardBorder, color: CIS.textMute }}>
              還沒有物件。點右上角「新增物件」開始第一件。
            </div>
          ) : (
            properties.map((p: PropertyRow) => {
              const cover = p.cover_url ? directImageUrl(p.cover_url) : parseImageList(p.photo_urls)[0];
              const media = mediaCount(p);
              const typeText = propertyTypeLabel(p);
              return (
                <Link
                  key={p.id}
                  href={`/admin/properties/${p.id}`}
                  className={styles.card}
                  style={{ background: CIS.card, borderColor: CIS.cardBorder, color: CIS.text }}
                >
                  <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                    {cover ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={cover}
                        alt=""
                        style={{
                          width: 116,
                          height: 84,
                          flexShrink: 0,
                          objectFit: "cover",
                          borderRadius: 8,
                          border: `1px solid ${CIS.cardBorder}`,
                          background: CIS.bgSoft,
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 116,
                          height: 84,
                          flexShrink: 0,
                          borderRadius: 8,
                          border: `1px dashed ${CIS.cardBorder}`,
                          background: CIS.bgSoft,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: CIS.textMute,
                          fontSize: 12,
                        }}
                      >
                        沒有照片
                      </div>
                    )}

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className={styles.cardHeader}>
                        <div style={{ minWidth: 0 }}>
                          <div className={styles.identity}>{p.title}</div>
                          <div style={{ color: CIS.textMute, fontSize: 14, marginTop: 3 }}>
                            {[p.district, typeText, p.layout, p.floor_info, p.parking]
                              .filter(Boolean)
                              .join("．")}
                          </div>
                        </div>
                        <div className={styles.chips}>
                          <span
                            className={styles.chip}
                            style={{
                              background: CHIP[statusTone(p.status)].bg,
                              color: CHIP[statusTone(p.status)].color,
                              borderColor: CHIP[statusTone(p.status)].border,
                            }}
                          >
                            {statusLabel(p.status)}
                          </span>
                        </div>
                      </div>

                      <div
                        style={{
                          marginTop: 8,
                          display: "flex",
                          gap: 14,
                          flexWrap: "wrap",
                          alignItems: "center",
                          fontSize: 14,
                          color: CIS.textSub,
                        }}
                      >
                        {p.price ? (
                          <span style={{ color: CIS.yellow, fontWeight: 900, fontSize: 17 }}>
                            {p.price} 萬
                          </span>
                        ) : (
                          <span style={{ color: CIS.textMute }}>未定價</span>
                        )}
                        <span style={{ color: CIS.textMute }}>
                          <Icon name="image" size={13} /> {media.photos}
                          {"　"}
                          <Icon name="video" size={13} /> {media.videos}
                        </span>
                        <span style={{ color: CIS.textMute }}>
                          <Icon name="eye" size={13} /> {p.view_count}
                        </span>
                        <code style={{ color: CIS.textMute, fontSize: 13 }}>/property/{p.slug}</code>
                      </div>

                      {p.headline ? (
                        <div style={{ marginTop: 7, fontSize: 15, color: CIS.text }}>{p.headline}</div>
                      ) : null}
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}
