# DeepSeek Harness (DSH) 项目总览

> 整理时间：2026-08-24
> 工作区：`E:\Claude\DSH`
> 本质：**把 DeepSeek 官方开源 Agent 运行底座 `@deepseek-ai/dsh` 及其 Web UI，包装成桌面客户端 / 绿色便携版，并产出 Windows + macOS 安装包。**

---

## 一、项目一句话定位

DSH 是一个**自包含、可搬运的 DeepSeek Agent 桌面运行环境**。它内置 Node.js + `@deepseek-ai/dsh`，双击即可在本地 `http://127.0.0.1:3080` 拉起 dsh 的 Web 服务并内嵌进原生窗口，**无需用户安装任何开发环境**。支持可选填入 DeepSeek API Key，留空则走本地匿名模式。

---

## 二、目录结构总览

| 目录 / 文件 | 类型 | 作用 | 大小 / 规模 |
|---|---|---|---|
| `ds-harness-app/` | 源码 | **Electron 桌面客户端主工程**（窗口版）。内置 dsh、H5 页面内嵌原生窗口、托盘、设置、自动更新检测。 | ~1.8万文件 |
| `ds-harness-portable/` | 产物 | **绿色便携版**：双击 `launch.cmd` 即用，数据存于本地 `.dsh`，不写系统盘。自带 Windows Node。 | ~1.85万文件 |
| `ds-harness-client/` | 源码 | **早期客户端启动器**（launch.cmd / .ps1）。依赖系统中已安装的 electron，从 PATH 拉起。 | 8 文件 |
| `dsh_ai_bak/` | 备份 | dsh 运行期的配置/缓存快照（`@deepseek-ai` 相关功能模块的历史备份，如 llm、mcp-client、sandbox、session 等）。 | ~2962 文件 |
| `dsh_home_test/` | 配置 | dsh 运行态目录测试（`profiles/` 配置）。 | 4 文件 |
| `release/` | 产物 | **最终发布包**：Mac (Apple Silicon) + Windows x64 的 tar.gz / zip，附带部署说明。 | ~658 MB |
| `build_mac.sh` | 脚本 | Mac (.app) 交叉构建脚本（darwin/arm64）。 | — |
| `rebuild_dist.sh` | 脚本 | Windows x64 重新打包脚本（解决 260 字符路径限制）。 | — |
| `.dsh_backup/` | 备份 | 另一个 dsh 运行态备份（credentials / profiles / sessions / storages）。 | — |
| `.workbuddy/` | 元数据 | 本工作区 WorkBuddy 项目数据（非项目源码）。 | — |

---

## 三、三大形态对比

| 形态 | 交付物 | 启动方式 | 内置 Node | 适用场景 |
|---|---|---|---|---|
| **Electron 桌面客户端** | `ds-harness-app/` → `dist/ds-harness-app-win32-x64/` + `dist/ds-harness-app-darwin-arm64/` | 双击 `.exe` / `.app` | 内置 Node v22 + `@deepseek-ai/dsh` | 正式分发的桌面应用，有托盘、设置面板、自动更新检测 |
| **绿色便携版** | `ds-harness-portable/` | 双击 `launch.cmd` | 内置 Windows Node v22 | U盘/云盘拷贝即用，数据不落系统盘，可彻底清理 |
| **旧客户端启动器** | `ds-harness-client/` | 双击 `launch.cmd` / `launch-browser.cmd` | 复用系统/受管 Node | 早期方案，需本机先 `npm install electron` |

---

## 四、核心运行机制（来自 main.js）

1. **端口约定**：dsh Web 服务固定监听 `127.0.0.1:3080`（可用环境变量 `DSH_PORT` 覆盖）。
2. **启动链路**：Electron 主进程 → spawn 内置 `node.exe` → 执行 `node_modules/@deepseek-ai/dsh/lib/bin.js` → 拉起 dsh 服务 → 窗口内 `<webview>` / BrowserWindow 加载 `http://127.0.0.1:3080`。
3. **关键路径常量**：
   - `NODE_BIN` = `bin/node.exe`（Windows）/ `bin/node`（Mac）
   - `DSH_BIN` = `node_modules/@deepseek-ai/dsh/lib/bin.js`
   - `DSH_HOME` = `.dsh/`（运行数据目录）
4. **设置持久化**：`settings.json` 存 `{ autoUpdate, apiKey, checkOnStartup }`；API Key 同时写入 `.env` 的 `DEEPSEEK_API_KEY`，供 dsh 启动时读取。
5. **自动更新检测**：启动时请求 `https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest` 比对版本，有新版弹窗提示（引导下载新安装包，无法热替换 node_modules）。
6. **托盘 + 多窗口**：主窗口、Splash 启动页、设置窗口、帮助窗口、托盘菜单（右键 → 设置）。
7. **Mac 特殊处理**：`build_mac.sh` 会复制 Mac 版 node 二进制，并生成 `fix-gatekeeper.command`（`xattr -cr` 去除未签名 .app 隔离标记）。

---

## 五、构建与发布链路

```
构建脚本
  ├─ build_mac.sh        → dist/ds-harness-app-darwin-arm64/ + fix-gatekeeper.command + README_MAC.txt
  └─ rebuild_dist.sh     → dist/ds-harness-app-win32-x64/ （短路径规避 Windows 260 字符限制）
          │
          ▼
  打包工具（ds-harness-app/tools/）
  ├─ makezip.js          → 生成 zip
  ├─ untar.js / genicon*.js / fetch-mac-node.js
          │
          ▼
  release/
  ├─ DeepSeek-Harness-Mac-AppleSilicon.tar.gz   (163 MB)
  ├─ DeepSeek-Harness-Windows-x64.tar.gz        (235 MB)
  ├─ DeepSeek-Harness-Windows-x64.zip           (259 MB)
  ├─ README-Mac部署说明.txt
  └─ README-Windows部署说明.txt
```

---

## 六、关键依赖版本

| 组件 | 版本 | 备注 |
|---|---|---|
| Electron | `^43.4.1` | 桌面壳 |
| electron-packager | `^17.1.2` | 打包工具 |
| 内置 Node | v22.19+ / v24+ | Windows 用 v22，Mac 脚本引用 v22.2.2 |
| `@deepseek-ai/dsh` | npm latest | 核心 Agent 底座（来自 `ds-harness-portable/node_modules`） |

---

## 七、待清理 / 注意事项

1. **冗余目录**：`dsh_ai_bak/`、`dsh_home_test/`、`.dsh_backup/` 均为 dsh 运行态快照/测试缓存，非源码，可考虑归档或删除（注意 `.dsh_backup` 含 `.credentials.yaml`，含敏感信息，勿外传）。
2. **`ds-harness-client/` 是早期方案**：已被 `ds-harness-app`（自包含 Electron 版）取代，如不维护可归档。
3. **两套构建脚本路径耦合**：`rebuild_dist.sh` 写死了 `C:\Users\jiang\WorkBuddy\2026-08-23-10-12-45\` 绝对路径，迁移机器需改写。
4. **发布包体积大**：Mac 163MB / Windows 235MB(zip 259MB)，主要是内置 Node + dsh 依赖。

---

## 八、快速上手

- **开发调试**：`cd ds-harness-app && npm start`（需先 `npm install electron`）
- **便携使用**：拷贝 `ds-harness-portable/`，双击 `launch.cmd`，浏览器开 `http://127.0.0.1:3080`
- **正式分发**：用 `release/` 下的压缩包，按 README 部署即可
