#!/bin/sh
# 同容器启动:后台 Node 分享 API(+ 可选的站点私有扩展)+ 前台 nginx(容器主进程)。
# Node 崩溃只影响 /api,静态站照常;nginx 退出则容器退出。
set -e

SHARE_PORT="${SHARE_PORT:-8787}" node /app/server/index.mjs &

# 站点私有扩展(部署方自备,不随本仓库分发;文件不存在时静默跳过,前端相应功能自动降级)。
if [ -f /app/server/private-api.mjs ]; then
  PRIVATE_API_PORT="${PRIVATE_API_PORT:-8788}" node /app/server/private-api.mjs &
fi

exec nginx -g 'daemon off;'
