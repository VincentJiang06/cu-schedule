# 数据契约与前端接入指南

**这是前端开发的唯一入口文档。** 读完本文即可开始改前端;需要更深的背景时,按下面的
阅读地图跳转,不要凭记忆假设契约。

## 0. 阅读地图

| 你要做的事 | 读什么 |
| --- | --- |
| 调数据、改页面、加功能 | **本文**(契约 + 运行时接口面 + 改动规则) |
| 理解 Course 字段/课号 key/先修三值逻辑的"为什么" | [schema.md](schema.md) |
| 培养方案(专业)数据的字段细节 | [programs-data.md](programs-data.md) |
| 数据目录/流水线/如何重建数据 | [../data/README.md](../data/README.md) |
| 这套结构是怎么定下来的 | [architecture-review.md](architecture-review.md)(背景,非必读) |
| 部署到服务器(Docker) | [deployment.md](deployment.md) |

**类型的唯一权威是代码,不是文档**:课程侧 `src/lib/types.ts`,方案侧 `src/lib/programs.ts`。
文档若与类型定义冲突,以类型为准并修文档。

---

## 1. 并发模型:静态实例,服务端零计算

本应用没有传统后端。"接口"是一组**不可变静态 JSON**;排课、冲突检测、可选课筛选、
先修判断全部在**每个用户自己的浏览器**里执行。

| 性质 | 说明 |
| --- | --- |
| 无共享可变状态 | 用户之间零交互;用户状态只在各自 localStorage |
| 读路径全静态 | 所有人下载同一份文件,CDN/静态托管天然横向扩展 |
| 服务端零计算 | 不存在"算力被打爆";数据更新是维护者手动构建+推送 |

**容量**(实测 gzip):首屏 Term1 246KB + Term2 246KB + subjects 3KB + manifest/index <1KB
≈ **496KB**;接入 programs.json 后 +223KB ≈ **719KB**(2026-07-15 实测:programs.json
原始 1.8MB、gzip 223KB——`structure` 树入包后比早期估算的 90KB 大一倍多)。1 万次完整
加载 ≈ 7.2GB 流量——Cloudflare Pages 免费不限量。二次访问命中缓存,接近零流量。

**铁律:目录数据永远走静态文件,永远不要为它建动态 API;计算永远留在客户端。**

---

## 2. 数据契约(只读"端点")

所有文件位于 `<BASE>/data/` 下,由 `npm run data:build`(`scripts/build_bundles.mts`)
从 `data/` 真源生成并镜像到 `public/data/`。

| 文件 | 形状(权威类型) | gzip | 缓存 |
| --- | --- | --- | --- |
| `manifest.json` | `DataManifest = { years, generatedAt }` | <0.1KB | **no-cache**(每次再验证) |
| `<年>/index.json` | `YearIndex`(term 清单+课数) | 0.2KB | `?v=` 不可变 |
| `<年>/<term>.json` | `TermBundle`(整学期课程,短键,**含预解析 `req`**) | 246KB | `?v=` 不可变 |
| `<年>/subjects.json` | `{ subjects: {code,title}[] }` | 3KB | `?v=` 不可变 |
| `programs.json` | `ProgramBundle`(见 programs.ts) | 223KB | `?v=` 已接(nginx 端 no-cache 特例待并回 immutable,见 §5) |

### 版本与缓存协议(已实现)

数据由维护者手动更新,更新后必须让所有用户尽快拿到新数据:

1. `manifest.json` 的 `generatedAt`(构建时刻 ISO UTC)= 整套数据的 **dataVersion**。
2. 前端仅对 manifest 用 `fetch(..., { cache: 'no-cache' })`(几十字节,模块级 memoize,
   见 `data.ts` 的 `fetchManifest`)。
3. 其余所有数据请求 URL 追加 `?v=<generatedAt>`:版本变则 URL 变,旧缓存自动失效;
   不变则长期命中缓存。

**前端改动规则**:任何新增的数据请求都必须走 `data.ts` 的 `fetchJson(path, version)`
通道(或复刻同样的 `?v=` 逻辑),不要裸 `fetch` 数据文件。

---

## 3. 前端运行时接口面

页面代码不应直接碰 wire 格式(短键),一律经过下列模块:

### 数据加载 — `src/lib/data.ts`
```ts
loadTermList(): Promise<TermRef[]>                 // manifest+index → 学期清单
loadYearOfferings(year): Promise<Offering[]>       // 整学年(两主学期)全量课程
loadTerm(term): Promise<Course[]>                  // 单学期(当前未被 App 使用)
loadSubjects(year): Promise<SubjectInfo[]>         // 学科码 → 学科名
```
`Offering = { course, termSlug, termName, termOrder(1=上|2=下) }`。同一门课两学期都开
则出现两次。`toCourse` 零解析(先修 AST 来自 wire 的 `req`),6089 门全量物化 <5ms。

