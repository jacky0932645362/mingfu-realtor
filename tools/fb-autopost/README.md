# FB 自動發文

把 `posts/` 裡排好的貼文，用 Playwright 發到 FB 個人主頁與社團。
另外可以從「活動紀錄」批次刪掉自己在社團發過的舊貼文（`delete-groups.mjs`）。
`runner.mjs` 接官網後台「FB 貼文工廠」排好的排程，桌機到點自己撈來發（見文末）。
之後會再擴充 Marketplace 刊登。

## 為什麼是這個做法

FB 個人主頁**沒有官方發文 API**（Graph API 只開放粉絲專頁），Marketplace 對個人也沒有，
所以只能用瀏覽器自動化模擬操作。這代表：

- **FB 一改版就會壞。** 所有瀏覽器自動化的通病，躲不掉。
- **修的方式是重跑 `inspect` 換 selector**，程式碼不用動。

所以設計目標不是「越自動越好」，是**「壞掉的時候好修、出事的機率壓到最低」**：
一次一篇（沒有批次迴圈）、每步停 0.3～0.9 秒、預設貼好停住等人按發布、
欄位對映全部外部化到 `config/selectors.json`。

## 腳本 ＋ 一個設定檔

| 檔 | 做什麼 |
|---|---|
| `save-login.mjs` | 開瀏覽器讓**本人自己登入**，存 cookie。腳本看不到帳密 |
| `inspect-composer.mjs` | 抄下 FB 畫面的按鈕與欄位 → `config/*-dump.json`（吃 `feed`／`marketplace`／`group`／`activity`） |
| `new-post.mjs` | 從物件資料庫產一篇貼文草稿丟進 `posts/` |
| `post.mjs` | 撈一篇該發的 → 開發文框 → 打字 → 上傳照片 → 停住（或送出） |
| `delete-groups.mjs` | 從「活動紀錄 → 社團貼文和留言」批次刪自己的社團舊貼文（預設只看不刪） |
| `config/selectors.json` | **唯一要維護的檔**。FB 改版只改這個，程式碼一行不動 |

⭐ **為什麼要有 inspect 這一步**：FB 的 class name 是每次改版都會變的亂碼
（`x1i10hfl x1qjc9v5 …`），aria-label 又跟介面語言綁在一起。Claude 看不到你的 FB 畫面，
硬猜 selector 的結果就是點錯按鈕。所以改成讓程式自己去問那一頁。
**FB 改版時的標準流程就是重跑 inspect、把 dump 檔貼給 Claude 換 selector。**

抄的時候處理了三個坑（2026-08-25 另一個視窗實抄 591 踩到的，
FB／Marketplace 是 React 做的，同樣適用）：

1. **標籤常常是輸入框的「兄弟節點」**，不是父節點也不是 `<label for>`。
   一般抄法會抄回一整排「(無標籤)」。這裡改成往上走四層、每層扣掉自己的文字再撿。
2. **自動產生的 id 不能用**（FB 的 `:r3h:`、`jsc_c_1x`，Ant Design 的 `rc_select_7`）——
   照抄回來但標成 `id能不能用: false`，免得有人拿去寫 selector，改版時整排位移。
3. **下拉選項 render 在 body 的 portal**，不在表單裡面 —— 另外掃一次，
   在表單範圍內找不到選項時就是被丟到那裡了。

## 怎麼用

桌面的 `.bat`，點兩下就好：

1. **FB登入.bat** —— 只有第一次、以及 cookie 過期時要跑
2. **FB抄欄位.bat** —— 選 1（首頁發文框）／2（Marketplace）／3（分享到社團）／4（活動紀錄，批次刪文用）
3. **FB發文.bat** —— 產草稿、發文都從這裡
4. **FB刪社團貼文.bat** —— 批次刪社團舊貼文（會先跑「只看不刪」讓你確認）

終端機的話：

