"use client";

/**
 * 台中海線旅遊地圖 —— MapLibre 版（不需要任何 API 金鑰）
 *
 * 為什麼用 MapLibre 不用 Google Maps：
 *   Google Maps 要申請金鑰、要綁信用卡；MapLibre 是開源的，底圖走 CARTO 的免費
 *   公開圖磚，本機跟正式站都不用設定任何金鑰就會動。
 *   ⚠️ 若日後流量變大，底圖建議改用付費圖磚，避免被免費服務限流。
 *
 * ⚠️ 三個踩過的坑（learning_地圖套件worker坑），改這個檔前先看一眼：
 *   1. maplibre-gl 6.x 沒有 default 匯出，且 worker 路徑要自己用 setWorkerUrl() 指，
 *      否則底圖永遠停在「載入中」。worker 檔由 scripts/sync-maplibre-worker.mjs 複製到 public/。
 *   2. 圖層要掛在 "style.load" 而不是 "load" —— load 一輩子只發生一次，
 *      初始底圖失敗時不會觸發，換備援底圖後圖層就補不回來。
 *   3. 中文字要靠 localIdeographFontFamily 用系統字型畫，否則得下載中文字型圖集，會很慢。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  SPOTS,
  ROUTES,
  AREAS,
  CATEGORY_META,
  CATEGORY_ORDER,
  MAP_CENTER,
  MAP_ZOOM,
  ORIGIN,
  straightLineKm,
  type Spot,
  type SpotCategory,
} from "./coastalSpots";
import styles from "./travel-map.module.css";

/** CARTO 免費公開向量底圖。抓不到時退回 OpenStreetMap 圖磚。 */
const CARTO_STYLE = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";
const OSM_FALLBACK_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

const SRC_SPOTS = "tm-spots";
const SRC_ROUTE = "tm-route";
const SRC_ORIGIN = "tm-origin";

