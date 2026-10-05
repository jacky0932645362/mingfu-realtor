# FB 社團貼文／留言 —— 指定日期區間批次刪除（2026-09-20，本人要的「可以指定日期刪除的小程式」）
#
# 這個檔要存成 UTF-8 with BOM，中文才不會壞（見 learning_給本人點兩下的腳本）。
# 由桌面「批次檔案\FB刪社團貼文-指定日期.bat」呼叫，那個 .bat 的內容必須是純 ASCII。
#
# 流程：問日期區間、問要刪貼文還是連留言 → 直接刪。
#   2026-09-20 本人拍板：「小程式直接刪就好，不用再問我」——預覽那一步跟 YES 確認都拿掉了。
#   要先看清單不刪的話，用 delete-groups.mjs 不加 --confirm 自己跑。
# 真的刪會跑兩條路（FB 活動紀錄兩個畫面互相漏，2026-09-20 查證）：
#   ① 一個月開一次（直達那個月、快；跳月份畫面偶爾載入不全，所以帶 --sweep 連續兩輪都空才算乾淨）
#   ② 不篩月份從最新往下捲當保險（慢：從 2026 捲到 2025 年要一百多次；捲過區間就會自己停）
#   2026-09-20 晚上把順序對調成先①後②：①才是主力，②以前放前面害本人等很久還常被 FB 節流卡住。

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Continue"
$toolDir = "C:\Users\ming\Desktop\Agent-OS\card-booking\tools\fb-autopost"

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  FB 社團貼文／留言 —— 指定日期區間批次刪除" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "走的是 FB「活動紀錄 → 社團貼文和留言」。輸入完日期跟種類就直接刪，不會再問。" -ForegroundColor DarkGray
Write-Host "⚠️ 刪掉救不回來。刪之前每一篇會先寫進 deleted-log\。要中途停：直接關掉這個視窗。" -ForegroundColor Yellow
Write-Host ""

if (-not (Test-Path $toolDir)) { Write-Host "找不到工具資料夾：$toolDir" -ForegroundColor Red; Read-Host "按 Enter 關閉"; exit 1 }
Set-Location $toolDir
if (-not (Test-Path "$toolDir\auth\fb-state.json")) {
    Write-Host "還沒存過 FB 登入狀態。請先點桌面的「FB登入.bat」。" -ForegroundColor Red
    Read-Host "按 Enter 關閉"; exit 1
}

function Read-Date([string]$prompt, [string]$default) {
    while ($true) {
        $raw = Read-Host $prompt
        if ([string]::IsNullOrWhiteSpace($raw)) { $raw = $default }
        $raw = $raw.Trim() -replace '[/.．／]', '-'
        if ($raw -match '^\d{4}-\d{1,2}-\d{1,2}$') {
            $parts = $raw.Split('-')
            try {
                $d = Get-Date -Year ([int]$parts[0]) -Month ([int]$parts[1]) -Day ([int]$parts[2]) -Hour 0 -Minute 0 -Second 0
                return $d
            } catch { }
        }
        Write-Host "  日期格式不對，請用 2025-07-01 這種寫法。" -ForegroundColor Red
    }
}

Write-Host "要刪哪一段日期的？（兩端都含）" -ForegroundColor Yellow
$from = Read-Date "  開始日期（例：2025-07-01）" ""
$to   = Read-Date "  結束日期（直接 Enter = 跟開始同一天）" $from.ToString("yyyy-MM-dd")
if ($to -lt $from) { $t = $from; $from = $to; $to = $t }
$fromStr = $from.ToString("yyyy-MM-dd")
$toStr   = $to.ToString("yyyy-MM-dd")

Write-Host ""
Write-Host "要刪什麼？" -ForegroundColor Yellow
Write-Host "  1. 貼文（含帶相片、影片的）　← 直接 Enter"
Write-Host "  2. 貼文 ＋ 留言（自己在別人貼文下的留言、回覆）"
Write-Host "  3. 只刪留言／回覆"
$kindPick = Read-Host "輸入 1、2 或 3"
switch ($kindPick) {
    "2" { $kinds = "all";      $kindLabel = "貼文＋留言" }
    "3" { $kinds = "comments"; $kindLabel = "留言／回覆" }
    default { $kinds = "posts"; $kindLabel = "貼文（含相片）" }
}

# 區間內的月份清單（跳月份那條路用）
$months = @()
$cursor = Get-Date -Year $from.Year -Month $from.Month -Day 1
$last   = Get-Date -Year $to.Year -Month $to.Month -Day 1
while ($cursor -le $last) { $months += $cursor.ToString("yyyy-MM"); $cursor = $cursor.AddMonths(1) }
$monthsArg = ($months -join ",")

# 2026-09-20 本人拍板「刪除的數量不要限制」：--max=999 加 --force 解掉工具本身一次 50 篇的保險
# 節奏（工具預設）：每篇 6～8 秒、每 20 篇停 15 秒（2026-09-20 本人拍板，原本 8～15 秒／每 10 篇 45 秒）
$common = @("--from=$fromStr", "--to=$toStr", "--kinds=$kinds", "--max=999", "--force", "--confirm", "--sweep", "--sweep-rounds=20")

Write-Host ""
Write-Host "-------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "區間：$fromStr ～ $toStr　種類：$kindLabel　月份：$monthsArg" -ForegroundColor White
Write-Host "-------------------------------------------------------" -ForegroundColor DarkGray
Write-Host ""

function Invoke-Delete([string[]]$cliArgs) {
    # 一邊把 node 的輸出印出來，一邊把 RESULT_JSON 那行接住
    $script:lastResult = $null
    & node delete-groups.mjs @cliArgs 2>&1 | ForEach-Object {
        $line = "$_"
        if ($line.StartsWith("RESULT_JSON:")) {
            try { $script:lastResult = $line.Substring(12) | ConvertFrom-Json } catch { }
        } else {
            Write-Host $line
        }
    }
    return $LASTEXITCODE
}

$totalDeleted = 0

Write-Host "🔴 ① 跳月份那條路（$monthsArg，直達那幾個月；連續兩輪都沒東西才算乾淨）…" -ForegroundColor Red
Write-Host ""
$code = Invoke-Delete ($common + @("--months=$monthsArg"))
if ($script:lastResult -and $script:lastResult.deleted) { $totalDeleted += [int]$script:lastResult.deleted }
if ($code -ne 0) {
    Write-Host ""
    Write-Host "這一條中途停了（離開碼 $code）。已刪的有寫進 deleted-log\，接著跑不篩月份那條當保險。" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "🔴 ② 不篩月份那條路（保險）：從最新一路往下捲到那個區間，捲過就停；前面幾分鐘畫面很安靜是正常的…" -ForegroundColor Red
Write-Host ""
$code = Invoke-Delete ($common)
if ($script:lastResult -and $script:lastResult.deleted) { $totalDeleted += [int]$script:lastResult.deleted }
if ($code -ne 0) {
    Write-Host ""
    Write-Host "這一條中途停了（離開碼 $code）。已刪的有寫進 deleted-log\。" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Green
Write-Host "  完成：$fromStr ～ $toStr 的$kindLabel，這次共刪了 $totalDeleted 則。" -ForegroundColor Green
Write-Host "  清單在 $toolDir\deleted-log\" -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Green
Write-Host "想確認的話，再跑一次同樣的日期：讀到 0 則就是真的清光了。" -ForegroundColor DarkGray
Write-Host ""
Read-Host "按 Enter 關閉"
