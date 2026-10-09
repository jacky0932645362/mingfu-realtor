/**
 * 第 1 步：把 FB 的登入狀態存下來
 *
 * 跑法：npm run login
 *
 * ⚠️ 這支腳本**不會**幫你打帳號密碼，也不會看到你的帳號密碼。
 *    它只做兩件事：開一個瀏覽器視窗給你自己登入、登入完把 cookie 存成檔案。
 *    存完之後 post.mjs 就不用每次重登（FB 的二階段驗證也只要過這一次）。
 *
 * ⚠️ 存出來的 auth/fb-state.json 等同你的 FB 帳號鑰匙。已經進 .gitignore，
 *    不要貼給任何人、不要 commit、不要放進雲端硬碟。
 *    登入狀態會過期（FB 大約幾個月），過期就再跑一次這支。
 */
import { chromium } from "playwright";
import { AUTH_FILE, FB_HOME, ensureDir, waitForEnter, authFileForIdentity, authAccountId, otherAuthFiles } from "./_shared.mjs";
import path from "node:path";

/**
 * 2026-10-07 發文身分：`--identity=<登入代號>`（後台「發文身分」頁每個身分卡片上有）存成這個身分自己的登入檔
 * （auth/fb-state-<代號>.json），**不會碰到主帳號的 fb-state.json**。沒加＝存主帳號，跟以前一模一樣。
 */
const identityArg = process.argv.slice(2).find((a) => a.startsWith("--identity="))?.slice("--identity=".length).trim();
let TARGET_FILE = AUTH_FILE;
if (identityArg) {
  try {
    TARGET_FILE = authFileForIdentity(identityArg);
  } catch (e) {
    console.error(`\n❌ ${e.message}`);
    console.error("   登入代號長這樣：acct-k7m2（在後台「發文身分」頁、那個身分的卡片上）。\n");
    process.exit(1);
  }
  console.log(`\n要登入的是發文身分「${identityArg}」，會存到：${TARGET_FILE}`);
  console.log("（主帳號的登入檔不會被動到）");
}

const browser = await chromium.launch({
  // 用系統已經裝好的 Chrome，不另外下載 150MB 的 chromium（C 槽吃緊）
  channel: "chrome",
  headless: false,
  args: ["--start-maximized"],
});

const context = await browser.newContext({ viewport: null, locale: "zh-TW" });
const page = await context.newPage();

console.log("開啟 Facebook…");
await page.goto(FB_HOME, { waitUntil: "domcontentloaded" });

/**
 * 🔴 存之前一定要確認真的登入了。
 *
 * FB 沒登入時也會給你一把 cookie（`datr`／`fr`／`sb`／`wd`／`dpr`），那些只是
 * 瀏覽器指紋，存下來檔案看起來很正常但完全沒用。真正代表「這是誰」的是
 * **`c_user`（帳號 id）**，代表「這段登入還有效」的是 **`xs`（session）**。
 *
 * 沒檢查的話會變成：這裡顯示「✅ 已存」，下一步抄欄位才報「登入過期」，
 * 而人根本不知道問題出在上一步 —— 2026-08-25 本人就是這樣卡住的。
 */
async function isLoggedIn() {
  const { cookies } = await context.storageState();
  const names = new Set(cookies.map((c) => c.name));
  return names.has("c_user") && names.has("xs");
}

const 指示 = [
  "─".repeat(60),
  "現在請在剛剛打開的那個瀏覽器視窗裡：",
  "",
  "  1. 自己輸入 FB 帳號密碼登入",
  "  2. 如果有二階段驗證（簡訊／驗證器），一併完成",
  "  3. 如果問「要記住這個瀏覽器嗎」→ 選記住，之後才不用一直重驗",
  "  4. 確認已經看到自己的首頁動態，而且中間有「在想些什麼」那個發文框",
  "",
  "⚠️ 慢慢來，不用急著按 Enter。登入沒完成就按的話存下來的檔是沒用的，",
  "   而且要到下一步「抄欄位」才會發現。",
  "",
  "全部完成之後，回到這個視窗按 Enter。",
  "（這支腳本看不到你輸入的任何東西，只會在你按 Enter 之後把 cookie 存起來）",
  "─".repeat(60),
].join("\n");

let 登入成功 = false;
for (let 第幾次 = 1; 第幾次 <= 3; 第幾次++) {
  await waitForEnter(第幾次 === 1 ? 指示 : "登入完成之後再按一次 Enter。");
  if (await isLoggedIn()) {
    登入成功 = true;
    break;
  }
  console.log("\n" + "─".repeat(60));
  console.log("⚠️  還沒偵測到登入狀態（缺 c_user / xs 這兩個 cookie）。");
  console.log("   代表瀏覽器裡還停在登入頁、或是二階段驗證還沒過。");
  console.log("   請回到瀏覽器把登入做完 —— 要看到自己的首頁動態才算。");
  console.log("─".repeat(60));
}

if (!登入成功) {
  console.error("\n❌ 試了三次都沒偵測到登入，這次不存檔。");
  console.error("   （刻意不存：存一個沒用的檔會蓋掉原本可能還能用的那份，");
  console.error("     而且要到下一步才會發現，反而更難查。）");
  console.error("\n   常見原因：FB 要求額外驗證（認照片／收信）、或登入卡在檢查點。");
  await browser.close();
  process.exit(1);
}

/**
 * 🔴 同一個 FB 帳號不能存成兩個身分（例：想登入第二個帳號，結果瀏覽器裡還是主帳號）。
 *    比對 c_user（帳號的數字編號，不是密碼）；撞到就不存，免得兩個身分其實是同一個帳號，
 *    各自有一份社團清單、各自排程，最後同一個帳號被當兩個人在發。
 */
{
  const { cookies } = await context.storageState();
  const newId = cookies.find((c) => c.name === "c_user")?.value;
  if (newId) {
    const dup = otherAuthFiles(TARGET_FILE).find((f) => authAccountId(f) === String(newId));
    if (dup) {
      console.error(`\n❌ 這次登入的帳號，跟另一個登入檔（${path.basename(dup)}）是同一個 FB 帳號，這次不存檔。`);
      console.error("   要登入的是「另一個」帳號——到瀏覽器先登出、換成那個帳號登入，再按 Enter。");
      console.error("   （如果其實就是同一個帳號，不用新增身分，直接用原本那個。）");
      await browser.close();
      process.exit(1);
    }
  }
}

ensureDir(path.dirname(TARGET_FILE));
await context.storageState({ path: TARGET_FILE });

console.log(`\n✅ 確認已登入，狀態存到：${TARGET_FILE}`);
console.log(
  identityArg
    ? "   下一步：雙擊 FB抓社團-其他帳號.bat（同一個登入代號），把這個帳號的社團抓進後台。"
    : "   下一步：npm run inspect（把 FB 發文框的結構抄下來）",
);
console.log("\n⚠️  這個檔等同 FB 帳號鑰匙，不要外流、不要 commit。");

await browser.close();
process.exit(0);
