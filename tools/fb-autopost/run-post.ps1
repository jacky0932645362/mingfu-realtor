# FB 自動發文 —— 發一篇
#
# 這個檔要存成 UTF-8 with BOM，中文才不會壞（見 learning_給本人點兩下的腳本）。
# 由桌面的「FB發文.bat」呼叫，那個 .bat 的內容必須是純 ASCII。

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"
$toolDir = "C:\Users\ming\Desktop\Agent-OS\card-booking\tools\fb-autopost"

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  FB 自動發文" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
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

Write-Host "目前的貼文佇列：" -ForegroundColor Yellow
node post.mjs --list

Write-Host ""
Write-Host "  1. 產一篇新草稿（從物件資料庫）"
Write-Host "  2. 產一篇空白草稿（純文字／房產知識文）"
Write-Host "  3. 發某一篇（貼好停住，發布你自己按）"
Write-Host ""
$choice = Read-Host "輸入 1 / 2 / 3"

switch ($choice) {
    "1" { node new-post.mjs }
    "2" { node new-post.mjs --blank }
    "3" {
        Write-Host ""
        $which = Read-Host "要發哪一篇？輸入上面的編號（直接 Enter = 最早到期的那篇）"
        if ($which -match '^\d+$') {
            node post.mjs $which
        } else {
            node post.mjs
        }
    }
    default {
        Write-Host "沒有這個選項。" -ForegroundColor Red
        Read-Host "按 Enter 關閉"
        exit 1
    }
}

Write-Host ""
if ($LASTEXITCODE -ne 0) {
    Write-Host "沒有正常結束（離開碼 $LASTEXITCODE）。上面的訊息是原因。" -ForegroundColor Red
}
Write-Host ""
Read-Host "按 Enter 關閉"
