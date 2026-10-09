# FB 發文身分 —— 抓「其他帳號」加入的社團（2026-10-07）
#
# 這個檔要存成 UTF-8 with BOM，中文才不會壞（見 learning_給本人點兩下的腳本）。
# 由桌面的「FB其他帳號-2抓社團.bat」呼叫，那個 .bat 的內容必須是純 ASCII。
#
# 只會「看」，不會發文、不會加入或退出任何社團。抓到的社團寫進那個身分自己的清單
# （後台 → 社團清單 → 切到那個身分），主帳號的社團清單完全不會被動到。
# 要先用「FB其他帳號-1登入.bat」把那個帳號登入過。

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
Write-Host "要先用「FB其他帳號-1登入.bat」把那個帳號登入過。整個約 15～20 分鐘，中間不要關視窗。" -ForegroundColor Yellow
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

# 2026-10-09：本人兩次先點到這支（還沒登入）。登入檔不存在就直接問要不要先登入，不用再回去找另一支。
$authFile = Join-Path $toolDir "auth\fb-state-$key.json"
if (-not (Test-Path $authFile)) {
    Write-Host ""
    Write-Host "「$key」這個帳號還沒登入過，要先登入才能抓社團。" -ForegroundColor Yellow
    $ans = (Read-Host "現在先登入嗎？輸入 Y 按 Enter（其他鍵＝關閉）").Trim().ToUpper()
    if ($ans -ne "Y") {
        Read-Host "按 Enter 關閉"
        exit 1
    }
    Write-Host ""
    Write-Host "等一下會開一個瀏覽器：在「那個瀏覽器」裡登入這個帳號（含二階段驗證），" -ForegroundColor Yellow
    Write-Host "登入完回到這個視窗按 Enter。自己另外開的 Chrome 登入不算數。" -ForegroundColor Yellow
    Write-Host "如果瀏覽器自動就是主帳號，先登出再換。" -ForegroundColor Yellow
    Write-Host ""
    node save-login.mjs "--identity=$key"
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "登入沒有完成（離開碼 $LASTEXITCODE）。上面的訊息是原因。" -ForegroundColor Red
        Read-Host "按 Enter 關閉"
        exit 1
    }
    Write-Host ""
    Write-Host "登入好了，接著抓這個帳號加入的社團…" -ForegroundColor Green
    Write-Host ""
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
