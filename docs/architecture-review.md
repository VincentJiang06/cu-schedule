# 架构审查与修改建议(已结案)

审查日期:2026-07-11 · 审查范围:整个工作树(含未提交变更) · 执行人:交由 Opus 逐项落实

> **状态(2026-07-11 结案)**:本审查已全部处理完毕,以下为历史记录,不再是待办。
> 各项裁决:
>
> | 条目 | 状态 |
> | --- | --- |
> | #1 提交纪律 | ✅ 已落库,工作树干净 |
> | #2 README 过时 | ✅ 已修正(含后续 build_bundles 引用更正) |
> | #3 tsx 依赖 | ✅ 进 devDependencies,`data:*` npm scripts 就位 |
> | #4 加载期解析 | ✅ 构建期预解析 `req` 入 wire 格式,audit 逐门复核一致性 |
> | #5 schema 双语言分治 | ✅ `build_bundles.mts` 统一,两个 Python build 脚本已删 |
> | #6 仓库重量 | ✅ **裁决:维持现状**。raw 永久只维护两份学年快照,不用 LFS 不出库;`public/data` 镜像与真源逐字节相同 → git 按内容寻址**只存一份 blob**(已实测 SHA 一致),"每提交存两遍"不成立,镜像仅使克隆工作区多 ~6MB |
> | #7 programs 双真源 | ✅ all_programs.json 已删,逐文件为唯一真源 |
> | #8 API 设计 | ✅ docs/api-design.md 落库 |
> | #9 CI | ✅ .github/workflows/ci.yml:类型检查 + 构建 + data:check + data:audit |
> | #10 prefs 死路径 | ⏪ 结案后回退(2026-07 核查):偏好 UI 已再次移除,`prefs` 恒为 `NO_PREFS`、`blockedByPrefs` 零调用点——现状以 api-design §3 为准(参数面保留,UI 无)。上下班时间窗约束以另一套「导轨」实现存在,与 prefs 无关 |
> | #11 programs.ts 挂空 | ✅ 已接入信息页(ProgramPicker / ProgramTable / 本专业筛选) |
> | #12 组合重算缓存 | ⏸ 按审查自己的要求"先测量再做",未出现可感知卡顿,不做 |
> | #13 localStorage 版本 | ⏸ 静默丢弃可接受(审查原文),失效提示留待 API 动工时随 dataVersion 一起做 |
> | #14 杂项 | ✅ audit_data.mts 已 import types.ts;schema.md 已补预解析一节 |

## 总评

分层是对的,底子是好的:`data/raw → data/{courses,programs} → public/data 镜像` 的三段式清晰;
`types.ts` 作为 schema 唯一真源、`courseKey.ts` 作为课号身份唯一裁决处的纪律已经建立;
先修引擎"三值逻辑 + 只在能证明时报警"经过全目录 964 门零误报验证,是全项目最扎实的部分。

现存的债务集中在五处:**仓库重量策略缺失**、**schema 被 Python/TS 两种语言分治**、
**一处实测 1.8 秒的加载期解析**、**文档与行为漂移**、**零自动化**。多用户 API 动工之前,
前两项必须先定,否则 API 会在错误的地基上开工。

---

## 不要动的部分(有意为之,勿"优化")

- `src/lib/requirements.ts` 的保守求值语义:`maybe` 塌缩为静默、成绩条件降级、互斥只取
  触发词之后。**964 门零误报是验收基线**,任何改动必须先过 `check_requirements.mts`。
- `courseKey.ts` 的 8 字符宽松匹配(前向兼容 ENGG1000A/B,今天是恒等操作)。
- `scripts/cuhk_scraper.py` / `scrape_all_subjects.py` / `data_utils.py`:vendored 自
  EagleZhen(AGPL-3.0),是"采集边界",保持原样,见 NOTICE.md。
- 排课的 cohort 配对规则(`A-LEC` 只配 `AT01-TUT`)——与上游行为一致。
- 客户端全量加载整学期目录的设计。这是"主动筛可选课"成立的前提,API 化之后也不变
  (见 P1-8:目录走静态,计算留客户端)。

---

## P0 — 立即处理(一致性/阻塞性)

### 1. 提交纪律:239 条未提交变更必须先落库

工作树混着两个会话数周的工作(数据重组、schema、UI 重构、programs 管线),任何后续
修改都不可追踪、不可回滚。**这是其他一切工作的前置。**

