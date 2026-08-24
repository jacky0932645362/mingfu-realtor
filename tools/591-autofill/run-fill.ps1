# 591 自動填表 —— 第 3 步：把一筆物件填進 591
#
# 這個檔要存成 UTF-8 with BOM（見 learning_給本人點兩下的腳本）。
# 由桌面的「591填表.bat」呼叫。

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"
$toolDir = "C:\Users\ming\Desktop\Agent-OS\card-booking\tools\591-autofill"

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  591 自動填表 - 第 3 步：填表" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "會先列出資料庫裡的物件，你輸入編號選一筆。" -ForegroundColor Yellow
Write-Host ""
Write-Host "填完會停住等你檢查。這支程式不會幫你按送出。" -ForegroundColor Yellow
Write-Host "照片也要你自己拖進去（591 是上傳檔案，程式手上只有網址），" -ForegroundColor DarkGray
Write-Host "但正確順序會印在畫面上。" -ForegroundColor DarkGray
Write-Host ""

if (-not (Test-Path $toolDir)) {
    Write-Host "找不到工具資料夾：$toolDir" -ForegroundColor Red
    Read-Host "按 Enter 關閉"
    exit 1
}

Set-Location $toolDir

if (-not (Test-Path "$toolDir\auth\591-state.json")) {
    Write-Host "還沒有登入狀態 —— 請先點桌面的「591登入.bat」。" -ForegroundColor Red
    Read-Host "按 Enter 關閉"
    exit 1
}

node fill.mjs

Write-Host ""
if ($LASTEXITCODE -ne 0) {
    Write-Host "沒有正常結束（離開碼 $LASTEXITCODE）。上面的訊息是原因。" -ForegroundColor Red
    Write-Host ""
    Write-Host "如果訊息說 selector 是空的：那是還沒對映過 591 的表單。" -ForegroundColor Yellow
    Write-Host "先點「591抄欄位.bat」，把 config\form-dump.json 貼給 Claude。" -ForegroundColor Yellow
}
Write-Host ""
Read-Host "按 Enter 關閉"