export default function CoastalTravelMap() {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const popupRef = useRef<any>(null);
  /** 地圖的點擊事件只掛一次，要靠 ref 才拿得到最新的篩選結果 */
  const visibleRef = useRef<Spot[]>(SPOTS);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [routeId, setRouteId] = useState<string | null>(null);
  const [areaOn, setAreaOn] = useState<string | null>(null);
  const [catOn, setCatOn] = useState<Record<SpotCategory, boolean>>({
    nature: true,
    culture: true,
    family: true,
    view: true,
    food: true,
  });

  const activeRoute = useMemo(() => ROUTES.find((r) => r.id === routeId) ?? null, [routeId]);

  /** 選了路線就只看路線上的點（且照行程順序排），否則走一般篩選 */
  const visible = useMemo(() => {
    if (activeRoute) {
      return activeRoute.spotIds
        .map((id) => SPOTS.find((s) => s.id === id))
        .filter((s): s is Spot => Boolean(s));
    }
    const q = query.trim();
    return SPOTS.filter(
      (s) =>
        catOn[s.category] &&
        (!areaOn || s.area === areaOn) &&
        (!q || s.name.includes(q) || s.area.includes(q) || s.blurb.includes(q))
    );
  }, [activeRoute, query, catOn, areaOn]);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  const active = useMemo(() => SPOTS.find((s) => s.id === activeId) ?? null, [activeId]);

  const toGeoJson = useCallback(
    (list: Spot[]) => ({
      type: "FeatureCollection" as const,
      features: list.map((s, i) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [s.position.lng, s.position.lat] },
        properties: {
          id: s.id,
          name: s.name,
          color: CATEGORY_META[s.category].color,
          step: activeRoute ? String(i + 1) : "",
        },
      })),
    }),
    [activeRoute]
  );

  const routeGeoJson = useCallback(
    (list: Spot[]) => ({
      type: "FeatureCollection" as const,
      features: activeRoute
        ? [
            {
              type: "Feature" as const,
              geometry: {
                type: "LineString" as const,
                coordinates: list.map((s) => [s.position.lng, s.position.lat]),
              },
              properties: { color: activeRoute.color },
            },
          ]
        : [],
    }),
    [activeRoute]
  );

  /* ───────── 建立地圖（只跑一次） ───────── */
  useEffect(() => {
    let cancelled = false;
    let map: any = null;

    (async () => {
      // 6.x 是純 ESM，沒有 default 匯出，不能寫 .default
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !mapDivRef.current) return;

      // 一定要在 new Map 之前指路，否則 worker 會去抓網頁本身
      maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

      map = new maplibregl.Map({
        container: mapDivRef.current,
        style: CARTO_STYLE,
        center: [MAP_CENTER.lng, MAP_CENTER.lat],
        zoom: MAP_ZOOM,
        attributionControl: { compact: true },
        // 中文用系統字型畫，不必下載字型圖集
        localIdeographFontFamily: "'Noto Sans TC', 'Microsoft JhengHei', sans-serif",
      });
      mapRef.current = map;

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: "metric" }), "bottom-right");

      popupRef.current = new maplibregl.Popup({
        closeButton: false,
        offset: 14,
        maxWidth: "240px",
      });

      /** 圖層掛在 style.load：換備援底圖時會再觸發一次，圖層才補得回來 */
      const addLayers = () => {
        if (!map.getSource(SRC_SPOTS)) {
          map.addSource(SRC_SPOTS, { type: "geojson", data: toGeoJson(visibleRef.current) });
        }
        if (!map.getSource(SRC_ROUTE)) {
          map.addSource(SRC_ROUTE, { type: "geojson", data: routeGeoJson(visibleRef.current) });
        }
        if (!map.getSource(SRC_ORIGIN)) {
          map.addSource(SRC_ORIGIN, {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: { type: "Point", coordinates: [ORIGIN.lng, ORIGIN.lat] },
                  properties: { name: ORIGIN.name },
                },
              ],
            },
          });
        }

        if (!map.getLayer("tm-route-line")) {
          map.addLayer({
            id: "tm-route-line",
            type: "line",
            source: SRC_ROUTE,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": ["get", "color"],
              "line-width": 3.5,
              "line-opacity": 0.75,
              "line-dasharray": [2, 1.4],
            },
          });
        }
        if (!map.getLayer("tm-origin-dot")) {
          map.addLayer({
            id: "tm-origin-dot",
            type: "circle",
            source: SRC_ORIGIN,
            paint: {
              "circle-radius": 5,
              "circle-color": "#111827",
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
            },
          });
        }
        if (!map.getLayer("tm-spot-dot")) {
          map.addLayer({
            id: "tm-spot-dot",
            type: "circle",
            source: SRC_SPOTS,
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5, 12, 8, 15, 11],
              "circle-color": ["get", "color"],
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
              "circle-opacity": 0.92,
            },
          });
        }
        if (!map.getLayer("tm-spot-step")) {
          map.addLayer({
            id: "tm-spot-step",
            type: "symbol",
            source: SRC_SPOTS,
            layout: {
              "text-field": ["get", "step"],
              "text-size": 11,
              "text-allow-overlap": true,
            },
            paint: { "text-color": "#ffffff" },
          });
        }
        if (!map.getLayer("tm-spot-label")) {
          map.addLayer({
            id: "tm-spot-label",
            type: "symbol",
            source: SRC_SPOTS,
            layout: {
              "text-field": ["get", "name"],
              "text-size": 12,
              "text-offset": [0, 1.3],
              "text-anchor": "top",
              "text-max-width": 8,
            },
            paint: {
              "text-color": "#1f2937",
              "text-halo-color": "#ffffff",
              "text-halo-width": 1.6,
            },
          });
        }

        setStatus("ready");
      };

      map.on("style.load", addLayers);

      // 底圖抓不到（被擋、離線）就換 OSM 圖磚，style.load 會再觸發一次把圖層補回來
      map.on("error", (e: any) => {
        const msg = String(e?.error?.message ?? "");
        if (msg.includes("style") || msg.includes("Failed to fetch")) {
          try {
            map.setStyle(OSM_FALLBACK_STYLE as any);
          } catch {
            setStatus("error");
          }
        }
      });

      const hit = (e: any) => {
        const f = e.features?.[0];
        if (!f) return;
        setActiveId(f.properties.id);
      };
      map.on("click", "tm-spot-dot", hit);
      map.on("mouseenter", "tm-spot-dot", (e: any) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        const s = visibleRef.current.find((x) => x.id === f?.properties?.id);
        if (!s) return;
        popupRef.current
          .setLngLat([s.position.lng, s.position.lat])
          .setHTML(
            '<div class="tmPopup"><div class="tmPopupName">' +
              s.name +
              '</div><div class="tmPopupMeta">' +
              CATEGORY_META[s.category].icon +
              " " +
              CATEGORY_META[s.category].label +
              "・" +
              s.area +
              "</div></div>"
          )
          .addTo(map);
      });
      map.on("mouseleave", "tm-spot-dot", () => {
        map.getCanvas().style.cursor = "";
        popupRef.current?.remove();
      });

      // 開發時方便在主控台檢查：window.__travelMap.getStyle().layers.length
      if (process.env.NODE_ENV !== "production") {
        (window as any).__travelMap = map;
      }
    })().catch(() => {
      if (!cancelled) setStatus("error");
    });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // 只建立一次；資料更新走下面的 setData
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ───────── 篩選變了就換資料，不重建地圖 ───────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    map.getSource(SRC_SPOTS)?.setData(toGeoJson(visible));
    map.getSource(SRC_ROUTE)?.setData(routeGeoJson(visible));
  }, [visible, status, toGeoJson, routeGeoJson]);

  /* 選了路線 → 把整條路線框進畫面 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !activeRoute || visible.length === 0) return;
    const lats = visible.map((s) => s.position.lat);
    const lngs = visible.map((s) => s.position.lng);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 70, duration: 700, maxZoom: 13.5 }
    );
  }, [activeRoute, visible, status]);

  /* 點清單 → 飛過去 */
  const focus = useCallback((s: Spot) => {
    setActiveId(s.id);
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [s.position.lng, s.position.lat], zoom: 14.2, duration: 800 });
  }, []);

  const toggleCat = (c: SpotCategory) => {
    setRouteId(null);
    setCatOn((prev) => ({ ...prev, [c]: !prev[c] }));
  };

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <p className={styles.kicker}>台中海線</p>
        <h1 className={styles.title}>海線旅遊地圖</h1>
        <p className={styles.lede}>
          從大安溪口到大肚山，{SPOTS.length} 個景點、{ROUTES.length} 條現成路線。點地圖上的圓點或清單看細節，
          每一個都附 Google 地圖導航。座標全部逐一查證過，概略位置的點會另外標明。
        </p>
      </header>

      <div className={styles.body}>
        {/* ─── 左側：詳情 or 篩選＋清單 ─── */}
        <aside className={styles.panel}>
          {active ? (
            <SpotDetail spot={active} onBack={() => setActiveId(null)} />
          ) : (
            <div className={styles.panelScroll}>
              <div className={styles.section}>
                <input
                  className={styles.search}
                  placeholder="搜尋景點、行政區、關鍵字"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setRouteId(null);
                  }}
                />
              </div>

              <div className={styles.section}>
                <p className={styles.sectionTitle}>現成路線</p>
                {ROUTES.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`${styles.routeBtn} ${routeId === r.id ? styles.routeOn : ""}`}
                    style={routeId === r.id ? { color: r.color } : undefined}
                    onClick={() => setRouteId(routeId === r.id ? null : r.id)}
                  >
                    <span className={styles.routeName}>
                      <span className={styles.routeBar} style={{ background: r.color }} />
                      <span style={{ color: "var(--tm-text)" }}>{r.name}</span>
                    </span>
                    <p className={styles.routeSummary}>{r.summary}</p>
                  </button>
                ))}
              </div>

              <div className={styles.section}>
                <p className={styles.sectionTitle}>類型</p>
                <div className={styles.chips}>
                  {CATEGORY_ORDER.map((c) => {
                    const m = CATEGORY_META[c];
                    const on = catOn[c] && !activeRoute;
                    return (
                      <button
                        key={c}
                        type="button"
                        className={`${styles.chip} ${on ? styles.chipOn : ""}`}
                        style={on ? { background: m.color } : undefined}
                        onClick={() => toggleCat(c)}
                      >
                        <span className={styles.dot} style={{ background: on ? "#fff" : m.color }} />
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={styles.section}>
                <p className={styles.sectionTitle}>行政區</p>
                <div className={styles.chips}>
                  {AREAS.map((a) => {
                    const on = areaOn === a && !activeRoute;
                    return (
                      <button
                        key={a}
                        type="button"
                        className={`${styles.chip} ${on ? styles.chipOn : ""}`}
                        style={on ? { background: "var(--tm-accent)" } : undefined}
                        onClick={() => {
                          setRouteId(null);
                          setAreaOn(areaOn === a ? null : a);
                        }}
                      >
                        {a}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={styles.section} style={{ paddingBottom: 0 }}>
                <p className={styles.sectionTitle}>
                  {activeRoute ? `${activeRoute.name}・依序` : "景點"}{" "}
                  <span className={styles.count}>{visible.length} 個</span>
                </p>
              </div>
              <ul className={styles.list}>
                {visible.map((s, i) => (
                  <li key={s.id}>
                    <button type="button" className={styles.item} onClick={() => focus(s)}>
                      {activeRoute ? (
                        <span
                          className={styles.stepNo}
                          style={{ background: activeRoute.color }}
                        >
                          {i + 1}
                        </span>
                      ) : (
                        <span className={styles.itemIcon}>{CATEGORY_META[s.category].icon}</span>
                      )}
                      <span>
                        <p className={styles.itemName}>{s.name}</p>
                        <p className={styles.itemMeta}>
                          {s.area}
                          {s.stay ? `・停留 ${s.stay}` : ""}
                        </p>
                      </span>
                    </button>
                  </li>
                ))}
                {visible.length === 0 && (
                  <li>
                    <p className={styles.itemMeta} style={{ padding: "16px" }}>
                      沒有符合的景點，把類型全部打開或清掉搜尋字試試。
                    </p>
                  </li>
                )}
              </ul>
            </div>
          )}
        </aside>

        {/* ─── 右側：地圖 ─── */}
        <div className={styles.mapCard}>
          <div ref={mapDivRef} className={styles.map} />
          {status !== "ready" && (
            <div className={styles.overlay}>
              {status === "loading"
                ? "地圖載入中…"
                : "地圖載入失敗。請重新整理頁面；若持續失敗，可能是底圖服務暫時無法連線。"}
            </div>
          )}
          {status === "ready" && (
            <div className={styles.legend}>
              {CATEGORY_ORDER.map((c) => (
                <span key={c} className={styles.legendItem}>
                  <span className={styles.dot} style={{ background: CATEGORY_META[c].color }} />
                  {CATEGORY_META[c].label}
                </span>
              ))}
              <span className={styles.legendItem}>
                <span className={styles.dot} style={{ background: "#111827" }} />
                {ORIGIN.name}
              </span>
            </div>
          )}
        </div>
      </div>

      <p className={styles.foot}>
        景點座標以 OpenStreetMap 官方查詢服務逐一比對（2026-09-02），標示為「概略位置」者為所在里的中心點，
        導航請以景點名稱搜尋為準。開放時間、票價、花況與潮汐管制隨季節與年度調整，出發前請再確認官方公告。
        底圖 ©{" "}
        <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">
          CARTO
        </a>{" "}
        ・ ©{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>{" "}
        contributors
      </p>
    </div>
  );
}

/* ───────── 景點詳情 ───────── */
function SpotDetail({ spot, onBack }: { spot: Spot; onBack: () => void }) {
  const m = CATEGORY_META[spot.category];
  const km = straightLineKm(ORIGIN, spot.position);
  /** 概略位置的點用「名稱搜尋」而不是座標導航，免得把人載到里辦公室 */
  const navUrl = spot.precise
    ? `https://www.google.com/maps/dir/?api=1&destination=${spot.position.lat},${spot.position.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        spot.name + " " + spot.area
      )}`;

  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <div>
          <h2 className={styles.detailName}>
            {m.icon} {spot.name}
          </h2>
          <span className={styles.badge} style={{ background: m.color }}>
            {m.label}
          </span>{" "}
          <span className={styles.areaTag}>{spot.area}</span>
        </div>
        <button type="button" className={styles.backBtn} onClick={onBack}>
          ← 全部景點
        </button>
      </div>

      <p className={styles.blurb}>{spot.blurb}</p>

      <div className={styles.factRow}>
        {spot.stay && <span className={styles.fact}>建議停留 {spot.stay}</span>}
        {spot.best && <span className={styles.fact}>最佳時段 {spot.best}</span>}
        <span className={styles.fact}>距梧棲市區 約 {km.toFixed(1)} 公里（直線）</span>
      </div>

      {spot.tip && <p className={styles.tip}>💡 {spot.tip}</p>}

      {!spot.precise && (
        <p className={styles.warn}>
          ⚠️ 這個點是概略位置（查到的是所在里的中心，不是景點門口，誤差可能數百公尺）。
          下面的按鈕會用景點名稱搜尋，不會直接用這個座標導航。
        </p>
      )}

      <a className={styles.navBtn} href={navUrl} target="_blank" rel="noreferrer">
        📍 用 Google 地圖{spot.precise ? "導航" : "搜尋"}
      </a>
    </div>
  );
}
