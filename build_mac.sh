#!/usr/bin/env bash
# ============================================================
#  DeepSeek Harness — Mac (.app) 构建脚本
#  在 Windows/Linux 上交叉编译 darwin/arm64 输出
#  用法: bash build_mac.sh
#  产物: ds-harness-app/dist/ds-harness-app-darwin-arm64/
# ============================================================
set -e

SRC="$(cd "$(dirname "$0")/ds-harness-app" && pwd)"
OUT="$SRC/dist"
DARWIN_OUT="$OUT/ds-harness-app-darwin-arm64"
PKG="$SRC/dist_mac"          # 相对路径（避免 /c/ 路径问题）

echo "=== [1/5] 清理旧产物 ==="
rm -rf "$DARWIN_OUT" "$PKG"

echo "=== [2/5] electron-packager (darwin/arm64) ==="
cd "$SRC"
export NODE_TLS_REJECT_UNAUTHORIZED=0
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

node node_modules/electron-packager/bin/electron-packager.js \
  . "ds-harness-app" \
  --platform=darwin \
  --arch=arm64 \
  --out="$PKG" \
  --overwrite \
  --icon="assets/icon.icns" \
  --app-bundle-id=com.deepseek.harness \
  --app-category-type=public.app-category.developer-tool

echo "=== [3/5] 集成 @deepseek-ai/dsh ==="
APP="$PKG/ds-harness-app-darwin-arm64/ds-harness-app.app/Contents/Resources/app"
if [ ! -d "$APP" ]; then
  echo "ERROR: 找不到 packaged app resources at $APP"
  ls -R "$PKG" 2>/dev/null | head -30
  exit 1
fi

AI_SRC="$(cd "$(dirname "$0")/ds-harness-portable" && pwd)/node_modules/@deepseek-ai"
mkdir -p "$APP/node_modules/@deepseek-ai"
cp -r "$AI_SRC/." "$APP/node_modules/@deepseek-ai/"
echo "DSH_OK"

echo "=== [4/5] 复制 Mac node 二进制 ==="
# 尝试从多个来源获取 macOS arm64 node
MAC_NODE=""
# A) 项目 bin/ 下可能有预置的
if [ -f "$SRC/bin/node-darwin-arm64" ]; then
  MAC_NODE="$SRC/bin/node-darwin-arm64"
fi
# B) 从系统 node (如果是 arm64 Mac 跑此脚本)
if [ -z "$MAC_NODE" ] && [ "$(uname -m)" = "arm64" ] && [ "$(uname -s)" = "Darwin" ]; then
  MAC_NODE="$(which node 2>/dev/null)"
fi
# C) 从 Electron 自带 node 提取
if [ -z "$MAC_NODE" ]; then
  ELEC_NODE=$(find "$PKG" -name "node" -type f 2>/dev/null | grep -v ".node$" | head -1)
  if [ -n "$ELEC_NODE" ]; then
    MAC_NODE="$ELEC_NODE"
  fi
fi

if [ -n "$MAC_NODE" ]; then
  mkdir -p "$APP/bin"
  cp "$MAC_NODE" "$APP/bin/node"
  chmod +x "$APP/bin/node"
  echo "NODE_OK ($MAC_NODE)"
else
  echo "WARN: 未找到 Mac node 二进制，将在 Mac 上首次运行时自动下载"
  # 创建一个下载脚本放在 app 里
  cat > "$APP/bin/fetch-node.sh" << 'FETCH_EOF'
#!/bin/bash
# 首次运行自动下载 macOS node
ARCH="$(uname -m)"
VER="v22.2.2"
URL="https://nodejs.org/dist/${VER}/node-${VER}-darwin-${ARCH}.tar.gz"
TMP="/tmp/node-fetch-$$"
echo "正在下载 Node.js ${VER} (${ARCH})..."
curl -fsSL "$URL" | tar xz -C "$TMP" --strip-components=1
cp "$TMP/bin/node" "$(dirname "$0")/node"
chmod +x "$(dirname "$0")/node"
rm -rf "$TMP"
echo "Node.js 安装完成"
FETCH_EOF
  chmod +x "$APP/bin/fetch-node.sh"
fi

echo "=== [5/5] 移至最终目录 + 生成修复脚本 ==="
# 移动到 dist
mv "$PKG/ds-harness-app-darwin-arm64" "$DARWIN_OUT" 2>/dev/null || {
  # 如果路径不同，find 并移动
  SRC_DIR=$(find "$PKG" -maxdepth 1 -type d | head -1)
  if [ -n "$SRC_DIR" ]; then mv "$SRC_DIR" "$DARWIN_OUT"; fi
}

# 生成 Gatekeeper 修复脚本（Mac 双击即可去除 quarantine）
FIX_SCRIPT="$OUT/fix-gatekeeper.command"
cat > "$FIX_SCRIPT" << 'FIXEOF'
#!/bin/bash
# ============================================================
#  DeepSeek Harness — Gatekeeper 修复脚本
#  用法：在 Mac 上双击本文件，或在终端执行
#  作用：移除 macOS 对未签名 .app 的隔离标记
# ============================================================
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_PATH="$SCRIPT_DIR/ds-harness-app-darwin-arm64/ds-harness-app.app"

if [ ! -d "$APP_PATH" ]; then
  # 尝试找 .app
  APP_PATH=$(find "$SCRIPT_DIR" -name "*.app" -maxdepth 2 -type d 2>/dev/null | head -1)
fi

if [ ! -d "$APP_PATH" ]; then
  echo "错误：找不到 .app 文件夹"
  echo "请确保 ds-harness-app-darwin-arm64 目录在本文件夹内"
  read -p "按回车退出..."
  exit 1
fi

echo "正在修复 $APP_PATH ..."
xattr -cr "$APP_PATH"
echo ""
echo "✅ 修复完成！现在可以打开 DeepSeek Harness 了。"
echo ""
read -p "按回车关闭此窗口..."
FIXEOF
chmod +x "$FIX_SCRIPT"

# 生成 README_MAC.txt
cat > "$OUT/README_MAC.txt" << 'READMEEOF'
DeepSeek Harness — Mac 版使用说明
==================================

【安装步骤】
1. 将 ds-harness-app-darwin-arm64 文件夹复制到 Mac 的 /Applications 或任意位置
2. 首次打开前，先双击运行 fix-gatekeeper.command（输入密码授权）
   这一步是必须的，因为 .app 未经过 Apple 签名认证

【如果提示"已损坏无法验证"】
终端执行：
  xattr -cr /Applications/ds-harness-app-darwin-arm64/ds-harness-app.app

【启动方式】
- 双击 ds-harness-app.app
- 或终端：open ds-harness-app.app

【注意】
- 需要 macOS 11+ (Big Sur)，Apple Silicon (M1/M2/M3/M4)
- 如需 Intel 版本，请联系重新打包 --arch=x64
- 首次启动会联网准备资源，请保持网络通畅
- 默认监听 http://127.0.0.1:3080

【配置】
- API Key：托盘 → 设置 → 填入 DeepSeek API Key
- 自动更新检测：默认开启，可在设置中关闭
READMEEOF

echo ""
echo "========================================="
echo "  MAC BUILD DONE"
echo "========================================="
echo "  APP:    $DARWIN_OUT"
echo "  FIX:    $FIX_SCRIPT (双击修复 Gatekeeper)"
echo "  README: $OUT/README_MAC.txt"
echo "========================================="