**做法**:按主题分成可独立 build 的提交序列,建议切分:
① 数据目录重组 + 脚本路径(data/raw、data/courses、data/programs、镜像逻辑);
② schema(types/courseKey/requirements/data/candidates + 两个校验脚本 + docs/schema.md);
③ UI 重构(App/SearchResults/SubjectPicker/styles + programs.ts + docs/programs-data.md);
④ 文档(README/NOTICE/data/README)。
**验收**:`git status` 干净;每个提交单独 checkout 后 `npm run build` 通过。
**注意**:提交 ① 前先执行 P1-6 的仓库策略决定,否则 39MB raw 会再次写进历史。

### 2. README 两处事实性过时

- 「它做什么」第 4 点仍写"混杂 and/or 的复合先修**不解析**"——现在解析了(布尔 AST,
  这正是本项目的卖点),README 在贬低自己的核心能力。
- 第 5 段"时间偏好是硬约束"——偏好 UI 已被移除(App.tsx:85-86 硬编码 DEFAULT_PREFS)。

**验收**:README 每一条行为描述与当前代码一致;先修一节改为描述三值逻辑与
「缺先修/看先修」两种标记。

### 3. `tsx` 未声明依赖

`audit_data.mts` / `check_requirements.mts` 靠 `npx tsx` 临时拉最新版,不可复现、CI 里
不可靠。

**做法**:`tsx` 进 devDependencies(锁版本);加 npm scripts:
`"data:audit": "tsx scripts/audit_data.mts"`、`"data:check": "tsx scripts/check_requirements.mts"`。
**验收**:干净 clone + `npm ci` 后两个命令直接可跑。

---

## P1 — 架构级(API 动工之前必须完成)

### 4. 加载期先修解析实测 1772ms,必须移到构建期

实测:`parseCode + parseRequirement × 6089 = 1772ms`(M 系列桌面 Node;中端手机预计
4-6 秒主线程阻塞)。这发生在每次页面加载的 `loadYearOfferings → toCourse` 里。

