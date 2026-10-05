# FB 貼文工廠 —— runner 撈一輪（給 Windows 工作排程器每 5 分鐘叫一次）
#
# 這個檔要存成 UTF-8 with BOM（見 learning_給本人點兩下的腳本）。
# install-runner-task.ps1 會把它排進工作排程器；你平常不用手動點。
#
# 到點會做的事：
#   ・Marketplace 排程 —— 直接讀資料庫，開瀏覽器把該發的商品發出去（不需要 dev server）
#   ・一般貼文 / 刪文排程 —— 要打得到後台 API（本機 dev server 或線上），打不到就略過

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Continue"
$toolDir = "C:\Users\ming\Desktop\Agent-OS\card-booking\tools\fb-autopost"
$logDir = Join-Path $toolDir "logs"
$runner = Join-Path $toolDir "runner.mjs"

if (-not (Test-Path $toolDir)) { exit 1 }
Set-Location $toolDir

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir ("runner-" + (Get-Date -Format "yyyy-MM-dd") + ".log")

# node 一律吐 UTF-8。log 也用 UTF-8 —— 用 .NET 的 StreamWriter 直接 append，
# 不要用 PowerShell 5.1 的 `*>>`（會寫成 UTF-16、還把 node 的 stderr 包成 ErrorRecord）。
function Log([string]$line) {
  $sw = New-Object System.IO.StreamWriter($logFile, $true, (New-Object System.Text.UTF8Encoding($false)))
  try { $sw.WriteLine($line) } finally { $sw.Close() }
}

Log ""
Log ("=== " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " runner --once ===")

if (-not (Test-Path "$toolDir\auth\fb-state.json")) {
  Log "  跳過：還沒存過 FB 登入狀態（先點 FB登入.bat）"
  exit 0
}

# 把 node 的 stdout+stderr 都收進字串，過濾掉沒意義的雜訊，再一次寫進 log。
# --no-warnings：關掉「.ts 檔沒有 type:module」那類提示，發文本身不受影響。
$env:NODE_OPTIONS = "--no-warnings"
$raw = & node $runner --once 2>&1 | ForEach-Object { $_.ToString() }
$code = $LASTEXITCODE

$noise = 'MODULE_TYPELESS|Reparsing as ES module|eliminate this warning|trace-warnings|NativeCommandError|CategoryInfo|FullyQualifiedErrorId'
foreach ($l in $raw) {
  if ($l -and ($l -notmatch $noise)) { Log $l }
}
Log ("=== 結束（離開碼 $code）===")

exit $code
