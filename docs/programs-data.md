# 专业（Program）数据接口

给前端：**用户选专业 + 入学年份**、以及**「本专业需要」搜索过滤**所需的数据和读取接口都在这里。
UI 和搜索逻辑你自己写；我提供 **数据文件 + 一个 TS 读取模块 + 本文档**，不碰你的 UI/搜索代码。

---

## TL;DR — 你要用的两样东西

| 你要什么 | 用什么 |
| --- | --- |
| 专业下拉/type-ahead 的候选列表 | `searchPrograms(programs, query, { year })` |
| 某专业「需要哪些课」的 course key 集合 | `programCourseKeys(program)` / `requiredCourseKeys(program)` |

```ts
import {
  loadPrograms, searchPrograms, getProgram,
  programCourseKeys, requiredCourseKeys, allCourseKeys,
  listYears, type Program,
} from './lib/programs.ts'

const programs = await loadPrograms()                      // 缓存，全程只 fetch 一次
const hits = searchPrograms(programs, 'computer', { year: '2024' })   // type-ahead
const prog = getProgram(programs, '2024:B.Eng. in Computer Engineering')
const need = programCourseKeys(prog!)                       // Set<string> of course keys
// 搜索过滤：need.has(course.key) 就是「本专业需要」
```

`course key` = 8 位 `SUBJ####`（`courseKey.ts` 的规范形式），和 `Course.key` 完全一致，直接 `.has()` 匹配即可。程序里的课号和课程目录跨年匹配（专业是 23–25 入学，课表是 2026-27），只要课还开着就能对上；停开的课自然不出现。

---

## 数据在哪

```
public/data/programs.json          ← 前端 fetch 的文件（UG，2023/2024/2025，245 个专业，~600KB / gzip ~88KB）
src/lib/programs.ts                ← 读取 + 查询接口（本文档描述的就是它）
```

生成链路（都在 `scripts/`，一般不用你跑）：

```
tt_dsp_acad_prog.aspx (CUHK)
  → scrape_programs.py        data/programs/<year>/<Faculty>/<slug>.{json, html.gz}   原始（含完整源页 .html.gz）
  → parse_programs.py         data/programs_parsed/…/*.json + all_programs.json        解析成 bucket
  → build_program_bundle.py   public/data/programs.json                                前端包
```

重新生成前端包：`npm run data:programs`（只做最后一步，读已解析结果）。

---

## `programs.json` 结构

```jsonc
{
  "years": ["2023", "2024", "2025"],
  "program_count": 245,
  "programs": [
    {
      "id": "2024:B.Eng. in Computer Engineering",   // 稳定 id = `${year}:${name_en}`
      "year": "2024",
      "name_en": "B.Eng. in Computer Engineering",
      "name_chi": "計算機工程學工程學士",
      "faculty": "Faculty of Engineering",            // 主 faculty（跨列时取内容最全的一条）
      "faculties": ["Faculty of Engineering"],        // 它被挂在的所有 faculty
      "degree": "B.Eng",
      "total_units": 75,                              // 可能为 null
      "parse_status": "full",                         // full | prose_only | partial | empty
      "required": ["ENGG1110", "ESTR1002", ...],      // 必修（Faculty Package + Required + Foundation 选一）
      "elective": [...],                              // 一般 major elective（不属于某 stream 的）
      "streams": [                                    // 分流/选项的选修池
        { "name": "Stream 1: Embedded Systems", "courses": ["BMEG3111", ...] }
      ],
      "all": ["ACCT2111", ...],                       // 完整 inventory：study scheme 里出现过的所有课号
      "structure": [ /* SectionNode[]，见下节「structure 树」 */ ]
    }
  ]
}
```

**课号约定**：都是纯 8 位 `SUBJ####`。`CENG3430/ESTR3100` 这种「等价课」会**两个都列进去**（修任一门都算命中）。`required`/`elective`/各 `stream.courses` 之间可能有重叠；`all` 是全集但不区分必修/选修。

