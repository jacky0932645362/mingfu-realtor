/**
 * 👤 這個系統是誰的 —— 從這裡改，只改這一個檔
 *
 * 名片頁、預約表單、通知信、日曆邀請 全都讀這裡。
 * 把下面換成你自己的資料，整套系統就是你的了。
 *
 * ⚠️ 這個檔會進 Git。手機與 Email 填進去等於公開在網路上
 *    （名片本來就是要給人看的，但你如果不想被爬蟲收割，
 *      可以改成讀環境變數：process.env.OWNER_PHONE 之類）。
 */

export const OWNER = {
  /** 你的名字（正式全名，出現在通知信署名與日曆邀請） */
  name: "蕭茗馥",
  /**
   * 慣用稱呼（客戶怎麼叫你，出現在對話式文案裡：
   * 「茗馥會與您聯繫」「茗馥主動來電」、通知信內文與主旨）
   *
   * ⚠️ 這個是「人的稱呼」，不是品牌名。要改對外品牌請改下面的 brandPersona。
   *    另外通知信（src/lib/appointment-notify.ts）裡有很多「茗馥」是寫死的，
   *    不吃這個變數，要一起改的話得手動改那個檔。
   */
  alias: "茗馥",
  /**
   * 對外個人品牌人設（門面用）。
   *
   * 2026-08-14 本人指定：名片封面姓名旁邊顯示這個，不顯示 alias。
   * 用在「給人第一眼認識你」的位置；一對一溝通的文案仍然用 alias（茗馥），
   * 品牌掛門口、名字留在對話裡。
   */
  brandPersona: "房仲蕭邦",
  /** 頭銜 */
  title: "台中海線房產顧問",
  /** 手機（顯示用，含分隔線） */
  phone: "0932-645-362",
  /** 手機（純數字，撥號連結與 LINE 加好友用） */
  phoneRaw: "0932645362",
  /**
   * 公開顯示的聯絡信箱。
   *
   * 2026-08-12：本人決定不公開個人 Gmail，所以這裡刻意留空 ——
   * 留空時名片上就不會出現 Email 那一列，客戶用電話 / LINE / 線上預約聯絡。
   *
   * 之後若申請了工作信箱要顯示，不要直接寫在這個檔（這個檔會進 Git 公開），
   * 改成在 .env.local 加一行：NEXT_PUBLIC_OWNER_EMAIL="工作信箱@example.com"
   *
   * 註：這跟收預約通知的信箱是兩回事，那個是 .env.local 的
   *     APPOINTMENT_ADMIN_EMAIL，本來就不會公開。
   */
  email: process.env.NEXT_PUBLIC_OWNER_EMAIL || "",
  /** 公司地址（「公司面談」這個選項會顯示它） */
  address: "台中市梧棲區四維中路338號",
  /** 公司／品牌名 */
  company: "太平洋房屋 梧棲市鎮加盟店",
  /** 大頭照放 public/card/ 底下 */
  photoUrl: "/card/owner.jpg",
  /**
   * 一句話介紹自己（名片頁與預約頁的自我介紹都讀這裡）
   *
   * 2026-08-14：補上「房屋土地買賣」。原本這句只講資產配置與稅務，
   * 但那是加值服務不是主業，客戶掃名片進來第一眼看不到你在賣房賣地。
   * 官網服務項目也是把「房屋土地買賣」擺第一，兩邊要一致。
   */
  slogan: "專營台中海線・沙鹿・龍井・清水・梧棲・房屋土地買賣・連續三年年度 TOP 1・資產配置與稅務規劃一站到位。",
} as const;

/** 社群連結 —— 用不到的留空字串，畫面會自動不顯示 */
export const SOCIAL = {
  line: `https://line.me/R/ti/p/~${OWNER.phoneRaw}`,
  fb: "",
  yt: "",
  ig: "",
} as const;

/** LINE 加好友 QR 圖（放 public/card/ 底下）。null = 不顯示 QR 區 */
export const LINE_QR: string | null = null;

/** 網站網址（通知信裡的連結、Open Graph 用） */
export const SITE_URL = process.env.APPOINTMENT_BASE_URL || "http://localhost:3000";
