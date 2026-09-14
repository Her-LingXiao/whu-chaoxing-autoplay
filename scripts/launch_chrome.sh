#!/usr/bin/env bash
# launch_chrome.sh — 以远程调试模式启动本机 Chrome（保留用户登录态）
# 用法：bash launch_chrome.sh
set -u

CHROME="$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser)"
if [ -z "$CHROME" ]; then
  echo "ERROR: 未找到 Chrome/Chromium，请先安装。"
  exit 1
fi
USER_DATA="${CHROME_USER_DATA_DIR:-$HOME/.config/google-chrome}"

# 若调试端口已开，直接复用
if curl -s --max-time 2 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  echo "Chrome 调试端口 9222 已在运行，直接复用。"
  curl -s http://127.0.0.1:9222/json/version
  exit 0
fi

# 关闭现有 Chrome，带调试端口重启
pkill -f "remote-debugging-port=9222" 2>/dev/null
"$CHROME" --remote-debugging-port=9222 --user-data-dir="$USER_DATA" >/dev/null 2>&1 &
sleep 4

if curl -s --max-time 2 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  echo "OK Chrome 已以调试模式启动："
  curl -s http://127.0.0.1:9222/json/version
else
  echo "WARN: 启动后未检测到 9222 调试端口，请手动以 --remote-debugging-port=9222 启动 Chrome。"
fi
