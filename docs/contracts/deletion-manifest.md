# Deletion manifest — ✅ 已执行(2026-08-10,用户批准「老的删了」)

> 保留本文作为**存档**:记录删了什么、为什么删、入链改指到哪里。
> 被删文件的内容在 git 历史里,`git show HEAD~1:docs/api-design.md` 之类随时可取回。

用户裁决(本轮开工前确认):**`docs/` 整体替换**;`fable_docs/`(哲学与方向,只存部署机)
**完全不动**——它管的是「为什么 / 往哪去」,本次重建管的是「现在是什么」,两者不冲突。

## 建议删除

| 文件 | 行数 | 理由 |
|---|---|---|
| `docs/api-design.md` | 215 | 它自称「前端开发的唯一入口」,但同时承担架构说明、数据契约、运行时接口面、改动规则四件事。接口面部分已被 `interfaces.md` 逐符号取代**且现在有机器门守着**(旧文档是纯人肉同步,本会话已两次撞见它与代码漂移);架构与边界部分进 `architecture.md`;改动规则进 `structure.md` 末尾的两条硬路径。 |
| `docs/schema.md` | 144 | 描述 `Course`/`Requirement` 字段与 wire 格式。这些是**类型**,权威在 `src/lib/types.ts`,文档里的副本只会腐坏;`interfaces.md` 现在逐条指着类型定义行。其中真正不可从类型读出的部分(三值逻辑「宁漏勿误」的理由、宽松 key 的前向兼容意图)已进 `architecture.md` §边界与信任线。 |
| `docs/programs-data.md` | 248 | 培养方案数据接口。`structure` 树 schema 与 `rule`/`unplaced` 口径已进 `interfaces.md`(`SectionNode` 行)与 `programProgress` 相关行;方案侧的机器门口径归 `fable_docs/06`。**注意**:本文件在本会话刚更新过两次,删之前确认新契约没漏掉 `kind` 语义与兜底节点约定——这两条我已写进 `structure.md`/`architecture.md`,但值得你复核一眼。 |
| `docs/architecture-review.md` | 217 | 2026-07 的一次性架构审查快照,**开头即写「已结案」**,却仍挂在旧阅读地图里。它列的 P0/P1 待办(加载期解析、双语言分治、双份真源、programs.ts 无人引用……)全部已完成——新会话读到它极易把已结案的问题当现状。历史价值可由 git 保存。 |
| `docs/deployment.md` | 78 | 部署 runbook。缓存三档的**理由**与健康探活的 `127.0.0.1` 坑已进 `architecture.md` §部署边界;逐条 curl 验证清单属于操作流程而非设计契约,若要保留,更合适的归宿是 `fable_docs`(它本来就管 runbook)。 |

合计 902 行 → 三份新契约。

## 不动

| 路径 | 为什么留着 |
|---|---|
| `fable_docs/**` | 用户明确保留。它是产品哲学/方向/方法论,不是契约层,本技能不该碰。 |
| `data/README.md` | 数据目录的就地说明,属于数据资产而非设计契约。 |
| `README.md` · `NOTICE.md` | 项目门面与许可,与契约层无关。 |
| `docs/contracts/_legacy-context.md` | 已 gitignore。是本次重建的临时上下文,**重建完就该删**——它按设计不入库,留在工作区只会让人误以为它是现行文档。建议连同上面五份一起清掉。 |

## 已执行的命令

```bash
cd ~/cu-schedule && git rm docs/api-design.md docs/schema.md docs/programs-data.md docs/architecture-review.md docs/deployment.md && rm -f docs/contracts/_legacy-context.md
```

**同时改掉的入链**(全仓库扫过;除下表外还有两处代码注释:`src/lib/programs.ts:11`
指向 programs-data、`src/lib/data.ts:106` 提到 api-design §5,均已改):

| 位置 | 现在指向 | 应改指 |
|---|---|---|
| `README.md:86` | `docs/deployment.md 是 runbook` | `docs/contracts/architecture.md` §部署边界 |
| `README.md:94` | `docs/api-design.md`「前端唯一入口」 | `docs/contracts/interfaces.md` + `structure.md` |
| `README.md:95` | `docs/schema.md` | `docs/contracts/interfaces.md`(`src/lib/types.ts` 段) |
| `README.md:96` | `docs/programs-data.md` | `docs/contracts/interfaces.md`(`programs.ts` 段) |
| `README.md:98` | `docs/deployment.md` | `docs/contracts/architecture.md` §部署边界 |
| `README.md:99` | `docs/architecture-review.md`(已结案审查) | 整行删掉——历史留给 git |
| `README.md:114` | `docs/api-design.md §6`(账号私有服务) | `docs/contracts/architecture.md` §边界与信任线 |
| `README.md:116` | 「前端开发从 api-design 入手」 | 「前端开发从 `docs/contracts/` 三件套入手」 |
| `data/README.md:56` | `docs/schema.md` | `docs/contracts/interfaces.md` |
| `data/README.md:71` | `docs/schema.md` | `docs/contracts/interfaces.md` |

(被删的五份文档彼此之间的互链不用管,它们一起走。)

另外确认:

1. `node ~/.claude/skills/reorganize-logic/scripts/verify_contracts.mjs ~/cu-schedule` 仍 PASS。
2. `fable_docs/README.md` 的阅读地图里若有指向 `docs/` 的行,改指 `docs/contracts/`。
