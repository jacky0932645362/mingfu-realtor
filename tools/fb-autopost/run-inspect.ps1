# FB 自動發文 —— 第 2 步：抄畫面結構
#
# 這個檔要存成 UTF-8 with BOM，中文才不會壞（見 learning_給本人點兩下的腳本）。
# 由桌面的「FB抄欄位.bat」呼叫，那個 .bat 的內容必須是純 ASCII。

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"
$toolDir = "C:\Users\ming\Desktop\Agent-OS\card-booking\tools\fb-autopost"

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  FB 自動發文 - 第 2 步：抄畫面結構" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "FB 的按鈕代號是每次改版都會變的亂碼，猜不得，所以要讓程式自己去問那一頁。" -ForegroundColor DarkGray
Write-Host "這支只會看、不會發文、不會刊登任何東西。" -ForegroundColor DarkGray
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

Write-Host "要抄哪一個畫面？" -ForegroundColor Yellow
Write-Host "  1. 首頁發文框（個人主頁貼文）"
Write-Host "  2. Marketplace 刊登表單"
Write-Host "  3. 分享到社團"
Write-Host "  4. 活動紀錄 -> 社團貼文和留言（批次刪文用）"
Write-Host ""
$choice = Read-Host "輸入 1 / 2 / 3 / 4"

switch ($choice) {
    "1" { $target = "feed";        $dump = "composer-dump.json" }
    "2" { $target = "marketplace"; $dump = "marketplace-dump.json" }
    "3" { $target = "group";       $dump = "group-dump.json" }
    "4" { $target = "activity";    $dump = "activity-dump.json" }
    default {
        Write-Host "沒有這個選項。" -ForegroundColor Red
        Read-Host "按 Enter 關閉"
        exit 1
    }
}

node inspect-composer.mjs $target

Write-Host ""
if ($LASTEXITCODE -eq 0) {
    $dumpPath = Join-Path $toolDir "config\$dump"
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
