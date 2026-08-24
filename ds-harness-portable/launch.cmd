@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "NODE=%ROOT%bin\node.exe"
set "DSH_BIN=%ROOT%node_modules\@deepseek-ai\dsh\lib\bin.js"
set "DSH_HOME=%ROOT%.dsh"
set "NODE_OPTIONS="
set "PORT=3080"
if not "%DSH_PORT%"=="" set "PORT=%DSH_PORT%"
set "HOST=127.0.0.1"

cd /d "%ROOT%"

echo DeepSeek Harness portable client
echo URL: http://%HOST%:%PORT%

if not exist "%NODE%" (
  echo [ERROR] bin\node.exe not found. Keep the folder structure intact.
  pause
  exit /b 1
)
if not exist "%DSH_BIN%" (
  echo [ERROR] dsh not found in node_modules\@deepseek-ai\dsh
  pause
  exit /b 1
)

REM Check if a dsh service is already running on the port
powershell -NoProfile -Command "$p=%PORT%;try{$c=New-Object Net.Sockets.TcpClient('%HOST%',$p);$c.Close();exit 0}catch{exit 1}" >nul 2>&1
if %errorlevel%==0 (
  echo Service already running on %HOST%:%PORT%, opening browser.
  start "" "http://%HOST%:%PORT%"
  goto done
)

echo Starting dsh web in background, please wait...
start "" /min "%NODE%" "%DSH_BIN%" web --host %HOST% --port %PORT%

REM Wait for the port to come up, then open the default browser
powershell -NoProfile -Command "$h='%HOST%';$p=%PORT%;$ok=$false;for($i=0;$i-lt300;$i++){try{$c=New-Object Net.Sockets.TcpClient($h,$p);$c.Close();$ok=$true;break}catch{Start-Sleep -Seconds 2}};if($ok){Write-Host 'ready, opening browser...';Start-Process ('http://'+$h+':'+$p)}else{Write-Host 'timeout: check network and retry'}}"

:done
echo dsh is running in background. You can close this window (service keeps running).
echo To stop the service: end the node process in Task Manager.
endlocal
