/**
 * 第 1 步：把 591 的登入狀態存下來
 *
 * 跑法：npm run login
 *
 * ⚠️ 這支腳本**不會**幫你打帳號密碼，也不會看到你的帳號密碼。
 *    它只做兩件事：開一個瀏覽器視窗給你自己登入、登入完把 cookie 存成檔案。
 *    存完之後 fill.mjs 就不用每次重登（也不用每次收簡訊驗證碼）。
 *
 * ⚠️ 存出來的 auth/591-state.json 等同你的帳號鑰匙。已經進 .gitignore，
 *    不要貼給任何人、不要 commit、不要放進雲端硬碟。
 *    591 的登入狀態會過期，過期就再跑一次這支。
 */
import { chromium } from "playwright";
import { AUTH_FILE, SITE_591, ensureDir, waitForEnter } from "./_shared.mjs";
import path from "node:path";

const browser = await chromium.launch({
  // 用系統已經裝好的 Chrome，不另外下載 150MB 的 chromium（C 槽吃緊）
  channel: "chrome",
  headless: false,
  args: ["--start-maximized"],
});

const context = await browser.newContext({ viewport: null });
const page = await context.newPage();

console.log("開啟 591…");
await page.goto(SITE_591, { waitUntil: "domcontentloaded" });

await waitForEnter(
  [
    "─".repeat(60),
    "現在請在剛剛打開的那個瀏覽器視窗裡：",
    "",
    "  1. 自己點右上角登入，輸入你的 591 帳號密碼",
    "  2. 如果有簡訊驗證碼，一併完成",
    "  3. 確認左上角／右上角已經顯示你的帳號名稱",
    "",
    "全部完成之後，回到這個視窗按 Enter。",
    "（這支腳本看不到你輸入的任何東西，只會在你按 Enter 之後把 cookie 存起來）",
    "─".repeat(60),
  ].join("\n"),
);

ensureDir(path.dirname(AUTH_FILE));
await context.storageState({ path: AUTH_FILE });

console.log(`\n✅ 登入狀態已存到：${AUTH_FILE}`);
console.log("   下一步：npm run inspect（把 591 刊登表單的欄位抄下來）");
console.log("\n⚠️  這個檔等同帳號鑰匙，不要外流、不要 commit。");

await browser.close();
process.exit(0);
