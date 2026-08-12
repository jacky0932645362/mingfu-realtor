/**
 * 後台統一 icon 系統 ── lucide-react 線條 SVG(取代散落的 emoji / 手貼 inline SVG)
 * 2026-06-21 起全後台 admin UI 一律走這裡,語意一致、可被 CIS 上色、向量不糊。
 *
 * 為什麼不用對外那套 Fluent Emoji 3D:那是「寄出去的 email / 報表」用的彩色光柵圖
 * (email client 吃不下 SVG);後台是瀏覽器內、密集表格,線條 SVG 才乾淨專業。
 * 對外報表請改用 `@/lib/report-icons`。
 *
 * 用法:
 *   import { Icon, StatusDot } from "@/app/admin/_ui/icons";
 *   <Icon name="success" size={16} />              // 語意 icon
 *   <Icon name="trash" size={14} aria-label="刪除" />  // 互動鈕記得給 aria-label
 *   <StatusDot tone="green" />                      // 🟢🟡🔴 狀態燈號(顏色才是語意)
 *
 * 新增語意:在 ICONS 加一行(去 lucide.dev 找 PascalCase 名),不要在頁面散裝直接 import lucide。
 */
import {
  CheckCircle2, XCircle, AlertTriangle, AlertOctagon, Lightbulb, Info,
  BarChart3, TrendingUp, TrendingDown, ClipboardList, Copy, CircleDot, Circle,
  Target, Loader2, Hourglass, Search, Save, Coins, Banknote, CreditCard,
  Mail, Send, MailX, MailCheck, MessageSquare, Clock, Sparkles, Wand2, BrainCircuit,
  RefreshCw, Smartphone, Monitor, Link as LinkIcon, CalendarDays, Pencil, FileText,
  ScrollText, Flame, Bot, User, Users, UserCog, Crown, GraduationCap, Trophy, Medal,
  Pin, Bookmark, MapPin, Map as MapIcon, Bell, BellOff, VolumeX, Globe, Trash2, Eraser,
  BookOpen, Settings, Wrench, Video, Play, Gem, Star, Lock, Key, Shield, Rocket,
  FlaskConical, Ban, Home, Building2, Landmark, HelpCircle, Palette, Plus, PartyPopper,
  Radar, Image as ImageIcon, Camera, Download, Upload, Megaphone, Package, Paperclip, FolderOpen,
  Stethoscope, Eye, Gift, Zap, Hand, Tag, PauseCircle, Ticket, Plug, Moon, Swords,
  Crosshair, HeartCrack, Heart, ToggleLeft, Cake, ShoppingCart, Mic, Type, Shuffle, Car,
  Sunrise, Dna, Share2, Construction, LifeBuoy, Printer, VenetianMask, GitBranch,
  Newspaper, MousePointerClick, CornerUpLeft, StopCircle, Frown, PanelBottom, Handshake,
  AtSign, Filter, Smile, Scale, LogIn, Briefcase, Infinity as InfinityIcon, Check, X, Menu, LogOut, ExternalLink,
  ArrowUpRight, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Reply,
  AlignLeft, AlignCenter, AlignRight, Undo2, Redo2, Bold, Italic,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

// 語意 key → lucide 元件(全後台共用對照表,對齊 _icon_audit/BATCH_PLAN.json 的 canonicalMap)
export const ICONS = {
  // 狀態 / 結果
  success: CheckCircle2, error: XCircle, warning: AlertTriangle, critical: AlertOctagon,
  info: Info, question: HelpCircle, loading: Loader2, pending: Hourglass, pause: PauseCircle,
  stop: StopCircle, ban: Ban, check: Check, close: X,
  // 數據 / 趨勢
  chart: BarChart3, trendUp: TrendingUp, trendDown: TrendingDown, target: Target,
  radar: Radar, scale: Scale, filter: Filter,
  // 提示 / AI
  tip: Lightbulb, ai: Sparkles, magic: Wand2, brain: BrainCircuit, bot: Bot,
  // 清單 / 文件
  list: ClipboardList, file: FileText, log: ScrollText, news: Newspaper, copy: Copy,
  folder: FolderOpen, package: Package, attach: Paperclip, bookmark: Bookmark, tag: Tag,
  textVar: Type,
  // 金流
  money: Coins, refund: Banknote, card: CreditCard, cart: ShoppingCart, ticket: Ticket,
  // 訊息 / 通訊
  mail: Mail, send: Send, mailEmpty: MailX, mailReceived: MailCheck, chat: MessageSquare,
  bell: Bell, bellOff: BellOff, mute: VolumeX, megaphone: Megaphone, reply: Reply,
  // 時間
  clock: Clock, calendar: CalendarDays, sunrise: Sunrise,
  // 動作 / 編輯
  edit: Pencil, save: Save, search: Search, refresh: RefreshCw, add: Plus, trash: Trash2,
  cleanup: Eraser, download: Download, upload: Upload, share: Share2, print: Printer, settings: Settings,
  tool: Wrench, toggle: ToggleLeft, hand: Hand, click: MousePointerClick, bounce: CornerUpLeft,
  // 連結 / 導覽
  link: LinkIcon, externalLink: ExternalLink, globe: Globe, plug: Plug, branch: GitBranch,
  threads: AtSign, menu: Menu, login: LogIn, logout: LogOut,
  chevronUp: ChevronUp, chevronDown: ChevronDown, chevronLeft: ChevronLeft, chevronRight: ChevronRight, arrowUpRight: ArrowUpRight,
  // 編輯器工具列(TipTap)
  undo: Undo2, redo: Redo2, alignLeft: AlignLeft, alignCenter: AlignCenter, alignRight: AlignRight, bold: Bold, italic: Italic,
  // 人 / 角色
  user: User, users: Users, adminUser: UserCog, crown: Crown, lecturer: GraduationCap,
  handshake: Handshake, mask: VenetianMask,
  // 內容 / 媒體
  book: BookOpen, video: Video, play: Play, image: ImageIcon, camera: Camera, mic: Mic,
  palette: Palette, eye: Eye,
  // 地點 / 物件
  home: Home, building: Building2, bank: Landmark, location: MapPin, map: MapIcon, pin: Pin, car: Car,
  // 裝置
  mobile: Smartphone, desktop: Monitor,
  // 安全
  lock: Lock, key: Key, shield: Shield,
  // 行銷 / 成長 / 榮譽
  hot: Flame, rocket: Rocket, premium: Gem, star: Star, trophy: Trophy, medal: Medal,
  gift: Gift, celebrate: PartyPopper, zap: Zap, test: FlaskConical,
  // 其他語意
  health: Stethoscope, moon: Moon, versus: Swords, competitor: Crosshair, churn: HeartCrack,
  heart: Heart, birthday: Cake, shuffle: Shuffle, dna: Dna, construction: Construction,
  lifebuoy: LifeBuoy, frown: Frown, smile: Smile, footer: PanelBottom, work: Briefcase,
  infinity: InfinityIcon,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
  /** 互動元素(按鈕)務必給,無障礙;純裝飾留空會自動 aria-hidden */
  "aria-label"?: string;
}

/** 後台統一語意 icon。預設 16px、繼承 currentColor(跟著文字色)。 */
export function Icon({ name, size = 16, className, color, strokeWidth, style, "aria-label": ariaLabel }: IconProps) {
  const Cmp = ICONS[name];
  return (
    <Cmp
      size={size}
      className={className}
      color={color}
      strokeWidth={strokeWidth}
      style={{ flexShrink: 0, verticalAlign: "text-bottom", ...style }}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    />
  );
}

// 狀態燈號顏色(對齊 🟢🟡🔴 語意,顏色才是語意載體)
const TONE: Record<string, string> = {
  green: "#22c55e", yellow: "#eab308", red: "#ef4444", orange: "#f97316",
  blue: "#3b82f6", purple: "#a855f7", neutral: "#9ca3af",
};
export type StatusTone = keyof typeof TONE;

export interface StatusDotProps {
  tone?: StatusTone;
  size?: number;
  style?: CSSProperties;
  /** 給螢幕閱讀器的文字,如「正常」「警告」 */
  title?: string;
}

/** 取代 🟢🟡🔴⚪ 狀態圓點。實心 lucide Circle,tone 決定顏色。 */
export function StatusDot({ tone = "neutral", size = 10, style, title }: StatusDotProps) {
  const c = TONE[tone] ?? TONE.neutral;
  return (
    <Circle
      size={size}
      color={c}
      fill={c}
      style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle", ...style }}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    />
  );
}
