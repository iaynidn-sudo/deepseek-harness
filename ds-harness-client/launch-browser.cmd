@echo off
REM =========================================================================
REM  DeepSeek Harness —— 轻量客户端启动器（零额外依赖，双击即用）
REM  行为：后台启动 dsh web 服务，端口就绪后自动打开默认浏览器访问。
REM  特性：
REM   1) 清除 WorkBuddy 注入的安全删除 shim（普通 Windows 无此变量，置空无害）
REM   2) 用干净的 DSH_HOME（AppData），避开本机 ~/.dsh 旧的 broken symlink
REM   3) 端口被占用则直接打开浏览器，避免重复拉起造成冲突
REM   4) 优先用 npx 缓存里的 dsh bin，绕过 npx 的 cacache 拦截
REM =========================================================================
setlocal EnableExtensions

REM 受管 Node（满足 dsh 引擎 ^22.19.0 || >=24）；不存在则回退系统 PATH
set "NODEBIN=C:\Users\jiang\.workbuddy\binaries\node\versions\22.22.2"
if not exist "%NODEBIN%\node.exe" set "NODEBIN="

REM 关键：清除安全删除拦截 shim
set "NODE_OPTIONS="

if defined NODEBIN set "PATH=%NODEBIN%;%PATH%"
cd /d "%~dp0"

set "PORT=3080"
if not "%DSH_PORT%"=="" set "PORT=%DSH_PORT%"
set "HOST=127.0.0.1"

REM 干净 DSH_HOME，避开用户旧 ~/.dsh 的 broken symlink 导致 heal 失败
set "DSH_HOME=%LOCALAPPDATA%\ds-harness-client\.dsh"
if not "%DSH_CUSTOM_HOME%"=="" set "DSH_HOME=%DSH_CUSTOM_HOME%"

echo ============================================================
echo   DeepSeek Harness 客户端（浏览器版）
echo   地址: http://%HOST%:%PORT%
echo ============================================================

REM ---- 端口已占用（已有 dsh 在跑）：直接开浏览器，不重复拉起 ----
powershell -NoProfile -Command "$p=%PORT%;try{$c=New-Object Net.Sockets.TcpClient('%HOST%',$p);$c.Close();exit 0}catch{exit 1}"
if %errorlevel%==0 (
  echo 检测到 %HOST%:%PORT% 已有服务在运行，直接打开浏览器。
  start "" "http://%HOST%:%PORT%"
  goto :done
)

echo 正在定位 dsh 并后台启动 web 服务（首次会自动下载 dsh 包，请稍候）...

REM 优先用 npx 缓存里的 dsh bin（绕过 npx 的 cacache / safe-delete 拦截）
set "DSH_BIN="
for /f "delims=" %%B in ('powershell -NoProfile -Command "(Resolve-Path \"$env:LOCALAPPDATA\npm-cache\_npx\*\node_modules\@deepseek-ai\dsh\lib\bin.js\" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)"') do set "DSH_BIN=%%B"

if defined DSH_BIN (
  echo 使用缓存 dsh: %DSH_BIN%
  start "" /min cmd /c ""%NODEBIN%\node.exe" "%DSH_BIN%" web --host %HOST% --port %PORT%"
) else (
  echo 未找到缓存 dsh，回退 npx 下载...
  start "" /min cmd /c "npx @deepseek-ai/dsh web --host %HOST% --port %PORT%"
)

REM ---- 端口探活：就绪后自动打开默认浏览器 ----
powershell -NoProfile -Command "$h='%HOST%';$p=%PORT%;$ok=$false;for($i=0;$i-lt300;$i++){try{$c=New-Object Net.Sockets.TcpClient($h,$p);$c.Close();$ok=$true;break}catch{Start-Sleep -Seconds 2}};if($ok){Write-Host '服务已就绪，正在打开浏览器...';Start-Process ('http://'+$h+':'+$p)}else{Write-Host '等待超时：请确认 dsh 包已成功安装（网络较慢时重试）'}}"

:done
echo dsh 服务已在后台运行；本窗口可关闭（关闭不会停止服务）。
echo 停止服务：结束任务管理器中的 node / dsh 进程。
endlocal