---

## `structure` 树（培养方案的忠实层级重建）

`structure` 是 Major Programme Requirement 的**忠实层级重建**：镜像日历里编号 / 字母 / 散文各层，让信息页大课表（`ProgramTable`）能按印刷版原样递归渲染。扁平的 `required`/`elective`/`streams` 仍保留供搜索过滤；`structure` 是新的树。

### Schema

```ts
type SectionNode = {
  marker: string              // 列表标记："1." | "(a)" | "(i)" | ""（散文拆出的伪子块）
  title: string               // 分区标题，如 "Faculty Package" / "Stream 2: …"；纯课组为 ""
  units: number | null        // 本区要求学分；未标注为 null（区间取下限，如 "15-18" → 15）
  note: string | null         // 散文规则，如 "Choose any one course from the following"；无则 null
  courses: ProgramCourse[]    // 直接挂在本节点的课程
  children: SectionNode[]     // 嵌套子节点
  kind?: 'concentration' | 'stream'   // 仅特殊可选段的顶层节点带；其余节点不带（见下）
}

type ProgramCourse = {
  code: string                // 8 位主 key（SUBJ####），与 Course.key 一致，直接 .has() 匹配
  alts: string[]              // 等价 key（如 ESTR 孪生课：["ESTR2102"]），命中任一即算修过
}
```

### 顶层节点构成

1. **Major Programme Requirement 的编号项**（`1.` / `2.` / `3.` / …）—— 主修块的强制要求，`kind` 不带。
2. **可选的 Concentration Area / Streams 段**（带 `kind`）—— 日历在主修块**总学分（Total）之后**印的可选段，被单独解析成一个顶层节点，`children` 是各方向。

### `kind` 语义（关键区分）

| 值 | 来源 | 含义 |
| --- | --- | --- |
| 不带（`undefined`） | 主修块内的编号/字母/散文节点 | 强制要求。**包括** `"Choose any ONE from the following N options"` 这类**内联 N 选一分流**：它作为主修块内的一个顶层编号节点，`children` 是各方向（`General` + `Stream 1..N`），**这些内联 stream 一律不带 `kind`**（它是强制 N 选一，属主修块）。 |
| `'concentration'` | `Concentration Area:` 段 | 可选的**专业方向**（学生可选 0–2 个）。顶层节点 `title:"专业方向 · Concentration Area"`，`children` 为各方向。 |
| `'stream'` | Total 之后的 `Streams:` 段 | 可选的**选修方向 / 分流**（学生可自愿声明）。顶层节点 `title:"选修方向 · Streams"`，`children` 为各 stream。 |

> ⚠️ 别把内联 `Choose any ONE` 的 stream 和 `kind:'stream'` 混淆：前者是**主修块内的强制 N 选一**（无 `kind`），后者是 **Total 之后的可选段**（有 `kind`）。前端凭 `kind` 是否存在来决定是否打「可选/选修方向」徽章。

### 兜底节点约定（零丢失保证）

任何在 Major 块文本里出现、但没能被结构化归位到上述分区的课程，都会被扫进**一个 catch-all 节点**：

```jsonc
{ "marker": "", "title": "其他相关课程",
  "note": "本方案文本中列出、未归入上述分区的课程",
  "courses": [ /* 未归位的课 */ ], "children": [] }
```

它保证信息页课表**绝不静默丢课**（`missing_codes` 恒为 0）。前端遇到它照常渲染即可（它就是一个普通 `SectionNode`，`title` 固定为 `"其他相关课程"`）。

### `prose_only` 方案

叙述式培养方案（`parse_status:"prose_only"`，如 M.B.,Ch.B.）没有可解析的层级，`structure` 为 `[]`。前端此时回退用 `program.all`（整个课号 inventory）渲染，不要指望 `structure`。

