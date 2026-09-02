/**
 * 台中海線旅遊地圖 —— 景點資料
 *
 * 【座標怎麼來的】
 * 全部用 OpenStreetMap 官方的 Nominatim 服務逐一查詢，不是憑印象填的。
 * 查詢日期 2026-09-02，查法見 reference_商圈地圖資料 的「地理座標查詢」段落。
 *
 * ⚠️ `precise: false` 的點，Nominatim 只查得到所在「里」的中心點，不是景點門口，
 *    誤差可能數百公尺。畫面上會明白標示「概略位置」，不要讓使用者誤以為是導航點。
 *    要修正的話：Google 地圖上查到正確經緯度後直接改這裡的 position 即可。
 *
 * 【為什麼沒有「沙鹿夢想街」】
 * 查不到可信座標。與其塞一個「差不多」的地址，不如不放 —— 導航把人載錯地方
 * 比少一個景點嚴重得多。同理，凡是會過時的資訊（票價、營業時間、特定店家）
 * 這裡一律不寫，只寫地形、性質、時段這類長期不變的事。
 */

export type SpotCategory = "nature" | "culture" | "family" | "view" | "food";

export type Spot = {
  id: string;
  name: string;
  /** 行政區（以 OSM 實際回傳為準，跟一般人的印象不一定一樣） */
  area: string;
  category: SpotCategory;
  position: { lat: number; lng: number };
  /** 座標是否為景點本身的點位。false = 只查到里／區中心，屬概略 */
  precise: boolean;
  /** 一句話：這是什麼、值不值得專程去 */
  blurb: string;
  /** 去之前最好先知道的一件事 */
  tip?: string;
  /** 建議停留 */
  stay?: string;
  /** 最佳時段 */
  best?: string;
};

export const CATEGORY_META: Record<
  SpotCategory,
  { label: string; color: string; icon: string }
> = {
  nature: { label: "海景・自然", color: "#0284c7", icon: "🌊" },
  culture: { label: "人文・古蹟", color: "#b45309", icon: "⛩️" },
  family: { label: "親子・購物", color: "#db2777", icon: "🎡" },
  view: { label: "展望・夜景", color: "#7c3aed", icon: "🌄" },
  food: { label: "在地・市集", color: "#ea580c", icon: "🍜" },
};

export const CATEGORY_ORDER: SpotCategory[] = ["nature", "culture", "family", "view", "food"];

/** 地圖起點：臺中港市鎮中心（梧棲鬧區）。畫面上的「直線距離」都以這裡為基準。 */
export const ORIGIN = {
  name: "梧棲・臺中港市鎮中心",
  lat: 24.2665,
  lng: 120.534,
};

export const MAP_CENTER = { lat: 24.28, lng: 120.57 };
export const MAP_ZOOM = 10.6;

