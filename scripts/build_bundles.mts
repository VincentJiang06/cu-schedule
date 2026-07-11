#!/usr/bin/env -S npx tsx
/**
 * Build every compact bundle the web app fetches: per-term course bundles and the
 * program bundle. Single TypeScript build step (run with tsx), replacing what used
 * to be two Python scripts (build_term_bundles.py, build_program_bundle.py).
 *
 * Why TS and not Python: the wire format now carries a pre-parsed `req` field (the
 * structured Requirement AST) on every course, produced by the exact same parser
 * (src/lib/requirements.ts) the client used to run at load time. Re-implementing
 * that parser in Python would fork the two languages' behavior — the one thing the
 * architecture review flagged as unacceptable. Doing the parse here means the
 * client's `toCourse` becomes a pure deserialize (see src/lib/data.ts), cutting the
 * measured 1772ms load-time parse of 6089 courses down to a JSON walk.
 *
 * Inputs:
 *   data/raw/courses/<year>/<SUBJ>.json   rich per-subject scrape (build_term_bundles.py's old input)
 *   data/programs/<year>/<Faculty>/*.json parsed per-program files (scripts/parse_programs.py's output)
 *
 * Outputs (canonical, under data/):
 *   data/courses/manifest.json
 *   data/courses/<year>/{<term-slug>.json, index.json, subjects.json}
 *   data/programs/programs.json
 *
 * Then the whole data/courses tree + data/programs/programs.json is mirrored,
 * as a single step owned only by this script, into public/data/ (the directory the
 * current static frontend fetches from; a future API would read data/ directly).
 *
 * Usage:
 *   npx tsx scripts/build_bundles.mts             # every course year + the program bundle
 *   npx tsx scripts/build_bundles.mts 2026-27      # one course year (still rebuilds programs + mirror)
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { parseCode } from '../src/lib/courseKey.ts'
import { parseRequirement } from '../src/lib/requirements.ts'
import type { DataManifest, RawCourse, RawMeeting, RawSection, TermBundle, YearIndex } from '../src/lib/types.ts'

const RAW_COURSES_DIR = path.join('data', 'raw', 'courses')
// Canonical processed course/program data lives under data/; public/data is a
// generated mirror the current static frontend fetches (the future API reads
// data/ directly).
const COURSES_OUT_DIR = path.join('data', 'courses')
const PROGRAMS_DIR = path.join('data', 'programs')
const PROGRAMS_OUT_FILE = path.join(PROGRAMS_DIR, 'programs.json')
const MIRROR_DIR = path.join('public', 'data')

// ============================================================================
// Term bundles (ported from scripts/build_term_bundles.py)
// ============================================================================

// "Th 1:30PM - 2:15PM"
const TIME_RE =
  /^(Mo|Tu|We|Th|Fr|Sa|Su)\s+(\d{1,2}):(\d{2})(AM|PM)\s*-\s*(\d{1,2}):(\d{2})(AM|PM)$/
const DAY_INDEX: Record<string, number> = { Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6, Su: 7 }

// "AT01-TUT (1234)" -> cohort "A", group "T01", component "TUT", class number 1234.
// A leading "-" means the section carries no cohort letter ("--LEC", "-T01-TUT").
const SECTION_RE = /^(.*)-([A-Z]{3})\s*\((\d+)\)$/
const GROUP_RE = /^([A-Z]*?)([A-Z]\d+)?$/

const TERM_NAME_RE = /^(\d{4}-\d{2})\s+(.+)$/

// Terms are listed in the order a student meets them, not alphabetically, so the
// app's default selection lands on Term 1 rather than "Acad Year (Medicine)".
const TERM_ORDER = ['Term 1', 'Term 2', 'Summer Session']

function termRank(name: string): [string, number, string] {
  const match = TERM_NAME_RE.exec(name)
  const year = match ? match[1] : ''
  const suffix = match ? match[2] : name
  const idx = TERM_ORDER.indexOf(suffix)
  return [year, idx === -1 ? TERM_ORDER.length : idx, suffix]
}

function compareTermRank(a: string, b: string): number {
  const [ay, ai, as_] = termRank(a)
  const [by, bi, bs] = termRank(b)
  if (ay !== by) return ay < by ? -1 : 1
  if (ai !== bi) return ai - bi
  return as_ < bs ? -1 : as_ > bs ? 1 : 0
}

function toMinutes(hourStr: string, minuteStr: string, meridiem: string): number {
  let value = Number(hourStr) % 12
  if (meridiem === 'PM') value += 12
  return value * 60 + Number(minuteStr)
}

function parseTime(raw: string): { d: number; s: number; e: number } | null {
  const match = TIME_RE.exec((raw || '').trim())
  if (!match) return null
  const [, day, sh, sm, sap, eh, em, eap] = match
  const start = toMinutes(sh, sm, sap)
  const end = toMinutes(eh, em, eap)
  if (end <= start) return null
  return { d: DAY_INDEX[day], s: start, e: end }
}

type ParsedSection = { cohort: string; group: string; component: string; classNo: number }

function parseSection(raw: string): ParsedSection | null {
  const match = SECTION_RE.exec((raw || '').trim())
  if (!match) return null
  const prefix = match[1].replace(/^-+/, '')
  const groupMatch = GROUP_RE.exec(prefix)
  let cohort: string
  let group: string
  if (!groupMatch) {
    // Unexpected shape; treat the whole prefix as a cohort so nothing silently merges.
    cohort = prefix
    group = ''
  } else {
    cohort = groupMatch[1] || ''
    group = groupMatch[2] || ''
  }
  return { cohort, group, component: match[2], classNo: Number(match[3]) }
}

function normalizeUnits(raw: unknown): number {
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

type RawScrapedMeeting = { instructor?: string; time?: string; location?: string }
type RawScrapedSchedule = {
  section?: string
  meetings?: RawScrapedMeeting[]
  availability?: { status?: string }
}
type RawScrapedTerm = { term_code?: string; term_name?: string; schedule?: RawScrapedSchedule[] }
type RawScrapedCourse = {
  subject: string
  course_code: string
  title?: string
  credits?: string
  academic_career?: string
  academic_group?: string
  enrollment_requirement?: string
  terms?: RawScrapedTerm[]
}
type RawScrapedFile = { metadata?: { subject?: string; subject_title?: string }; courses?: RawScrapedCourse[] }

/** Builds one wire-format course entry for one term of one scraped course; null if
 * every section on it fails to parse (nothing schedulable to show). */
