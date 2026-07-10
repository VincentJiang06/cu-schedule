/**
 * Whole-catalog integrity audit. Three questions:
 *
 *   1. Do the built bundles line up with the raw scrape? (no course or section
 *      silently lost or invented)
 *   2. Is every field of every course internally consistent under the schema?
 *      (code parses, key/subject/number/level agree, sections and meetings are
 *      sane, requirement leaves are real keys, nothing references itself)
 *   3. Does the pre-parsed `req` field stored in the bundle (built once, at
 *      bundle-build time, by scripts/build_bundles.mts) exactly match what
 *      requirements.ts's parser produces if run again right now on the same
 *      `rq` text and the same known-keys set? This is the guarantee that lets
 *      the client skip parsing entirely (see src/lib/data.ts's toCourse) without
 *      ever silently drifting from the parser's real behavior.
 *
 * HARD failures exit non-zero. SOFT observations are printed for eyeballing.
 *
 * Run: npx tsx scripts/audit_data.mts
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseCode } from '../src/lib/courseKey.ts'
import { collectCodes, parseRequirement } from '../src/lib/requirements.ts'
import { EMPTY_REQUIREMENT } from '../src/lib/types.ts'
import type { RawCourse as BundleCourse, TermBundle } from '../src/lib/types.ts'

const RAW_DIR = 'data/raw/courses/2026-27'
const BUNDLE_DIR = 'data/courses/2026-27'

type ScrapedCourse = {
  subject: string
  course_code: string
  credits: string
  academic_career: string
  enrollment_requirement?: string
  terms?: Array<{ term_name: string; schedule?: Array<{ section: string; meetings?: unknown[] }> }>
}
// BundleCourse (and its nested section shape) now come straight from
// src/lib/types.ts (RawCourse) — the audit reads the same schema the app and the
// build script agree on, instead of maintaining a third, hand-copied declaration.

let hard = 0
const soft: string[] = []
function fail(msg: string): void {
  hard += 1
  if (hard <= 40) console.log('  ✗', msg)
}

/** Deterministic JSON stringify (object keys sorted) so two structurally-equal
 * values compare equal regardless of the order their keys were built in. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(val).sort()) sorted[k] = (val as Record<string, unknown>)[k]
      return sorted
    }
    return val
  })
}

// ---- load ---------------------------------------------------------------------

const rawFiles = fs.readdirSync(RAW_DIR).filter((f) => f.endsWith('.json'))
const rawCourses: ScrapedCourse[] = rawFiles.flatMap(
  (f) => JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), 'utf8')).courses as ScrapedCourse[],
)

const bundleFiles = fs.readdirSync(BUNDLE_DIR).filter((f) => /term-[12]\.json$/.test(f))
const bundles = bundleFiles.map((f) => ({
  file: f,
  ...(JSON.parse(fs.readFileSync(path.join(BUNDLE_DIR, f), 'utf8')) as TermBundle),
}))

// requirements.ts's parser validates bare-inherited course numbers against a
// known-keys set. scripts/build_bundles.mts builds that set from EVERY term bundle
// in the academic year (not just Term 1 / Term 2 — a prerequisite can cite a
// Summer Session or Medicine-academic-year-only course), so the audit's
// re-parse must draw from the same, full-year set or a real match could look
// like a false divergence.
const allYearBundleFiles = fs
  .readdirSync(BUNDLE_DIR)
  .filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'subjects.json')
const allYearBundles = allYearBundleFiles.map(
  (f) => JSON.parse(fs.readFileSync(path.join(BUNDLE_DIR, f), 'utf8')) as TermBundle,
)
const allKeys = new Set<string>(allYearBundles.flatMap((b) => b.courses.map((c) => parseCode(c.c).key)))

// A section string the build keeps iff it matches "<prefix>-<CMP> (<num>)".
const SECTION_RE = /^.*-[A-Z]{3}\s*\(\d+\)$/

console.log('=== 1. 数据包 vs 原始抓取 对账 ===')
for (const bundle of bundles) {
  const termOrder = /Term 1/.test(bundle.term) ? '2026-27 Term 1' : '2026-27 Term 2'
  // Raw course-terms for this term that carry at least one build-parseable section.
  const rawForTerm = new Map<string, number>()
  for (const c of rawCourses) {
    for (const t of c.terms ?? []) {
      if (t.term_name.trim() !== termOrder) continue
      const sections = (t.schedule ?? []).filter((s) => SECTION_RE.test((s.section ?? '').trim())).length
      if (sections > 0) rawForTerm.set(`${c.subject}${c.course_code}`, sections)
    }
  }
  const bundleCodes = new Map(bundle.courses.map((c) => [c.c, c.x.length]))

  const dropped = [...rawForTerm.keys()].filter((code) => !bundleCodes.has(code))
  const invented = [...bundleCodes.keys()].filter((code) => !rawForTerm.has(code))

  console.log(
    `  ${bundle.term}: 原始有 section 的课 ${rawForTerm.size} · 数据包 ${bundleCodes.size} · 丢失 ${dropped.length} · 凭空多出 ${invented.length}`,
  )
  if (invented.length > 0) fail(`${bundle.term}: 数据包出现原始没有的课 ${invented.slice(0, 5).join(', ')}`)
  if (dropped.length > 0) soft.push(`${bundle.term} 丢失 ${dropped.length} 门(应为全部 section 无法解析): ${dropped.slice(0, 8).join(', ')}`)

  // Section-count agreement for courses present in both.
  let sectionMismatch = 0
  for (const [code, rawN] of rawForTerm) {
    const bN = bundleCodes.get(code)
    if (bN !== undefined && bN !== rawN) sectionMismatch += 1
  }
  if (sectionMismatch > 0) soft.push(`${bundle.term} 有 ${sectionMismatch} 门课 section 数与原始不一致(通常因去重合并)`)
}

console.log('\n=== 2. 逐字段 schema 不变量 ===')
const careers = new Set<string>()
const statuses = new Set<string>()
let zeroUnits = 0
let tbaSections = 0
let totalSections = 0
let selfExclusion = 0
let selfPrereq = 0
const bothTerms = new Map<string, BundleCourse>()
let titleUnitDrift = 0
let reqMismatches = 0

for (const bundle of bundles) {
  for (const c of bundle.courses) {
    const id = parseCode(c.c)

    // identity
    if (!/^[A-Z]{4}\d{4}$/.test(c.c)) fail(`码不规范: ${c.c}`)
    if (id.key !== c.c) fail(`key 与 code 不一致: ${c.c} -> ${id.key}`)
    if (c.sj !== id.subject) fail(`subject 字段(${c.sj})与码前四位(${id.subject})不符: ${c.c}`)
    if (id.number !== c.c.slice(4)) fail(`number 解析错: ${c.c} -> ${id.number}`)
    if (id.level !== Number(c.c[4])) fail(`level 解析错: ${c.c} -> ${id.level}`)

    // descriptive
    if (typeof c.u !== 'number' || !Number.isFinite(c.u) || c.u < 0) fail(`学分非法: ${c.c} = ${c.u}`)
    if (c.u === 0) zeroUnits += 1
    careers.add(c.cr)

    // sections & meetings
    if (c.x.length === 0) fail(`无 section 却出现在数据包: ${c.c}`)
    const seenComponents: string[] = []
    for (const s of c.x) {
      totalSections += 1
      statuses.add(s.st)
      if (!/^[A-Z]{3}$/.test(s.cp)) fail(`component 非三字母: ${c.c} ${s.cp}`)
      if (!seenComponents.includes(s.cp)) seenComponents.push(s.cp)
      if (s.m.length === 0) tbaSections += 1
      for (const m of s.m) {
        if (m.d < 1 || m.d > 7) fail(`星期非法: ${c.c} ${s.id} d=${m.d}`)
        if (!(m.s >= 0 && m.e > m.s && m.e <= 24 * 60)) fail(`时间非法: ${c.c} ${s.id} ${m.s}-${m.e}`)
        if (m.s < 7 * 60 || m.e > 23 * 60) soft.push(`异常时段 ${c.c} ${s.id} ${Math.floor(m.s / 60)}:xx-${Math.floor(m.e / 60)}:xx`)
      }
    }

    // requirement
    const req = parseRequirement(c.rq, allKeys)
    for (const code of req.exclusions) {
      if (!/^[A-Z]{4}\d{4}$/.test(code)) fail(`互斥码非法: ${c.c} -> ${code}`)
    }
    if (req.exclusions.includes(id.key)) selfExclusion += 1
    const prereqCodes = collectCodes(req.prerequisite)
    for (const code of prereqCodes) {
      if (!/^[A-Z]{4}\d{4}$/.test(code)) fail(`先修码非法: ${c.c} -> ${code}`)
    }
    if (prereqCodes.includes(id.key)) selfPrereq += 1

    // pre-parsed req consistency: what scripts/build_bundles.mts stored on `c.req`
    // must exactly equal parsing `c.rq` again right now with the same known-keys.
    // Zero divergence here is what makes it safe for the client to trust the
    // stored AST instead of ever re-parsing (src/lib/data.ts's toCourse).
    const stored = c.req ?? EMPTY_REQUIREMENT
    if (stableStringify(stored) !== stableStringify(req)) {
      reqMismatches += 1
      fail(`预解析 req 与现场重新解析不一致: ${c.c}`)
    }

    // cross-term consistency
    const prev = bothTerms.get(c.c)
    if (prev) {
      if (prev.u !== c.u || prev.t !== c.t) titleUnitDrift += 1
    } else {
      bothTerms.set(c.c, c)
    }
  }
}

console.log(`  课程码/身份字段: 全部一致(否则上面已报错)`)
console.log(`  section 总数 ${totalSections} · 其中 TBA(无时间) ${tbaSections}`)
console.log(`  career 取值: ${[...careers].join(' / ')}`)
console.log(`  section 状态取值: ${[...statuses].sort().join(' / ')}`)
console.log(`  0 学分课程: ${zeroUnits}`)
console.log(`  自我互斥: ${selfExclusion} · 自我先修: ${selfPrereq}`)
console.log(`  两学期都开且 标题/学分 不一致: ${titleUnitDrift}`)
console.log(`  预解析 req 与现场重新解析不一致: ${reqMismatches}`)

// dangling prereq references — expected (cross-term / discontinued), just quantified
const dangling = new Set<string>()
let refTotal = 0
for (const bundle of bundles) {
  for (const c of bundle.courses) {
    for (const code of collectCodes(parseRequirement(c.rq, allKeys).prerequisite)) {
      refTotal += 1
      if (!allKeys.has(code)) dangling.add(code)
    }
  }
}
soft.push(`先修引用的课号中有 ${dangling.size} 个当前学年不开(跨学期/已停开,属正常)`)

console.log('\n=== 软性观察 ===')
for (const s of [...new Set(soft)].slice(0, 14)) console.log('  •', s)

console.log(`\n${hard === 0 ? '✅ 硬性不变量全部通过' : `❌ ${hard} 处硬性不一致`}`)
process.exit(hard === 0 ? 0 : 1)
