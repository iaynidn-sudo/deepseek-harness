#!/bin/bash
# ============================================================
#  DeepSeek Harness — Mac 一键安装脚本
#  用法：解压 tar.gz 后，双击本文件即可
#  作用：1) 解除系统拦截  2) 安装到「应用程序」  3) 启动
# ============================================================
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/ds-harness-app.app"
INSTALLED="/Applications/ds-harness-app.app"

if [ ! -d "$APP" ]; then
  echo "❌ 错误：找不到 ds-harness-app.app"
  echo "   请确认在解压后的文件夹内双击本脚本。"
  read -p "按回车退出..." -r
  exit 1
fi

echo ""
echo "  🚀 DeepSeek Harness 一键安装"
echo "  =============================="
echo ""

echo "  [1/3] 解除系统拦截 (xattr -cr) ..."
xattr -cr "$APP" 2>/dev/null || true
echo "        ✓ 完成"

echo "  [2/3] 安装到「应用程序」文件夹 ..."
rm -rf "$INSTALLED" 2>/dev/null || true
cp -R "$APP" /Applications/
echo "        ✓ 已安装到 /Applications"

echo "  [3/3] 启动 ..."
open "$INSTALLED"
echo "        ✓ 已启动"

echo ""
echo "  ✅ 安装完成！"
echo "  📌 以后请从「应用程序」文件夹启动 DeepSeek Harness"
echo "  （本次安装的副本在 /Applications，原解压目录可删除）"
echo ""
read -p "按回车关闭本窗口..." -r
