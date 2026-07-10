/** Shapes emitted by scripts/build_term_bundles.py. Keys are short to keep the payload small. */
export type RawMeeting = { d: number; s: number; e: number; l: string }
export type RawSection = {
  id: string
  co: string
  gp: string
  cp: string
  m: RawMeeting[]
  in: string[]
  st: string
}
export type RawCourse = {
  c: string
  sj: string
  t: string
  u: number
  cr: string
  gr: string
  rq: string
  x: RawSection[]
}
export type TermBundle = { term: string; termCode: string; courses: RawCourse[] }
export type YearIndex = {
  year: string
  terms: Array<{ name: string; slug: string; courseCount: number }>
}
export type DataManifest = { years: string[] }

/** Runtime shapes. */
export type Meeting = { dayIndex: number; start: number; end: number; location: string }

export type Section = {
  id: string
  /** Cohort letter shared across components, e.g. `A` in `A-LEC` / `AE01-EXR`. Empty = matches all. */
  cohort: string
  /** Group token within a component, e.g. `T01`. */
  group: string
  component: string
  meetings: Meeting[]
  instructors: string[]
  status: string
  /** True when the section has no timed meeting at all. */
  isTba: boolean
}

export type Course = {
  code: string
  subject: string
  title: string
  units: number
  career: string
  academicGroup: string
  requirement: string
  sections: Section[]
  /** Components present on this course, in a stable order. */
  components: string[]
  searchText: string
}
