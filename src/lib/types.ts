/**
 * The course schema. Two layers:
 *
 *   Raw*      — the compact wire format emitted by scripts/build_bundles.mts.
 *               Short keys, one term per file, kept small for transfer. Every
 *               course also carries a pre-parsed `req` (the structured Requirement
 *               AST, built at bundle time from `rq` by the same parser in
 *               requirements.ts) so the client never re-parses free text — see
 *               `req` below. Courses whose `rq` is empty omit `req`; the runtime
 *               falls back to EMPTY_REQUIREMENT.
 *   Course    — the runtime model the app programs against. Every field is named,
 *               the code is parsed into its parts, and the enrollment requirement
 *               is a structured value, not free text.
 *
 * data.ts is the only place that turns Raw* into Course.
 */

// ---- wire format --------------------------------------------------------------

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
  /** Pre-parsed `rq`, built at bundle time. Absent when `rq` is empty — the
   * runtime falls back to EMPTY_REQUIREMENT rather than re-parsing. */
  req?: Requirement
}
export type TermBundle = { term: string; termCode: string; courses: RawCourse[] }
export type YearIndex = {
  year: string
  terms: Array<{ name: string; slug: string; courseCount: number }>
}
/** `generatedAt` is the data version: an ISO-UTC build timestamp. The client
 * appends it as a `?v=` query parameter to every other data request so a fresh
 * build's URLs change and stale browser caches are bypassed automatically. */
export type DataManifest = { years: string[]; generatedAt: string }

// ---- scheduling ---------------------------------------------------------------

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

// ---- enrollment requirement (structured) --------------------------------------

/** A boolean expression over course keys, parsed from the free-text requirement. */
export type ReqNode =
  | { t: 'code'; code: string }
  | { t: 'soft' } // exemption / consent / grade — unverifiable, evaluates to maybe
  | { t: 'and'; kids: ReqNode[] }
  | { t: 'or'; kids: ReqNode[] }
  | { t: 'unknown' } // an unparsed fragment — maybe, never a hard no

export type Requirement = {
  /** Original text, kept for display and audit. */
  raw: string
  /** Prerequisite boolean expression, or null when none was stated. */
  prerequisite: ReqNode | null
  /** Corequisite expression (may be taken concurrently). */
  corequisite: ReqNode | null
  /** Course keys that bar enrolment once taken ("Not for students who have taken …"). */
  exclusions: string[]
  /** Cleaned prerequisite / corequisite text, for hover display. */
  prereqText: string
  coreqText: string
}

export const EMPTY_REQUIREMENT: Requirement = {
  raw: '',
  prerequisite: null,
  corequisite: null,
  exclusions: [],
  prereqText: '',
  coreqText: '',
}

export type RequirementStatus = 'none' | 'met' | 'missing' | 'unverifiable'

// ---- course -------------------------------------------------------------------

export type Course = {
  // identity — see courseKey.ts
  /** Full code including any variant suffix: "CSCI2100", "ENGG1000A". */
  code: string
  /** Canonical eight-character key used for all matching: "CSCI2100". */
  key: string
  /** Four subject letters: "CSCI". */
  subject: string
  /** Four-digit catalog number: "2100". */
  number: string
  /** Variant suffix, usually empty: "A". */
  suffix: string
  /** Leading digit of the number — the course level (1-9). */
  level: number

  // descriptive
  title: string
  units: number
  career: string
  department: string

  // structured requirement
  requirement: Requirement

  // scheduling
  sections: Section[]
  /** Components present on this course, in a stable order. */
  components: string[]

  searchText: string
}
