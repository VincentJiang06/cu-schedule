#!/bin/sh
# 同容器启动两个进程：后台 Node 分享 API + 前台 nginx（作为容器主进程）。
# Node 崩溃只影响 /api（分享功能），静态站照常；nginx 退出则容器退出。
set -e

SHARE_PORT="${SHARE_PORT:-8787}" node /app/server/index.mjs &

exec nginx -g 'daemon off;'
