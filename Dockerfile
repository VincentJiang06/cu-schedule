# CU Schedule — 纯静态站点,多阶段构建:node 出 dist,nginx 托管。
# 数据(public/data)已随 git 提交,构建不需要 Python/抓取步骤。
# 部署 runbook 见 docs/deployment.md。

# ---- 构建阶段 -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

# 预压缩:nginx gzip_static 直接回 .gz,运行时零压缩 CPU
RUN find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.json' \
      -o -name '*.svg' -o -name '*.html' \) -exec gzip -9 -k {} +

# ---- 运行阶段 -------------------------------------------------------------
# nginx 托管静态资源;同容器内跑一个极小的 Node 服务处理 /api/*（只读分享的内存存储）。
FROM nginx:alpine
RUN apk add --no-cache nodejs
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY server /app/server
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO /dev/null http://127.0.0.1/data/manifest.json || exit 1

# 先起 Node 分享服务(后台)，再把 nginx 拉到前台作为容器主进程。
ENTRYPOINT ["/entrypoint.sh"]
