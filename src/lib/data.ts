import { parseCode } from './courseKey.ts'
import { EMPTY_REQUIREMENT } from './types.ts'
import type { Course, DataManifest, RawCourse, Section, TermBundle, YearIndex } from './types.ts'

const BASE = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`

function dataUrl(path: string, version?: string): string {
  const url = `${BASE}data/${path}`
  return version ? `${url}?v=${encodeURIComponent(version)}` : url
}

async function fetchJson<T>(path: string, version?: string): Promise<T> {
  const response = await fetch(dataUrl(path, version))
  if (!response.ok) throw new Error(`加载失败：${path}`)
  return (await response.json()) as T
}

// manifest.json is tiny (a few dozen bytes) and is the one file fetched with
// `cache: 'no-cache'` so the browser always revalidates it. Its `generatedAt` is
// the data version: every other data request appends it as `?v=`, so a fresh
// build's URLs change and old cached responses are never reused. Memoized so a
// page load only pays for one manifest round-trip no matter how many callers
// need the version.
let manifestPromise: Promise<DataManifest> | null = null

function fetchManifest(): Promise<DataManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(dataUrl('manifest.json'), { cache: 'no-cache' }).then((response) => {
      if (!response.ok) throw new Error('加载失败：manifest.json')
      return response.json() as Promise<DataManifest>
    })
  }
  return manifestPromise
}

function toSection(raw: RawCourse['x'][number]): Section {
  const meetings = raw.m.map((meeting) => ({
    dayIndex: meeting.d,
    start: meeting.s,
    end: meeting.e,
    location: meeting.l,
  }))
  return {
    id: raw.id,
    cohort: raw.co,
    group: raw.gp,
    component: raw.cp,
    meetings,
    instructors: raw.in,
    status: raw.st,
    isTba: meetings.length === 0,
  }
}

// requirements.ts's parser already ran at bundle-build time (scripts/build_bundles.mts):
// every course's `req` field is the finished Requirement AST. toCourse only
// deserializes — no parsing on the load path (previously a measured 1772ms for
// 6089 courses).
function toCourse(raw: RawCourse): Course {
  const sections = raw.x.map(toSection)
  const components: string[] = []
  for (const section of sections) {
    if (!components.includes(section.component)) components.push(section.component)
  }
  const instructors = [...new Set(sections.flatMap((section) => section.instructors))]
  const identity = parseCode(raw.c)
  return {
    code: raw.c,
    key: identity.key,
    subject: raw.sj || identity.subject,
    number: identity.number,
    suffix: identity.suffix,
    level: identity.level,
    title: raw.t,
    units: raw.u,
    career: raw.cr,
    department: raw.gr,
    requirement: raw.req ?? EMPTY_REQUIREMENT,
    sections,
    components,
    searchText: `${raw.c} ${raw.t} ${instructors.join(' ')} ${raw.gr}`.toLowerCase(),
  }
}

export type SubjectInfo = { code: string; title: string }

export async function loadSubjects(year: string): Promise<SubjectInfo[]> {
  const manifest = await fetchManifest()
  const payload = await fetchJson<{ subjects: SubjectInfo[] }>(`${year}/subjects.json`, manifest.generatedAt)
  return payload.subjects
}

export type TermRef = { year: string; slug: string; name: string; courseCount: number }

export async function loadTermList(): Promise<TermRef[]> {
  const manifest = await fetchManifest()
  const indexes = await Promise.all(
    manifest.years.map((year) => fetchJson<YearIndex>(`${year}/index.json`, manifest.generatedAt)),
  )
  return indexes.flatMap((index) =>
    index.terms.map((term) => ({
      year: index.year,
      slug: term.slug,
      name: term.name,
      courseCount: term.courseCount,
    })),
  )
}

export async function loadTerm(term: TermRef): Promise<Course[]> {
  const manifest = await fetchManifest()
  const bundle = await fetchJson<TermBundle>(`${term.year}/${term.slug}.json`, manifest.generatedAt)
  return bundle.courses.map((raw) => toCourse(raw))
}

/** One course as offered in one term. A course offered in both terms yields two offerings. */
export type Offering = {
  course: Course
  termSlug: string
  termName: string
  /** 1 = 上学期 (Term 1), 2 = 下学期 (Term 2). */
  termOrder: number
}

const MAIN_TERM_RE = /Term\s+([12])\b/

/**
 * Loads every main term (Term 1 and Term 2) of one academic year at once. The course
 * list view compares 上学期 against 下学期 side by side, so it needs both bundles,
 * not the single active term the planner schedules within.
 */
export async function loadYearOfferings(year: string): Promise<Offering[]> {
  const manifest = await fetchManifest()
  const index = await fetchJson<YearIndex>(`${year}/index.json`, manifest.generatedAt)
  const mains = index.terms
    .map((term) => ({ ...term, order: Number(term.name.match(MAIN_TERM_RE)?.[1] ?? 0) }))
    .filter((term) => term.order > 0)
    .sort((a, b) => a.order - b.order)

  const bundles = await Promise.all(
    mains.map((term) => fetchJson<TermBundle>(`${year}/${term.slug}.json`, manifest.generatedAt)),
  )

  return bundles.flatMap((bundle, index) =>
    bundle.courses.map((raw) => ({
      course: toCourse(raw),
      termSlug: mains[index].slug,
      termName: mains[index].name,
      termOrder: mains[index].order,
    })),
  )
}
