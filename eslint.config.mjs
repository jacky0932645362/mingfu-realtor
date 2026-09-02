/**
 * ESLint 設定檔（flat config —— ESLint 9 開始只認這個新格式）
 *
 * 為什麼需要這個檔：
 *   ESLint 9 只讀 eslint.config.{js,mjs,cjs}，舊的 .eslintrc.* 一律不看。
 *   專案原本兩種都沒有，所以 `npm run lint` 會直接回
 *   "ESLint couldn't find an eslint.config.(js|mjs|cjs) file." 而不是真的去檢查程式碼。
 *
 * 為什麼只有短短幾行：
 *   "eslint-config-next/core-web-vitals" 匯出的本身就是一個完整的 flat config 陣列，
 *   已內含 react / react-hooks / eslint-plugin-import / jsx-a11y / @next/next 五組規則，
 *   TypeScript 的解析器，以及 .next、out、build、next-env.d.ts 的預設忽略清單。
 *   展開（...）進來即可，不需要 @eslint/eslintrc 的 FlatCompat 轉接。
 *
 * 想再加 TypeScript 專屬規則（no-explicit-any 那一類）時，
 *   多 import "eslint-config-next/typescript" 一起展開即可 —— 但會多出不少既有警告。
 */
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextCoreWebVitals,
  {
    ignores: [
      // 這底下是 scripts/sync-maplibre-worker.mjs 從 node_modules 複製過來的
      // maplibre-gl 原廠檔，不是本專案寫的程式碼，掃了只會噴一堆無意義的警告。
      "public/maplibre/**",
    ],
  },
];

export default config;
