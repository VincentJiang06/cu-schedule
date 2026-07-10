# 数据目录结构

`data/` 是**所有数据的唯一真源**，收纳两组数据集：**课程（courses）** 与 **培养方案（programs）**。

顶层按阶段分：原始抓取统一放在 `data/raw/` 下，处理后的成品直接放在 `data/courses/`、
`data/programs/`。浏览器实际拉取的 `public/data/` 只是构建脚本生成的**镜像**（部署工件，
不是真源；未来的 API 会直接读 `data/`，届时它就没用了）。

```text
data/                                   ← 数据真源
├── raw/                                原始抓取
│   ├── courses/
│   │   └── <学年>/<SUBJ>.json          每学科一个富文本文件（约 38 MB/学年）
│   └── programs/
│       ├── index.json                  抓取清单
│       └── <入学年>/<学院>/
│           ├── <方案>.json             元数据 + 抽取的方案文本
│           └── <方案>.html.gz          完整原始详情页（无损，gzip）
│
├── courses/                            处理后课程（真源，前端/API 读取）
│   ├── manifest.json                   可用学年 + generatedAt（数据版本，见下）
│   └── <学年>/
│       ├── <term>.json                 按学期的精简包，每门课带预解析 req（约 2.3 MB / gzip 240 KB）
│       ├── index.json                  该学年的学期清单
│       └── subjects.json               学科码 → 学科名
│
└── programs/                           处理后方案（真源）
    ├── programs.json                   紧凑方案包（供前端按 Course.key 匹配）
    └── <入学年>/<学院>/<方案>.json      结构化：degree / total_units / all_course_codes[] …
                                         （逐文件是唯一真源；不再有 all_programs.json 合并数组）

public/data/                            ← 生成的镜像（每次构建整体重写，供当前静态前端）
├── manifest.json                       = data/courses/manifest.json
├── <学年>/…                            = data/courses/<学年>/…
└── programs.json                       = data/programs/programs.json
```

## 两条流水线

| 阶段 | 课程（courses） | 培养方案（programs） |
| --- | --- | --- |
| 抓取 | `scripts/scrape_all_subjects.py` → `raw/courses/<学年>/*.json` | `scripts/scrape_programs.py` → `raw/programs/<年>/<学院>/*` |
| 处理 | `scripts/build_bundles.mts`（tsx）→ `courses/*`，预解析 `req` 一并写入 | `scripts/parse_programs.py` → `programs/<年>/<学院>/*.json`（逐文件即真源，不再产出合并数组） |
| 打包 | 同上 | `scripts/build_bundles.mts` 直接读逐文件 → `programs/programs.json` |
| 镜像 | `scripts/build_bundles.mts` 一次性把 `data/courses/**` + `data/programs/programs.json` 整体镜像进 `public/data/`（先清空再拷，单一所有者） | 同 |
| 前端 | `src/lib/data.ts` | `src/lib/programs.ts` |

课程与方案两条流水线的"打包 + 镜像"步骤现在由同一个 TS 脚本 `scripts/build_bundles.mts`
（`npm run data:build`）完成，取代了原来的 `build_term_bundles.py` + `build_program_bundle.py`
两个 Python 脚本各自维护一份 wire 格式契约、各自 carve-out 镜像目录的做法。Python 侧此后只剩
抓取（vendored）与 `parse_programs.py`（研究计划文本解析，属"处理"而非 wire 契约）。

## 两组数据的连接点

方案的 `all_course_codes[]` 就是课程码，与课程数据的 `Course.key`（前 8 字符，见
[docs/schema.md](../docs/schema.md)）同一套命名，可直接匹配——这是把「培养方案」接到
「课程」上的桥。

## 命名约定

- 课程用**学年**：`2026-27`。
- 方案用**入学年**：`2025`（该年入学适用的培养方案）。语义不同，各自保留原写法。

## 数据版本（manifest.json 的 generatedAt）

`data/courses/manifest.json`（= `public/data/manifest.json`）里的 `generatedAt` 是整套数据的
版本号——构建那一刻的 ISO UTC 时间戳，例如 `"2026-07-11T04:20:00Z"`。前端只对这一个文件用
`fetch(..., { cache: 'no-cache' })` 强制走网络再验证（几十字节，代价可忽略），拿到
`generatedAt` 后给其余每个数据请求的 URL 追加 `?v=<generatedAt>`：手动重跑 `data:build` 换出新
版本号，浏览器旧缓存的 URL 不再命中，用户不会无限期吃到旧数据；版本没变时新请求仍能命中缓存。
详见 [docs/schema.md](../docs/schema.md) 与 `src/lib/data.ts` 的 `fetchManifest`。

## 校验

```bash
npx tsx scripts/audit_data.mts          # 课程：数据包 vs 原始逐门对账 + 逐字段不变量
npx tsx scripts/check_requirements.mts  # 先修/互斥解析：全目录零误报
```
