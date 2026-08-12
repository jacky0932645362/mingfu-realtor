/**
 * 後台登入的入口 —— next-auth 的路由。
 *
 * 2026-08-12 補上：原本範本裡 `src/auth.ts` 有設定好登入，卻沒有這個檔，
 * 所以 `/api/auth/signin` 一直是 404，後台永遠進不去（填了 Google 金鑰也沒用）。
 *
 * 這個檔什麼邏輯都沒有，只是把 `auth.ts` 設定好的處理器接到網址上。
 * 白名單、誰能進，全都在 `src/auth.ts` 跟 `src/lib/admin-check.ts` 決定。
 */
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
