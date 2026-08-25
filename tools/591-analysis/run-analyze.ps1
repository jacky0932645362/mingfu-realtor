# 591 競品分析 —— 貼網址、產生報告
#
# 這個檔要存成 UTF-8 with BOM（見 learning_給本人點兩下的腳本）。
# 由桌面的「591競品分析.bat」呼叫。

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"
$toolDir = "C:\Users\ming\Desktop\Agent-OS\card-booking\tools\591-analysis"

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  591 競品分析" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "會開真的 Chrome、跳出來問你要分析哪個 591 物件網址。" -ForegroundColor Yellow
Write-Host "貼詳情頁的網址，例如 https://sale.591.com.tw/home/house/detail/2/20731244.html" -ForegroundColor DarkGray
Write-Host "跑完會產生一份報告（HTML 檔），路徑會印在畫面上，自動用瀏覽器打開。" -ForegroundColor Yellow
Write-Host ""

if (-not (Test-Path $toolDir)) {
    Write-Host "找不到工具資料夾：$toolDir" -ForegroundColor Red
    Read-Host "按 Enter 關閉"
    exit 1
}

Set-Location $toolDir

if (-not (Test-Path "$toolDir\node_modules")) {
    Write-Host "第一次用，先裝需要的套件（Playwright）..." -ForegroundColor Yellow
    npm install
}

$before = Get-ChildItem "$toolDir\reports\*.html" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name

node analyze.mjs
$exitCode = $LASTEXITCODE

Write-Host ""
if ($exitCode -ne 0) {
    Write-Host "沒有正常結束（離開碼 $exitCode）。上面的訊息是原因。" -ForegroundColor Red
    Write-Host ""
    Read-Host "按 Enter 關閉"
    exit 1
}

# 打開剛剛新產生的那份報告（跟跑之前比對，抓出新出現的檔案）
$after = Get-ChildItem "$toolDir\reports\*.html" -ErrorAction SilentlyContinue
$newFile = $after | Where-Object { $before -notcontains $_.Name } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($newFile) {
    Start-Process $newFile.FullName
}

Write-Host ""
Read-Host "按 Enter 關閉"