export const SPOTS: Spot[] = [
  /* ───────── 清水區 ───────── */
  {
    id: "gaomei",
    name: "高美濕地",
    area: "清水區",
    category: "nature",
    position: { lat: 24.3148586, lng: 120.5497816 },
    precise: true,
    blurb: "海線的門面。退潮時整片潮間帶露出來，木棧道走到底就是一望無際的水鏡，夕陽倒影是全台知名的畫面。",
    tip: "木棧道會依當天潮汐管制開放時間，漲潮時封閉。出發前先查臺中市政府公告的當日開放時段，不然到了只能在外圍看。海風整年都大，外套帶著。",
    stay: "1.5～2 小時",
    best: "日落前 1.5 小時進場",
  },
  {
    id: "gaomei-lighthouse",
    name: "高美燈塔",
    area: "清水區",
    category: "nature",
    position: { lat: 24.3126305, lng: 120.5511361 },
    precise: true,
    blurb: "紅白相間的方形燈塔，已經除役停用，現在是濕地旁最好認的地標與拍照背景。",
    tip: "就在濕地入口旁邊，順路一起走，不用另外安排時間。",
    stay: "20 分鐘",
  },
  {
    id: "wuqi-fishport",
    name: "梧棲觀光漁港",
    area: "清水區",
    category: "food",
    position: { lat: 24.2919456, lng: 120.5177034 },
    precise: true,
    blurb: "海線最大的漁貨集散地，現流海鮮直接挑、旁邊就有店家代客料理。假日人潮很滿。",
    tip: "名字叫梧棲，門牌其實在清水區 —— 這點外地客十之八九會搞錯，導航直接搜「梧棲漁港」比較保險。",
    stay: "1～2 小時",
    best: "上午漁貨最齊，傍晚接夕陽",
  },
  {
    id: "qingshui-cave",
    name: "清水鬼洞",
    area: "清水區",
    category: "culture",
    position: { lat: 24.2720355, lng: 120.5815494 },
    precise: true,
    blurb: "二戰時期挖在鰲峰山裡的軍事戰備坑道，全長數百公尺，裡面陰涼、有機槍堡與指揮所遺跡。",
    tip: "坑道低矮潮濕，要低頭走，穿好走的鞋。有開放時段管制，且雨後可能因積水關閉。",
    stay: "40 分鐘",
  },
  {
    id: "aofeng",
    name: "鰲峰山運動公園",
    area: "清水區",
    category: "view",
    position: { lat: 24.2711925, lng: 120.581588 },
    precise: true,
    blurb: "清水人的後山。有觀景平台可以一路望到台中港與海線平原，還有一區大型的競合體驗遊戲場，小孩會玩到不想走。",
    tip: "跟清水鬼洞在同一座山上，走路可到，排行程一定要排在一起。",
    stay: "1.5 小時",
    best: "傍晚看夕照，入夜看港區燈火",
  },
  {
    id: "qingshui-village",
    name: "清水眷村文化園區",
    area: "清水區",
    category: "culture",
    position: { lat: 24.2684716, lng: 120.5588559 },
    precise: true,
    blurb: "保留下來的空軍眷村聚落，紅磚矮房、老樹、防空洞原地保存，整區很好拍，人潮比市區景點少。",
    tip: "跟港區藝術中心隔壁而已，兩個一起走剛好一個下午。",
    stay: "1 小時",
  },
  {
    id: "gangqu-art",
    name: "臺中市港區藝術中心",
    area: "清水區",
    category: "culture",
    position: { lat: 24.26935, lng: 120.55791 },
    precise: true,
    blurb: "閩南式建築群配上大片草皮與水池的公立藝文園區，展覽免費，草地本身就值得帶野餐墊來躺。",
    tip: "室內展館週一休。但戶外庭園是開放的，撲空也不會白跑。",
    stay: "1～2 小時",
  },
  {
    id: "ziyunyan",
    name: "清水紫雲巖",
    area: "清水區",
    category: "culture",
    position: { lat: 24.2710639, lng: 120.5794963 },
    precise: true,
    blurb: "海線香火最盛的觀音廟之一，規模宏大。廟埕周邊就是清水最熱鬧的小吃聚落。",
    tip: "清水米糕、擀麵、肉圓幾家老店都在步行範圍，來拜拜順便解決一餐。",
    stay: "1 小時",
  },
  {
    id: "qingshui-rest",
    name: "清水服務區",
    area: "清水區",
    category: "view",
    position: { lat: 24.2813055, lng: 120.6008503 },
    precise: true,
    blurb: "國道三號上最有名的服務區，二樓觀景平台居高臨下看整片海線平原，天氣好時看得到台中港。",
    tip: "不用上高速公路也能從平面道路開進去，在地人常直接來這裡吃飯看夜景。",
    stay: "40 分鐘",
    best: "夜間",
  },

  /* ───────── 梧棲區 ───────── */
  {
    id: "mitsui",
    name: "三井 OUTLET PARK 台中港",
    area: "梧棲區",
    category: "family",
    position: { lat: 24.2582246, lng: 120.5189037 },
    precise: true,
    blurb: "全台唯一緊鄰港口的 OUTLET，戶外開放式街廓，還有一座面海的摩天輪。下雨天以外都很好逛。",
    tip: "戶外動線多，夏天中午非常曬。建議傍晚來，逛完剛好在海邊看夕陽。",
    stay: "2～4 小時",
    best: "傍晚",
  },
  {
    id: "port-visitor",
    name: "臺中港旅客服務中心",
    area: "梧棲區",
    category: "nature",
    position: { lat: 24.2604736, lng: 120.5214841 },
    precise: true,
    blurb: "台中港的郵輪碼頭大樓，港邊可以近距離看貨櫃船與大型船舶進出，是海線少數能貼近工作港區的位置。",
    tip: "就在三井 OUTLET 旁邊，走路可到。",
    stay: "30 分鐘",
  },
  {
    id: "dingyuliao",
    name: "頂魚寮公園",
    area: "梧棲區",
    category: "family",
    position: { lat: 24.2646805, lng: 120.5371 },
    precise: true,
    blurb: "以漁村生活為主題的 3D 立體彩繪公園，牆上的鯨魚、漁夫都是可以站進去合照的錯視畫。",
    tip: "免費、有停車位，小孩放電的好地方，二十分鐘就能逛完，適合塞在兩個大景點之間。",
    stay: "30 分鐘",
  },
  {
    id: "wuqi-oldstreet",
    name: "梧棲老街（頂橫街）",
    area: "梧棲區",
    category: "culture",
    position: { lat: 24.2579468, lng: 120.5288274 },
    precise: true,
    blurb: "梧棲最早發跡的街廓，還留著幾棟老屋與百年廟宇，是理解這個港鎮怎麼長出來的地方。",
    tip: "不是那種整條商店街的觀光老街，是安靜的舊聚落。喜歡看老房子的人才會喜歡。",
    stay: "40 分鐘",
  },

  /* ───────── 沙鹿區 ───────── */
  {
    id: "shalu-cinema",
    name: "沙鹿電影藝術館",
    area: "沙鹿區",
    category: "culture",
    position: { lat: 24.2334725, lng: 120.56404 },
    precise: true,
    blurb: "公立的電影主題館，有小型放映廳與電影文物展，票價親民，是海線少見的靜態文藝空間。",
    stay: "1 小時",
  },
  {
    id: "meiren",
    name: "美仁里彩繪村",
    area: "沙鹿區",
    category: "culture",
    position: { lat: 24.2343275, lng: 120.5639011 },
    precise: false,
    blurb: "老社區巷弄裡的懷舊主題彩繪，畫的是五、六〇年代的台灣街景，跟一般卡通彩繪村不一樣。",
    tip: "巷子窄，開車進去不好停，建議停在電影藝術館附近走過來，兩個景點本來就相鄰。",
    stay: "30 分鐘",
  },
  {
    id: "providence",
    name: "靜宜大學",
    area: "沙鹿區",
    category: "culture",
    position: { lat: 24.2268822, lng: 120.580697 },
    precise: true,
    blurb: "校園開放參觀，主顧聖母堂與林蔭大道是拍照點；校門口整條就是海線最大的學生商圈與夜市。",
    tip: "來這裡的重點通常不是校園，是門口那條吃的。學期中晚上最熱鬧，寒暑假會冷清很多。",
    stay: "1～2 小時",
    best: "傍晚後",
  },

  /* ───────── 龍井區 ───────── */
  {
    id: "lishui",
    name: "麗水漁港",
    area: "龍井區",
    category: "nature",
    position: { lat: 24.2175815, lng: 120.4792867 },
    precise: false,
    blurb: "腹地小、觀光化程度低的老漁港，有一段親水步道與紅樹林，看夕陽的人潮遠比高美濕地少。",
    tip: "想看海又怕人擠人的話選這裡。周邊餐飲選擇少，別空著肚子來。",
    stay: "1 小時",
    best: "日落前後",
  },
  {
    id: "luce",
    name: "東海大學路思義教堂",
    area: "西屯區（緊鄰龍井）",
    category: "culture",
    position: { lat: 24.1788982, lng: 120.6045034 },
    precise: true,
    blurb: "貝聿銘設計的雙曲面教堂，台灣戰後建築的代表作，前面那片草皮永遠有人在躺著。",
    tip: "門牌在西屯區，但緊貼龍井，從海線過來比從台中市區還近，順路排進海線行程完全合理。",
    stay: "1.5 小時",
  },
  {
    id: "donghai-art",
    name: "東海藝術街商圈",
    area: "西屯區（緊鄰龍井）",
    category: "food",
    position: { lat: 24.1855259, lng: 120.5945959 },
    precise: true,
    blurb: "東海大學旁的歐風小巷商圈，咖啡館、手作店與小吃聚集，跟校園走路連得起來。",
    stay: "1～2 小時",
  },
  {
    id: "zhukeng",
    name: "竹坑南寮登山步道",
    area: "龍井區",
    category: "view",
    position: { lat: 24.1765916, lng: 120.5700915 },
    precise: false,
    blurb: "大肚山西側的短程登山步道，爬升不高但視野開闊，可以一路看到台中港與海岸線。",
    tip: "步道入口不只一個且指標不明顯，出發前先在地圖上確認要走哪一段。夏天蚊蟲多。",
    stay: "2 小時",
    best: "清晨或傍晚",
  },

  /* ───────── 大肚區 ───────── */
  {
    id: "zhuifen",
    name: "追分車站",
    area: "大肚區",
    category: "culture",
    position: { lat: 24.1205177, lng: 120.5701802 },
    precise: true,
    blurb: "1922 年的檜木造日式站房，至今仍在營運。「追分→成功」車票是台灣最有名的祈福紀念票。",
    tip: "是真的在跑車的小站，不是園區。買紀念票要在窗口有人的時段來。",
    stay: "40 分鐘",
  },
  {
    id: "huangxi",
    name: "磺溪書院",
    area: "大肚區",
    category: "culture",
    position: { lat: 24.1500946, lng: 120.5393805 },
    precise: true,
    blurb: "清代留下來的書院古蹟，屋脊燕尾與磚雕做工細緻，是台中海線最完整的傳統學堂建築。",
    tip: "腹地小、二十分鐘就看完，適合跟追分車站串成一條古蹟小旅行。",
    stay: "30 分鐘",
  },
  {
    id: "wanggaoliao",
    name: "望高寮夜景公園",
    area: "南屯區（大肚山稜線）",
    category: "view",
    position: { lat: 24.1447185, lng: 120.5785534 },
    precise: true,
    blurb: "大肚山稜線上的觀景台，一邊是台中市區的燈海，一邊是海線與台灣海峽，夜景視野是這一帶最好的。",
    tip: "行政區屬南屯，但上山的路從大肚、龍井這側接最順。夜間風大且照明有限，注意安全。",
    stay: "1 小時",
    best: "日落後",
  },

  /* ───────── 大甲區 ───────── */
  {
    id: "zhenlan",
    name: "大甲鎮瀾宮",
    area: "大甲區",
    category: "culture",
    position: { lat: 24.3452713, lng: 120.6234579 },
    precise: true,
    blurb: "台灣媽祖信仰的重鎮，每年三月的大甲媽遶境是全台最大的宗教活動之一。平日也香火鼎盛。",
    tip: "遶境期間（農曆三月前後）整個大甲會封路、人潮數十萬，要嘛專程來體驗，要嘛避開。",
    stay: "1 小時",
  },
  {
    id: "dajia-wenchang",
    name: "大甲文昌祠",
    area: "大甲區",
    category: "culture",
    position: { lat: 24.3478303, lng: 120.6228154 },
    precise: true,
    blurb: "清光緒年間的文昌廟古蹟，考生祈福的地方，格局工整、遊客少，跟鎮瀾宮的熱鬧是兩種氣氛。",
    tip: "離鎮瀾宮走路就到，拜完媽祖順道過來很順。",
    stay: "30 分鐘",
  },
  {
    id: "jianggonglu",
    name: "大甲蔣公路夜市",
    area: "大甲區",
    category: "food",
    position: { lat: 24.345273, lng: 120.6241423 },
    precise: true,
    blurb: "就在鎮瀾宮廟埕外的街邊夜市，芋頭酥、粉腸、肉圓等大甲名產集中在這一段。",
    tip: "座標是整條路的位置，不是單一攤。傍晚後才會熱鬧起來。",
    stay: "1 小時",
    best: "傍晚後",
  },
  {
    id: "tiezhenshan",
    name: "鐵砧山風景區",
    area: "大甲區・外埔區交界",
    category: "view",
    position: { lat: 24.3469311, lng: 120.6531428 },
    precise: false,
    blurb: "海拔約 236 公尺的方形台地，山頂能俯瞰大安溪出海口與整片海線平原，園區裡有劍井與雕塑公園。",
    tip: "山不高但路彎，機車、汽車都上得去。座標為山區道路上的概略點，導航請認「鐵砧山風景特定區」。",
    stay: "1.5 小時",
  },

  /* ───────── 大安區 ───────── */
  {
    id: "daan-beach",
    name: "大安濱海樂園",
    area: "大安區",
    category: "nature",
    position: { lat: 24.3833023, lng: 120.5863214 },
    precise: true,
    blurb: "台中少數能真正踩到沙的沙灘，腹地大、海岸線長，夏天有水域活動，其他季節就是空曠的散步海灘。",
    tip: "沿海風大、遮蔽少，夏天請做好防曬。開放戲水的區域與期間每年不同，下水前先看現場公告。",
    stay: "1.5～2 小時",
  },
  {
    id: "songbo",
    name: "松柏漁港",
    area: "大甲區・大安區交界",
    category: "nature",
    position: { lat: 24.4288373, lng: 120.6153582 },
    precise: true,
    blurb: "大安溪出海口旁的小型漁港，堤防上看夕陽與風力發電機的畫面很開闊，觀光客極少。",
    tip: "台中海線最北端，從梧棲開過來要一段路，適合安排成一日遊的折返點。",
    stay: "40 分鐘",
    best: "日落前後",
  },
  {
    id: "guike",
    name: "龜殼生態公園",
    area: "大安區",
    category: "family",
    position: { lat: 24.3700511, lng: 120.5829253 },
    precise: true,
    blurb: "以濕地與草坡為主的社區型生態公園，環境安靜、有步道與水域，適合帶小孩慢慢走。",
    tip: "離大安濱海樂園很近，兩個排在一起剛好一個下午。",
    stay: "1 小時",
  },

  /* ───────── 外埔區 ───────── */
  {
    id: "wangyou",
    name: "外埔忘憂谷",
    area: "外埔區",
    category: "view",
    position: { lat: 24.320919, lng: 120.621638 },
    precise: true,
    blurb: "一整片起伏的稻田台地，田埂間有小路可以走進去，二期稻作轉黃時是台中最美的農田風景之一。",
    tip: "沒有商業設施、沒有廁所、沒有遮蔽，就是純粹的田。看的是季節 —— 綠油油或金黃色差很多，去之前先確認稻作時節。",
    stay: "1 小時",
    best: "稻作轉黃期的清晨或傍晚",
  },
  {
    id: "shuiliudong",
    name: "水流東桐花步道",
    area: "外埔區",
    category: "nature",
    position: { lat: 24.3228473, lng: 120.6743429 },
    precise: true,
    blurb: "沿著水流東灌溉圳道的平緩步道，四、五月油桐花開時整條路鋪滿白花。",
    tip: "花期只有短短兩三週，錯過就是一條普通的綠蔭步道 —— 想看桐花務必先查當年花況。",
    stay: "1.5 小時",
    best: "四月下旬～五月中",
  },
];

