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
import { keySet } from './courseKey.ts'

const BASE = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`

// ---- wire format (mirrors programs.json) --------------------------------------

export type ProgramStream = {
  /** Stream / option label, e.g. "Stream 1: Embedded Systems". */
  name: string
  /** Course codes in this stream's elective pool (course/ESTR alternatives both listed). */
  courses: string[]
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
}

export type ProgramBundle = {
  years: string[]
  program_count: number
  programs: Program[]
}

// ---- loading ------------------------------------------------------------------

let cache: Promise<Program[]> | null = null

/** Loads and caches the programme bundle (single fetch for the app's lifetime). */
export function loadPrograms(): Promise<Program[]> {
  if (!cache) {
    cache = fetch(`${BASE}data/programs.json`)
      .then((res) => {
        if (!res.ok) throw new Error('加载专业数据失败：programs.json')
        return res.json() as Promise<ProgramBundle>
      })
      .then((bundle) => bundle.programs)
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
export function searchPrograms(
  programs: Program[],
  query: string,
  opts: { year?: string; limit?: number } = {},
): Program[] {
  const pool = opts.year ? programs.filter((p) => p.year === opts.year) : programs
  const needle = query.trim().toLowerCase()
  if (!needle) return pool.slice(0, opts.limit ?? 8)
  return pool
    .map((p) => ({ p, score: scoreProgram(p, needle) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.p.name_en.localeCompare(b.p.name_en))
    .slice(0, opts.limit ?? 8)
    .map((e) => e.p)
}

function scoreProgram(p: Program, needle: string): number {
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
