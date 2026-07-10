# 课程数据 Schema

本项目对"课程"有一套明确定义的字段。这份文档说明每个字段的含义、课号 key 的判定规则、以及选课要求(先修/互斥/并修)是如何从自由文本解析成结构化数据的。

数据流三层:

```text
CUHK 公开课程目录
    ↓  scripts/scrape_all_subjects.py            （抓取，来自 EagleZhen）
data/raw/courses/<year>/<SUBJ>.json               原始富文本，按学科分文件
    ↓  scripts/build_bundles.mts  (tsx)           （压缩成按学期的精简包 + 预解析 req）
data/courses/<year>/<term>.json                   紧凑 wire 格式，短键名，镜像进 public/data
    ↓  src/lib/data.ts  (toCourse)                （运行时反序列化成 Course，不再解析）
Course                                            应用编程针对的模型
```

`src/lib/types.ts` 是 schema 的**唯一真源**。wire 格式的写、读两端现在都是 TS：
`scripts/build_bundles.mts` 写、`src/lib/data.ts` 读，同一份 `RawCourse` 类型定义两端共用，
不再是 Python 写 / TS 读的两语言分治。

---

## Course

```ts
Course {
  // 身份 —— 由 src/lib/courseKey.ts 从课号解析
  code: string       // 完整课号，含变体后缀： "CSCI2100" / "ENGG1000A"
  key: string        // 规范身份，前 8 字符： "CSCI2100" —— 所有匹配都用它
  subject: string    // 四个学科字母： "CSCI"
  number: string     // 四位目录号： "2100"
  suffix: string     // 变体后缀，通常为空： "A"
  level: number      // number 的首位数字，即课程级别 1–9

  // 描述
  title: string
  units: number
  career: string     // "Undergraduate" / "Postgraduate - Taught" / "Postgraduate - Research"
  department: string // 开课院系（academic group）

  // 结构化的选课要求 —— 见下
  requirement: Requirement

  // 排课
  sections: Section[]
  components: string[]   // 该课出现过的 component，稳定顺序

  searchText: string     // 预拼接的小写检索串
}
```

### 课号 key 的判定（宽松匹配）

一个 CUHK 课号是「四个学科字母 + 四位数字」= 8 个字符，这 8 个字符就是**规范身份 `key`**。

CUHK 偶尔会把一门课发布成共享号码、但带尾字母的变体（`ENGG1000A` vs `ENGG1000B`）——它们是不同的开课，但先修、成绩单、搜索里写 `ENGG1000` 时指的是它们全体。所以匹配**故意放宽**：一律比对 8 字符 key，后缀仅用于显示与两边都带后缀时的精确消歧。

```ts
courseKey("ENGG1000A") === "ENGG1000"        // 前 8 字符
codesMatch("ENGG1000", "ENGG1000A") === true // 同 key 即同课
```

> 当前 2026-27 数据里没有任何带后缀的课号，5196 门全是 8 字符。宽松 key 是前向兼容，今天对 8 字符码是恒等操作、零行为变化。

---

## Requirement（结构化选课要求）

`enrollment_requirement` 是自由文本，但全目录遵循一套小语法。运行时把它解析成：

```ts
Requirement {
  raw: string              // 原文，留作展示/审计
  prerequisite: ReqNode|null   // 先修：布尔表达式 AST
  corequisite: ReqNode|null    // 并修：可同期修
  exclusions: string[]         // 互斥课的 key 列表；修过其一即不可选
  prereqText: string           // 清洗后的先修文本，供悬停
  coreqText: string
}
```

`ReqNode` 是对课号 key 的布尔表达式：`and` / `or` / 叶子（课号）/ `soft`（豁免·同意·成绩等无法核验项）/ `unknown`。它能表达真实文本里的 `(A or B) and (C or D)`、`[Option 1]…[Option 2]`、斜杠等价 `A/B`、方括号嵌套等。

### 求值：三值逻辑，只在能证明时才报警

对着学生「上过的课」求值，结果是 `met` / `missing` / `unverifiable` / `none`。铁律（因为一个错误的"你不能选这门"是最糟的失败）：

**只有当先修表达式求值为「确定的否」时才报「缺先修」。** 任何无法核验的东西——成绩条件、导师同意、豁免、歧义逗号列表——都塌缩为 `maybe`，当作满足(静默)，绝不报缺。