```
npm run login              存登入狀態
npm run inspect            抄首頁發文框
npm run inspect:activity   抄「活動紀錄 → 社團貼文和留言」（批次刪文用）
npm run draft              從物件資料庫產草稿
npm run list               看佇列
npm run post               發下一篇（貼好停住）
npm run delete:groups      批次刪社團舊貼文（預設只看不刪）
npm test                   全部離線測試
```

## 批次刪社團貼文（`delete-groups.mjs`）

有些社團規定「N 天要自己刪文重發」，或物件賣掉了要把散在各社團的貼文收回來。
這支從 FB 自己的「活動紀錄 → 社團貼文和留言」進去，一列一列刪 —— 不需要事先記
貼文網址，FB 的活動紀錄本身就是清單。（做法參考別人的教學截圖。）

```
node delete-groups.mjs                     只看：列出會刪哪幾篇，什麼都不刪
node delete-groups.mjs --confirm            🔴 真的刪
node delete-groups.mjs --from-post=檔名     只刪「那一篇文案」發出去的（比對開頭文字）
node delete-groups.mjs --match="698萬海景"  只刪內文含這串字的（--from-post 的手動版）
node delete-groups.mjs --older-than=30      只處理 30 天前的（預設不限日期）
node delete-groups.mjs --max=10             這次最多刪幾篇（預設 5）
node delete-groups.mjs --include-undated    連「日期看不出來」的也刪（預設跳過）
```

### 「發一篇到 10 個社團，之後要刪掉那 10 篇」

同一篇文案發到多個社團，內文（尤其第一行鉤子）是一樣的，`--from-post` 就靠這個認：

```
1. 發文：node post.mjs 2026-09-05-梧棲海景.md          （發到個人主頁＋勾選的社團）
2. 過幾天想刪：
   node delete-groups.mjs --from-post=2026-09-05-梧棲海景.md --max=15        （先看清單）
   node delete-groups.mjs --from-post=2026-09-05-梧棲海景.md --max=15 --confirm  （確認後真刪）
```

`--from-post` 只會刪內文對得上那一篇的，中間你又發了別的文案都不會被掃到。
`--max` 記得開到「社團數 + 個人主頁」以上（10 個社團就給 `--max=15` 保險）。

📌 **預設只看不刪**，跟 `post.mjs` 一樣 —— 刪 FB 貼文救不回來，先看清單再 `--confirm`。
📌 **刪之前先把內文與連結寫進 `deleted-log/`**，就算刪錯也知道刪掉的是什麼。
📌 **一次最多 50 篇**（`--force` 才解得開）、**每篇之間隔 6～8 秒、每 20 篇停 15 秒**（2026-09-20 本人拍板，原本 8～15 秒／每 10 篇 45 秒）——
   短時間連續刪自己的貼文跟連續發文一樣是異常訊號。
📌 **活動紀錄裡社團貼文有四種樣子**（⋯ 的 aria：在XX社團發佈了貼文／新增了 N 張相片／只有名字／只有「更多選項」），
   第四種（帶縮圖的貼文）數量最多，2026-09-20 才抓到——之前 8/14～8/15 那 59 篇全是它，工具一直以為那幾天沒東西。
📌 從清單**最下面往上刪**，`.nth()` 才不會因為前面的列被刪掉而位移；每一列刪之前
   還會再比對一次內文，對不上就停，絕不刪一個沒把握的。

⚠️ ⋯ 鈕、查看連結、直達網址已對到真實 DOM（2026-09-02）；⋯ 選單裡「刪除」的字＋確認框還沒抄到。
   先 `npm run inspect:activity`（或「FB抄欄位.bat」選 4），把 `config/activity-dump.json`
   貼回對話。在那之前跑多半會在「找不到 XXX」停住 —— 這是設計成這樣，不會亂刪。

⚠️ 這裡是「刪貼文」不是「清垃圾桶」。個人主頁貼文刪除後會進垃圾桶留 30 天；
   永久清除那種不自動化。

