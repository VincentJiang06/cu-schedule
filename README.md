# CU Schedule · 中大选课助手

从"我要上哪几门课"和"我已经上过哪几门课"出发，自动排出课表，并主动筛选出**这学期你还能选什么**。

界面只做一件事：把整张课表和整张可选课表同时放进一屏，不用来回滚动。

---

## 它做什么

1. **输入两组课号**。要上的课，和上过的课。都支持整段粘贴（`MATH2050, CSCI2100 ENGG1110`），也支持按课名/教师搜索。
2. **自动排课表**。系统枚举每门课的 section 组合，遵守 CUHK 的 cohort 配对规则（`A-LEC` 只配 `AT01-TUT`、`AE01-EXR`，不配 `BT01-TUT`），排除时间冲突，给出若干种可行排法，按上课天数从少到多排序。
3. **主动筛可选课**。对全学期每一门课，判断它能不能放进你当前的课表：

   | 状态 | 含义 |
   | --- | --- |
   | 可选 | 至少有一种上课组合能直接放进当前排法 |
   | 换排法 | 和当前排法冲突，但换一种排法就放得下 |
   | 冲突 | 所有组合都和你确定要上的课冲突 |
   | 待定 | 本学期尚未公布上课时间 |

4. **读懂选课限制**。课程目录里的 `enrollment_requirement` 是自由文本，我们把先修条件解析成完整的布尔表达式（`and` / `or` / 嵌套括号 / `/` 等价写法都支持），用三值逻辑（满足 / 不满足 / 不确定）求值：
   - `Not for students who have taken X` —— 你修过 X，这门课直接从表里移除。
   - `Pre-requisite: (A or B) and C` —— 只有在能**证明**条件不满足时才标「缺先修」；铁律是宁可不提示，也不给错误提示。
   - 成绩条件、导师/院系同意、豁免这类没法核验的条件，一律判「不确定」，按满足处理——不会因为我们读不懂一句话，就把你本来能选的课误判成不能选。

5. **对照培养方案**。在信息页选定入学年份和主修后，培养方案按官方日历的层级原样渲染成大课表（编号项 / 分流 / 可选方向逐层展开），点选标记已完成课程；选课页可按「本专业需要」过滤全目录。
6. **导出与分享**。排好的课表可导出 `.ics` 日历（周期估算，需回 CUSIS 核对实际日期）和 PNG 对比图；整套选择可压进一条 URL 分享链接，打开即恢复。

---

## 数据从哪来

