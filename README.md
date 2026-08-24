# DeepSeek Harness (DSH)

> 把 DeepSeek 官方开源 Agent 运行底座 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) 及其 Web UI，包装成**自包含、可搬运的桌面应用**。双击即用，无需安装 Node.js / npm / Electron 等任何开发环境。

- 本地 Web 服务：`http://127.0.0.1:3080`
- 运行数据存于应用目录 `.dsh/`，不写系统盘，复制走不留痕迹

## 🚀 快速开始（小白 3 步）

### Windows
1. 下载 `DeepSeek-Harness-Setup-x64.exe`（[Releases](../../releases) 最新版）
2. 双击运行 → 一路点「下一步」→「完成」
3. 桌面/开始菜单出现 **DeepSeek Harness** 图标，双击即可使用

> 安装后自动创建桌面快捷方式，自带卸载程序（控制面板可卸载）。不需要任何配置，打开就能对话。

### Mac (Apple Silicon)
1. 下载 `DeepSeek-Harness-Mac-AppleSilicon.tar.gz` 并解压
2. 双击文件夹里的 `install.command`（输入一次开机密码）
3. 自动完成：解除拦截 → 安装到「应用程序」→ 启动

> 之后从「应用程序」文件夹打开即可。

### 首次使用
- 界面加载后，到 **Settings → Models** 填入 DeepSeek API Key（可选，留空走本地匿名模式）
- 有新版本时会自动弹窗提示，点「立即更新」自动完成，无需干预

## 形态

| 形态 | 说明 | 启动方式 |
|---|---|---|
| **Windows 一键安装版** | `DeepSeek-Harness-Setup-x64.exe` — 安装器，桌面快捷方式 + 卸载器 | 双击安装，装完双击图标 |
| **Electron 桌面客户端** | `ds-harness-app/` — 原生窗口 + 托盘 + 设置 + 自动更新检测 | `npm start`（开发）或打包后双击 `.exe` / `.app` |
| **绿色便携版** | `ds-harness-portable/` — 拷贝到任意 Windows 电脑双击即用 | 双击 `launch.cmd` |
| **发布包** | `release/` — Windows x64 + Mac (Apple Silicon) 安装包 | 见 [Releases](../../releases) |

## 使用

1. 启动后自动拉起 dsh Web 服务，浏览器/窗口打开 `http://127.0.0.1:3080`
2. 在页面选择工作区 / 权限 / 模式
3. 到 **Settings → Models** 填入 DeepSeek API Key（可选，留空走本地匿名模式）

## 构建

| 目标 | 命令 |
|---|---|
| Windows x64 打包 | `bash rebuild_dist.sh`（或 `ds-harness-app` 内 `npm run package`） |
| macOS (Apple Silicon) 打包 | `bash build_mac.sh` |
| 图标 / 打包工具 | `ds-harness-app/tools/`（genicon2.js、makezip.js、untar.js 等） |

> 打包产物在 `ds-harness-app/dist/`，压缩分发用 `tools/makezip.js` 或 Git Bash 的 `tar`。
> 内置 Node v22 + `@deepseek-ai/dsh`，离线可用；自动更新检测会比对 npm 上 dsh 最新版本并提示下载新包。

## 目录结构

```
├─ ds-harness-app/        # Electron 桌面客户端主工程（源码）
│   ├─ main.js            # 主进程：拉起 dsh、托盘、设置、更新检测
│   ├─ preload.js         # 渲染进程桥接
│   ├─ splash/settings/help.html
│   ├─ assets/            # 图标（png/ico/icns）
│   └─ tools/             # 打包/图标/解压工具
├─ ds-harness-portable/   # 绿色便携版（launch.cmd + 内置 Node + dsh）
├─ ds-harness-client/     # 早期客户端启动器（已被 app 取代）
├─ build_mac.sh           # Mac 交叉构建脚本
├─ rebuild_dist.sh        # Windows 重打包脚本
└─ PROJECT_OVERVIEW.md    # 项目总览
```

## License

MIT