**做法**:构建期预解析。把 `Requirement`(AST + exclusions + 清洗文本)直接写进 wire
格式(`RawCourse` 增加 `req` 字段),运行时 `toCourse` 只做反序列化。AST 是纯 JSON,
天然可序列化。
**前置**:#5(否则要在 Python 里重写 TS 解析器——绝对禁止,必然分叉)。
**过渡方案**(若 #5 延后):只解析当前学期(约减半),另一学期首次切换时解析;或放
Web Worker。但正解是构建期。
**验收**:加载路径中 requirement 解析耗时 < 100ms;`check_requirements.mts` 与
`audit_data.mts` 仍全绿(校验脚本改读预解析字段并复核一致性)。

### 5. 结束 schema 双语言分治:wire 格式的"最后一跳"统一到 TS

现状:Python(`build_term_bundles.py`、`build_program_bundle.py`)**写** wire 格式,
TS(`types.ts`/`data.ts`)**读**,`audit_data.mts` 还内联重复声明了一份 Bundle 类型。
同一份契约三处维护。且 #4 要求在构建期跑 TS 解析器,Python 侧无法承担。

**做法**:新建 `scripts/build_bundles.mts`(tsx 运行),吸收两个 Python build 脚本的
职责:读 `data/raw/courses` 与 `data/programs/*.json` → 产出 `data/courses/*`、
`data/programs/programs.json` → 统一镜像整个成品树到 `public/data`(消灭现在两个脚本
按文件名 carve-out 共管镜像的脆弱结构)。复用 `courseKey.ts`/`requirements.ts`/`types.ts`。
Python 侧此后只剩:抓取(vendored)+ `parse_programs.py`(study_scheme 文本解析,属
"处理"而非 wire 契约,可留)。
**验收**:一条命令产出全部成品与镜像;`audit_data.mts` 改 import `types.ts` 后全绿;
两个 Python build 脚本删除;`package.json` 的 data:* 脚本对应更新。

### 6. 仓库重量策略(需用户拍板,阻塞 P0-1)

实测:HEAD 树 43.6MB,其中 `data/` 占 39.4MB。每学期刷新数据将向 git 历史叠加
~40MB;`public/data`(4.2MB)是 `data/courses` 的逐字节镜像,**同一份数据每个提交存
两遍**。三年后这个仓库会不可克隆。

**建议方案**(默认):
- `public/data/` 进 `.gitignore` —— 纯生成物,`npm run data:build` 可重建;
- `data/raw/**` 走 **Git LFS**(64MB,抓取有验证码、慢,出库损失可复现性,LFS 是折中);
- 处理后的 `data/courses`、`data/programs`(瘦身后,见 #7)留常规 git —— 它们是部署
  与 API 的直接输入,必须随 clone 可得。

**需用户决定**:raw 用 LFS 还是彻底出库(仓库最轻,但重建依赖再抓)。
**验收**:新提交不含镜像;raw 按决定处理;干净 clone 后 `npm ci && npm run data:build
&& npm run build` 全通。

### 7. `data/programs` 双份真源:all_programs.json 与逐文件完全同构

实测:`all_programs.json`(8.0MB)与 306 个逐文件(8.5MB)字段逐一相同(已验证
`keys()` 同构)。同一数据两份 tracked 真源,必然漂移。

**做法**:逐文件为真源;`all_programs.json` 降级为构建中间产物(gitignore),或让
build 步骤直接读逐文件、彻底删掉合并数组。`parse_programs.py` 输出对应调整。
**验收**:一份数据只有一个 tracked 副本;programs.json 重建结果不变(diff 为空)。

### 8. 多用户 API:切分设计(输出设计文档,不写代码)

核心判断,也是本次审查最重要的架构裁决:**目录数据不可变且人人相同 → 走静态版本化
JSON + CDN 强缓存,不要为它建动态 API。需要 API 的只有用户状态,而用户状态每用户
独立、无共享可变数据 → 并发天然平凡,服务端零计算。**排课与候选筛选全部留在客户端
(这正是全量加载设计的红利)。

要点写入 `docs/api-design.md`:
- **数据版本化**:wire 格式加 `dataVersion`(抓取时间戳);目录文件按
  `/data/<version>/...` 不可变发布,`manifest` 指向当前版本。客户端 localStorage 缓存
  按 dataVersion 失效。
- **用户状态模型**(现有 localStorage 结构不能直接 API 化,要拆):
  `taken[]` 是**跨学期全局**的;`committed[]` 是 **per-term** 的。
  `{ userId, taken: string[], selections: { [termSlug]: { committed: string[] } }, updatedAt }`
- **接口**:`GET /api/v1/me` / `PUT /api/v1/me`(整体读写,带 `If-Match` ETag,冲突
  409 由客户端合并重试)。够用就别拆更细。
- **离线/未登录**:localStorage 保留为离线模式;登录后服务端为准、本地做一次性合并。
- **AGPL §13**:以网络服务提供必须在界面提供完整源码入口(footer 已有,保持)。
**验收**:`docs/api-design.md` 落库,含上述契约与并发语义。

### 9. CI:目前为零

四个现成命令(`tsc -b`、`vite build`、`data:check`、`data:audit`)没有任何自动执行。
schema 和数据一致性全靠手跑。

**做法**:GitHub Actions,push/PR 触发四连;Python 侧 pytest 可选(需 uv,标记
allow-failure 或后补)。
**验收**:PR 上可见红绿灯;故意改坏一个断言能让 CI 变红。

---

## P2 — 清理与优化(API 之后不迟)

### 10. prefs 死路径,二选一

偏好 UI 已删,但 App.tsx 仍 import `blockedByPrefs` 并渲染"时间偏好把这些课筛掉了"
卡片——`prefs` 恒为默认值,该分支**永不触发**;`Saved` 里也仍序列化 prefs。要么恢复
偏好 UI,要么删掉 App 侧死分支与存档字段(schedule.ts 的 prefs 参数面保留,排课引擎
支持约束是对的)。别留半吊子。

### 11. `programs.ts`(161 行)无人引用

在建功能(个人信息卡/"本专业需要"筛选)。接入或在文件头标注 in-flight 状态与接入
计划,不要长期挂空。**不要删**——programs 数据管线是它的上游,已经建成。

### 12. `evaluateCandidates` 的组合重算

每次 committed/taken/planIndex 变更都对全部课程重建 `courseCombos`(cartesian ≤240/课)。
prefs 恒定时可用 `WeakMap<Course, Combo[]>` 缓存。**先测量再做**(dev 下加
`console.time`),避免臆想优化。

### 13. localStorage 版本策略

结构变化时 `loadSaved` 静默丢弃,可接受;但建议随 #8 的 dataVersion 一起做失效提示。

### 14. 杂项

- `audit_data.mts` 内联的 Bundle 类型改为 import `types.ts`(随 #5 自然解决)。
- `docs/schema.md` 在 #4 落地后补"预解析 requirement 已入 wire 格式"一节。

---

## 建议执行顺序

```
P0-2, P0-3(小,先清掉)
  → P1-6(仓库策略,需用户拍板 raw 的去留)
  → P0-1(分主题提交,落库)
  → P1-5 + P1-4 + P2-14(TS 统一构建 + 预解析,一个工程)
  → P1-7(programs 去重)
  → P1-9(CI)
  → P1-8(API 设计文档)
  → P2 按需
```

每步的硬性回归门槛不变:`check_requirements.mts` 全绿零误报、`audit_data.mts` 硬性
不变量全过、`tsc -b` 与 `vite build` 通过。
