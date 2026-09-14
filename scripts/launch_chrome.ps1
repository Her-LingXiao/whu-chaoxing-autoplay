# launch_chrome.ps1 — 以远程调试模式启动本机 Chrome（保留用户登录态）
# 用法：powershell -ExecutionPolicy Bypass -File launch_chrome.ps1
$ErrorActionPreference = 'SilentlyContinue'

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) {
  $chrome = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
}
if (-not (Test-Path $chrome)) {
  Write-Output "ERROR: 未找到 Chrome，请先安装谷歌浏览器。"
  exit 1
}
$userData = "$env:LOCALAPPDATA\Google\Chrome\User Data"

# 若调试端口已开，直接复用，避免重启丢失标签页
try {
  $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:9222/json/version
  if ($r.StatusCode -eq 200) {
    Write-Output "Chrome 调试端口 9222 已在运行，直接复用。"
    Write-Output $r.Content
    exit 0
  }
} catch { }

# 关闭现有 Chrome（释放用户配置锁），带调试端口重启
Stop-Process -Name chrome -Force
Start-Sleep -Seconds 3
Start-Process -FilePath $chrome -ArgumentList "--remote-debugging-port=9222","--user-data-dir=$userData"
Start-Sleep -Seconds 4

try {
  $v = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9222/json/version
  Write-Output "OK Chrome 已以调试模式启动："
  Write-Output $v.Content
} catch {
  Write-Output "WARN: 启动后仍未检测到 9222 调试端口，请重试或手动以 --remote-debugging-port=9222 启动 Chrome。"
}
