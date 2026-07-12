/**
 * audit_programs.mts — 培养方案导出条目机器门(fable_docs/06 §3 规范)
 *
 * 读 data/raw/programs/**(权威 study_scheme)与 data/programs/programs.json(被审),
 * 对每个 parse_status:"full" 的方案跑 P1–P6,输出逐方案明细 + 末尾一行机器可读汇总 JSON。
 *
 * 门(FAIL 非零即不过):P1 独立对照提取(I1 零丢课)、P2 学分-课程合理性(I3)、
 * P5 标题保真(I4)、P6 回归 case 表。WARN 门:P3 文本完整性 lint、P4 总学分对账。
 *
 * 关键纪律(06 §3):P1 的参考提取器与 parse_programs.py 代码独立、刻意简单、宁滥勿缺;
 * 其自身误报走 scripts/audit-whitelist.json,每条带 reason;whitelist 只收「参考提取器误报」,
 * 绝不收「解析器真丢课」。运行:npm run data:audit-programs (tsx scripts/audit_programs.mts)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RAW_DIR = join(ROOT, 'data/raw/programs')
const BUNDLE = join(ROOT, 'data/programs/programs.json')
const COURSES_DIR = join(ROOT, 'data/courses')
const WHITELIST = join(ROOT, 'scripts/audit-whitelist.json')

// --------------------------------------------------------------------------- types
type ProgramCourse = { code: string; alts: string[] }
type SectionNode = {
  marker: string
  title: string
  units: number | null
  note: string | null
  courses: ProgramCourse[]
  children: SectionNode[]
  kind?: string
}
type Program = {
  id: string
  year: string
  name_en: string
  total_units: number | null
  parse_status: string
  structure: SectionNode[]
}

// --------------------------------------------------------------------------- utils
const norm = (t: string): string => t.replace(/\s+/g, ' ').trim()
/** 标题归一化:剥小写脚注 [a] / 星号,去非字母数字,小写折空格 —— 用于标题比对。 */
function titleSlug(t: string | null | undefined): string {
  return (t || '')
    .replace(/\[[a-z]+\]/g, '')
    .replace(/[*]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 原文顶层「N. | 标题[: / ( 内联课单·规则] | 学分」行 → marker("N.") 映射到该行整格印刷文本
 *  的 slug 列表(折行标题向后拼一两行补全、去尾部 "| 学分")。多表方案同号节各表整格都收进。
 *  P5 判定:解析器节标题(slug)须是其中某张表整格 slug 的非空「整词前缀」——标题就是印刷表头的
 *  前导部分(其后可能跟课单/括号规则),前缀命中即保真;对多表/折行/内联规则/含冒号的专名标题
 *  ("1st Major: X"、"Elective Courses (…)")都稳健,同时仍能抓到 title 丢空、张冠李戴(前缀不命中)。 */
function rawHeaderCells(block: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const lines = block.split('\n')
  const isMarkerLine = (s: string) => /^\s*(?:\d+\.|\([a-z]\)|\([ivx]+\)|[ivx]+\))/.test(s)
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(\d+)\.\s*\|?\s*(.*)$/.exec(lines[i])
    if (!m) continue
    // 表头 blob:本行 + 后续续行,直到遇到下一个 marker/空行,或某行以学分列 "| N" 收尾。
    // 多拼无妨——只做「起点整词前缀」判定,右侧多拼不会在起点造出假前缀;下一 marker(含 (a)
    // 子项)即止,故 blob 恰是该节印刷表头区。折行标题("Elective Courses (Choose any ONE\n
    // from the following)")、跨行专名("1st Major: Interdisciplinary Data\nAnalytics")都能补全。
    let blob = m[2]
    for (let j = i + 1; j < lines.length; j++) {
      const nxt = lines[j]
      if (!nxt.trim() || isMarkerLine(nxt)) break
      blob = `${blob} ${nxt.trim()}`
      if (/\|\s*[\d-]+\s*$/.test(nxt)) break // 行尾学分列 → 表头行结束
    }
    const slug = titleSlug(blob.replace(/\|\s*[\d\s-]+/g, ' '))
    if (!slug) continue
    const mk = `${m[1]}.`
    if (!map.has(mk)) map.set(mk, [])
    map.get(mk)!.push(slug)
  }
  return map
}

// --------------------------------------------------------------------------- load raw
/** 递归读所有 raw 方案 json,按 id=`${admission_year}:${program_en}` 建索引;
 *  同 id 多份(跨 faculty)时取 study_scheme 最长的一份(内容最全,与打包去重口径一致)。 */
function loadRaw(): Map<string, string> {
  const byId = new Map<string, string>()
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ent.isFile() && ent.name.endsWith('.json')) {
        let rec: any
        try { rec = JSON.parse(readFileSync(p, 'utf8')) } catch { continue }
        const year = rec.admission_year, name = rec.program_en, ss = rec.study_scheme
        if (!year || !name || typeof ss !== 'string') continue
        const id = `${year}:${name}`
        const prev = byId.get(id)
        if (prev === undefined || ss.length > prev.length) byId.set(id, ss)
      }
    }
  }
  walk(RAW_DIR)
  return byId
}