### 课程模型 — `src/lib/types.ts` / `src/lib/courseKey.ts`
`Course` 字段见 [schema.md](schema.md)。**所有课号比较必须用 `course.key` 或
`courseKey(code)`**(8 字符宽松匹配,`ENGG1000A` ≡ `ENGG1000`),严禁 `===` 比原始字符串。

### 排课 — `src/lib/schedule.ts`
```ts
generatePlans(courses, prefs, pins?): Plan[]   // 无冲突课表,按上课天数升序,≤12 个
findClashes(courses, prefs, pins?): Clash[]    // 排不出时,给出互撞的课对
courseCombos(course, prefs, pin?): Combo[]     // 单课的可行 section 组合(cohort 配对已内建)
type Pins = Record<courseCode, Record<component, sectionId>>   // 钉选某课某组件的 section
```
`prefs` 的 UI 已移除但参数面保留,传 `NO_PREFS` 即可。

### 可选课筛选 — `src/lib/candidates.ts`
```ts
evaluateCandidates({ courses, taken, committed, plans, selectedPlanIndex, prefs })
  → { rows: Candidate[], summary }
Candidate = { course, status: 'open'|'rearrange'|'conflict'|'tba',
              slots, instructors,
              prereqStatus: 'none'|'met'|'missing'|'unverifiable', prereqText }
```
语义:`missing` = **可证明**先修不满足(红标「缺先修」);`unverifiable` = 有成绩/同意等
无法核验条件(灰标「看先修」,悬停展示 `prereqText`)。**绝不把 `unverifiable` 渲染成
拦截性提示**——引擎的铁律是宁可漏报不误报,UI 不得推翻这条语义(详见 schema.md)。

### 培养方案 — `src/lib/programs.ts`(已接入信息页大课表 `ProgramTable`)
```ts
loadPrograms(): Promise<Program[]>             // programs.json,模块级缓存
searchPrograms(programs, query, year?)         // 中英文名 type-ahead
requiredCourseKeys(p) / programCourseKeys(p, scope) / allCourseKeys(p): Set<string>
```
上面几个返回的都是与 `Course.key` 同构的 8 字符 key,可直接 `set.has(course.key)` 做
"本专业需要"筛选。接入点:个人信息卡 + 搜索过滤,以及信息页大课表。

**`Program.structure`(`SectionNode[]`)** 是培养方案的忠实层级树,字段级 schema 见
[programs-data.md 的「structure 树」](programs-data.md)(以 `programs.ts` 的
`SectionNode` / `ProgramCourse` 类型为权威)。前端(`ProgramTable`)的渲染约定:

1. **递归渲染** `SectionNode` 树:`marker` + `title` 作标题行,`units`/`note` 作辅助行,
   `courses` 渲染成课程卡,`children` 递归下一层。
2. **按 `kind` 打徽章**:`kind==='concentration'` → 「可选方向」,`kind==='stream'` →
   「选修方向」,二者共用可选段底纹(`.pg-section--concentration`,stream 另加
   `.pg-section--stream` 细分描边);`kind` 不存在的节点(含内联 `Choose any ONE` 的强制
   N 选一 stream)**不打徽章**,照普通分区渲染。
3. **叶子 `courses` 用 courseKey 匹配 taken**:每门课的 `code`(及 `alts`)已是 8 字符 key,
   命中任一即视为已修。现行实现(`ProgramTable.courseDone`)对 `code`/`alts` 再过一次
   `courseKey()` 属**防御性规范化**(对已规范的 key 幂等,无害)——保持这个写法即可,
   不要"优化"掉,也不要在别处依赖"结构里的 code 一定已规范"这个假设。
4. **兜底节点照常渲染**:`title==="其他相关课程"` 的 catch-all 就是一个普通 `SectionNode`
   (它保证零丢课),无需特殊分支,递归到它时按常规分区画即可。
5. **`structure` 为 `[]`**(prose_only 方案)时回退用 `program.all` 渲染整份课号 inventory。

### 学分进度 — `src/lib/programProgress.ts`
```ts
computeProgramProgress(program, takenKeys, unitsFor)   // 已修课按方案顶层节归类统计
```
纯逻辑,消费 `Program.structure` 树:按 `courseKey` 匹配(含 alts 孪生),节子树内
去重;课程学分唯一来源是课程目录(`unitsFor` 回调),目录查不到(今年未开)按 3 学分
估算(`estimated` 字段透出);`reconciled` 判据——各节推导学分自洽(全非空且加总
== total_units)才按节显示上限,否则只认显式 `units` 节、以整方案累计为准。消费方:
信息页 + 选课页右栏的 `ProgramProgress` 组件。

