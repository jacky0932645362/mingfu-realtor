/**
 * 物件媒體網址處理（2026-08-23）
 *
 * 「貼網址」版物件資料庫用：照片與影片都不存在自己的伺服器，
 * 資料庫只存一條網址，這個檔負責把「人類手上會拿到的網址」轉成
 * 「瀏覽器真的能直接顯示的網址」。
 *
 * 為什麼需要這層轉換：客戶手上最容易拿到的連結（Google Drive 分享連結、
 * YouTube 觀看連結、Dropbox 分享連結）通通都是「網頁」的網址，不是「檔案」的網址。
 * 直接塞進 <img src> 或 <iframe src> 一律不會動，而且失敗時畫面是空白，
 * 沒有任何錯誤訊息，最難查。統一在這裡轉掉。
 */

/* ────────────────── 影片 ────────────────── */

/**
 * 從各種 YouTube 網址格式抽出影片 ID。
 * 支援 watch / youtu.be / shorts / embed / live —— Shorts 一定要支援，
 * 房產短影音發出去的連結就是 Shorts 格式。
 */
export function youtubeId(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;

  // 已經是純 ID（11 碼英數 - _）就直接用
  if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;

  let parsed: URL;
  try {
    parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1).split("/")[0];
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;

  const v = parsed.searchParams.get("v");
  if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;

  const m = parsed.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export type VideoEmbed = {
  /** iframe 用的網址 */
  src: string;
  /** 原始連結（給「在 YouTube 開啟」用） */
  watchUrl: string;
  /** 縮圖（列表頁不載入 iframe，只放縮圖，省流量也快很多） */
  thumbUrl: string;
};

/**
 * 轉成可嵌入的播放器網址。
 *
 * 用 youtube-nocookie.com：客戶還沒點播放前不會被種 cookie，
 * 對「同意 cookie」那套比較乾淨（本站已有 tracking-consent 機制，不要再多一個來源）。
 * rel=0 讓結束後的推薦影片限定在本頻道，不會把客戶推去看別人的房子。
 */
export function videoEmbed(raw: string): VideoEmbed | null {
  const id = youtubeId(raw);
  if (!id) return null;
  return {
    src: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`,
    watchUrl: `https://www.youtube.com/watch?v=${id}`,
    thumbUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

/* ────────────────── 圖片 ────────────────── */

/**
 * 把分享用網址轉成「檔案本體」網址。轉不了的原樣回傳
 * （已經是 https://…/xxx.jpg 這種直連的話本來就不用轉）。
 */
export function directImageUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return "";

  let parsed: URL;
  try {
    parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return url;
  }

  const host = parsed.hostname.replace(/^www\./, "");

  // Google Drive：分享連結是一個「網頁」，要換成圖片 CDN 的直連網址。
  // 檔案本身必須設成「知道連結的人都可以檢視」，否則轉了也是破圖。
  if (host === "drive.google.com") {
    const m =
      parsed.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/) ||
      parsed.pathname.match(/\/d\/([A-Za-z0-9_-]+)/);
    const id = m ? m[1] : parsed.searchParams.get("id");
    if (id) return `https://lh3.googleusercontent.com/d/${id}=w1600`;
  }

  // Dropbox：?dl=0 是預覽頁，raw=1 才是檔案
  if (host === "dropbox.com" || host === "dl.dropboxusercontent.com") {
    parsed.searchParams.delete("dl");
    parsed.searchParams.set("raw", "1");
    return parsed.toString();
  }

  // GitHub：blob 頁面 → raw
  if (host === "github.com" && parsed.pathname.includes("/blob/")) {
    return `https://raw.githubusercontent.com${parsed.pathname.replace("/blob/", "/")}`;
  }

  return url;
}

/** 一行一個網址的欄位 → 陣列（順手去空行、去重、轉直連、限量）。 */
export function parseImageList(raw: string | null | undefined, max = 40): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/[\r\n]+/)) {
    const url = directImageUrl(line);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * FB 貼文工廠「手動填一筆」的照片欄專用：一行一個，**網址或桌機路徑都收**。
 *
 * ・http(s) 開頭 → 當網址，轉直連（Google Drive／Dropbox 分享連結）
 * ・其它（`D:\物件照\覓蜜`、`C:\...\01.jpg`、`\\NAS\...`、`~/pics`）→ 原樣留著。
 *   這是**發文那台桌機上的路徑**：發文時桌機的 preparePhotos() 會處理
 *   —— 單一圖檔直接用、整個資料夾自動展開成裡面所有圖（依檔名排序，第一張＝封面）。
 *   瀏覽器讀不到本機檔案，所以這種在後台不會有預覽，是正常的。
 *
 * ⚠️ 只給 FB 這條通路用。物件庫的公開物件頁一律要真網址，不能用本機路徑。
 */
export function parseFbPhotoLines(raw: string | null | undefined, max = 10): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/[\r\n]+/)) {
    const s = line.trim();
    if (!s) continue;
    const v = /^https?:\/\//i.test(s) || /^data:/i.test(s) ? directImageUrl(s) : s;
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/** 這一條照片來源是不是「桌機本機路徑」（不是 http/https/data 網址）。給 UI 決定要不要顯示預覽。 */
export function isLocalPhotoPath(s: string): boolean {
  return !/^(https?:|data:)/i.test(s.trim());
}

/**
 * FB 貼文工廠「影片」欄位專用：**一支**，網址或桌機路徑都收，規則跟 parseFbPhotoLines 一樣，
 * 只是只留一支——FB 一篇貼文只掛一支影片，不像照片可以排到 10 張。
 *
 * ⚠️ 網址刻意不轉直連（不像 directImageUrl 那樣處理 Google Drive／Dropbox）：
 *    影片檔通常很大，Drive 分享連結沒有像圖片那樣簡單的直連 CDN 寫法，硬轉只會轉出打不開的網址。
 *    要嘛貼「本來就是檔案本體」的直連網址（例如 Cloudinary 影片網址），要嘛貼桌機路徑最實際。
 */
export function parseFbVideoLine(raw: string | null | undefined): string | null {
  const s = (raw || "").trim();
  return s || null;
}

/** 一行一個 YouTube 連結 → 可嵌入的播放器清單。 */
export function parseVideoList(raw: string | null | undefined, max = 6): VideoEmbed[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: VideoEmbed[] = [];
  for (const line of raw.split(/[\r\n]+/)) {
    const embed = videoEmbed(line);
    if (!embed || seen.has(embed.src)) continue;
    seen.add(embed.src);
    out.push(embed);
    if (out.length >= max) break;
  }
  return out;
}