/** 定位 Major Programme Requirement 块:起点=首个 "Major Programme Requirement",
 *  终点=Recommended Course Pattern / Explanatory Notes / 文本尾 三者最先者。
 *  Total 之后的 Concentration Area: / Streams: 段天然落在此窗口内(在 Explanatory Notes 前)。 */
function majorBlock(ss: string): string {
  const start = ss.search(/Major\s+Programme\s+Requirement/i)
  if (start < 0) return ''
  let end = ss.length
  for (const re of [/Recommended\s+Course\s+Pattern/i, /Explanatory\s+Notes/i]) {
    const m = ss.slice(start).search(re)
    if (m >= 0) end = Math.min(end, start + m)
  }
  return ss.slice(start, end)
}

// --------------------------------------------------------------------------- P1 独立参考提取器
// 与 parse_programs.py 的 extract_courses 代码独立(同一双眼睛查不出自己盲区),
// 刻意简单、宁滥勿缺:先剥脚注,再扫完整课号 / 孪生 / 交叉挂号 / 裸续号。
const CODE = /[A-Z]{4}\d{4}/
const TOKEN =
  /[A-Z]{4}\[[A-Z]{4}\]\d{4}|[A-Z]{4}\d{4}(?:\/[A-Z]{4}\d{4})*|(?<![A-Za-z0-9])\d{4}(?![0-9])/g
// 续号之后紧跟 level/units/above 等 → 是「…级」描述词,不是课号。
const LEVEL_AFTER = /^\s*(?:or\s+above|and\s+above|above|or\s+below|below|level|units)\b/i

/** 裸续号的 gap 判定:去掉插入括号后,只允许分隔符与 and/or 连接词。 */
function gapBinds(gap: string): boolean {
  const g = gap.replace(/\([^)]*\)/g, ' ').replace(/[\s,*&]+/g, ' ').trim()
  if (g === '') return true
  return g.split(' ').every((w) => w === 'and' || w === 'or')
}

/** 参考课号集合(over-inclusive)。返回 code -> 首次出现处上下文,供报错。 */
function referenceCodes(block: string): Map<string, string> {
  // 剥同一「丢课族」的标记:小写脚注 [a][b]…、数字别号 [3001](跨届重编号,非独立课)、
  // Major-GPA 标记 #、特殊标记 @、实验课标记 ^,以及紧贴数字的单个 retake 标记 r(Law
  // 的 "LAWS1010r, 1020r@")。全都紧贴课号、卡断后续裸续号。大写跨挂 [DSME] 不动。镜像 parser。
  const text = block.replace(/\[[a-z]+\]|\[\d+\]|[#@^]|(?<=\d)r(?![a-z])/g, '')
  const found = new Map<string, string>()
  let currentSubj: string | null = null
  let lastEnd = -1
  let lastWasCourse = false
  const add = (code: string, at: number) => {
    if (!found.has(code)) {
      const lo = Math.max(0, at - 80)
      found.set(code, norm(text.slice(lo, at + 80)))
    }
  }
  TOKEN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN.exec(text))) {
    const s = m[0]
    const bm = /^([A-Z]{4})\[([A-Z]{4})\](\d{4})$/.exec(s)
    if (bm) {
      currentSubj = bm[1]
      add(bm[1] + bm[3], m.index)
      add(bm[2] + bm[3], m.index)
      lastEnd = TOKEN.lastIndex; lastWasCourse = true
      continue
    }
    if (/^[A-Z]/.test(s)) {
      currentSubj = s.slice(0, 4)
      for (const c of s.match(new RegExp(CODE.source, 'g')) || []) add(c, m.index)
      lastEnd = TOKEN.lastIndex; lastWasCourse = true
      continue
    }
    // 裸 4 位续号
    const gap = lastEnd >= 0 ? text.slice(lastEnd, m.index) : 'x'
    if (currentSubj && lastWasCourse && gapBinds(gap)) {
      if (LEVEL_AFTER.test(text.slice(m.index + 4))) {
        lastWasCourse = false; lastEnd = TOKEN.lastIndex; continue
      }
      add(currentSubj + s, m.index)
      lastEnd = TOKEN.lastIndex; lastWasCourse = true
    } else {
      // 不绑定的裸号:跳过但不重置 running subject/lastWasCourse、不推进 lastEnd(镜像
      // parser)。锚点留在最后一门被接受的课上,让夹在两门课之间的括号插入语能从加宽的
      // gap 里被抹掉,真实的下一门课重新绑定;真正的非课号数字仍因 gap 里塞满散文词而失败。
      continue
    }
  }
  return found
}

