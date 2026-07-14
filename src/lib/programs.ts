/**
 * Program (major) data access — the interface the personal-info card + search logic
 * read from. Loads the bundle built by scripts/build_program_bundle.py and exposes
 * typed lookups: type-ahead search over programme names, and the set of course keys
 * a programme requires (for "本专业需要"-style filtering).
 *
 * Data source: public/data/programs.json  (UG, admission years 2023-2025).
 * Course codes are plain 8-char SUBJ#### tokens; helpers normalize them to the same
 * course key (courseKey.ts) the catalog uses, so they match Course.key directly.
 *
 * See docs/programs-data.md for the full contract.
 *
 * STATUS: in-flight, unreferenced by the app UI. The upstream data pipeline is done —
 * public/data/programs.json is already built and ships with the site. What's missing
 * is the frontend wiring: the personal-info card (App.tsx's "我的情况") should load
 * this module to resolve the student's programme, and the search/candidate filters
 * should gain a "本专业需要" toggle driven by requiredCourseKeys() / programCourseKeys() above.
 * Do not delete this file — it is the intended landing spot for that work.
 */
import { courseKey, keySet } from './courseKey.ts'
import { dataVersion } from './data.ts'

const BASE = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`

// ---- wire format (mirrors programs.json) --------------------------------------

export type ProgramStream = {
  /** Stream / option label, e.g. "Stream 1: Embedded Systems". */
  name: string
  /** Course codes in this stream's elective pool (course/ESTR alternatives both listed). */
  courses: string[]
}

/**
 * One course inside the faithful `structure` tree. `code` is the 8-char primary
 * course key; `alts` holds equivalent keys (e.g. an ESTR twin: ["ESTR2102"]).
 * Both are already canonical keys — compare against Course.key directly.
 */
export type ProgramCourse = {
  code: string
  alts: string[]
}

/**
 * A node of the faithful Major-Programme-Requirement tree (mirrors programs.json's
 * `structure`). Renders as a nested requirement block: a numbered/lettered marker,
 * an optional title, an optional units requirement, a prose rule (`note`), the
 * courses attached directly to this node, and nested children.
 */
export type SectionNode = {
  /** List marker: "1." | "(a)" | "(i)" | "" (prose-split sub-block). */
  marker: string
  /** Section title, e.g. "Faculty Package" / "Stream 2: …"; "" for a pure course group. */
  title: string
  /** Units this section requires, or null when not stated. */
  units: number | null
  /** Prose rule, e.g. "Any one course from the following" / "Required Courses". */
  note: string | null
  /** Courses attached directly to this node. */
  courses: ProgramCourse[]
  children: SectionNode[]
  /**
   * Marks a special-schema optional section printed after the Major-block total. The
   * top node of a "Concentration Area:" segment carries `'concentration'` and the top
   * node of a "Streams:" segment carries `'stream'` (their children are the individual
   * 专业方向 / 选修方向); every other node — including the mandatory inline "Choose any
   * ONE …" stream options inside the Major block — leaves this undefined.
   */
  kind?: 'concentration' | 'stream'
}

export type ProgramParseStatus = 'full' | 'prose_only' | 'partial' | 'empty'

export type Program = {
  /** Stable id: `${year}:${name_en}`, e.g. "2024:B.Eng. in Computer Engineering". */
  id: string
  /** Admission year: "2023" | "2024" | "2025". */
  year: string
  name_en: string
  name_chi: string
  /** Primary faculty (the richest listing when cross-listed). */
  faculty: string
  /** Every faculty this programme is listed under. */
  faculties: string[]
  degree: string
  total_units: number | null
  parse_status: ProgramParseStatus
  /** Required course codes (Faculty Package + Required + Foundation picks). */
  required: string[]
  /** General major-elective course codes (not stream-scoped). */
  elective: string[]
  /** Stream / option elective pools. */
  streams: ProgramStream[]
  /** Full inventory: every course code referenced anywhere in the study scheme. */
  all: string[]
  /**
   * Faithful hierarchical requirement tree — the top-level numbered items (1./2./3./4.)
   * of the Major Programme Requirement. Empty [] for prose-only programmes (or old data
   * built before this field existed).
   */
  structure: SectionNode[]
}

export type ProgramBundle = {
  years: string[]
  program_count: number
  programs: Program[]
}

// ---- loading ------------------------------------------------------------------

let cache: Promise<Program[]> | null = null

/**
 * Loads and caches the programme bundle (single fetch for the app's lifetime).
 * Goes through the shared `?v=<generatedAt>` version channel (data.ts's dataVersion),
 * so a fresh data build busts the cache exactly like every other static data file.
 */
export function loadPrograms(): Promise<Program[]> {
  if (!cache) {
    cache = dataVersion()
      .then((version) => fetch(`${BASE}data/programs.json?v=${encodeURIComponent(version)}`))
      .then((res) => {
        if (!res.ok) throw new Error('加载专业数据失败：programs.json')
        return res.json() as Promise<ProgramBundle>
      })
      // Tolerate data built before `structure` existed: default it to [].
      .then((bundle) => bundle.programs.map((p) => ({ ...p, structure: p.structure ?? [] })))
      .catch((err) => {
        cache = null // let a later call retry
        throw err
      })
  }
  return cache
}

// ---- queries ------------------------------------------------------------------

export function listYears(programs: Program[]): string[] {
  return [...new Set(programs.map((p) => p.year))].sort()
}

export function getProgram(programs: Program[], id: string): Program | undefined {
  return programs.find((p) => p.id === id)
}

/**
 * Type-ahead search over programme names (English + Chinese). Scores an exact/prefix
 * name match above a word-start above a loose substring, mirroring the course search.
 * Pass `year` to scope to one admission year (recommended once the user picked a year).
 */
export type SubjectTitle = { code: string; title: string }

export function searchPrograms(
  programs: Program[],
  query: string,
  opts: { year?: string; limit?: number; subjects?: SubjectTitle[] } = {},
): Program[] {
  const pool = opts.year ? programs.filter((p) => p.year === opts.year) : programs
  const needle = query.trim().toLowerCase()
  if (!needle) return pool.slice(0, opts.limit ?? 8)
  const subjects = opts.subjects ?? []
  return pool
    .map((p) => ({ p, score: scoreProgram(p, needle, subjects) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.p.name_en.localeCompare(b.p.name_en))
    .slice(0, opts.limit ?? 8)
    .map((e) => e.p)
}

/** Higher of the name match and the subject-code match, so both routes reach a programme. */
function scoreProgram(p: Program, needle: string, subjects: SubjectTitle[]): number {
  return Math.max(nameScore(p, needle), subjectScore(p, needle, subjects))
}

function nameScore(p: Program, needle: string): number {
  const en = p.name_en.toLowerCase()
  const chi = p.name_chi.toLowerCase()
  if (en === needle || chi === needle) return 1000
  if (en.startsWith(needle) || chi.startsWith(needle)) return 700
  let score = 0
  for (const token of needle.split(/\s+/).filter(Boolean)) {
    if (chi.includes(token)) score += 200
    else if (en.startsWith(token)) score += 160
    else if (new RegExp(`\\b${escapeRegExp(token)}`).test(en)) score += 110
    else if (en.includes(token)) score += 45
    else if (p.degree.toLowerCase().includes(token)) score += 20
    else return 0
  }
  return score
}

// Faculty-package / general-education prefixes shared by many programmes — they don't
// identify a major, so they never count as a programme's primary subject.
const GENERIC_SUBJECTS = new Set(['ENGG', 'ESTR', 'UGEA', 'UGEB', 'UGEC', 'UGED', 'UGFN', 'UGFH', 'GECC'])
const subjectRankCache = new Map<string, string[]>()

/**
 * The four-letter course-code prefixes that define a programme, ranked: department
 * subjects first (by frequency in `required`, falling back to `all`), with the shared
 * faculty-package generics pushed to the back. So CSCI ranks first for B.Sc. in
 * Computer Science even though its required list also carries ENGG/ESTR.
 */
function subjectRanking(p: Program): string[] {
  const cached = subjectRankCache.get(p.id)
  if (cached) return cached
  const freq = new Map<string, number>()
  for (const code of p.required.length > 0 ? p.required : p.all) {
    const subj = code.slice(0, 4).toUpperCase()
    if (/^[A-Z]{4}$/.test(subj)) freq.set(subj, (freq.get(subj) ?? 0) + 1)
  }
  const ranked = [...freq.entries()]
    .sort((a, b) => {
      const genA = GENERIC_SUBJECTS.has(a[0]) ? 1 : 0
      const genB = GENERIC_SUBJECTS.has(b[0]) ? 1 : 0
      if (genA !== genB) return genA - genB
      return b[1] - a[1]
    })
    .map(([subj]) => subj)
  subjectRankCache.set(p.id, ranked)
  return ranked
}

const canonicalCache = new Map<string, string | null>()

/**
 * A programme's canonical subject: the four-letter code whose official title (from the
 * subjects list) best matches the programme name — so "Computer Science" ⇒ CSCI and
 * "Computer Engineering" ⇒ CENG, which pure course-frequency can't tell apart (both
 * required lists are CSCI-heavy). Falls back to the dominant non-generic required subject
 * when no title matches the name.
 */
export function canonicalSubject(p: Program, subjects: SubjectTitle[]): string | null {
  const cached = canonicalCache.get(p.id)
  if (cached !== undefined) return cached
  let best: string | null = null
  let bestScore = 0
  for (const { code, title } of subjects) {
    if (!title) continue
    const s = nameScore(p, title.toLowerCase())
    if (s > bestScore) {
      bestScore = s
      best = code.toUpperCase()
    }
  }
  const result = best ?? subjectRanking(p)[0] ?? null
  canonicalCache.set(p.id, result)
  return result
}

/**
 * A short all-letters query (C, CS, CSCI) is read as a course-code prefix and matched to
 * the programme's *own* subject, so "CSCI" ⇒ Computer Science (not Computer Engineering,
 * whose required list is also CSCI-heavy) and "C" ⇒ every C-prefixed major.
 */
function subjectScore(p: Program, needle: string, subjects: SubjectTitle[]): number {
  if (!/^[a-z]{1,4}$/.test(needle)) return 0
  const subj = needle.toUpperCase()
  const canon = canonicalSubject(p, subjects)
  if (!canon) return 0
  if (canon === subj) return 950
  if (canon.startsWith(subj)) return 780
  return 0
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---- course-key helpers -------------------------------------------------------

export type CourseScope = {
  /** Include general major-elective courses (default true). */
  electives?: boolean
  /** Include stream / option elective pools (default true). */
  streams?: boolean
}

/**
 * The set of canonical course keys a programme touches, for matching against
 * Course.key. Defaults to required + electives + streams. Pass
 * `{ electives: false, streams: false }` for required-only.
 */
export function programCourseKeys(program: Program, scope: CourseScope = {}): Set<string> {
  const { electives = true, streams = true } = scope
  const codes: string[] = [...program.required]
  if (electives) codes.push(...program.elective)
  if (streams) for (const s of program.streams) codes.push(...s.courses)
  return keySet(codes)
}

/** Just the required course keys (Faculty Package + Required + Foundation picks). */
export function requiredCourseKeys(program: Program): Set<string> {
  return keySet(program.required)
}

/** Every course key referenced anywhere in the programme (the full inventory). */
export function allCourseKeys(program: Program): Set<string> {
  return keySet(program.all)
}

// ---- course standing within a programme ---------------------------------------

/** A course's kind of membership in the chosen programme. */
export type StandingKind = 'required' | 'elective' | 'free'

/** A bilingual label: Chinese gloss + English original. `zh` is '' for a 专名 with no
 *  Chinese gloss (e.g. "Stream 2: …") — render whichever parts are present. */
export type BiLabel = { zh: string; en: string }

/**
 * How a course sits inside a chosen programme. `required`/`elective` carry the
 * requirement-tree section the course sits under (the label the 信息 page shows for
 * that group), bilingually; `free` = 自由选修, the course is not part of this programme.
 */
export type CourseStanding =
  | { kind: 'required'; section: BiLabel }
  | { kind: 'elective'; section: BiLabel }
  | { kind: 'free' }

/** Bilingual label per standing kind — shared by the 选课 cards and the detail popup. */
export const STANDING_LABEL: Record<StandingKind, BiLabel> = {
  required: { zh: '必修', en: 'Required' },
  elective: { zh: '选修', en: 'Elective' },
  free: { zh: '自由选修', en: 'Free Elective' },
}

// Same light gloss the 信息 page (ProgramTable) applies to section titles, so a card's
// classification reads identically to that page. 专名 (Stream N: … / General …) ride
// through as English-only; a "Choose any ONE…" wrapper collapses to 任选其一.
const SECTION_GLOSS: Record<string, string> = {
  'Faculty Package': '学院基础包',
  'Foundation Courses': '基础课程',
  'Required Courses': '必修课程',
  'Research Component Courses': '研究/毕业项目',
  'Elective Courses': '选修课程',
  'Elective Course 1': '选修组一',
  'Elective Course 2': '选修组二',
}

export function glossSection(title: string): BiLabel {
  if (!title) return { zh: '', en: '' }
  if (SECTION_GLOSS[title]) return { zh: SECTION_GLOSS[title], en: title }
  if (title.includes('Choose any ONE')) return { zh: '任选其一', en: title }
  return { zh: '', en: title }
}

/**
 * Classify every course a programme references by its standing — 必修 (required) vs
 * 选修 (major-elective / stream) — tagged with the requirement-tree section it sits
 * under (nearest titled ancestor, glossed like the 信息 page). Courses absent from the
 * returned map are 自由选修 (free elective) for this programme. Keyed by course key,
 * so it matches Course.key (and a stream's ESTR alternatives) directly.
 */
export function classifyPrograms(program: Program): Map<string, CourseStanding> {
  const required = requiredCourseKeys(program)
  const map = new Map<string, CourseStanding>()

  const record = (rawKey: string, section: string): void => {
    const key = courseKey(rawKey)
    const kind: StandingKind = required.has(key) ? 'required' : 'elective'
    const prev = map.get(key)
    // 必修 wins over 选修; otherwise the first (outermost) section label sticks.
    if (!prev || (kind === 'required' && prev.kind !== 'required')) {
      map.set(key, { kind, section: glossSection(section) })
    }
  }

  const visit = (node: SectionNode, inheritedTitle: string): void => {
    const section = node.title || inheritedTitle
    for (const course of node.courses) {
      record(course.code, section)
      for (const alt of course.alts) record(alt, section)
    }
    for (const child of node.children) visit(child, section)
  }
  for (const node of program.structure) visit(node, node.title)

  // prose-only programmes (no structured tree): fall back to the flat lists.
  if (program.structure.length === 0) {
    for (const key of required) {
      map.set(key, { kind: 'required', section: { zh: '必修课程', en: 'Required Courses' } })
    }
    for (const key of programCourseKeys(program)) {
      if (!map.has(key)) map.set(key, { kind: 'elective', section: { zh: '选修课程', en: 'Elective Courses' } })
    }
  }
  return map
}
