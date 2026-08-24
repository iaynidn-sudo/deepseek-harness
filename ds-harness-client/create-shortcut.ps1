# 生成桌面快捷方式
$ws = New-Object -ComObject WScript.Shell

function Make-Lnk($name, $target) {
  $lnkPath = Join-Path $PSScriptRoot $name
  $lnk = $ws.CreateShortcut($lnkPath)
  $lnk.TargetPath = Join-Path $PSScriptRoot $target
  $lnk.WorkingDirectory = $PSScriptRoot
  $lnk.WindowStyle = 7          # 7 = 最小化
  $lnk.Description = "DeepSeek Harness (dsh web) 客户端"
  $lnk.Save()
  Write-Host "已生成: $lnkPath"
  # 复制到桌面
  try {
    $desktop = [Environment]::GetFolderPath('Desktop')
    Copy-Item $lnkPath (Join-Path $desktop $name) -Force
    Write-Host "已复制到桌面: $desktop"
  } catch {
    Write-Warning "复制至桌面失败（可手动拖拽）: $_"
  }
}

# 默认（可靠）：浏览器版启动器
Make-Lnk "DeepSeek Harness 客户端.lnk" "launch-browser.cmd"
# 可选（窗口版，需先 npm install 装好 electron）
Make-Lnk "DeepSeek Harness 客户端 (窗口版).lnk" "launch.cmd"