具体：`and` 有一个 `no` 即 `no`，否则有 `maybe` 即 `maybe`，全 `yes` 才 `yes`；`or` 有一个 `yes` 即 `yes`，否则有 `maybe` 即 `maybe`，全 `no` 才 `no`。成绩条件把"修过"降级为 `maybe`（修过不代表分够）；豁免/同意恒为 `maybe`。

### 三个防误判的保护

- **课号校验**：裸号继承（`CSCI1120 or 1130`）必须落在真实课号 key 上；`taken X in 2008-09` 里的年份不会变成 `MATH2024` 这类幽灵课。
- **互斥只取触发词之后**：`… who have taken X or Y` 只抓 "taken" 之后的课号，前面的说明句(如"本课与 Z 双重编码")不会被误当互斥。
- **性能**：先修解析已经不在客户端发生，见下一节；候选筛选(每次键入跑遍全目录)只做 `evaluateRequirement` 纯求值，不重新解析。

---

## Wire 格式携带预解析 req

`enrollment_requirement`（wire 格式里的 `rq`）曾经在**每次页面加载**时于客户端用 `parseRequirement` 解析一遍——实测 6089 门课耗时 1772ms 主线程阻塞。现在解析移到构建期:

```ts
RawCourse {
  c: string; sj: string; t: string; u: number; cr: string; gr: string
  rq: string          // 原始 enrollment_requirement 文本，留作展示/审计
  x: RawSection[]
  req?: Requirement   // 预解析好的 Requirement AST；rq 为空时省略该字段
}
```

`scripts/build_bundles.mts` 用**与客户端完全相同**的 `src/lib/requirements.ts` 的 `parseRequirement` 在构建期跑一遍,写进每门课的 `req` 字段;`src/lib/data.ts` 的 `toCourse` 现在只做 `raw.req ?? EMPTY_REQUIREMENT`,零解析。已实测:6089 门课的 `toCourse` 全量物化 < 5ms(见下方校验脚本一节的一致性保证）。

`knownKeys`(裸号继承校验用的已知课号集合)在构建期按**该学年全部 term bundle**(Term 1/2、Summer Session、Acad Year 各分支)聚合而成——构建顺序是先收集全年所有课的 key，再逐课解析，保证一门课的先修能引用到只在其他 term 开设的课号。

`scripts/audit_data.mts` 新增一项硬性校验：对每门课，把构建期写进 `req` 的值与**现场用同一个 `knownKeys` 重新跑 `parseRequirement(rq, knownKeys)`** 的结果做深度比较，两者必须逐字段相等——这是"预解析绝不分叉于运行时真实解析"的机器验证，而不仅是口头保证。

## manifest.json 与数据版本

`data/courses/manifest.json`（镜像进 `public/data/manifest.json`）多了一个 `generatedAt` 字段：

```json
{ "years": ["2026-27"], "generatedAt": "2026-07-11T04:20:00Z" }
```

`generatedAt` 是整套数据的版本号（构建时刻的 ISO UTC 时间戳）。客户端只对 `manifest.json` 用
`fetch(..., { cache: 'no-cache' })`（这一个文件几十字节，强制走一次网络再验证），拿到
`generatedAt` 后，其余所有数据请求（`index.json`、`subjects.json`、各 term bundle）的 URL 都会
追加 `?v=<generatedAt>`。版本号一变，URL 就变，旧的浏览器缓存自然失效且不会被复用；版本不变时
新请求会命中浏览器缓存。见 `src/lib/data.ts` 的 `fetchManifest`。

---

## 校验脚本

两个脚本用真实数据把上述保证钉死：

```bash
npx tsx scripts/check_requirements.mts   # 先修解析：手挑案例 + 全目录零误报 sweep
npx tsx scripts/audit_data.mts           # 全量一致性审计：数据包 vs 原始对账 + 逐字段不变量
```

`audit_data.mts` 当前结果:数据包与原始抓取**逐门对得上**(Term 1 `2973=2973`、Term 2 `3116=3116`,零丢失零多出),所有身份字段自洽,section/meeting 星期与时间全部合法。`check_requirements.mts`:全部断言通过,**964 门有先修的课零误报**。
