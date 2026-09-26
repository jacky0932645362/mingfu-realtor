/**
 * 第一次設定用：開一個看得到畫面的瀏覽器，本人自己登入樂屋「刊登會員」身份，
 * 登入完直接關掉這個視窗就好——session 會留在 data/rakuya-profile/（gitignore），
 * 之後 recycle-runner.mjs 用同一個 profile 就是已登入狀態，不用每次都登入。
 *
 * 跑法：node login.mjs
 *
 * 跟 property-watch 的 Cloudflare 通關狀態留得住是同一個道理，只是這裡留住的
 * 是「刊登會員」的登入 session，不是反爬蟲通關記錄。
 */
import { launchContext } from "./rakuya-actions.mjs";

const context = await launchContext({ headless: false });
const page = await context.newPage();
await page.goto("https://www.rakuya.com.tw/");

console.log("\n請在這個瀏覽器視窗裡，用「刊登會員」身份登入樂屋網。");
console.log("密碼請自己輸入，不要貼給任何程式或 AI。");
console.log("登入完成、確認能看到「我的樂屋」之後，直接關閉這個瀏覽器視窗即可，這支程式會自動結束。\n");

await new Promise((resolve) => {
  context.on("close", resolve);
});
