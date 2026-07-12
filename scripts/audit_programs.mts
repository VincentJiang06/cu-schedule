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
  const text = block.replace(/\[[a-z]+\]/g, '') // 剥小写脚注 [a][b]…
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
      lastWasCourse = false; lastEnd = TOKEN.lastIndex
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
const DANGLING_END =
  /\b(from|the|of|to|and|or|with|at|below|following)\s*$|[,]\s*$|\b\d+\s*$/i
function parensBalanced(s: string): boolean {
  let d = 0
  for (const ch of s) { if (ch === '(') d++; else if (ch === ')') { d--; if (d < 0) return false } }
  return d === 0
}
function lintText(s: string | null): string | null {
  if (!s) return null
  const t = s.trim()
  if (!t) return null
  if (DANGLING_END.test(t)) return 'dangling-end'
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
      // P3
      for (const [field, val] of [['title', n.title], ['note', n.note]] as const) {
        const flag = lintText(val)
        if (flag) { p3Warn++; bump(`P3:${flag}`); d.p3.push(`[${n.marker}] ${field}: ${flag} :: ${norm(String(val)).slice(0, 60)}`) }
      }
      // P2 —— 仅对「挂课、有 units、非 choose、无子节点」的节点
      if (typeof n.units === 'number' && n.units > 0 && n.courses.length > 0 && n.children.length === 0 && !isChooseNode(n)) {
        const codes = [...nodeCodeSet(n)]
        // 每门课取该课号及其 alts 里能解出的学分(alt 取任一可解)
        let sum = 0, unresolved = 0
        for (const c of n.courses) {
          const cand = [c.code, ...c.alts]
          const u = cand.map((k) => courseUnits.get(k)).find((v) => typeof v === 'number')
          if (typeof u === 'number') sum += u; else unresolved++
        }
        if (unresolved === 0) {
          if (sum < n.units) {
            p2Fail++; bump('P2:units-gt-courses')
            d.p2.push(`[${n.marker}] "${n.title}" units=${n.units} but Σcourse=${sum} (${codes.length} courses: ${codes.slice(0, 8).join(',')}${codes.length > 8 ? '…' : ''})`)
          }
        } else if (sum < n.units) {
          // 部分停开 → WARN(计入 P3 通道,标注未解析数)
          p3Warn++; bump('P2:partial-unresolved')
          d.p3.push(`[${n.marker}] "${n.title}" units=${n.units} Σresolved=${sum} unresolved=${unresolved} (WARN)`)
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
        p4Warn++; bump('P4:total-mismatch')
        d.p4.push(`Σtop=${sum} vs total_units=${prog.total_units} (Δ${sum - prog.total_units})`)
      }
    }

    // ---- P5 标题保真(I4,FAIL)—— raw 每个「N. | Title | units」行
    if (ss) {
      const lineRe = /^\s*(\d+)\.\s*\|\s*([^|]+?):?\s*\|\s*\d+\s*$/
      for (const rawLine of block.split('\n')) {
        const lm = lineRe.exec(rawLine)
        if (!lm) continue
        const n = topByMarker(prog, `${lm[1]}.`)
        const want = titleSlug(lm[2])
        if (!want) continue
        const got = titleSlug(n?.title)
        if (!n) continue // 缺节点属结构问题,不在 P5 口径
        if (got === '' || got !== want) {
          p5Fail++; bump(got === '' ? 'P5:empty-title' : 'P5:title-mismatch')
          d.p5.push(`[${lm[1]}.] want="${lm[2].trim()}" got="${n.title}"`)
        }
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
  console.log(`  最大失败签名  : ${topOffender ? `${topOffender[0]} ×${topOffender[1]}` : 'none'}`)

  const summary = {
    p1Missing, p2Fail, p3Warn, p4Warn, p5Fail, p6Fail,
    topOffender: topOffender ? `${topOffender[0]} ×${topOffender[1]}` : 'none',
    pass: p1Missing === 0 && p2Fail === 0 && p5Fail === 0 && p6Fail === 0,
  }
  console.log('\nAUDIT_PROGRAMS_SUMMARY ' + JSON.stringify(summary))
  // 门:P1/P2/P5/P6 任一非零即非零退出(CI 可据此拦)
  process.exitCode = summary.pass ? 0 : 1
}

main()