课程数据抓取自 [CUHK 公开课程目录](https://rgsntl.rgs.cuhk.edu.hk/aqs_prd_applx/Public/tt_dsp_crse_catalog.aspx)。

**抓取管线整套来自 [EagleZhen/another-cuhk-course-planner](https://github.com/EagleZhen/another-cuhk-course-planner)**，包括 `scripts/cuhk_scraper.py`、`scripts/scrape_all_subjects.py`、`scripts/data_utils.py` 及其测试。这些文件基本原样保留。向作者致敬 —— 抓一个会变的、带验证码的、HTML 结构不稳定的教务系统，是这个项目里最脏也最有价值的一段工作，我们没有重造它。

打包环节是本项目自己写的 `scripts/build_bundles.mts`（`npm run data:build`）：把抓下来的、按学科分文件的完整数据，压成前端要的**按学期**精简包（先修条件在这一步预解析写入），再整体镜像到 `public/data/`。

```text
CUHK 公开课程目录（外部）
    ↓  scripts/scrape_all_subjects.py        （来自 EagleZhen）
data/raw/courses/<year>/<SUBJ>.json            ~38 MB / 学年
    ↓  scripts/build_bundles.mts             （本项目，npm run data:build）
data/courses/<year>/<term>.json                ~2.3 MB / 学期（gzip 后 ~240 KB）
    ↓  同一脚本镜像到 public/data/
前端一次性加载整个学期
```

前端一次性把整学期 2973 门课全部读进内存，是"主动筛选可选课"能成立的前提 —— 每次改动课表都要对全目录重算一遍状态。压到 240 KB 才让这件事变得可行。

数据目录的完整结构（课程 + 培养方案两组数据）见 [data/README.md](data/README.md)。

### 更新数据

```bash
uv sync                                        # 装 Python 依赖
uv run python scripts/scrape_all_subjects.py   # 抓全部学科（慢，有验证码）
uv run python scripts/scrape_all_subjects.py CSCI,MATH   # 只抓几个学科
npm run data:build                             # 生成前端数据包（含 public/data 镜像）
```

---

## 项目结构

```text
├── src/                    前端（React + Vite，无路由无状态库，App.tsx 是唯一编排层）
│   ├── lib/                纯逻辑：types.ts（schema 唯一真源）、courseKey.ts（课号身份
│   │                       唯一裁决处）、requirements.ts（先修三值求值）、schedule.ts（排课）、
│   │                       candidates.ts（可选课筛选）、programs.ts（培养方案）……不依赖 React 运行时
│   └── components/         纯展示组件，被 App.tsx 编排
├── scripts/                数据管线（用法见下节「数据从哪来」）
│   ├── cuhk_scraper.py 等  抓取器，vendored 自 EagleZhen（保持原样，见 NOTICE.md）
│   ├── parse_programs.py   培养方案文本 → 结构化 JSON
│   ├── build_bundles.mts   唯一的打包脚本：产出全部成品 + public/data 镜像
│   └── {check_requirements,audit_data}.mts   两个校验门（CI 强制执行）
├── data/                   所有数据的唯一真源（raw → 成品，结构详见 data/README.md）
├── public/data/            data/ 成品的生成镜像（勿手改，data:build 整体重写）
├── docs/                   见下方阅读地图
├── deploy/ + Dockerfile    静态站点的 nginx 容器化（docs/deployment.md 是 runbook）
└── .github/workflows/      CI：类型检查 + 构建 + 两个数据校验门
```

### 文档阅读地图

| 你要做的事 | 从哪读起 |
| --- | --- |
| 改前端（UI / 交互 / 筛选逻辑） | [docs/api-design.md](docs/api-design.md) —— **前端唯一入口**，数据契约与改动规则 |
| 理解课程数据字段 / 课号 key / 先修解析 | [docs/schema.md](docs/schema.md) |
| 理解培养方案数据与 `structure` 树 | [docs/programs-data.md](docs/programs-data.md) |
| 更新 / 重建数据 | [data/README.md](data/README.md) + 本文「数据从哪来」 |
| 部署 | [docs/deployment.md](docs/deployment.md) |
| 了解架构决策的来龙去脉 | [docs/architecture-review.md](docs/architecture-review.md)（已结案的审查记录） |

## 开发

```bash
npm install
npm run dev        # 本地开发（Vite，:5173）
npm run dev:api    # 只读分享后端（Node 内存存储，:8787，另开一个终端）
npm run build      # 类型检查 + 生产构建
```

「只读分享」（导出页生成 `/#v=<id>` 只读链接）需要 `npm run dev:api` 一起跑：Vite 把
`/api` 代理到这个 Node 服务（内存存储、1 天 TTL）。不跑它时其余功能不受影响，只是分享
按钮会提示连不上服务。生产环境由同容器的 nginx 反代 `/api` 到该服务（见 `deploy/`）。

**前端开发从 [docs/api-design.md](docs/api-design.md) 入手**——数据契约、运行时接口面、
改动规则与阅读地图都在那里。改动前后必须过的两道校验门（CI 也会跑）：

```bash
npm run data:check   # 先修解析：全目录零误报
npm run data:audit   # 全量一致性审计：数据包 vs 原始对账
```

Python 侧（抓取器与方案解析）的测试：

```bash
uv sync && uv run pytest
```

---

## 许可证

本项目以 **AGPL-3.0** 发布，见 [LICENSE](LICENSE)。

这不是一个自由选择：`scripts/` 下的抓取器直接来自 AGPL-3.0 授权的 `EagleZhen/another-cuhk-course-planner`，AGPL 的传染性条款要求任何包含它的衍生作品同样以 AGPL-3.0 发布，且通过网络提供服务时必须向用户提供完整源码。

---

## 免责声明

名额、Closed 状态、开课与否都会实时变化。**最终选课前请回 CUSIS 核对。**