// --------------------------------------------------------------------------- structure helpers
function collectStructCodes(nodes: SectionNode[], out: Set<string>): void {
  for (const n of nodes) {
    for (const c of n.courses) {
      out.add(c.code)
      for (const a of c.alts) out.add(a)
    }
    collectStructCodes(n.children, out)
  }
}
function nodeCodeSet(n: SectionNode): Set<string> {
  const s = new Set<string>()
  for (const c of n.courses) { s.add(c.code); for (const a of c.alts) s.add(a) }
  return s
}
function topByMarker(prog: Program, marker: string): SectionNode | undefined {
  return prog.structure.find((n) => n.marker === marker)
}
function childByMarker(node: SectionNode | undefined, marker: string): SectionNode | undefined {
  return node?.children.find((n) => n.marker === marker)
}
const CHOOSE_RE = /at\s+least|choose|any|elective|following|select|minimum|units of|or above|or below/i
function isChooseNode(n: SectionNode): boolean {
  return CHOOSE_RE.test(n.title || '') || CHOOSE_RE.test(n.note || '')
}
/** 节点有效学分:自身 units,若为 null 则回退子节点求和(处理「units 记在子节点」的方案)。 */
function effUnits(n: SectionNode): number {
  if (typeof n.units === 'number') return n.units
  return n.children.reduce((s, c) => s + effUnits(c), 0)
}

// --------------------------------------------------------------------------- courses units
function loadCourseUnits(): Map<string, number> {
  const map = new Map<string, number>()
  const years = existsSync(COURSES_DIR)
    ? readdirSync(COURSES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
    : []
  const latest = years[years.length - 1]
  if (!latest) return map
  const dir = join(COURSES_DIR, latest)
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'index.json' || f === 'subjects.json') continue
    let d: any
    try { d = JSON.parse(readFileSync(join(dir, f), 'utf8')) } catch { continue }
    for (const c of d.courses || []) {
      if (typeof c.u === 'number') map.set(c.c, c.u)
    }
  }
  return map
}

// --------------------------------------------------------------------------- P3 lint
// 半句截断(签名 3):title/note 以介词/冠词/连词或逗号结尾,说明续行/后半句丢了。
// 收窄口径(去两类可证非缺陷的误报,避免污染 WARN 表):
//   * 去掉「裸数字结尾」触发:标题合法地以编号收尾("Stream 2"/"Area 1"/"Group 3"),整句规则
//     也常以编号收尾("Any 9 units from Area 1"),裸数字≠截断——真截断都落在介词/冠词/连词/逗号上。
//   * 「引出附着课单的引子」豁免:一条规则以 from/of/following/the/at 收尾、且本节自带课单时
//     ("two courses selected from:"→课单在 courses[])是引子而非断句,不算截断。仍拦真正无课单
//     兜底的悬垂("Any 12 units of CUMT courses, with"+续行丢失)与以 and/or/with/逗号 收尾者。
const DANGLING_END = /\b(from|the|of|to|and|or|with|at|below|following)\s*$|,\s*$/i
// 引出附着内容的收尾词(本节自带课单/子节点时豁免):from/of/following/the/at 引出课单;
// below 是"见下方"指针("modules listed below"/"any one stream below"),都是完整指向而非截断。
const LEAD_IN_END = /\b(from|of|following|the|at|below)\s*$/i
function parensBalanced(s: string): boolean {
  let d = 0
  for (const ch of s) { if (ch === '(') d++; else if (ch === ')') { d--; if (d < 0) return false } }
  return d === 0
}
function lintText(s: string | null, hasCourses = false): string | null {
  if (!s) return null
  const t = s.trim()
  if (!t) return null
  if (DANGLING_END.test(t) && !(hasCourses && LEAD_IN_END.test(t))) return 'dangling-end'
  if (!parensBalanced(t)) return 'unbalanced-parens'
  return null
}

// --------------------------------------------------------------------------- run
type Detail = { p1: string[]; p2: string[]; p3: string[]; p4: string[]; p5: string[] }