### 真实例子（摘要）

- **B.Sc. in Computer Science（内联 7 选一，无 kind）**：顶层 `4. Choose any ONE from the following seven options`，`children` = `(a) General Computer Science` / `(b) Stream 1: Intelligence Science` / … `(g) Stream 6: Data Analytics`，共 7 个，**均不带 `kind`**（强制 N 选一）。
- **B.S.Sc. in Economics（Concentration Area，kind='concentration'）**：主修编号项之后多一个 `kind:'concentration'` 顶层节点，`children` = `Economic Theory` / `Financial Economics` / `Business Economics` / `Chinese Economy` / `Data Analytics`，各方向下再挂 `(a)/(b)` 必修/选修子树。
- **B.Sc. in Physics（Streams，kind='stream'）**：主修 Total 之后一个 `kind:'stream'` 顶层节点 `选修方向 · Streams`，`children` = `Enrichment Stream in Theoretical Physics` / `Astrophysics and Particle Physics Stream` / `Computational and Data Physics Stream` / `Quantum Science and Technology Stream`，各 stream 下挂 `(a) Required courses` / `(b) Elective courses`。

---

## TS 接口（`src/lib/programs.ts`）

### 加载
```ts
loadPrograms(): Promise<Program[]>      // 全程缓存一次；失败会清缓存以便重试
```

### 查询
```ts
listYears(programs): string[]                                   // ["2023","2024","2025"]
getProgram(programs, id): Program | undefined                  // 按 id 精确取
searchPrograms(programs, query, { year?, limit? }): Program[]  // type-ahead，中英文名都打分
```
`searchPrograms` 打分规则：整名/前缀命中 > 词首命中 > 子串命中；中文名子串也算。`query` 为空时返回该年份前 `limit`（默认 8）个，适合下拉初始态。**选专业前建议先让用户选 year，再把 `year` 传进来收窄候选。**

### 课号集合（给「本专业需要」过滤）
```ts
programCourseKeys(program, { electives?, streams? }): Set<string>  // 默认 必修+选修+分流
requiredCourseKeys(program): Set<string>                          // 只要必修
allCourseKeys(program): Set<string>                               // 整个 inventory
```
返回的都是规范化 course key（`keySet` 处理过），直接和 `Course.key` 比。

---

## 典型用法

**① 专业 type-ahead 选择器**（仿 `CodeInput` 的交互）
```ts
const programs = await loadPrograms()
// 输入框 onChange:
const suggestions = searchPrograms(programs, draft, { year: admissionYear, limit: 7 })
// 选中后存 program.id；用 getProgram 还原
```

**② 「本专业需要」搜索过滤**
```ts
const selected = getProgram(programs, savedId)
const need = selected ? programCourseKeys(selected) : null
// 在你的搜索过滤里加一条：
rows.filter(row => !programOnly || (need?.has(row.course.key) ?? true))
```

---

## 坑 / 边界

- **`parse_status`**：`full`（227）可信；`prose_only`（18，如 M.B.,Ch.B.、Gerontology 等叙述式培养方案）**只有 `all` inventory 可靠，`required`/`elective` 可能为空**。做过滤时用 `all` 兜底，或对 `prose_only` 降级处理。
- **`total_units` 可能为 null**（同上叙述式专业）。
- **跨列重复已去重**：同一 (year, name_en) 只留内容最全的一条，被挂的所有 faculty 记在 `faculties[]`。
- **只有 UG、2023–2025、全日制**。研究生/兼读/2026 没抓（2026 入学培养方案当时基本没公布）。
- **没有 Recommended Course Pattern**（按年级/学期的修读计划）——当前一轮没解析。要做「按入学年份预测已修课」得先补这部分；原始 `.html.gz` 里有，随时可再解析。
- 数据抓取时间见 `data/programs/index.json`；培养方案会逐年更新，重跑 `scripts/scrape_programs.py` 刷新。
