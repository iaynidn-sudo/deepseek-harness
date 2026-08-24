# DeepSeek Harness (DSH)

> 把 DeepSeek 官方开源 Agent 运行底座 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) 及其 Web UI，包装成**自包含、可搬运的桌面应用**。双击即用，无需安装 Node.js / npm / Electron 等任何开发环境。

- 本地 Web 服务：`http://127.0.0.1:3080`
- 运行数据存于应用目录 `.dsh/`，不写系统盘，复制走不留痕迹

## 形态

| 形态 | 说明 | 启动方式 |
|---|---|---|
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
