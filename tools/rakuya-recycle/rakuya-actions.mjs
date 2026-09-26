/**
 * 真的在樂屋後台按東西：關閉舊物件、建立新物件（自動送出）。
 *
 * ⚠️ 第一版，還沒對真的樂屋帳號跑過——跟 fillRakuya.js 當初的處境一樣（它自己
 * 檔頭就寫「這是第一版，還沒對真的樂屋網跑過」），照著兩張截圖跟已經驗證過的
 * 591-extension/fillRakuya.js「應該長這樣」寫，第一次真的跑，紅字/例外訊息
 * 回頭調整這支檔案，不要照這裡的假設繼續往下蓋。
 *
 * 🔴 這支刻意不 import fillRakuya.js，是本人 2026-09-26 拍板的決定：fillRakuya.js
 * 是每天在用的正式 Chrome 外掛，不想因為這個新專案增加它的回歸風險，寧可另外
 * 寫一份。低階的「怎麼把值塞進表單欄位」那幾個小工具函式（setText/setSelect/
 * clickRadio…）刻意抄了 fillRakuya.js 已經驗證過的同一套 DOM 邏輯（同樣用 name
 * 屬性定位、同樣用「最近的 label 文字」找 radio），只是包成 page.evaluate() 能
 * 呼叫的樣子；真正屬於「填表商業邏輯」的部分（哪個欄位填什麼值）才是這支重寫的
 * 部分。以後樂屋表單改版，fillRakuya.js 那邊修的欄位對照，這裡不會自動跟著改，
 * 要記得手動比對兩邊——跟 591-extension／catalog-import.ts 是同一種已接受的取捨。
 *
 * 範圍只有出租（[[project_樂屋出租循環刊登]] 拍板），沒有port任何出售專屬欄位。
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { DATA_DIR, ensureDir } from "./_shared.mjs";

export async function launchContext({ headless = false } = {}) {
  ensureDir(DATA_DIR);
  const profileDir = path.join(DATA_DIR, "rakuya-profile");
  return chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless,
    viewport: null,
    args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
  });
}

/* ───────── 低階表單操作：照抄 fillRakuya.js 已驗證過的 DOM 邏輯，包成 page.evaluate() 能用的樣子 ───────── */

async function setText(page, name, value) {
  return page.evaluate(
    ([name, value]) => {
      const fire = (el, types) => types.forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
      const visible = (e) => !!e && e.offsetParent !== null && getComputedStyle(e).visibility !== "hidden";
      const els = [...document.querySelectorAll(`[name="${name}"]`)];
      const el = els.find(visible) || document.querySelector(`[name="${name}"]`) || document.getElementById(name);
      if (!el) return false;
      el.focus();
      el.value = value == null ? "" : String(value);
      fire(el, ["input", "change", "blur"]);
      return true;
    },
    [name, value],
  );
}

/** cascading 下拉：上一格 change 之後選項才會長出來，這裡用 Playwright 的 waitForFunction 頂住這個等待 */
async function setSelect(page, name, candidates, timeout = 6000) {
  const wants = [].concat(candidates).filter(Boolean);
  if (!wants.length) return false;
  try {
    await page.waitForFunction(
      ([name, wants]) => {
        const el = document.querySelector(`select[name="${name}"]`);
        if (!el) return false;
        const opts = [...el.options];
        return wants.some((w) => opts.some((o) => o.text.trim() === w || o.text.trim().includes(w)));
      },
      [name, wants],
      { timeout },
    );
  } catch {
    return false;
  }
  return page.evaluate(
    ([name, wants]) => {
      const fire = (el, types) => types.forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
      const el = document.querySelector(`select[name="${name}"]`);
      if (!el) return false;
      const opts = [...el.options];
      let opt = null;
      for (const w of wants) {
        opt = opts.find((o) => o.text.trim() === w) || opts.find((o) => o.text.trim().includes(w));
        if (opt) break;
      }
      if (!opt) return false;
      el.value = opt.value;
      fire(el, ["change"]);
      return true;
    },
    [name, wants],
  );
}

async function clickRadio(page, name, labelText) {
  return page.evaluate(
    ([name, labelText]) => {
      const txt = (e) => (e && e.textContent ? e.textContent.replace(/\s+/g, " ").trim() : "");
      const labelOf = (i) => txt(i.closest("label")) || (i.id && txt(document.querySelector(`label[for="${i.id}"]`))) || "";
      const rs = [...document.querySelectorAll(`[name="${name}"]`)].filter((i) => i.type === "radio");
      const r = rs.find((i) => labelOf(i) === labelText) || rs.find((i) => labelOf(i).startsWith(labelText));
      if (!r) return false;
      if (!r.checked) r.click();
      return true;
    },
    [name, labelText],
  );
}

