/**
 * 舊檔名。內容搬到 DraftDetail.tsx（接的表從 fb_post 換成 fb_draft）。
 * 這裡留一個 re-export，避免還有地方 import 到舊名字時整包壞掉。
 */
export { DraftDetail as PostDetail } from "./DraftDetail";
