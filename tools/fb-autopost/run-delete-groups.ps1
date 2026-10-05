# FB 自動發文 —— 批次刪「社團貼文和留言」
#
# 這個檔要存成 UTF-8 with BOM，中文才不會壞（見 learning_給本人點兩下的腳本）。
# 由桌面的「FB刪社團貼文.bat」呼叫，那個 .bat 的內容必須是純 ASCII。

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"
$toolDir = "C:\Users\ming\Desktop\Agent-OS\card-booking\tools\fb-autopost"

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  FB 批次刪社團貼文（活動紀錄 -> 社團貼文和留言）" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "預設是「只看不刪」：先列出會刪哪幾篇，讓你確認。" -ForegroundColor DarkGray
Write-Host "確認清單沒問題，再選「真的刪」重跑一次。" -ForegroundColor DarkGray
Write-Host ""
Write-Host "⚠️ FB 貼文刪掉救不回來。刪之前每一篇的內文與連結會先寫進 deleted-log\。" -ForegroundColor Yellow
Write-Host ""

if (-not (Test-Path $toolDir)) {
    Write-Host "找不到工具資料夾：$toolDir" -ForegroundColor Red
    Read-Host "按 Enter 關閉"
    exit 1
}

Set-Location $toolDir

if (-not (Test-Path "$toolDir\auth\fb-state.json")) {
    Write-Host "還沒存過 FB 登入狀態。請先點桌面的「FB登入.bat」。" -ForegroundColor Red
    Read-Host "按 Enter 關閉"
    exit 1
}

if (-not (Test-Path "$toolDir\config\activity-dump.json")) {
    Write-Host "⚠️ 還沒抄過活動紀錄的畫面結構。" -ForegroundColor Yellow
    Write-Host "   selector 沒對過真實畫面，這次很可能會在某一步停住（不會亂刪）。" -ForegroundColor Yellow
    Write-Host "   要先抄：點「FB抄欄位.bat」選 4。" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "要刪哪些？" -ForegroundColor Yellow
Write-Host "  A. 只刪某一篇文案發出去的（發到 N 個社團後，清掉那一篇的所有分身）"
Write-Host "  B. 照日期／篇數刪（社團規定 N 日刪文、清舊貼文）"
Write-Host ""
$mode = Read-Host "輸入 A 或 B"

$cliArgs = @()

if ($mode -ieq "A") {
    Write-Host ""
    Write-Host "posts\ 裡的貼文檔：" -ForegroundColor DarkGray
    Get-ChildItem "$toolDir\posts\*.md" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $($_.Name)" -ForegroundColor DarkGray }
    Write-Host ""
    $fromPost = Read-Host "輸入發文時用的檔名（例：2026-09-02-測試.md）"
    if ([string]::IsNullOrWhiteSpace($fromPost)) {
        Write-Host "沒輸入檔名，取消。" -ForegroundColor Red
        Read-Host "按 Enter 關閉"
        exit 1
    }
    $cliArgs += "--from-post=$fromPost"
    $max = Read-Host "最多刪幾篇？（發到幾個社團就填幾 + 2，直接 Enter = 15）"
    if ($max -match '^\d+$') { $cliArgs += "--max=$max" } else { $cliArgs += "--max=15" }
}
else {
    $older = Read-Host "只刪幾天前的貼文？（直接 Enter = 不限日期）"
    $max   = Read-Host "這次最多刪幾篇？（直接 Enter = 5）"
    if ($older -match '^\d+$') { $cliArgs += "--older-than=$older" }
    if ($max   -match '^\d+$') { $cliArgs += "--max=$max" }
}

Write-Host ""
Write-Host "先跑一次「只看不刪」…" -ForegroundColor Cyan
Write-Host ""
node delete-groups.mjs @cliArgs

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "沒有正常結束（離開碼 $LASTEXITCODE）。上面的訊息是原因。" -ForegroundColor Red
    Read-Host "按 Enter 關閉"
    exit 1
}

Write-Host ""
Write-Host "-------------------------------------------------" -ForegroundColor DarkGray
$go = Read-Host "上面這幾篇要真的刪掉嗎？輸入大寫 YES 才會刪，其他都是取消"
if ($go -ceq "YES") {
    Write-Host ""
    Write-Host "🔴 真的刪…" -ForegroundColor Red
    Write-Host ""
    node delete-groups.mjs --confirm @cliArgs
    Write-Host ""
    if ($LASTEXITCODE -eq 0) {
        Write-Host "刪完了。清單在 $toolDir\deleted-log\" -ForegroundColor Green
    } else {
        Write-Host "中途停了（離開碼 $LASTEXITCODE）。已刪的部分有寫進 deleted-log\。" -ForegroundColor Red
    }
} else {
    Write-Host "取消，什麼都沒刪。" -ForegroundColor Green
}

Write-Host ""
Read-Host "按 Enter 關閉"