async function setCheck(page, name, labelText, want) {
  return page.evaluate(
    ([name, labelText, want]) => {
      const txt = (e) => (e && e.textContent ? e.textContent.replace(/\s+/g, " ").trim() : "");
      const labelOf = (i) => txt(i.closest("label")) || (i.id && txt(document.querySelector(`label[for="${i.id}"]`))) || "";
      const boxes = [...document.querySelectorAll(`[name="${name}"]`)].filter((i) => i.type === "checkbox");
      const b = labelText ? boxes.find((i) => labelOf(i) === labelText) || boxes.find((i) => labelOf(i).startsWith(labelText)) : boxes[0];
      if (!b) return false;
      if (b.checked !== want) b.click();
      return true;
    },
    [name, labelText, want],
  );
}

async function setSummernote(page, text, html) {
  return page.evaluate(
    ([text, html]) => {
      const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
      const fire = (el, types) => types.forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
      const ed = document.querySelector(".note-editable");
      if (!ed) return false;
      ed.focus();
      ed.innerHTML = html || String(text || "").split("\n").map((l) => `<p>${esc(l) || "<br>"}</p>`).join("");
      fire(ed, ["input", "keyup", "change", "blur"]);
      return true;
    },
    [text, html],
  );
}

const has = (v) => v !== null && v !== undefined && v !== "";

/* ───────── 關閉舊物件 ───────── */

/**
 * 上架中物件列表 →找到指定物件那一列 →「成交/關閉」→原因選「關閉」→方式選
 * 「不方便帶看」（🔴 本人 2026-09-26 拍板固定選這個，不要選別的、不要每次問）
 * →確認送出。
 *
 * `matchText` 用來在列表裡認出正確的那一列（物件標題的一段獨特文字，例如
 * 「遠雄幸福成」），因為同一頁會有很多筆物件。
 */
export async function closeListing(page, { manageUrl, matchText }) {
  if (manageUrl) await page.goto(manageUrl, { waitUntil: "domcontentloaded" });

  const row = page.locator("tr, li, div").filter({ hasText: matchText }).first();
  const closeLink = row.getByText("成交/關閉", { exact: false }).first();
  await closeLink.waitFor({ timeout: 10000 });
  await closeLink.click();

  const dialog = page.getByText("成交 / 關閉物件", { exact: false }).first();
  await dialog.waitFor({ timeout: 8000 });

  // 原因下拉選「關閉」（不是「成交」——這支不處理已成交的情境）
  const reasonSelect = page.locator("select").filter({ hasText: "關閉" }).first();
  if (await reasonSelect.count()) await reasonSelect.selectOption({ label: "關閉" });

  // 方式：固定選「不方便帶看」
  await page.getByText("不方便帶看", { exact: true }).first().click();

  await page.getByRole("button", { name: "確認送出" }).click();

  // 送出後應該會離開彈窗／跳提示，這裡先確認彈窗真的關了，不然算失敗
  await dialog.waitFor({ state: "hidden", timeout: 8000 }).catch(() => {
    throw new Error("送出後彈窗沒有關閉，不確定是不是真的成功，需要人工確認");
  });
}

/* ───────── 建立新物件（自動送出）───────── */

/**
 * `listing` 是快照存的完整物件資料（跟 fillRakuya.js 收到的 payload 同一種形狀：
 * { rakuya, addr, area, price, layout, floor, deal:"rent", rent, desc, descHtml,
 *   community, photos, title }）。頁面要先手動 goto 到樂屋的出租刊登頁
 * （member.rakuya.com.tw/rent/post/...，實際路徑要本人帶著看過一次才能確定）。
 *
 * 跟 fillRakuya.js 最大的不同：**這支填完真的會按下「上架」送出**，不會停在
 * 「只填不送出」——這是 [[project_樂屋出租循環刊登]] 本人 2026-09-26 明確拍板
 * 的「全自動」範圍，本專案系列第一個跨過這條安全線的工具。
 */
