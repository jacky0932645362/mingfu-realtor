# FB 自動發文 —— 抄「發布」那一步的結構
#
# 這個檔要存成 UTF-8 with BOM，中文才不會壞（見 learning_給本人點兩下的腳本）。
# 由桌面的「FB抄發布鈕.bat」呼叫，那個 .bat 的內容必須是純 ASCII。

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"
$toolDir = "C:\Users\ming\Desktop\Agent-OS\card-booking\tools\fb-autopost"

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  FB 自動發文 - 抄「發布」那一步" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "FB 的發文框是兩段式：打完字之後那顆藍色按鈕寫「繼續」，" -ForegroundColor DarkGray
Write-Host "按下去才會到第二步，那裡才有「發佈」。" -ForegroundColor DarkGray
Write-Host ""
Write-Host "等一下程式會自己開發文框、打幾個字，然後停住。" -ForegroundColor Yellow
Write-Host "你只要做一件事：**自己按一次藍色的「繼續」**，然後回來按 Enter。" -ForegroundColor Yellow
Write-Host ""
Write-Host "⚠️ 不要按「發佈」。程式也絕對不會幫你按。" -ForegroundColor Red
Write-Host "   抄完會直接關掉瀏覽器，沒發出去的貼文不會留在 FB 上。" -ForegroundColor DarkGray
Write-Host ""

if (-not (Test-Path $toolDir)) {
    Write-Host "找不到工具資料夾：$toolDir" -ForegroundColor Red
    Read-Host "按 Enter 關閉"
    exit 1
}

Set-Location $toolDir

node probe-publish.mjs

Write-Host ""
if ($LASTEXITCODE -eq 0) {
    $dumpPath = Join-Path $toolDir "config\publish-dump.json"
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
