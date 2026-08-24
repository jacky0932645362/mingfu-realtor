# 591 自動填表 —— 第 1 步：存登入狀態
#
# 這個檔要存成 UTF-8 with BOM，中文才不會壞（見 learning_給本人點兩下的腳本）。
# 由桌面的「591登入.bat」呼叫，那個 .bat 的內容必須是純 ASCII。

# node 吐的是 UTF-8，這台主控台預設 Big5，不換編碼中文會變亂碼
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"
$toolDir = "C:\Users\ming\Desktop\Agent-OS\card-booking\tools\591-autofill"

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  591 自動填表 - 第 1 步：存登入狀態" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "等一下會開一個瀏覽器視窗。" -ForegroundColor Yellow
Write-Host "請你自己在裡面登入 591（含簡訊驗證），登入完回來這個視窗按 Enter。" -ForegroundColor Yellow
Write-Host ""
Write-Host "這支程式看不到你的帳號密碼，只會在你按 Enter 之後把 cookie 存起來。" -ForegroundColor DarkGray
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

if (-not (Test-Path "$toolDir\node_modules\playwright")) {
    Write-Host "Playwright 還沒裝，現在裝（只有第一次要等）…" -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "npm install 失敗。" -ForegroundColor Red
        Read-Host "按 Enter 關閉"
        exit 1
    }
}

node save-login.mjs

Write-Host ""
if ($LASTEXITCODE -eq 0) {
    Write-Host "完成。下一步：點桌面的「591抄欄位.bat」" -ForegroundColor Green
} else {
    Write-Host "沒有正常結束（離開碼 $LASTEXITCODE）。上面的訊息是原因。" -ForegroundColor Red
}
Write-Host ""
Read-Host "按 Enter 關閉"
