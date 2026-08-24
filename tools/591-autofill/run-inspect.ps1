# 591 自動填表 —— 第 2 步：抄下 591 表單的欄位
#
# 這個檔要存成 UTF-8 with BOM（見 learning_給本人點兩下的腳本）。
# 由桌面的「591抄欄位.bat」呼叫。

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"
$toolDir = "C:\Users\ming\Desktop\Agent-OS\card-booking\tools\591-autofill"

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  591 自動填表 - 第 2 步：抄下表單欄位" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "等一下會開瀏覽器（已經是登入狀態）。" -ForegroundColor Yellow
Write-Host "請你自己導航到「刊登物件 / 新增物件」那一頁，" -ForegroundColor Yellow
Write-Host "開到你平常填的表單畫面，再回來按 Enter。" -ForegroundColor Yellow
Write-Host ""
Write-Host "我會把那一頁每個輸入框的資訊抄下來，存成 config\form-dump.json。" -ForegroundColor DarkGray
Write-Host "抄完把那個檔貼回對話給 Claude，他才知道要填哪一格。" -ForegroundColor DarkGray
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

node inspect-form.mjs

Write-Host ""
if ($LASTEXITCODE -eq 0) {
    $dump = "$toolDir\config\form-dump.json"
    if (Test-Path $dump) {
        Write-Host "抄好了：$dump" -ForegroundColor Green
        Write-Host ""
        Write-Host "已經幫你在檔案總管裡選起來，直接拖進對話視窗給 Claude。" -ForegroundColor Green
        Start-Process explorer.exe "/select,`"$dump`""
    }
} else {
    Write-Host "沒有正常結束（離開碼 $LASTEXITCODE）。" -ForegroundColor Red
}
Write-Host ""
Read-Host "按 Enter 關閉"
