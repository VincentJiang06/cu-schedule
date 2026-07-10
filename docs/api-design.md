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
≈ **496KB**;接入 programs.json 后 +90KB ≈ **586KB**。1 万次完整加载 ≈ 5.9GB 流量——
Cloudflare Pages 免费不限量;GitHub Pages(100GB/月)约支撑 17 万次/月。二次访问命中
缓存,接近零流量。

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
| `programs.json` | `ProgramBundle`(见 programs.ts) | 90KB | ⚠️ 尚未接 `?v=`(见 §5) |

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

### 培养方案 — `src/lib/programs.ts`(in-flight,数据已就绪)
```ts
loadPrograms(): Promise<Program[]>             // programs.json,模块级缓存
searchPrograms(programs, query, year?)         // 中英文名 type-ahead
requiredCourseKeys(p) / programCourseKeys(p, scope) / allCourseKeys(p): Set<string>
```
返回的都是与 `Course.key` 同构的 8 字符 key,可直接 `set.has(course.key)` 做
"本专业需要"筛选。预期接入点:个人信息卡 + 搜索过滤。

### 已修/要上判定 — `src/lib/requirements.ts`
前端一般只消费 `Candidate.prereqStatus`;若需自行求值,用
`evaluateRequirement(course.requirement, takenSet, committedSet)`,**不要**调
`parseRequirement`(解析已在构建期完成,运行时重复解析=性能回退+潜在分叉)。

---

## 4. 前端改动的硬性规则

1. **四门槛必须保持全绿**(CI 强制):`tsc -b`、`vite build`、`npm run data:check`
   (先修零误报)、`npm run data:audit`(数据审计)。
2. 课号比较一律走 `key`;新增输入解析用 `search.ts` 的 `parseCourseCodes`(支持后缀)。
3. 不修改 `requirements.ts` 的解析/求值语义、`courseKey.ts` 的 key 规则——它们有
   全目录机器验证背书;想改先改测试再改码。
4. 不直接读 wire 短键(`c/sj/rq/x/...`),经 `data.ts` 物化后的 `Course` 编程。
5. 新数据请求必须带版本参数(§2)。
6. localStorage 目前存 `{ termSlug, committed, taken }`(key `cu-schedule:v1`);
   注意语义:`taken` 是**跨学期全局**的,`committed` 逻辑上是 **per-term** 的(现为
   单份,将来 API 化要拆,见 §6)。

## 5. 已知欠账(接手时留意)

- `programs.ts` 的 fetch 未走 `?v=` 版本参数——接入个人信息卡时顺手补上(§2 规则)。
- 启动时 `index.json` 被 `loadTermList` 与 `loadYearOfferings` 各请求一次(多一次
  304,无害);可在下次改 data.ts 时合并。
- `programs.json` 字段为 snake_case,课程包为短键——已被类型覆盖,统一留待下次
  wire 变更。

## 6. 将来若要"用户账号/多设备同步"(当前不做)

原则不变:目录仍走静态,只为用户状态建微型 API。
状态模型(把 localStorage 的混存拆开):
```json
{ "taken": ["CSCI1130"],
  "selections": { "2026-27-term-1": { "committed": ["MATH2050"] } },
  "updatedAt": "…" }
```
接口只需 `GET /api/v1/me` + `PUT /api/v1/me`(`If-Match` ETag,409 冲突客户端合并
重试)。每用户 <2KB、互相独立,服务端仍零计算。未登录/离线继续用 localStorage,
登录时一次性合并。

## 7. 合规

以网络服务提供本应用受 **AGPL-3.0 §13** 约束:界面必须保留完整源码入口(页脚的
GitHub 链接,勿删)。
