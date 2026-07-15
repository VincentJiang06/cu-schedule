# 服务器部署(Docker)

给部署操作者(Claude)的 runbook。本项目是**纯静态站点**:构建产物就是 `dist/`,
容器里只有一个 nginx,没有后端进程、没有数据库、没有运行时数据写入。

> ✅ 这套 Dockerfile / deploy/nginx.conf / docker-compose.yml **已在生产实机验证**
> (2026-07 起以 `svc-cuschedule` 跑在部署方的 Traefik 栈里,HEALTHCHECK 打
> `127.0.0.1/data/manifest.json` 与仓库定义一致)。§3 的清单从"首次部署必须逐项过"
> 降级为**变更后回归用**。

## 1. 服务器要求

| 项 | 要求 |
| --- | --- |
| 运行时 | Docker(任意近年版本;compose v2 可选) |
| 资源 | 极低:128MB 内存、0.1 核、磁盘 ~200MB(镜像+产物)即可 |
| 架构 | amd64/arm64 均可;若在 Mac 上构建再传服务器,注意 `--platform linux/amd64` |
| 网络 | 容器只讲 HTTP :80;TLS 由宿主反向代理(Caddy/Traefik/nginx)终结 |
| 入站依赖 | 无。构建所需数据已随 git 提交(`public/data`),**不需要** Python/抓取环境 |

## 2. 部署步骤

```bash
git clone https://github.com/VincentJiang06/cu-schedule.git && cd cu-schedule
docker compose up -d --build        # 或: docker build -t cu-schedule . && docker run -d -p 8080:80 cu-schedule
```

构建流程(Dockerfile 已定义,两阶段):`node:22-alpine` 里 `npm ci && npm run build`,
产物预压缩出 `.gz`;`nginx:alpine` 托管 `dist/`,健康检查打 `/data/manifest.json`。

## 3. 部署后验证清单(必须逐项过)

```bash
BASE=http://localhost:8080
curl -s -o /dev/null -w '%{http_code}\n' $BASE/                          # 200
curl -sI $BASE/data/manifest.json | grep -i cache-control                # no-cache
curl -sI $BASE/data/2026-27/2026-27-term-1.json | grep -i cache-control  # max-age=31536000, immutable
curl -sI $BASE/data/programs.json | grep -i cache-control                # max-age=31536000, immutable(2026-07-15 起与其余 /data/** 一致)
curl -sI -H 'Accept-Encoding: gzip' $BASE/data/2026-27/2026-27-term-1.json | grep -i content-encoding  # gzip
curl -s $BASE/data/manifest.json                                         # 含 generatedAt 字段
docker ps --format '{{.Names}} {{.Status}}'                              # (healthy)
```

浏览器里开一次页面:课程能加载、切 Term 1/2 正常、无 console 报错。

## 4. 缓存策略(为什么是这样,勿随意改)

与 [api-design.md](api-design.md) §2 的版本协议一一对应:

- `manifest.json` → **no-cache**:数据版本入口,必须每次再验证(ETag 304 极便宜)。
- 其余 `/data/**` 与 `/assets/**` → **1 年 immutable**:客户端一律带 `?v=<generatedAt>`
  (数据)/文件名带哈希(资产),版本变则 URL 变,长缓存绝对安全。
- `index.html` → no-cache:入口再验证,发布即生效。

前面若有 CDN,同样遵守:不要对 manifest.json 做覆盖性长缓存。

## 5. 数据/代码更新流程

数据是**手动更新**的(维护者本地跑抓取与构建、提交、推送),服务器上只做不可变重建:

```bash
cd cu-schedule && git pull
docker compose up -d --build        # 重建镜像并替换容器
# 验证:curl -s $BASE/data/manifest.json 里 generatedAt 应为新值
```

## 6. 回滚

```bash
git checkout <上一个好提交> && docker compose up -d --build
```

镜像即产物、无状态、无迁移,回滚就是重建旧提交。

## 7. 合规(AGPL-3.0 §13)

以网络服务提供本应用,必须保留界面上的完整源码入口(页脚 GitHub 链接)。若部署的是
修改过的版本,需公开对应源码。