/** 三條把散點串成行程的推薦路線。id 對應上面的 SPOTS。 */
export type Route = {
  id: string;
  name: string;
  color: string;
  summary: string;
  spotIds: string[];
};

export const ROUTES: Route[] = [
  {
    id: "sunset",
    name: "夕陽海線經典",
    color: "#f97316",
    summary: "海線第一次來就走這條。從逛街到海鮮到夕陽，一路往北收在高美濕地。",
    spotIds: ["mitsui", "port-visitor", "wuqi-fishport", "gaomei-lighthouse", "gaomei"],
  },
  {
    id: "heritage",
    name: "大甲媽祖・古蹟半日",
    color: "#b45309",
    summary: "海線北段的人文路線。廟宇、古蹟、小吃集中在步行範圍，最後上鐵砧山看整片平原。",
    spotIds: ["zhenlan", "dajia-wenchang", "jianggonglu", "tiezhenshan"],
  },
  {
    id: "hillside",
    name: "清水山線・文藝與展望",
    color: "#7c3aed",
    summary: "不下海的另一種海線。眷村、藝術中心、廟埕小吃，晚上上鰲峰山看港區燈火。",
    spotIds: ["qingshui-village", "gangqu-art", "ziyunyan", "qingshui-cave", "aofeng"],
  },
];

/** 兩點間的直線距離（公里）。⚠️ 是直線不是車程，畫面上要標清楚。 */
export function straightLineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export const AREAS = [...new Set(SPOTS.map((s) => s.area))].sort();