export async function createListing(page, p) {
  const r = p.rakuya || {};
  const a = p.addr || {};
  const A = p.area || {};
  const L = p.layout || {};
  const f = p.floor || {};
  const R = p.rent || {};
  const X = r.rent || {};

  await page.waitForSelector('[name="usecode"], [name="city"]', { timeout: 15000 });

  /* 1. 類型三連選 */
  await setSelect(page, "selectPropertyUsecode", r.legal);
  await page.waitForTimeout(400);
  await setSelect(page, "usecode", r.usecode);
  await page.waitForTimeout(600);
  await setSelect(page, "typecode", r.typecode, 6000);
  await page.waitForSelector('[name="surfloors"]', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(400);

  /* 2. 名稱＋地址＋社區 */
  await setText(page, "hname", r.title25 || p.title || "");
  await setSelect(page, "city", a.city);
  await page.waitForTimeout(600);
  await setSelect(page, "zipcode", a.town, 6000);
  await page.waitForTimeout(800);
  if (a.road) await setSelect(page, "addr_road", [a.road], 8000);
  await setText(page, "addr_lane", a.lane || "");
  await setText(page, "addr_alley", a.alley || "");
  await setText(page, "addr_num", a.no ? `${a.no}${a.sub ? `之${a.sub}` : ""}` : "");
  await clickRadio(page, "is_community", r.isCommunity ? "是社區" : "非社區");
  if (r.isCommunity && p.community) {
    await page.waitForTimeout(900);
    const done = await setSelect(page, "community", p.community, 3000);
    if (!done) await setText(page, "community_new", p.community);
  }

  /* 3. 樓層／格局／屋齡／朝向／電梯／車位／坪數（只做出租分支） */
  await clickRadio(page, "floors_type", r.floorsType || "單層");
  await page.waitForTimeout(300);
  if (r.floorsType === "多層") {
    await setText(page, "floors_max", r.floorsMax ?? f.total ?? "");
  } else if (has(f.sell)) {
    await setText(page, "floors", f.sell);
  }
  await setText(page, "surfloors", f.total ?? "");
  if (has(L.room)) await setSelect(page, "bedrooms", String(L.room));
  if (has(L.hall)) await setSelect(page, "livingrooms", String(L.hall));
  if (has(L.bath)) await setSelect(page, "bathrooms", String(L.bath));
  if (has(r.ageYears)) await setText(page, "findate", r.ageYears);
  else await setCheck(page, "findateUnknow", null, true);
  if (p.facing) await setSelect(page, "direction", p.facing);
  const liftWant = /電梯大廈|華廈/.test(r.typecode || "") ? "有" : "無";
  const liftIsSelect = await page.locator('select[name="lifts"]').count();
  if (liftIsSelect) await setSelect(page, "lifts", liftWant);
  else await clickRadio(page, "lifts", liftWant);
  await clickRadio(page, "parkings", r.parkStatus === "無車位" ? "無車位" : "自有");
  await setText(page, "mainsize", R.usePing ?? A.main ?? "");
  if (has(A.land)) await setText(page, "basesize", A.land);
  await setSelect(page, "manage", r.manage || "無");
  await page.waitForTimeout(300);
  if (has(r.manageFee)) await setText(page, "securityfee", r.manageFee);

  /* 4. 租住條件 */
  await setText(page, "rental", R.monthly ?? "");
  for (const x of X.includes || []) await setCheck(page, "rental_include[]", x, true);
  await setSelect(page, "deposit_m", X.depositSel || "2個月租金");
  await clickRadio(page, "property_right", X.propertyRight || "有");
  await clickRadio(page, "short_rent", X.shortRent || "不可");
  await setCheck(page, "is_immigrate_anytime", null, X.anytime !== false);
  await clickRadio(page, "cook", X.cook || "可");
  await clickRadio(page, "pet", X.pet || "不可");
  await clickRadio(page, "sex", X.sex || "不限");
  await clickRadio(page, "ridentity", X.identity || "不限");
  await clickRadio(page, "landlord", X.landlord || "不與房東同住");

  /* 5. 描述、周圍環境（catalogUrl 這時候已經在 descHtml 最後一行的下一行，
        由快照存的時候就處理好，見 [[project_樂屋出租循環刊登]] 拍板） */
  if (p.desc) await setSummernote(page, p.desc, p.descHtml);
  const env = r.env || {};
  for (const k of ["elementary", "market", "park", "transport", "mrt", "vital_function"]) {
    if (env[k]) await setText(page, k, env[k]);
  }

  /* 6. 聯絡人 */
  await clickRadio(page, "isOwnerContact", "自行填寫");
  await page.waitForTimeout(400);
  if (r.contactName) await setText(page, "contact_name", r.contactName);
  if (r.tel2) await setText(page, "tel2", r.tel2);
  if (r.email) await setText(page, "email", r.email);

  /* 7. 照片：Node 直接 fetch 圖片位元組，不用像 fillRakuya.js 那樣繞道 chrome.runtime
        避開跨網域限制——Playwright 的 Node 端 fetch 本來就不受頁面的 CORS 限制。 */
  if (p.photos && p.photos.length) {
    await uploadPhotos(page, p.photos.slice(0, 25));
  }

  /* 🔴 跟 fillRakuya.js 最大的不同：這裡真的送出，不停在「只填不送出」。
        送出前小睡一下讓 Summernote／cascading 下拉最後的 change 事件跑完。 */
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "上架" }).click();
}

async function uploadPhotos(page, urls) {
  const input = page.locator('[name="surface_image_input"]');
  if (!(await input.count())) return;
  for (let i = 0; i < urls.length; i += 5) {
    const chunk = urls.slice(i, i + 5);
    const buffers = [];
    for (const u of chunk) {
      try {
        const res = await fetch(u);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = (res.headers.get("content-type") || "").includes("png") ? "png" : "jpg";
        buffers.push({ name: `${String(buffers.length + 1).padStart(2, "0")}.${ext}`, buffer: buf });
      } catch {
        /* 這張抓不到就跳過，不擋其他張 */
      }
    }
    if (buffers.length) {
      await input.setInputFiles(buffers.map((b) => ({ name: b.name, mimeType: "image/jpeg", buffer: b.buffer })));
      await page.waitForTimeout(2500);
    }
  }
}
