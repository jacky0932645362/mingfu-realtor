# FB 發文身分 —— 檢查「以粉專身分發到社團」切換得過去嗎（2026-10-09）
#
# 這個檔要存成 UTF-8 with BOM，中文才不會壞（見 learning_給本人點兩下的腳本）。
# 由桌面的「FB檢查粉專身分.bat」呼叫，那個 .bat 的內容必須是純 ASCII。
# 只開瀏覽器確認身分，不發任何文。

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"
$toolDir = "C:UsersmingDesktopAgent-OScard-booking	oolsb-autopost"

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  FB 發文身分 - 檢查粉專身分切換" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "會對每一個有設定「用哪個個人帳號切換」的粉專開一次瀏覽器，確認能切換成粉專。" -ForegroundColor Yellow
Write-Host "這支不會發文、不會按任何按鈕。檢查完瀏覽器會自己關掉。" -ForegroundColor Yellow
Write-Host ""

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

node check-page-identity.mjs

Write-Host ""
Write-Host "結果也會顯示在後台「發文身分」頁那個粉專的卡片上。" -ForegroundColor Green
Read-Host "按 Enter 關閉"