function buildCourse(course: RawScrapedCourse, term: RawScrapedTerm): RawCourse | null {
  const sections: RawSection[] = []
  for (const entry of term.schedule ?? []) {
    const parsed = parseSection(entry.section ?? '')
    if (!parsed) continue

    const meetings: RawMeeting[] = []
    const seen = new Set<string>()
    const instructors: string[] = []
    for (const meeting of entry.meetings ?? []) {
      const instructor = (meeting.instructor ?? '').trim()
      if (instructor && !instructors.includes(instructor)) instructors.push(instructor)

      const slot = parseTime(meeting.time ?? '')
      if (!slot) continue
      // The catalog repeats one weekly slot once per date range; collapse them.
      const key = `${slot.d}|${slot.s}|${slot.e}|${meeting.location ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      meetings.push({ ...slot, l: (meeting.location ?? '').trim() })
    }

    const availability = entry.availability ?? {}
    sections.push({
      id: String(parsed.classNo),
      co: parsed.cohort,
      gp: parsed.group,
      cp: parsed.component,
      m: meetings,
      in: instructors,
      st: (availability.status ?? '').trim(),
    })
  }

  if (sections.length === 0) return null

  return {
    c: `${course.subject}${course.course_code}`,
    sj: course.subject,
    t: (course.title ?? '').trim(),
    u: normalizeUnits(course.credits),
    cr: (course.academic_career ?? '').trim(),
    gr: (course.academic_group ?? '').trim(),
    rq: (course.enrollment_requirement ?? '').trim(),
    x: sections,
  }
}

function writeCompactJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data) + '\n', 'utf8')
}

function writePrettyJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

type TermSizeReport = { year: string; name: string; slug: string; courseCount: number; bytes: number }

function buildYear(yearName: string): TermSizeReport[] {
  const yearDir = path.join(RAW_COURSES_DIR, yearName)
  const byTerm = new Map<string, RawCourse[]>()
  const termCodes = new Map<string, string>()
  const subjectTitles = new Map<string, string>()

  const subjectFiles = fs
    .readdirSync(yearDir)
    .filter((f) => f.endsWith('.json'))
    .sort()

  for (const file of subjectFiles) {
    const payload: RawScrapedFile = JSON.parse(fs.readFileSync(path.join(yearDir, file), 'utf8'))
    const meta = payload.metadata ?? {}
    if (meta.subject) subjectTitles.set(meta.subject, (meta.subject_title ?? '').trim())
    for (const course of payload.courses ?? []) {
      for (const term of course.terms ?? []) {
        const name = (term.term_name ?? '').trim()
        if (!TERM_NAME_RE.test(name)) continue
        const built = buildCourse(course, term)
        if (built) {
          if (!byTerm.has(name)) byTerm.set(name, [])
          byTerm.get(name)!.push(built)
          termCodes.set(name, term.term_code ?? '')
        }
      }
    }
  }

  // Pre-parse requirements once knownKeys spans every course offered anywhere in
  // this academic year (all term bundles, not just the two main terms) — a
  // prerequisite can cite a course only offered in Summer Session or the Medicine
  // academic-year bundle. Build order matters: collect every key first, then parse.
  const knownKeys = new Set<string>()
  for (const courses of byTerm.values()) {
    for (const c of courses) knownKeys.add(parseCode(c.c).key)
  }
  for (const courses of byTerm.values()) {
    for (const c of courses) {
      if (c.rq) c.req = parseRequirement(c.rq, knownKeys)
    }
  }

  const outYear = path.join(COURSES_OUT_DIR, yearName)
  fs.mkdirSync(outYear, { recursive: true })

  const termNames = [...byTerm.keys()].sort(compareTermRank)
  const termsMeta: YearIndex['terms'] = []
  const sizeReport: TermSizeReport[] = []

  for (const name of termNames) {
    const courses = byTerm.get(name)!.sort((a, b) => (a.c < b.c ? -1 : a.c > b.c ? 1 : 0))
    const slug = name.toLowerCase().replaceAll(' ', '-').replaceAll('(', '').replaceAll(')', '')
    const target = path.join(outYear, `${slug}.json`)
    const bundle: TermBundle = { term: name, termCode: termCodes.get(name) ?? '', courses }
    writeCompactJson(target, bundle)
    const bytes = fs.statSync(target).size
    termsMeta.push({ name, slug, courseCount: courses.length })
    sizeReport.push({ year: yearName, name, slug, courseCount: courses.length, bytes })
    console.log(`  ${name.padEnd(34)} ${String(courses.length).padStart(5)} courses  ${(bytes / 1e6).toFixed(2).padStart(5)} MB  -> ${target}`)
  }

  writePrettyJson(path.join(outYear, 'index.json'), { year: yearName, terms: termsMeta })

  const subjects = [...subjectTitles.keys()]
    .sort()
    .map((code) => ({ code, title: subjectTitles.get(code) ?? '' }))
  writePrettyJson(path.join(outYear, 'subjects.json'), { subjects })

  return sizeReport
}

// ============================================================================
// Program bundle (ported from scripts/build_program_bundle.py)
//
// Reads the per-program files directly (data/programs/<year>/<Faculty>/*.json) —
// NOT the merged data/programs/all_programs.json array, which used to be a second,
// always-in-sync-by-hand copy of the exact same data (P1-7 in the architecture
// review). parse_programs.py no longer writes that file.
// ============================================================================

const PROGRAM_YEARS = ['2023', '2024', '2025']

type ProgramCourseRef = { codes?: string[] }
type ProgramStreamBucket = { stream?: string; from?: string; courses?: ProgramCourseRef[] }

// The faithful hierarchical rebuild of the Major Programme Requirement produced by
// scripts/parse_programs.py's build_structure(). Passed through verbatim so the
// frontend can render the scheme's numbered / lettered / prose layers as printed.
type ProgramCourse = { code: string; alts: string[] }
type SectionNode = {
  marker: string
  title: string
  units: number | null
  note: string | null
  courses: ProgramCourse[]
  children: SectionNode[]
  /** Set on the top node of an optional post-total segment: 'concentration' for a
   * "Concentration Area:" block, 'stream' for a "Streams:" block; absent on every other
   * node. Passed through verbatim. */
  kind?: 'concentration' | 'stream'
}

type ProgramFile = {
  program_en: string
  program_chi: string
  admission_year: string
  faculty: string
  degree?: string
  total_units?: number | null
  parse_status?: string
  all_course_codes?: string[]
  buckets: {
    required?: ProgramCourseRef[]
    elective?: ProgramCourseRef[]
    stream_elective?: ProgramStreamBucket[]
  }
  structure?: SectionNode[]
}

type BuiltProgram = {
  id: string
  year: string
  name_en: string
  name_chi: string
  faculty: string
  degree: string
  total_units: number | null
  parse_status: string
  required: string[]
  elective: string[]
  streams: Array<{ name: string; courses: string[] }>
  all: string[]
  structure: SectionNode[]
  faculties?: string[]
}

/** Union of every course code in a bucket, first-seen order, de-duplicated. */
function flatCodes(bucketItems: ProgramCourseRef[]): string[] {
  const seen: string[] = []
  const have = new Set<string>()
  for (const item of bucketItems) {
    for (const code of item.codes ?? []) {
      if (!have.has(code)) {
        have.add(code)
        seen.push(code)
      }
    }
  }
  return seen
}

function buildProgram(p: ProgramFile): BuiltProgram {
  const b = p.buckets
  const streams = (b.stream_elective ?? []).map((se) => ({
    name: se.stream || se.from || 'Stream',
    courses: flatCodes(se.courses ?? []),
  }))
  return {
    id: `${p.admission_year}:${p.program_en}`,
    year: p.admission_year,
    name_en: p.program_en,
    name_chi: p.program_chi,
    faculty: p.faculty,
    degree: p.degree ?? '',
    total_units: p.total_units ?? null,
    parse_status: p.parse_status ?? 'unknown',
    required: flatCodes(b.required ?? []),
    elective: flatCodes(b.elective ?? []),
    streams,
    all: p.all_course_codes ?? [],
    structure: p.structure ?? [],
  }
}

/** Prefer the listing with the most content when de-duplicating cross-listings. */
function richnessCompare(a: BuiltProgram, b: BuiltProgram): number {
  if (a.all.length !== b.all.length) return a.all.length - b.all.length
  return a.required.length + a.elective.length - (b.required.length + b.elective.length)
}

function listProgramFiles(): string[] {
  const files: string[] = []
  for (const year of PROGRAM_YEARS) {
    const yearDir = path.join(PROGRAMS_DIR, year)
    if (!fs.existsSync(yearDir) || !fs.statSync(yearDir).isDirectory()) continue
    for (const faculty of fs.readdirSync(yearDir).sort()) {
      const facultyDir = path.join(yearDir, faculty)
      if (!fs.statSync(facultyDir).isDirectory()) continue
      for (const file of fs.readdirSync(facultyDir).sort()) {
        if (file.endsWith('.json')) files.push(path.join(facultyDir, file))
      }
    }
  }
  return files
}

function buildProgramsBundle(): {
  generated_from: string
  source_page: string
  academic_career: string
  study_mode: string
  years: string[]
  program_count: number
  programs: BuiltProgram[]
} {
  const files = listProgramFiles()
  // De-duplicate by (year, name_en) — cross-listed programmes appear under several
  // faculties; keep the richest listing.
  const best = new Map<string, BuiltProgram>()
  const faculties = new Map<string, Set<string>>()

  for (const file of files) {
    const rec: ProgramFile = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!PROGRAM_YEARS.includes(rec.admission_year)) continue // defensive; dir scan is already scoped
    const prog = buildProgram(rec)
    const key = `${prog.year} ${prog.name_en}`
    if (!faculties.has(key)) faculties.set(key, new Set())
    faculties.get(key)!.add(prog.faculty)
    const existing = best.get(key)
    if (!existing || richnessCompare(prog, existing) > 0) best.set(key, prog)
  }

  const programs = [...best.entries()].map(([key, prog]) => ({
    ...prog,
    faculties: [...faculties.get(key)!].sort(),
  }))
  programs.sort((a, b) => {
    if (a.year !== b.year) return a.year < b.year ? -1 : 1
    if (a.faculty !== b.faculty) return a.faculty < b.faculty ? -1 : 1
    return a.name_en < b.name_en ? -1 : a.name_en > b.name_en ? 1 : 0
  })

  return {
    generated_from: 'data/programs/<year>/<Faculty>/*.json',
    source_page: 'tt_dsp_acad_prog.aspx',
    academic_career: 'UG',
    study_mode: 'Full-time',
    years: [...PROGRAM_YEARS],
    program_count: programs.length,
    programs,
  }
}

// ============================================================================
// Mirror + size reporting
// ============================================================================

function mirrorToPublic(): void {
  fs.rmSync(MIRROR_DIR, { recursive: true, force: true })
  fs.mkdirSync(MIRROR_DIR, { recursive: true })
  fs.cpSync(COURSES_OUT_DIR, MIRROR_DIR, { recursive: true })
  fs.copyFileSync(PROGRAMS_OUT_FILE, path.join(MIRROR_DIR, 'programs.json'))
  console.log(`  mirrored -> ${MIRROR_DIR}`)
}

function gzipSize(filePath: string): number {
  return zlib.gzipSync(fs.readFileSync(filePath)).length
}

// ============================================================================
// main
// ============================================================================

function main(): number {
  if (!fs.existsSync(RAW_COURSES_DIR) || !fs.statSync(RAW_COURSES_DIR).isDirectory()) {
    console.error(`missing ${RAW_COURSES_DIR}/ — run the scraper first`)
    return 1
  }

  const requested = process.argv.slice(2)
  const yearNames = requested.length > 0
    ? requested
    : fs
        .readdirSync(RAW_COURSES_DIR)
        .filter((name) => /^\d{4}-\d{2}$/.test(name) && fs.statSync(path.join(RAW_COURSES_DIR, name)).isDirectory())
        .sort()

  if (yearNames.length === 0) {
    console.error('no year directories to build')
    return 1
  }

  // Snapshot old term-bundle sizes before we overwrite them, for the before/after report.
  const before = new Map<string, { raw: number; gz: number }>()
  for (const yearName of yearNames) {
    const yearDir = path.join(COURSES_OUT_DIR, yearName)
    if (!fs.existsSync(yearDir)) continue
    for (const file of fs.readdirSync(yearDir)) {
      if (file === 'index.json' || file === 'subjects.json') continue
      const full = path.join(yearDir, file)
      before.set(full, { raw: fs.statSync(full).size, gz: gzipSize(full) })
    }
  }

  const manifestYears: string[] = []
  const allSizeReports: TermSizeReport[] = []
  for (const yearName of yearNames) {
    const yearDir = path.join(RAW_COURSES_DIR, yearName)
    if (!fs.existsSync(yearDir) || !fs.statSync(yearDir).isDirectory()) {
      console.error(`missing ${yearDir}`)
      return 1
    }
    console.log(`${yearName}:`)
    allSizeReports.push(...buildYear(yearName))
    manifestYears.push(yearName)
  }

  fs.mkdirSync(COURSES_OUT_DIR, { recursive: true })
  const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const manifest: DataManifest = { years: [...manifestYears].sort().reverse(), generatedAt }
  writePrettyJson(path.join(COURSES_OUT_DIR, 'manifest.json'), manifest)

  console.log('\nprogram bundle:')
  const programsBundle = buildProgramsBundle()
  fs.mkdirSync(path.dirname(PROGRAMS_OUT_FILE), { recursive: true })
  writeCompactJson(PROGRAMS_OUT_FILE, programsBundle)
  const progSize = fs.statSync(PROGRAMS_OUT_FILE).size
  const byYear = new Map<string, number>()
  for (const p of programsBundle.programs) byYear.set(p.year, (byYear.get(p.year) ?? 0) + 1)
  console.log(`  wrote ${programsBundle.programs.length} programmes -> ${PROGRAMS_OUT_FILE} (${(progSize / 1024).toFixed(0)} KB)`)
  console.log(`  per year: ${JSON.stringify(Object.fromEntries(byYear))}`)

  mirrorToPublic()

  console.log('\nterm bundle size report (raw / gzip, before -> after):')
  for (const report of allSizeReports) {
    const full = path.join(COURSES_OUT_DIR, report.year, `${report.slug}.json`)
    const prev = before.get(full)
    const afterGz = gzipSize(full)
    const fmt = (n: number) => `${(n / 1024).toFixed(1)} KB`
    if (prev) {
      console.log(
        `  ${report.year}/${report.slug}: raw ${fmt(prev.raw)} -> ${fmt(report.bytes)} · gzip ${fmt(prev.gz)} -> ${fmt(afterGz)}`,
      )
    } else {
      console.log(`  ${report.year}/${report.slug}: raw ${fmt(report.bytes)} · gzip ${fmt(afterGz)} (new)`)
    }
  }

  return 0
}

process.exit(main())
