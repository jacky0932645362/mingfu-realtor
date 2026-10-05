# FB 貼文工廠 —— 發一則 Marketplace（自動填表單 + 可選自動發佈 + 可選勾社團）
#
# 這個檔要存成 UTF-8 with BOM，中文才不會壞（見 learning_給本人點兩下的腳本）。
# 由桌面「批次檔案\FB-Marketplace.bat」呼叫，那個 .bat 的內容必須是純 ASCII。

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"
$toolDir = "C:\Users\ming\Desktop\Agent-OS\card-booking\tools\fb-autopost"

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  FB 貼文工廠 - 發一則 Marketplace" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $toolDir)) {
    Write-Host "找不到工具資料夾：$toolDir" -ForegroundColor Red
    Write-Host "資料夾是不是搬走或改名了？" -ForegroundColor Red
    Read-Host "按 Enter 關閉"
    exit 1
}
Set-Location $toolDir

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "找不到 node —— Node.js 沒裝或不在 PATH 裡。" -ForegroundColor Red
    Read-Host "按 Enter 關閉"
    exit 1
}

if (-not (Test-Path "$toolDir\auth\fb-state.json")) {
    Write-Host "還沒存過 FB 登入狀態。請先點桌面的「FB登入.bat」。" -ForegroundColor Red
    Read-Host "按 Enter 關閉"
    exit 1
}

Write-Host "跑之前先在網站『貼文庫』把這則文案的 Marketplace 分頁補好：" -ForegroundColor Yellow
Write-Host "  價格 / 狀況(一定要選) / 商品說明 / 打算上架去哪些社團" -ForegroundColor Yellow
Write-Host "  上面那排紅字警告(門牌、Markdown...)也要先清掉。" -ForegroundColor Yellow
Write-Host ""
Write-Host "把那一頁的網址整段貼進來就好（也可以只貼最後那串 id）：" -ForegroundColor Gray
Write-Host "  .../admin/fb/library/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX?channel=marketplace" -ForegroundColor DarkGray
Write-Host ""

$raw = Read-Host "貼文庫網址或 draft id"
if ($raw -match '([0-9a-fA-F]{32})') {
    $draftId = $Matches[1].ToLower()
} elseif ($raw -match 'library/([^/?#\s]+)') {
    $draftId = $Matches[1]
} else {
    $draftId = $raw.Trim()
}

if ([string]::IsNullOrWhiteSpace($draftId)) {
    Write-Host "沒有讀到 id。" -ForegroundColor Red
    Read-Host "按 Enter 關閉"
    exit 1
}
Write-Host ""
Write-Host "draft id = $draftId" -ForegroundColor Green
Write-Host ""

# ── 照片來源 ──────────────────────────────────────────
Write-Host "照片要用哪裡的？" -ForegroundColor Yellow
Write-Host "  直接 Enter  = 用物件庫那筆的照片網址（預設）" -ForegroundColor DarkGray
Write-Host "  貼資料夾路徑 = 用那個資料夾裡的圖，依檔名排序、最多 10 張（例：D:\物件照\覓蜜）" -ForegroundColor DarkGray
$photoDir = (Read-Host "資料夾路徑（可留空）").Trim().Trim('"')

if (-not [string]::IsNullOrWhiteSpace($photoDir)) {
    if (-not (Test-Path $photoDir)) {
        Write-Host "找不到這個路徑：$photoDir" -ForegroundColor Red
        Read-Host "按 Enter 關閉"
        exit 1
    }
    $imgs = @(Get-ChildItem -LiteralPath $photoDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -match '(?i)\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$' })
    if ($imgs.Count -eq 0) {
        Write-Host "這個資料夾裡沒有圖片檔（不會看子資料夾）。確認一下路徑。" -ForegroundColor Red
        Read-Host "按 Enter 關閉"
        exit 1
    }
    Write-Host ("  → 這個資料夾有 {0} 張圖" -f $imgs.Count) -ForegroundColor Green
    if ($imgs.Count -gt 10) {
        Write-Host "  ⚠ 超過 10 張，只會用前 10 張（依檔名排序）。要精準就先整理成 10 張以內。" -ForegroundColor Yellow
    }
    Write-Host "  提醒：用資料夾就『完全不用』物件庫的照片了，兩邊不會混。" -ForegroundColor DarkGray
} else {
    Write-Host "  → 用物件庫的照片網址（Google 相簿要開公開分享）" -ForegroundColor Green
}
Write-Host ""

Write-Host "  1. 只填表單、存成 FB 草稿（不公開）—— 第一次跑這則、想先檢查用這個" -ForegroundColor Gray
Write-Host "  2. 填表單 + 真的發佈到 Marketplace（不勾社團）" -ForegroundColor Gray
Write-Host "  3. 填表單 + 發佈 + 同步上架到『打算上架去哪些社團』那份清單" -ForegroundColor Gray
Write-Host ""
$choice = Read-Host "輸入 1 / 2 / 3（直接 Enter = 1）"
if ([string]::IsNullOrWhiteSpace($choice)) { $choice = "1" }

$mpArgs = @("post-marketplace.mjs", "--draft=$draftId")
if (-not [string]::IsNullOrWhiteSpace($photoDir)) { $mpArgs += "--photos=$photoDir" }
switch ($choice) {
    "1" { }
    "2" { $mpArgs += "--publish" }
    "3" { $mpArgs += "--publish"; $mpArgs += "--crosspost" }
    default {
        Write-Host "沒有這個選項。" -ForegroundColor Red
        Read-Host "按 Enter 關閉"
        exit 1
    }
}

if ($choice -ne "1") {
    Write-Host ""
    Write-Host "⚠ 選 $choice 會真的把商品發佈到你的 FB Marketplace（公開）。" -ForegroundColor Yellow
    if ($choice -eq "3") {
        Write-Host "  而且會照『打算上架去哪些社團』的清單真的去勾社團、一起公開。" -ForegroundColor Yellow
    }
    $ok = Read-Host "確定要發佈就輸入 y，其它任何鍵取消"
    if ($ok -ne "y") {
        Write-Host "取消了，什麼都沒做。" -ForegroundColor DarkGray
        Read-Host "按 Enter 關閉"
        exit 0
    }
}

Write-Host ""
Write-Host "開始跑… 瀏覽器會自己開，過程不要動它。" -ForegroundColor Cyan
Write-Host ""
node $mpArgs

Write-Host ""
if ($LASTEXITCODE -eq 0) {
    if ($choice -eq "1") {
        Write-Host "完成：表單已填好、存成 FB 草稿（還沒公開）。" -ForegroundColor Green
        Write-Host "去 FB Marketplace →『你的商品』找草稿，對一下標題／價格／照片／說明，" -ForegroundColor Green
        Write-Host "沒問題就自己按發佈，或回來這裡選 2 / 3 讓程式發。" -ForegroundColor Green
    } else {
        Write-Host "完成：已發佈。截圖在 tools\fb-autopost\shots\，" -ForegroundColor Green
        Write-Host "去 FB Marketplace →『你的商品』對一下內容。" -ForegroundColor Green
    }
} else {
    Write-Host "沒有正常結束（離開碼 $LASTEXITCODE）。上面的訊息是原因，截圖在 shots\。" -ForegroundColor Red
    Write-Host "常見：狀況沒選、Google 相簿沒開公開分享、登入過期。" -ForegroundColor Red
}
Write-Host ""
Read-Host "按 Enter 關閉"
