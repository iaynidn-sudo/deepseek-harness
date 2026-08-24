@echo off
REM =========================================================================
REM  DeepSeek Harness 客户端 —— 双击启动器（Electron 窗口版）
REM  作用：设置受管 Node 到 PATH，随后以隐藏控制台方式启动 Electron 客户端。
REM  前提：已在本目录执行过一次  npm install  （安装 electron）。
REM =========================================================================
setlocal
REM 清除 WorkBuddy 注入的安全删除 shim（普通 Windows 无此变量，置空无害）
set "NODE_OPTIONS="

set "NODEBIN=C:\Users\jiang\.workbuddy\binaries\node\versions\22.22.2"
if not exist "%NODEBIN%\npx.cmd" (
  echo 未找到受管 Node，将回退到系统 PATH 中的 node。
  set "NODEBIN="
)
if defined NODEBIN ( set "PATH=%NODEBIN%;%PATH%" )

cd /d "%~dp0"

if not exist "%~dp0\node_modules\electron" (
  echo [提示] 首次运行需安装 electron，正在执行 npm install ...
  call npm install
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%NODEBIN%\npm.cmd' -ArgumentList 'start' -WindowStyle Hidden"
endlocal
