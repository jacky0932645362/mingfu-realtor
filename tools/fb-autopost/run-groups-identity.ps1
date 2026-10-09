# FB 發文身分 —— 抓「其他帳號」加入的社團（2026-10-07）
#
# 這個檔要存成 UTF-8 with BOM，中文才不會壞（見 learning_給本人點兩下的腳本）。
# 由桌面的「FB抓社團-其他帳號.bat」呼叫，那個 .bat 的內容必須是純 ASCII。
#
# 只會「看」，不會發文、不會加入或退出任何社團。抓到的社團寫進那個身分自己的清單
# （後台 → 社團清單 → 切到那個身分），主帳號的社團清單完全不會被動到。
# 要先用「FB登入-其他帳號.bat」把那個帳號登入過。

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"
$toolDir = "C:\Users\ming\Desktop\Agent-OS\card-booking\tools\fb-autopost"

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  FB 發文身分 - 抓「其他帳號」加入的社團" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "登入代號在後台「發文身分」頁、那個身分的卡片上，長得像 acct-k7m2。" -ForegroundColor Yellow
Write-Host "要先用「FB登入-其他帳號.bat」把那個帳號登入過。整個約 15～20 分鐘，中間不要關視窗。" -ForegroundColor Yellow
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

node list-groups.mjs "--identity=$key"

Write-Host ""
if ($LASTEXITCODE -eq 0) {
    Write-Host "完成。到後台「社團清單」切到那個身分，用勾的挑要發哪些。" -ForegroundColor Green
} else {
    Write-Host "沒有正常結束（離開碼 $LASTEXITCODE）。上面的訊息是原因。" -ForegroundColor Red
}
Write-Host ""
Read-Host "按 Enter 關閉"