### 三语 — `src/i18n/index.ts`
```ts
t(src, vars?)          // gettext 式:简体源文本即 key;zht/en 查词典,查不到回落简体
setLang / getLang      // 模块级语言态;App 顶层 setLang + state 重渲染切全树
```
词典(`ui-zh/zht/en.json`,~370 条)随包静态载入,零运行时请求(§1 铁律的延伸)。
新增用户可见中文必须包 `t()`;生成链 `node scripts/i18n-extract.mjs` →
`node scripts/i18n-gen.mjs`(繁=OpenCC s2hk,英=DeepSeek)。**`.md` 配置
(configMd)的节标题是解析协议 key,恒简体不得 localize**(写出侧本地化会破坏回导入)。

### 已修/要上判定 — `src/lib/requirements.ts`
前端一般只消费 `Candidate.prereqStatus`;若需自行求值,用
`evaluateRequirement(course.requirement, takenSet, committedSet)`,**不要**调
`parseRequirement`(解析已在构建期完成,运行时重复解析=性能回退+潜在分叉)。

---

## 4. 前端改动的硬性规则

1. **四门槛必须保持全绿**(CI 强制):`tsc -b`、`vite build`、`npm run data:check`
   (先修零误报)、`npm run data:audit`(数据审计)。方案线另有**手动第五门**
   `npm run data:audit-programs`(`scripts/audit_programs.mts`,不在 CI):凡动
   `parse_programs.py` 或刷新 programs 数据必跑,P1–P6 全绿才算过。
2. 课号比较一律走 `key`;新增输入解析用 `search.ts` 的 `parseCourseCodes`(支持后缀)。
3. 不修改 `requirements.ts` 的解析/求值语义、`courseKey.ts` 的 key 规则——它们有
   全目录机器验证背书;想改先改测试再改码。
4. 不直接读 wire 短键(`c/sj/rq/x/...`),经 `data.ts` 物化后的 `Course` 编程。
5. 新数据请求必须带版本参数(§2)。
6. localStorage 目前存 `{ termSlug, committed, taken, cart?, pins? }`(key
   `cu-schedule:v1`;`cart`=可能学、`pins`=section 钉选);注意语义:`taken` 是
   **跨学期全局**的,`committed` 逻辑上是 **per-term** 的(现为单份,将来 API 化要拆,
   见 §6)。这五个字段同时参与 §6 的云同步契约(`ConfigMdState`/`CloudConfig`),
   加字段走 §6 的四处联动规则。

## 5. 已知欠账(接手时留意)

- ~~`programs.ts` 的 fetch 未走 `?v=`~~ **前端已修**(`loadPrograms` 走 `dataVersion()`
  拼 `?v=`);残留:`deploy/nginx.conf` 仍把 `/data/programs.json` 单独 no-cache
  (无害,只是少了长缓存)——下次动 nginx 时把该 carve-out 并回 immutable 段,并同步
  deployment.md §4。
- 启动时 `index.json` 被 `loadTermList` 与 `loadYearOfferings` 各请求一次(多一次
  304,无害);可在下次改 data.ts 时合并。
- `programs.json` 字段为 snake_case,课程包为短键——已被类型覆盖,统一留待下次
  wire 变更。

## 6. 用户账号 / 多设备同步(前端调用面)

原则不变:目录仍走静态,只为用户状态建微型 API;服务端零计算。

账号的**服务端由部署方的私有扩展承担**(`/api/v1/*`,独立进程,不随本仓库分发——
见 `deploy/nginx.conf` 的 `/api/v1/` 反代与 `deploy/entrypoint.sh` 的条件启动)。
本仓库只包含**前端调用面**(`src/lib/cloud.ts`):克隆本仓库自部署时若无该服务,
账号按钮会提示连不上服务器,其余功能不受影响。

**前端侧契约**(以 `cloud.ts` 为权威):

- 云端配置形状 = `ConfigMdState`(与 `.md` 备份**同一套**可携带状态,共用
  `configMd.ts` 的 `sanitizeConfigState` 校验,两条携带通道一个 schema 裁决处)+
  `enrollYear` + `programId` + `planSigs {solo,a,b}`。排法用 `plan.id`(排序 section id
  连接)做签名持久化——数据更新后序号会漂,签名按内容回配,失配静默放弃。
- **同步策略**(App.tsx):登录期间一切可携带状态编辑 → 1.5s 防抖自动 PUT(与 `#st=`
  replaceState 同手感);带凭据启动 → 以云端为准(boot pull;URL 带 `#st=` 时例外,
  链接状态优先);登录时云端已有存档且本地非空 → 界面内联二选一(载入云端 / 本地覆盖)。
  未登录/离线一切照旧走 localStorage。冲突模型 = last-write-wins,不做合并。
- **改动规则**:云端配置加字段 = 同时改 `ConfigMdState`(configMd.ts)+
  `sanitizeCloudConfig`(cloud.ts)+ `buildCloudConfig`/`applyCloudConfig`(App.tsx)
  四处,漏一处就是静默丢字段;服务端对 config 内容零感知(整包存取)。

## 7. 合规

以网络服务提供本应用受 **AGPL-3.0 §13** 约束:界面必须保留完整源码入口(页脚的
GitHub 链接,勿删)。
