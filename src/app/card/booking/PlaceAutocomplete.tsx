"use client";

/**
 * PlaceAutocomplete — 客戶自訂見面地點輸入（2026-06-25）
 *
 * Google 2025-03 起對「新專案」移除經典版 google.maps.places.Autocomplete（undefined）,
 * 改用新版 <gmp-place-autocomplete>（PlaceAutocompleteElement / Places API New）。
 * 此版用 React 託管 JSX 渲染該自訂元素（不再 imperative appendChild,避免 ref/timing bug）。
 *
 * 有 NEXT_PUBLIC_GOOGLE_MAPS_KEY → Google 地點搜尋（限台灣）+ 小地圖 + 手動備案;
 * 沒 key → 只剩手動純文字框。onChange 一律回 MeetLocation | null。
 */
import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react";
import type { MeetLocation } from "@/lib/appointment-constants";

// 新版自訂元素 <gmp-place-autocomplete>;用 any 當 tag 避開 JSX.IntrinsicElements 型別
// (各 @types/react 版本 global JSX vs React.JSX 不一致,直接繞過最穩)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GmpPlaceAutocomplete = "gmp-place-autocomplete" as any;

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "";

// 模組層只載一次 Maps JS
let mapsPromise: Promise<boolean> | null = null;
function loadMaps(key: string): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).google?.maps) return Promise.resolve(true);
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise<boolean>((resolve) => {
    const s = document.createElement("script");
    s.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      `&libraries=places&language=zh-TW&region=TW&loading=async`;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return mapsPromise;
}

export default function PlaceAutocomplete({
  value,
  onChange,
  inputStyle,
}: {
  value: MeetLocation | null;
  onChange: (loc: MeetLocation | null) => void;
  inputStyle: CSSProperties;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [manual, setManual] = useState(value?.source === "manual" ? value.name : "");
  const onChangeRef = useRef(onChange);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elRef = useRef<any>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // 載 Maps JS + places library，ready 後才渲染 <gmp-place-autocomplete>（確保已註冊為自訂元素）
  useEffect(() => {
    if (!MAPS_KEY) return;
    let cancelled = false;
    loadMaps(MAPS_KEY).then(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).google;
      if (!g?.maps) return;
      if (!g.maps.places?.PlaceAutocompleteElement && g.maps.importLibrary) {
        try {
          await g.maps.importLibrary("places");
        } catch {
          /* importLibrary 失敗仍嘗試渲染 */
        }
      }
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ref callback：元素掛進 DOM 後設限台灣 + 綁選取事件
  const attachEl = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el: any) => {
      if (!el || el === elRef.current) return;
      elRef.current = el;
      try {
        el.includedRegionCodes = ["tw"];
      } catch {
        /* 屬性設定失敗就不限地區，不影響功能 */
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onSelect = async (ev: any) => {
        const pred = ev.placePrediction;
        const place = pred ? pred.toPlace() : ev.place;
        if (!place) return;
        try {
          await place.fetchFields({ fields: ["displayName", "formattedAddress", "location", "id"] });
        } catch {
          /* 抓欄位失敗仍用現有 */
        }
        const loc = place.location;
        const lat = typeof loc?.lat === "function" ? loc.lat() : loc?.lat;
        const lng = typeof loc?.lng === "function" ? loc.lng() : loc?.lng;
        setManual("");
        onChangeRef.current({
          name: String(place.displayName || place.formattedAddress || "").slice(0, 120),
          address: String(place.formattedAddress || "").slice(0, 200),
          lat: typeof lat === "number" ? lat : null,
          lng: typeof lng === "number" ? lng : null,
          placeId: place.id || place.placeId || null,
          source: "google",
        });
      };
      // 新版事件 gmp-select;舊 beta 是 gmp-placeselect,兩個都聽以防萬一
      el.addEventListener("gmp-select", onSelect);
      el.addEventListener("gmp-placeselect", onSelect);
    },
    [],
  );

  // 小地圖預覽（有座標才畫）
  useEffect(() => {
    if (!loaded || !mapRef.current || value?.lat == null || value?.lng == null) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).google;
    if (!g?.maps) return;
    const center = { lat: value.lat, lng: value.lng };
    const map = new g.maps.Map(mapRef.current, {
      center,
      zoom: 16,
      disableDefaultUI: true,
      gestureHandling: "none",
      keyboardShortcuts: false,
    });
    new g.maps.Marker({ position: center, map });
  }, [loaded, value?.lat, value?.lng]);

  // 手動備案
  const handleManual = (v: string) => {
    setManual(v);
    const t = v.trim();
    if (!t) {
      if (value?.source === "manual") onChange(null);
      return;
    }
    onChange({ name: t.slice(0, 120), address: "", lat: null, lng: null, placeId: null, source: "manual" });
  };

  const hasCoords = value?.lat != null && value?.lng != null;

  return (
    <div>
      {/* Google 地點搜尋（新版自訂元素，自帶輸入框，限台灣）*/}
      {loaded ? (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 13, color: "#5A7A8C", marginBottom: 6, lineHeight: 1.5, fontWeight: 600 }}>
            🔍 在下方框輸入「地址 / 社區 / 店名」,再從跳出的清單點選你要約的地方
          </div>
          {/* ⚠️ 2026-06-26 修壞掉:新版 <gmp-place-autocomplete> 的下拉建議清單是絕對定位、
              渲染在輸入框「外面下方」。外層若 overflow:hidden(原本為了切圓角)會把整個下拉清單裁掉,
              客戶打字看不到任何建議 → 功能等於壞了。改 overflow:visible 讓清單能溢出顯示。*/}
          <div style={{ border: "1.5px solid #BBD0DA", borderRadius: 10, overflow: "visible", background: "#fff", position: "relative", zIndex: 5 }}>
            <GmpPlaceAutocomplete
              ref={attachEl}
              style={{ width: "100%", display: "block", colorScheme: "light", borderRadius: 10 }}
            />
          </div>
        </div>
      ) : null}
      {value?.source === "google" ? (
        <div style={{ fontSize: 13, color: "#06C755", marginBottom: 6, lineHeight: 1.5 }}>
          ✓ 已定位:{value.address || value.name}
        </div>
      ) : null}
      {hasCoords ? (
        <div
          ref={mapRef}
          style={{ width: "100%", height: 140, borderRadius: 10, marginBottom: 8, overflow: "hidden", background: "#EAF1F4" }}
        />
      ) : null}
      {/* 手動備案:Google 找不到 → 直接打字 */}
      <input
        style={inputStyle}
        value={manual}
        onChange={(e) => handleManual(e.target.value)}
        placeholder={MAPS_KEY ? "找不到?直接打地址 / 地點（會標未定位）" : "直接輸入見面地址 / 地點"}
        maxLength={120}
        name="meet-location-manual"
        autoComplete="off"
      />
    </div>
  );
}
