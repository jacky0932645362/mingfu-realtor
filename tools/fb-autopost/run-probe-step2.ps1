# FB 自動發文 —— 抄「第二步」（發文 + Marketplace）
#
# 這個檔要存成 UTF-8 with BOM，中文才不會壞（見 learning_給本人點兩下的腳本）。
# 由桌面的「FB抄第二步.bat」呼叫，那個 .bat 的內容必須是純 ASCII。

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"
$toolDir = "C:\Users\ming\Desktop\Agent-OS\card-booking\tools\fb-autopost"

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  FB 自動發文 - 抄「第二步」" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "FB 這兩個流程都是兩段式，第二步長什麼樣只有按過才知道。" -ForegroundColor DarkGray
Write-Host ""
Write-Host "會做兩件事，每一件都會停下來等你：" -ForegroundColor Yellow
Write-Host "  1. 發文       - 程式打幾個字，你按一次「繼續」" -ForegroundColor Yellow
Write-Host "  2. Marketplace - 程式填測試標題與價格，你按一次「繼續」" -ForegroundColor Yellow
Write-Host ""
Write-Host "⚠️ 你只要按「繼續」。看到下一頁就停手。" -ForegroundColor Red
Write-Host "   不要按「發佈」，也不要按「上架」。程式也絕對不會幫你按。" -ForegroundColor Red
Write-Host "   抄完會直接關掉瀏覽器，沒送出的東西不會留在 FB 上。" -ForegroundColor DarkGray
Write-Host ""

if (-not (Test-Path $toolDir)) {
    Write-Host "找不到工具資料夾：$toolDir" -ForegroundColor Red
    Read-Host "按 Enter 關閉"
    exit 1
}

Set-Location $toolDir

Write-Host "要抄哪一個？（直接按 Enter = 兩個都抄）" -ForegroundColor Yellow
Write-Host "  1. 兩個都抄"
Write-Host "  2. 只抄發文"
Write-Host "  3. 只抄 Marketplace"
Write-Host ""
$choice = Read-Host "輸入 1 / 2 / 3"

switch ($choice) {
    "2" { node probe-step2.mjs feed }
    "3" { node probe-step2.mjs marketplace }
    default { node probe-step2.mjs }
}

Write-Host ""
if ($LASTEXITCODE -eq 0) {
    $dumpPath = Join-Path $toolDir "config\step2-dump.json"
    Write-Host "完成。抄回來的檔案：$dumpPath" -ForegroundColor Green
    Write-Host "檔案總管會幫你開起來並選中它，直接拖進 Claude 的對話就好。" -ForegroundColor Green
    if (Test-Path $dumpPath) {
        Start-Process explorer.exe -ArgumentList "/select,`"$dumpPath`""
    }
} else {
    Write-Host "沒有正常結束（離開碼 $LASTEXITCODE）。上面的訊息是原因。" -ForegroundColor Red
}
Write-Host ""
Read-Host "按 Enter 關閉"