function main() {
  const raw = loadRaw()
  const bundle = JSON.parse(readFileSync(BUNDLE, 'utf8'))
  const programs: Program[] = bundle.programs
  const courseUnits = loadCourseUnits()
  const whitelist = existsSync(WHITELIST) ? JSON.parse(readFileSync(WHITELIST, 'utf8')) : { p1: [] }
  const wlP1 = new Set<string>((whitelist.p1 || []).map((e: any) => `${e.program}|${e.code}`))
  // P2 白名单:逐条裁决过的「节内课已全录、但 2026-27 目录学分和 < 印刷节学分」的跨届学分漂移
  // (非解析器丢课;P1 已保证零丢课)。key = program|marker|title。每条带 reason(见 whitelist)。
  const wlP2 = new Set<string>((whitelist.p2 || []).map((e: any) => `${e.program}|${e.marker}|${e.title ?? ''}`))
  // WARN 白名单(P3 lint / P2 部分停开 / P4 总账):逐条裁决过、确属「原文如此 / 停开课 / 结构性
  // 双主修·双学位总账」的 WARN。每条 {program, contains, reason}:contains 是该 WARN 明细行的判别
  // 子串。命中即计入「已裁决」,不再计入活跃 WARN。绝不许收真缺陷(真 bug 一律修,见 §5.2)。
  const wlWarn: { program: string; contains: string; reason: string }[] = whitelist.warn || []
  const warnHit = (pid: string, line: string) =>
    wlWarn.some((e) => e.program === pid && line.includes(e.contains))
  let warnAdj = 0

  let p1Missing = 0, p2Fail = 0, p3Warn = 0, p4Warn = 0, p5Fail = 0
  const offenders = new Map<string, number>()
  const bump = (sig: string) => offenders.set(sig, (offenders.get(sig) || 0) + 1)
  const lines: string[] = []

  for (const prog of programs) {
    if (prog.parse_status !== 'full') continue
    const ss = raw.get(prog.id)
    const d: Detail = { p1: [], p2: [], p3: [], p4: [], p5: [] }
    const block = ss ? majorBlock(ss) : ''
    const structCodes = new Set<string>()
    collectStructCodes(prog.structure, structCodes)

    // ---- P1 独立对照提取(I1 零丢课,FAIL)
    if (block) {
      const ref = referenceCodes(block)
      for (const [code, ctx] of ref) {
        if (structCodes.has(code)) continue
        if (wlP1.has(`${prog.id}|${code}`)) continue
        p1Missing++; bump('P1:missing-course')
        d.p1.push(`${code}  ⟨…${ctx}…⟩`)
      }
    }

    // ---- P2 学分-课程合理性(I3,FAIL)+ P3 lint + P4 总账
    const visit = (n: SectionNode) => {
      // P3 —— hasContent:本节自带课单/子节点时,规则以 from/of/following 收尾是引子非截断
      const hasContent = n.courses.length > 0 || n.children.length > 0
      for (const [field, val] of [['title', n.title], ['note', n.note]] as const) {
        const flag = lintText(val, hasContent)
        if (flag) {
          const line = `[${n.marker}] ${field}: ${flag} :: ${norm(String(val)).slice(0, 60)}`
          if (warnHit(prog.id, line)) warnAdj++
          else { p3Warn++; bump(`P3:${flag}`); d.p3.push(line) }
        }
      }
      // P2 —— 仅对「挂课、有 units、非 choose、无子节点」的节点
      if (typeof n.units === 'number' && n.units > 0 && n.courses.length > 0 && n.children.length === 0 && !isChooseNode(n)) {
        const codes = [...nodeCodeSet(n)]
        // 每门课取该课号及其 alts 里能解出的学分(alt 取任一可解)
        let sum = 0, unresolved = 0
        for (const c of n.courses) {
          const cand = [c.code, ...c.alts]
          // 一门 '/'-孪生(如 CHEM4030/4040)取各半里能解出学分的 *最大* 值,不是第一个:
          // 目录里常留一个 0 学分的旧半(CHEM4030 "PBL I"=0,真正带学分的是 CHEM4040 "II"=4),
          // .find 会抓到 0 而漏报 4 学分,凭空制造 sum<units 假 FAIL。孪生=择一,取真正带学分的那半。
          const resolved = cand.map((k) => courseUnits.get(k)).filter((v): v is number => typeof v === 'number')
          if (resolved.length) sum += Math.max(...resolved); else unresolved++
        }
        if (unresolved === 0) {
          if (sum < n.units && !wlP2.has(`${prog.id}|${n.marker}|${n.title}`)) {
            p2Fail++; bump('P2:units-gt-courses')
            d.p2.push(`[${n.marker}] "${n.title}" units=${n.units} but Σcourse=${sum} (${codes.length} courses: ${codes.slice(0, 8).join(',')}${codes.length > 8 ? '…' : ''})`)
          }
        } else if (sum < n.units) {
          // 部分停开 → WARN(计入 P3 通道,标注未解析数)
          const line = `[${n.marker}] "${n.title}" units=${n.units} Σresolved=${sum} unresolved=${unresolved} (WARN)`
          if (warnHit(prog.id, line)) warnAdj++
          else { p3Warn++; bump('P2:partial-unresolved'); d.p3.push(line) }
        }
      }
      n.children.forEach(visit)
    }
    prog.structure.forEach(visit)

    // ---- P4 总学分对账(I3,WARN)
    if (typeof prog.total_units === 'number') {
      const forced = prog.structure.filter((n) => !n.kind)
      const sum = forced.reduce((s, n) => s + effUnits(n), 0)
      if (Math.abs(sum - prog.total_units) > 3) {
        const line = `Σtop=${sum} vs total_units=${prog.total_units} (Δ${sum - prog.total_units})`
        if (warnHit(prog.id, line)) warnAdj++
        else { p4Warn++; bump('P4:total-mismatch'); d.p4.push(line) }
      }
    }

    // ---- P5 标题保真(I4,FAIL)—— raw 每个「N. | Title | units」行
    if (ss) {
      // 原文每个顶层「N.」编号节的印刷标题(可能跨表重复、可能折行、可能内联课单/规则)。
      // 提取 = 取标题格首个冒号前(剥内联课单/规则),折行标题向后拼一两行补全。多表方案的
      // 同号节各表标题都收进集合:解析器只忠实重建其中一张表,断言其标题命中任一张表的印刷标题
      // 即算保真(对多表/内联/折行稳健,同时仍能抓到 title 丢空、张冠李戴的真 bug)。
      const rawCells = rawHeaderCells(block)
      for (const n of prog.structure) {
        if (!/^\d+\.$/.test(n.marker)) continue // 仅顶层编号节;concentration/stream/catch-all 不在口径
        const cells = rawCells.get(n.marker)
        if (!cells || cells.length === 0) continue // 原文无对应编号标题行 → 结构问题,不在 P5 口径
        const got = titleSlug(n.title)
        // 非空、且是某张表整格的整词前缀(或整格全等)→ 保真
        if (got !== '' && cells.some((c) => c === got || c.startsWith(got + ' '))) continue
        p5Fail++; bump(got === '' ? 'P5:empty-title' : 'P5:title-mismatch')
        d.p5.push(`[${n.marker}] cells∈{${cells.map((c) => c.slice(0, 40)).join(' | ')}} got="${n.title}"`)
      }
    }

    // ---- 逐方案明细
    const total = d.p1.length + d.p2.length + d.p3.length + d.p4.length + d.p5.length
    if (total > 0) {
      lines.push(`\n### ${prog.id}  ${ss ? '' : '(⚠ no raw matched)'}`)
      for (const m of d.p1) lines.push(`  P1 miss  ${m}`)
      for (const m of d.p2) lines.push(`  P2 FAIL  ${m}`)
      for (const m of d.p5) lines.push(`  P5 FAIL  ${m}`)
      for (const m of d.p4) lines.push(`  P4 warn  ${m}`)
      for (const m of d.p3) lines.push(`  P3 warn  ${m}`)
    }
  }

  // --------------------------------------------------------------------- P6 回归 case 表(只增不删)
  const byId = new Map(programs.map((p) => [p.id, p]))
  const p6: { case: string; ok: boolean; detail: string }[] = []
  const assert = (name: string, ok: boolean, detail: string) => p6.push({ case: name, ok, detail })

  // case 1: 2025:B.S.Sc. in Economics 第 2 节
  {
    const p = byId.get('2025:B.S.Sc. in Economics')
    const n = p && topByMarker(p, '2.')
    const want = ['ECON1101', 'ECON1111', 'ECON1902', 'ECON2021', 'ECON2121', 'ECON2901', 'ECON3011', 'ECON3021', 'ECON3121', 'ECON4901', 'ECON4903']
    const got = n ? nodeCodeSet(n) : new Set<string>()
    const ok = !!n && titleSlug(n.title) === 'required courses' && n.units === 27 &&
      want.every((c) => got.has(c)) && got.size === want.length
    assert('ECON2025 §2 Required Courses=27,11门', ok,
      n ? `title="${n.title}" units=${n.units} n=${got.size} missing=[${want.filter((c) => !got.has(c)).join(',')}]` : 'node missing')
  }
  // case 2: 2025:B.S.Sc. in Economics 第 3 节 note
  {
    const p = byId.get('2025:B.S.Sc. in Economics')
    const n = p && topByMarker(p, '3.')
    const ok = !!n && /36\s*units of elective ECON courses at 3000 or above level/i.test(norm(n.note || ''))
    assert('ECON2025 §3 note 完整', ok, n ? `note="${norm(n.note || '')}"` : 'node missing')
  }
  // case 3: 2023:B.A. in Philosophy 第 2/3 节
  {
    const p = byId.get('2023:B.A. in Philosophy')
    const n2 = p && topByMarker(p, '2.')
    const n3 = p && topByMarker(p, '3.')
    const want2 = ['PHIL1110', 'PHIL1310', 'PHIL2020', 'PHIL2030', 'PHIL2040', 'PHIL2050', 'PHIL2060', 'PHIL3000', 'PHIL3800', 'PHIL3820', 'PHIL4800']
    const got2 = n2 ? nodeCodeSet(n2) : new Set<string>()
    const ok2 = !!n2 && titleSlug(n2.title) === 'required courses' && n2.units === 30 && want2.every((c) => got2.has(c))
    assert('PHIL2023 §2 Required Courses=30,含11门', ok2,
      n2 ? `title="${n2.title}" units=${n2.units} missing=[${want2.filter((c) => !got2.has(c)).join(',')}]` : 'node missing')
    const ok3 = !!n3 && titleSlug(n3.title) === 'elective courses' && n3.units === 33 && !!(n3.note && n3.note.trim().length > 20)
    assert('PHIL2023 §3 Elective Courses=33,note完整', ok3,
      n3 ? `title="${n3.title}" units=${n3.units} note="${norm(n3.note || '')}"` : 'node missing')
  }
  // case 4: 2023:B.Ed. in Mathematics and Mathematics Education 2(a)
  {
    const p = byId.get('2023:B.Ed. in Mathematics and Mathematics Education')
    const n = childByMarker(p && topByMarker(p, '2.'), '(a)')
    const want = ['MATH1010', 'MATH1018', 'MATH1030', 'MATH1038', 'MATH1050', 'MATH1058', 'MATH2010', 'MATH2018', 'MATH2020', 'MATH2028', 'MATH2040', 'MATH2048', 'MATH2050', 'MATH2058', 'MATH2070', 'MATH2078', 'MATH2221', 'MATH2230']
    const got = n ? nodeCodeSet(n) : new Set<string>()
    const ok = !!n && titleSlug(n.title) === 'subject knowledge' && n.units === 26 && want.every((c) => got.has(c))
    assert('BEdMath2023 2(a) Subject Knowledge=26,含18门', ok,
      n ? `title="${n.title}" units=${n.units} missing=[${want.filter((c) => !got.has(c)).join(',')}]` : 'node missing')
  }
  // case 5: 签名1(脚注/插入语卡断裸续号)回收 —— SOWK "…4030 (capstone course), 4510, …,
  // 4590, 4591, 4592" 一列曾整段丢课;只断言这些续号课号出现在 structure 任意节点(与归位/
  // 标题无关,专锁续号回收)。修复前 SOWK4590/4591/4592 均为 P1 缺课。
  {
    const p = byId.get('2025:B.S.Sc. in Social Work')
    const codes = new Set<string>()
    if (p) collectStructCodes(p.structure, codes)
    const want = ['SOWK4510', 'SOWK4520', 'SOWK4530', 'SOWK4540', 'SOWK4550', 'SOWK4570', 'SOWK4580', 'SOWK4590', 'SOWK4591', 'SOWK4592']
    const ok = !!p && want.every((c) => codes.has(c))
    assert('SOWK2025 脚注/插入语后续号全回收', ok,
      p ? `missing=[${want.filter((c) => !codes.has(c)).join(',')}]` : 'program missing')
  }

  // case 6: 签名1 的 "or 续号" 半 —— "Capstone course: MATH4400 or 4900" 曾丢 MATH4900
  // (旧 CONT_GAP_RE 只认 and,不认 or)。断言两门都落在 structure(gap 的 and/or 一视同仁,
  // 差异只体现在 note/title 的选择语义,不构成丢课理由)。
  {
    const p = byId.get('2025:Articulated Bachelor of Science – Ph.D. Programme in Mathematical Sciences')
    const codes = new Set<string>()
    if (p) collectStructCodes(p.structure, codes)
    const want = ['MATH4400', 'MATH4900']
    const ok = !!p && want.every((c) => codes.has(c))
    assert('MathSci2025 "MATH4400 or 4900" 两门都回收', ok,
      p ? `missing=[${want.filter((c) => !codes.has(c)).join(',')}]` : 'program missing')
  }
  // case 7: 签名2(节标题静默丢失)—— "2. | Required Courses: | 27" / "3. | Elective
  // Courses: | 36" 这类无关键词的编号节曾 title=""。断言其 title 非空且与原文一致。
  {
    const p = byId.get('2025:B.S.Sc. in Economics')
    const n2 = p && topByMarker(p, '2.')
    const n3 = p && topByMarker(p, '3.')
    const ok = titleSlug(n2?.title) === 'required courses' && titleSlug(n3?.title) === 'elective courses'
    assert('ECON2025 §2/§3 节标题非空保真', !!ok,
      `§2="${n2?.title ?? ''}" §3="${n3?.title ?? ''}"`)
  }

  // case 8: 签名1 的「/ 孪生裸续号」半(R3 修复)—— 日历把一门课的两种形态写成
  // "MATH1010/1018"、"1050/1058"、"CSCI2100/ESTR2102",后半常是裸 4 位数继承前缀。
  // 旧 tokenizer 只跨 full/full 的斜杠,把裸半 silently 丢掉("MATH1010 only"全库丢课)。
  // 断言两处独立程序的孪生两半都进 structure:BEdMath 2(a)(case 4 已锁,含 MATH1018/1058)
  // 之外,再锁 MathSci 2(a) 的 "MATH2070/2078" 两半 —— 证明是通用规则,非单例特判。
  {
    const p = byId.get('2025:Articulated Bachelor of Science – Ph.D. Programme in Mathematical Sciences')
    const codes = new Set<string>()
    if (p) collectStructCodes(p.structure, codes)
    const want = ['MATH2070', 'MATH2078', 'IMSC2018', 'IMSC2058', 'IMSC2068']
    const ok = !!p && want.every((c) => codes.has(c))
    assert('MathSci2025 "/孪生裸续号"两半全回收', ok,
      p ? `missing=[${want.filter((c) => !codes.has(c)).join(',')}]` : 'program missing')
  }

  // case 9: 签名3(note 半句截断)R4 修复 —— 规则续行被课号列表卡断致 note 只剩 marker 行
  // 碎片。两族:(i) 规则跨行到课单前 "At least five courses chosen from" + "the following
  // (…): PSYC1020, …" 曾冻结为 "…chosen from"(dangling);(ii) 整段叙述式规则里顺带点名一
  // 门课 "…other than PHIL1110 … are elective courses. Students …" 曾被当纯课单整段丢 note。
  // 断言两族的 note 回到完整句(非空、非 dangling 结尾)。
  {
    const p = byId.get('2025:B.S.Sc. in Psychology')
    const n3 = p && topByMarker(p, '3.')
    const a = childByMarker(n3, '(a)')
    const b = childByMarker(n3, '(b)')
    const dang = /\b(from|the|of|to|and|or|with|at|below|following)\s*$/i
    const okA = !!a && /At least five courses chosen from the following/i.test(a.note || '') && !dang.test((a.note || '').trim())
    const okB = !!b && /capstone courses/i.test(b.note || '') && !dang.test((b.note || '').trim())
    assert('PSYC2025 §3(a)/(b) note 续行完整不 dangling', okA && okB,
      `(a)="${norm(a?.note || '')}" (b)="${norm(b?.note || '')}"`)
  }
  // case 10: 签名3 第二族 —— PHIL2023 §3 叙述式规则(顺带点名 PHIL1110)整段保留为 note,
  // 不再因含课号被当纯课单丢弃(与 case 3 的 length>20 呼应,这里锁具体句首,防回退)。
  {
    const p = byId.get('2023:B.A. in Philosophy')
    const n3 = p && topByMarker(p, '3.')
    const ok = !!n3 && /All\s+Philosophy courses other than PHIL1110/i.test(norm(n3.note || ''))
    assert('PHIL2023 §3 叙述式 note 整段保留', ok, n3 ? `note="${norm(n3.note || '').slice(0, 70)}…"` : 'node missing')
  }

  // case 11: 签名「误锚」(R5 修复,全库丢课主因)—— 只面向 senior-year/AD 收生的方案,真实
  // Major 标题是 "(for …)" 变体(命中 senior_year 锚);旧 parse_program 却以 major_requirement
  // 锚定位块首,而该正则排斥 "(for",只会命中 Explanatory Notes 里的散句
  // "…as included in the Major Programme Requirement will be…",导致整段课单落在块外全丢。
  // Bimodal Bilingual Studies 曾 57/51/51 门 P1 缺课;断言首节课单回到 structure。
  {
    const p = byId.get('2025:B.A. in Bimodal Bilingual Studies')
    const codes = new Set<string>()
    if (p) collectStructCodes(p.structure, codes)
    const want = ['BMBL1001', 'BMBL1002', 'BMBL2001', 'BMBL2004', 'HKSL1003', 'HKSL3002']
    const ok = !!p && want.every((c) => codes.has(c))
    assert('BMBL2025 senior-year 误锚修复:首节课单回收', ok,
      p ? `missing=[${want.filter((c) => !codes.has(c)).join(',')}]` : 'program missing')
  }
  // case 12: 同族第二方案(证明通用)—— Exercise Science 的 "(a) | Core Courses … | 38" 后课单
  // 另起一续行(无 marker、无 |)。误锚修复后块首正确,断言核心课(含 (a) 续行、(d) 单课)全回收。
  {
    const p = byId.get('2025:B.Sc. in Exercise Science and Health Education')
    const codes = new Set<string>()
    if (p) collectStructCodes(p.structure, codes)
    const want = ['PHPC1001', 'SPED2520', 'SPED4570', 'SPED2010', 'SPED4201']
    const ok = !!p && want.every((c) => codes.has(c))
    assert('EXS2025 senior-year 误锚修复:核心课全回收', ok,
      p ? `missing=[${want.filter((c) => !codes.has(c)).join(',')}]` : 'program missing')
  }
  // case 13: 签名1 续号卡断的两个新变体(R5)—— '#'(Major-GPA 标记,"PHPC1001#, 1012#, 1017#"
  // 卡断 1012/1017)与数字别号 '[####]'("BMBL1002[3001], 2004[4001]" 卡断 2004)。二者同族,
  // 上游 strip 已加入 '#' 与 \[\d+\]。断言 '#' 后续号(Community Health)与数字别号后续号(BMBL)全回收。
  {
    const chp = byId.get('2025:B.Sc. in Community Health Practice')
    const cc = new Set<string>(); if (chp) collectStructCodes(chp.structure, cc)
    const bmbl = byId.get('2025:B.A. in Bimodal Bilingual Studies')
    const bc = new Set<string>(); if (bmbl) collectStructCodes(bmbl.structure, bc)
    const ok = cc.has('PHPC1012') && cc.has('PHPC1017') && bc.has('BMBL2004')
    assert('R5 #/数字别号续号卡断修复:PHPC1012/1017 + BMBL2004 回收', ok,
      `CHP:1012=${cc.has('PHPC1012')} 1017=${cc.has('PHPC1017')} | BMBL:2004=${bc.has('BMBL2004')}`)
  }
  // case 14: 签名2 第二族(R5)—— "<Section Label>: <inline rule>" 且无 | units 的编号节:
  // "2. | Elective Courses[a]: No more than 3 units …" 曾把标题吞进 note、title="" (P5 FAIL)。
  // 冠标签剥离后 title="Elective Courses"(Natural Sciences 三届皆然)。
  {
    const p = byId.get('2025:B.Sc. in Natural Sciences')
    const n = p && topByMarker(p, '2.')
    const ok = titleSlug(n?.title) === 'elective courses'
    assert('NS2025 §2 冠标签内联规则:title="Elective Courses" 保真', !!ok,
      `title="${n?.title ?? ''}"`)
  }
  // case 15: 签名1「续行裸续号跨 marker/body 边界」(R6)—— Case A 的课单节标记行本身是课单,
  // 而课单折行续到 cont 正文:"(a) | GDRS1001, 1002,\n2010, 2011, 3007 | 15"。旧路径把 marker
  // 行(direct_courses)与 body(_parse_body)分两次 extract_courses,续行 body 拿不到运行中的
  // subject "GDRS",裸续号 2010/2011/3007 全丢,(a) 只剩 2 门 6 学分 vs units=15(P2 FAIL)。
  // 修复:body 是纯课单尾(_is_courselist_tail、无 prose 子标题)时,marker 行+body 合并一次抽取,
  // subject 跨折行传导。断言 GDRS (a) 五门齐(1001/1002/2010/2011/3007)=15 学分。
  {
    const p = byId.get('2025:B.S.Sc. in Gender Studies')
    const n1 = p && topByMarker(p, '1.')
    const a = childByMarker(n1, '(a)')
    const codes = (a?.courses || []).map((c) => c.code)
    const want = ['GDRS1001', 'GDRS1002', 'GDRS2010', 'GDRS2011', 'GDRS3007']
    const ok = !!a && a.units === 15 && want.every((c) => codes.includes(c))
    assert('GDRS2025 §1(a) 折行裸续号回收:5门=15学分', ok,
      `units=${a?.units} courses=[${codes.join(',')}]`)
  }

  const p6Fail = p6.filter((c) => !c.ok).length

  // --------------------------------------------------------------------- 输出
  console.log('# 培养方案机器门 (fable_docs/06 §3)  —— audit_programs.mts')
  console.log(`# 审计范围: parse_status="full" ${programs.filter((p) => p.parse_status === 'full').length} 个方案`)
  for (const l of lines) console.log(l)

  console.log('\n## P6 回归 case')
  for (const c of p6) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.case}  ::  ${c.detail}`)

  const topOffender = [...offenders.entries()].sort((a, b) => b[1] - a[1])[0]
  console.log('\n## 汇总')
  console.log(`  P1 缺课(FAIL) : ${p1Missing}`)
  console.log(`  P2 FAIL       : ${p2Fail}`)
  console.log(`  P3 WARN       : ${p3Warn}`)
  console.log(`  P4 WARN       : ${p4Warn}`)
  console.log(`  P5 FAIL       : ${p5Fail}`)
  console.log(`  P6 FAIL       : ${p6Fail}`)
  console.log(`  WARN 已裁决    : ${warnAdj}(whitelist.warn 收录,原文如此/停开/结构性总账)`)
  console.log(`  最大失败签名  : ${topOffender ? `${topOffender[0]} ×${topOffender[1]}` : 'none'}`)

  const summary = {
    p1Missing, p2Fail, p3Warn, p4Warn, p5Fail, p6Fail, warnAdj,
    topOffender: topOffender ? `${topOffender[0]} ×${topOffender[1]}` : 'none',
    pass: p1Missing === 0 && p2Fail === 0 && p5Fail === 0 && p6Fail === 0,
  }
  console.log('\nAUDIT_PROGRAMS_SUMMARY ' + JSON.stringify(summary))
  // 门:P1/P2/P5/P6 任一非零即非零退出(CI 可据此拦)
  process.exitCode = summary.pass ? 0 : 1
}

main()
