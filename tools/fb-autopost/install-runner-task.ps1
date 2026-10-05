# FB 貼文工廠 —— 一鍵把「runner 每 5 分鐘撈一輪」排進 Windows 工作排程器
#
# 這個檔要存成 UTF-8 with BOM（見 learning_給本人點兩下的腳本）。
# 你自己雙擊執行（或用桌面「批次檔案\FB-Runner-排程.bat」叫）。只建一個排程工作，不動別的。
# 要拿掉：跑 Unregister-ScheduledTask -TaskName "FB貼文工廠-runner"，或用「工作排程器」介面刪。
#
# 設好之後：只要這台桌機開著、你有登入，網站上排的 Marketplace 貼文到點就會自動發。
# （一般貼文 / 刪文的排程還要另外能連到後台 API —— 本機 dev server 或線上 Vercel。）

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$taskName = "FB貼文工廠-runner"
$toolDir  = "C:\Users\ming\Desktop\Agent-OS\card-booking\tools\fb-autopost"
$script   = Join-Path $toolDir "run-runner-once.ps1"

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  把「FB 貼文工廠 runner」排進工作排程器" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $script)) {
    Write-Host "找不到 run-runner-once.ps1：$script" -ForegroundColor Red
    Read-Host "按 Enter 關閉"; exit 1
}

if (-not (Test-Path "$toolDir\auth\fb-state.json")) {
    Write-Host "⚠ 還沒存過 FB 登入狀態。排程可以先設，但到點發不了 —— 記得去點「FB登入.bat」。" -ForegroundColor Yellow
    Write-Host ""
}

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "已經有一個叫「$taskName」的排程工作了。" -ForegroundColor Yellow
    $ans = Read-Host "要用新設定覆蓋它嗎？(y/N)"
    if ($ans -ne "y") { Write-Host "沒有改動。"; Read-Host "按 Enter 關閉"; exit 0 }
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$intervalInput = Read-Host "每幾分鐘撈一輪？(直接 Enter = 5)"
if ([string]::IsNullOrWhiteSpace($intervalInput)) { $intervalInput = "5" }
$minutes = 0
if (-not [int]::TryParse($intervalInput, [ref]$minutes) -or $minutes -lt 1 -or $minutes -gt 60) {
    Write-Host "要是 1~60 之間的數字。" -ForegroundColor Red
    Read-Host "按 Enter 關閉"; exit 1
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

# 每 $minutes 分鐘重複一次，長期有效。開機/睡醒後補跑。
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $minutes) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

# 只有登入時才跑（發文要用得到桌面的 Chrome + FB cookie）
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# 上一輪還沒跑完就不要疊下一輪（發文一輪可能好幾分鐘）
# 2026-09-19：上限從 1 小時拉到 4 小時 —— 社團間隔改成 6～14 分之後，一篇發 5 個社團會跑超過 1 小時，
# 被排程器砍在半路比跑久更糟（可能發了沒記到、下一輪重發）。
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Hours 4) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description "每 $minutes 分鐘撈一輪 FB 貼文工廠排程（Marketplace 直接發；一般貼文/刪文要連得到後台 API）。工具：$toolDir" | Out-Null

Write-Host ""
Write-Host "✅ 排好了：每 $minutes 分鐘撈一輪。" -ForegroundColor Green
Write-Host "   ・log：$toolDir\logs\runner-<日期>.log"
Write-Host "   ・馬上試跑一次：工作排程器 → 找「$taskName」→ 右鍵「執行」"
Write-Host "   ・暫停：工作排程器裡對它按「停用」；要拿掉就「刪除」"
Write-Host "   ・桌機關機時不會跑；開機後下一輪會補上（沒過失效時間的排程還在）"
Write-Host ""
Read-Host "按 Enter 關閉"