## 貼文檔格式

`posts/` 底下一篇一個 `.md`：

```markdown
---
status: pending
publishAt: 2026-08-26 09:00
photos:
  - https://res.cloudinary.com/…/a.jpg
source: property:2002450b-…
---
第一行是鉤子

底下是內文…
```

- `status`：`pending` → `posted` / `failed`。發完程式自己改。
- `publishAt`：本地時間。留空＝隨時可發。
- `photos`：一行一筆，發文時每個社團都會上傳。三種寫法可混用：
  - **網址**（`https://…`）→ 抓下來再上傳（官網物件照、Cloudinary 走這條）
  - **本機圖片檔**（`D:\物件照\禾盛晶綻\01.jpg`）→ 直接用
  - **本機資料夾**（`D:\物件照\禾盛晶綻\`）→ 展開成裡面所有圖片（依檔名排序）——整個資料夾丟進來最省事
  photos 有列但一張都備不出來（路徑打錯之類）→ 程式停下來問，不會默默發成沒圖的。

## 📌 拍板的幾件事

**預設只貼不送出。** 發布那一下自己按，確認穩定之後才加 `--publish` 交給排程。
理由：第一次接上去的時候，壞掉的後果應該是「沒發出去」，而不是「發錯東西出去」——
FB 貼文刪掉了，看到的人也已經看到了。

**兩篇之間至少隔 90 分鐘**（`MIN_GAP_MINUTES`，可用環境變數調）。
連續發文是最容易被判定成異常帳號的行為。`--force` 可以蓋過，但預設擋住。

**一次只發一篇，沒有批次迴圈。** 一天要發三篇就讓排程器叫三次。

**打完字一定對答案。** 內文如果被 FB 的編輯器吃掉超過一成就中止，
不繼續往下按發布——發出一篇殘缺的貼文而且沒人發現，比整篇沒發出去嚴重。

**文案跟後台用同一個函式**（`src/lib/export-fb.ts`），不會出現
「後台顯示 A、實際發出去 B」。跟 `export-591.ts` 同一個原則。

## 🧑 擬真模式（`humanize.mjs`，2026-09-18，預設開）

讓「動作節奏」像一個人在用，不像排程器在跑。三件事：

| | 做什麼 | 在哪 |
|---|---|---|
| **隨機冷卻** | 社團之間基準 4 分 × 0.75～1.25 ＝ **3～5 分**（2026-09-19 本人拍板「一般社團發文間隔 3 到 5 分鐘發一則」）；每一步的停頓本來就是隨機區間；社團冷卻天數每輪隨機加碼（7 天 → 7～10 天，後台 `fb-humanize.ts`） | `post.mjs`／後台排程頁 |
| **發文時間抖動** | 認領到之後開瀏覽器前再等 0～45 秒，避開排程器的 5 分鐘格線。分鐘級的抖動（排程當下抽 0～N 分存進 `fb_task_run.jitter_sec`，runner 等到 run_at＋抖動才撈）程式都在，但 **2026-09-19 本人拍板預設關**（排定幾點就幾點，他自己規劃），要開設 `FB_JITTER_MAX_MINUTES` | 後台 `createFbTask`／`runner.mjs` |
| **滑鼠軌跡擬人化** | 點按鈕前游標沿三次貝茲曲線移過去、先快後慢、三成機率衝過頭再拉回、落點常態分佈在中間附近、按下到放開停 45～130ms；打字切成一次 2～6 字、標點後停；進頁面先捲一捲再動手；等上傳時游標小幅晃動 | `post.mjs`／`post-marketplace.mjs` |

🔴 **每個擬真動作都有退路**：抓不到座標、落點被蓋住、任何一步出錯 → 退回 Playwright 原本的
`locator.click()`。擬真失敗絕對不能變成「發不出去」。

🔴 **只做節奏，不做偽裝**：不碰 `navigator.webdriver`、不改瀏覽器指紋、不換 IP。那些 FB 一升級
偵測就整包失效，而且真正決定帳號安不安全的是發文量、同一篇灌幾個社團、內容重複度、
社團管理員有沒有檢舉 —— 擬真不是讓你可以灌更多。

調整（`.env.local`，不設就用預設）：
```
FB_HUMANIZE=0                 整個關掉（桌機那半）
FB_GAP_JITTER=0.75-1.25       社團間隔倍數區間（基準 FB_GROUP_GAP_MINUTES=4 → 3～5 分）
FB_START_JITTER_MAX_SEC=45    開瀏覽器前的秒級抖動上限
FB_JITTER_MAX_MINUTES=0       排程時間抖動上限（後台；線上要在 Vercel 設）。預設 0＝關（本人拍板），要抖再設例如 20
FB_COOLDOWN_JITTER_RATIO=0.5  冷卻天數加碼比例（後台），0 = 關
```
`FB_FAST=1`（端對端測試打假頁面）會一起關掉擬真。測試：`npm run test:humanize`（83 項離線），
`test-post-e2e.mjs` 則是擬真開著對假頁面真的走一遍（滑鼠曲線＋分段打字都會跑到）。

## ⏱ 節奏保護（資料庫版，`src/lib/fb-rhythm.ts`，2026-09-19）

本人問「一般貼文跟 Marketplace 不小心排到同一時間會怎樣？」查出兩個洞：post.mjs 自己的
「兩篇隔 90 分」「一天最多 N 次」是看 `posts/*.md` 算的，但 runner 做完就把 `task-*.md` 刪掉
→ 做完的那些它看不到，等於 runner 模式下只在同一份工作裡有效；而且 Marketplace 根本不在那本帳裡，
一般貼文剛發完 Marketplace 會立刻接著刊登。所以**認領那一步改用資料庫再擋一次**：

| 規則 | 預設（2026-09-19 本人拍板後） | 環境變數 |
|---|---|---|
| 一般貼文 ↔ 一般貼文（不同文案）至少隔 | 90 分 | `FB_MIN_GAP_MINUTES`（跟 post.mjs 同一個） |
| 一般貼文 ↔ Marketplace（跨通路）至少隔 | **0 ＝ 不管** | `FB_CHANNEL_GAP_MINUTES` |
| 今天發到的地方（動態＋每個社團）上限 | **0 ＝ 不設限** | `FB_MAX_PER_DAY`（跟 post.mjs 同一個；.env.local 也設 0） |
| Marketplace 本身 | **不受任何間隔／上限管** | — |

🔴 本人 2026-09-19 拍板：「發布社團不要設限發文次數；一般社團發文間隔 3 到 5 分鐘一則；Marketplace 就一次
上架即可（本來就能勾 20 個社團做一次性上架）」。所以每日上限與跨通路預設都是 0，Marketplace 完全不算次數、
不等間隔，只跟其他工作排隊（一次一個瀏覽器）。留著的只有「兩篇不同文案隔 90 分」。
同一份工作接著發剩下的社團不受這裡管（那是 post.mjs 的 GROUP_GAP 3～5 分）。
被擋的任務**維持「等時間到」**，runner 每 5 分鐘再看一次，log 會印「⏸ 有到期的，但上一篇 6 分鐘前才發…還要等約 85 分」。
排到同一時間：runner 一輪固定「一般貼文 → Marketplace → 刪文」，一次只開一個瀏覽器，所以是排隊不是同時；
排程頁與排下去的訊息都會標「⏳ 跟『X』只差 N 分：這筆會等它發完、再隔滿 30 分才發」。

同一天順手拉長的三個天花板（社團間隔隨機化之後原本的會撞）：runner 給 post.mjs 的逾時 25 分 → 3 小時
（`FB_RUNNER_JOB_TIMEOUT_MINUTES`）、認領 30 分視為過期 → 240 分、工作排程器整輪上限 1 小時 → 4 小時
（**要重跑桌面「FB-Runner-排程.bat」才會套用到已裝好的排程**）。測試：`npm run test:rhythm`（40 項離線）。

## 🔴 auth/fb-state.json 等同 FB 帳號鑰匙

存的是 FB 的登入 cookie。已進 `.gitignore`（連同 `shots/`、`posts/`、`tmp/`、`config/*-dump.json`）。
不要 commit、不要貼給任何人、不要放雲端硬碟。過期就重跑 `npm run login`。

## 測試（`npm test`，共 163 項，都不需要 FB 帳號）

**`test-fb-post.mjs` —— 57 項，純離線。**
貼文檔的解析與往返、時區（差 8 小時就是發錯時段）、該發哪一篇、
文案內容，以及**四項外洩檢查**（完整門牌、屋主底價、Email、TOP1 措辭禁忌）。

**`test-post-e2e.mjs` —— 62 項，自己蓋假頁面讓真的程式去跑。**
`test-fake-fb.html` 是結構跟 FB 一樣的假發文頁，
`test-fake-marketplace.html` 專門重現抄欄位的三個坑。驗的是：
完整發一篇（打字＋照片＋送出）、**照片來源（data URL／本機檔／整個資料夾）**、
**photos 有列但全備不出來要中止**、已發過的不再發、90 分鐘間隔、空內文不發、
**FB 改版時要停住而不是發出殘缺的**、挑哪一篇、抄欄位抄不抄得全。

**`test-delete-e2e.mjs` —— 44 項，假的活動紀錄頁讓真的 `delete-groups.mjs` 去跑。**
`test-fake-activity-log.html` 是結構跟「活動紀錄 → 社團貼文和留言」一樣的清單頁。驗的是：
日期字串解析（年月日／「3 天前」／看不懂的回 null）、預設只看不刪、`--confirm` 剛好刪 N 篇、
`--older-than` 跳過近期與日期不明的、`--include-undated`、
**`--match` / `--from-post` 只刪內文對得上的**、
**selector 壞掉要停住不亂刪**、`--max` 超上限要擋、沒東西可刪時不硬做、`deleted-log/` 有寫。

### 這兩支測試抓到過的東西

- 🐛 **發布按鈕永遠找不到**：`selectors.json` 裡寫成
  `div[role="dialog"] div[role="button"][aria-label="發佈"]`，
  但程式已經把範圍限定在 dialog 裡，等於在找「dialog 裡面的 dialog」。
  **接上真的 FB 也會炸**，而且症狀是「文字都打好了卻卡在最後一步」。
- 🐛 **沒有終端機時會永遠卡住**：`waitForEnter` 只等 `data` 事件，
  遇到 EOF（排程器、`< /dev/null`）不會回，畫面上還什麼都看不出來。

瀏覽器那段接上真 FB 才驗得了 selector，但主迴圈的邏輯已經驗過了 ——
「接上去那天才發現不會動」這件事先擋掉。

## 現況

- ✅ 個人主頁貼文：selector 已校正、第一篇已實際發出（2026-09-02，草稿模式）
- ✅ 社團發文：`post.mjs` 支援多目標，社團發文框已抄回、selector 已填
- ✅ 照片：`photos:` 吃網址／本機檔／整個資料夾（`preparePhotos()`），每個社團都會傳
- 🆕 批次刪社團貼文：`delete-groups.mjs` 寫完、163 項測試全過（57＋62＋44）
  含 `--from-post`（發一篇到 N 個社團後，精準刪掉那一篇的所有分身）。
  ⚠️ **`activity_delete` 的 selector 全部『已驗證: false』** —— 要先 `npm run inspect:activity`
  校正才能真的用。在那之前跑會停在「找不到 XXX」，不會亂刪。
- 🔲 Marketplace 刊登：inspect 已支援，發文腳本還沒寫（要先看 dump）
- 🆕 **`runner.mjs`：接官網後台的排程，到點自己撈來發**（2026-09-03，見下）

---

## `runner.mjs` —— 官網後台排好的排程，桌機到點自己發

官網後台 `/admin/fb`（FB 貼文工廠）只是遙控器：**Vercel 上跑不了瀏覽器、沒有你的 FB 登入**，
所以它只把「幾點發什麼到哪」寫進雲端資料庫的 `fb_task` / `fb_task_item`。
`runner.mjs` 在**這台桌機**上跑，到點撈走、叫 `post.mjs` 真的發、把結果回寫。

```
後台排程 → fb_task（TiDB）→ runner.mjs 撈走 → post.mjs（Playwright）→ 真的發 → 回寫狀態
```

⭐ **`runner.mjs` 不改 `post.mjs` 一個字。** 它把工作寫成一個 `posts/task-xxxx.md`，
叫 `post.mjs` 去跑，再讀回結果 —— 白撿 `post.mjs` 所有已驗證過的行為
（打完字對答案、擋 Markdown、90 分鐘間隔、社團沒討論分頁就跳過）。

### 設定（一次）

`card-booking/.env.local` 要有（Claude 2026-09-03 已幫你產好 `FB_RUNNER_TOKEN`）：

```
FB_RUNNER_TOKEN="<一長串，跟後台同一把，≥16 字>"
FB_RUNNER_URL=http://localhost:3000/api/fb/runner   # 本機測試用；線上換成正式網址
FB_RUNNER_POLL_MINUTES=5
```

🔴 `FB_RUNNER_TOKEN` **不要加 `NEXT_PUBLIC_` 前綴**（會被打包進前端等於公開）。
🔴 同一把也要填進 **Vercel 專案設定**，否則線上後台的 `/api/fb/runner` 是關閉的（回 503/401）。

### 用法

```
npm run runner          # 常駐輪詢，每 5 分鐘看一次有沒有到期的排程
npm run runner:once     # 撈一輪就結束 —— 給 Windows 工作排程器每 5 分鐘叫一次
npm run runner:ping     # 只確認連得到後台、密鑰對不對
npm run runner:dry      # 撈一輪但不開瀏覽器、不回報（看會發什麼）
```

要「電腦開著就自動發」→ 用 `runner:once` 配 Windows 工作排程器（跟 `物件追蹤` 那套一樣）。
要「我看著它發」→ 直接 `npm run runner`。

### 「草稿模式」還是「全自動」

後台排程時有個開關「程式自己按發佈」：

- **關**（預設安全）→ runner 開瀏覽器、打好字、上傳照片，**停在最後一步等你按**。
- **開** → runner 自己按「繼續 → 發佈」，全程不用你在。打完字還是會讀回來對答案，
  少超過一成就中止不發。

第一次接真 FB 建議先關著跑順幾次再開。

### `import-groups.mjs` —— 把抓好的 152 個社團搬進後台

```
node import-groups.mjs --taichung   # 只出名稱含台中／海線關鍵字的（建議）
node import-groups.mjs --all         # 全部 152 個
node import-groups.mjs               # 只出 groups.json 裡「啟用: true」的
```

會產出 `config/groups-for-paste.txt`，用記事本打開、全選複製，
貼進後台「社團清單 → 新增社團」的框（一次一整批）。

### 現況（2026-09-03）

- ✅ runner ↔ 後台 API 的認領／回報／收尾迴圈：對真實排程資料跑通（`--dry`）
- ✅ `FB_RUNNER_TOKEN` 已產、API 健檢通過
- ⚠️ **真的開瀏覽器發那一段還沒接真 FB 驗過** —— 沿用 `post.mjs`，但 runner 這層的
  「寫貼文檔 → 叫 post.mjs → 讀回結果」還沒跑過一次真的
- 🔲 Windows 工作排程器還沒設（要本人自己點 `.bat`，Claude 不代跑）
- 🔲 整包還沒 commit
