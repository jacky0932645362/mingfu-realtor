# FB 自動發文 —— 存「其他帳號」的登入狀態（發文身分，2026-10-07）
#
# 這個檔要存成 UTF-8 with BOM，中文才不會壞（見 learning_給本人點兩下的腳本）。
# 由桌面的「FB登入-其他帳號.bat」呼叫，那個 .bat 的內容必須是純 ASCII。
#
# 跟「FB登入.bat」的差別：這支存的是「其他發文身分」自己的登入檔（auth\fb-state-<代號>.json），
# 完全不會動到主帳號的 fb-state.json。

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"
$toolDir = "C:\Users\ming\Desktop\Agent-OS\card-booking\tools\fb-autopost"

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  FB 發文身分 - 存「其他帳號」的登入狀態" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "登入代號在後台「發文身分」頁、那個身分的卡片上，長得像 acct-k7m2。" -ForegroundColor Yellow
Write-Host "（主帳號不用這支，主帳號請點原本的「FB登入.bat」）" -ForegroundColor DarkGray
Write-Host ""

$key = (Read-Host "請輸入登入代號").Trim().ToLower()
if ($key -notmatch '^[a-z0-9][a-z0-9-]{0,23}$') {
    Write-Host ""
    Write-Host "登入代號格式不對（只能是小寫英數和 -，例如 acct-k7m2）。" -ForegroundColor Red
    Read-Host "按 Enter 關閉"
    exit 1
}

if (-not (Test-Path $toolDir)) {
    Write-Host "找不到工具資料夾：$toolDir" -ForegroundColor Red
    Read-Host "按 Enter 關閉"
    exit 1
}

Set-Location $toolDir

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "找不到 node —— Node.js 沒裝或不在 PATH 裡。" -ForegroundColor Red
    Read-Host "按 Enter 關閉"
    exit 1
}

Write-Host ""
Write-Host "等一下會開一個瀏覽器視窗。請在裡面登入「那個身分的」Facebook 帳號（含二階段驗證），" -ForegroundColor Yellow
Write-Host "登入完回到這個視窗按 Enter。這支程式看不到你的帳號密碼。" -ForegroundColor Yellow
Write-Host "⚠ 要登入的是「另一個」帳號，不是主帳號——如果瀏覽器自動就是主帳號，先登出再換。" -ForegroundColor Yellow
Write-Host ""

node save-login.mjs "--identity=$key"

Write-Host ""
if ($LASTEXITCODE -eq 0) {
    Write-Host "完成。下一步：點「FB抓社團-其他帳號.bat」，輸入同一個登入代號，把這個帳號的社團抓進後台。" -ForegroundColor Green
} else {
    Write-Host "沒有正常結束（離開碼 $LASTEXITCODE）。上面的訊息是原因。" -ForegroundColor Red
}
Write-Host ""
Read-Host "按 Enter 關閉"
