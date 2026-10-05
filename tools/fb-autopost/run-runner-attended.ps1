# FB 貼文工廠 —— runner「有人看著」模式
#
# 這個檔要存成 UTF-8 with BOM，中文才不會壞。
# 由桌面的「FB-Runner.bat」呼叫（那個 .bat 必須是純 ASCII）。

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"
$toolDir = "C:\Users\ming\Desktop\Agent-OS\card-booking\tools\fb-autopost"

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  FB 貼文工廠 - 執行排好的工作" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "這支會去後台撈「時間到了」的工作，然後真的去發。" -ForegroundColor DarkGray
Write-Host ""

if (-not (Test-Path $toolDir)) {
    Write-Host "找不到工具資料夾：$toolDir" -ForegroundColor Red
    Read-Host "按 Enter 關閉"
    exit 1
}
Set-Location $toolDir

Write-Host "先做出發前檢查……" -ForegroundColor Yellow
Write-Host ""
node runner.mjs --ping
$pingOk = ($LASTEXITCODE -eq 0)

if (-not $pingOk) {
    Write-Host ""
    Write-Host "上面有 X 的先處理掉再跑。" -ForegroundColor Red
    Write-Host "最常見的兩個：" -ForegroundColor DarkGray
    Write-Host "  - 後台連不上：本機的話要先開 npm run dev（在 card-booking 資料夾）" -ForegroundColor DarkGray
    Write-Host "  - FB 登入失效：點桌面的 FB-Login.bat 重登一次" -ForegroundColor DarkGray
    Write-Host ""
    Read-Host "按 Enter 關閉"
    exit 1
}

Write-Host ""
Write-Host "  1. 有人看著跑（撈一份，停住等你按發佈）  <- 第一次用選這個" -ForegroundColor Green
Write-Host "  2. 無人模式跑一輪（只會處理「自動發佈」的工作）"
Write-Host "  3. 只看不做（印出會發什麼，不開瀏覽器）"
Write-Host ""
$choice = Read-Host "輸入 1 / 2 / 3"

switch ($choice) {
    "2" { node runner.mjs --once }
    "3" { node runner.mjs --once --dry }
    default { node runner.mjs --attended }
}

Write-Host ""
if ($LASTEXITCODE -ne 0) {
    Write-Host "沒有正常結束（離開碼 $LASTEXITCODE）。上面的訊息是原因。" -ForegroundColor Red
}
Write-Host ""
Read-Host "按 Enter 關閉"
