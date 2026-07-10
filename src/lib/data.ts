import type { Course, DataManifest, RawCourse, Section, TermBundle, YearIndex } from './types.ts'

const BASE = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`

function dataUrl(path: string): string {
  return `${BASE}data/${path}`
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(dataUrl(path))
  if (!response.ok) throw new Error(`加载失败：${path}`)
  return (await response.json()) as T
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

function toCourse(raw: RawCourse): Course {
  const sections = raw.x.map(toSection)
  const components: string[] = []
  for (const section of sections) {
    if (!components.includes(section.component)) components.push(section.component)
  }
  const instructors = [...new Set(sections.flatMap((section) => section.instructors))]
  return {
    code: raw.c,
    subject: raw.sj,
    title: raw.t,
    units: raw.u,
    career: raw.cr,
    academicGroup: raw.gr,
    requirement: raw.rq,
    sections,
    components,
    searchText: `${raw.c} ${raw.t} ${instructors.join(' ')} ${raw.gr}`.toLowerCase(),
  }
}

export type TermRef = { year: string; slug: string; name: string; courseCount: number }

export async function loadTermList(): Promise<TermRef[]> {
  const manifest = await fetchJson<DataManifest>('manifest.json')
  const indexes = await Promise.all(
    manifest.years.map((year) => fetchJson<YearIndex>(`${year}/index.json`)),
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
  const bundle = await fetchJson<TermBundle>(`${term.year}/${term.slug}.json`)
  return bundle.courses.map(toCourse)
}
