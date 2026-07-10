import type { Offering } from './data.ts'
import type { Course } from './types.ts'

/**
 * The catalog list is arranged the way a student reads a subject ladder, not by a
 * single global sort. The order is:
 *
 *   1. subject (the four letters), alphabetical
 *   2. leading digit of the catalog number: 1-level, then 2-level, then 3-level…
 *   3. term: 上学期 (Term 1) before 下学期 (Term 2)
 *
 * Only within one (subject, leading digit, term) row are courses sorted by number.
 * Because term outranks the number, reading top to bottom is deliberately NOT
 * monotonic — a 1-level Term-2 row can sit above a 1-level number that was higher
 * but offered in Term 1.
 */

// The example the ordering was specified against shows within-row ascending
// (1050 before 1060). Flip to 'desc' to honor the literal "从大到小" wording.
const WITHIN_ROW: 'asc' | 'desc' = 'asc'

export type ListFilters = {
  /** Four-letter subject codes; a course matches if its subject is one of these. Empty = all. */
  subjects: string[]
  /** Leading digits (1-9); a course matches if its leading digit is in the set. Empty = all. */
  digits: number[]
  /** Substring matched against title and code. Empty = all. */
  name: string
}

export const EMPTY_FILTERS: ListFilters = { subjects: [], digits: [], name: '' }

export type ListRow = {
  subject: string
  digit: number
  termName: string
  termOrder: number
  courses: Course[]
}

export function leadingDigit(course: Course): number {
  return Number(course.code.slice(4, 5)) || 0
}

function catalogNumber(course: Course): number {
  return Number(course.code.slice(4)) || 0
}

/** All conditions are ANDed: subject AND leading-digit AND name must each match. */
function matches(course: Course, filters: ListFilters): boolean {
  if (filters.subjects.length > 0 && !filters.subjects.includes(course.subject)) return false
  if (filters.digits.length > 0 && !filters.digits.includes(leadingDigit(course))) return false
  if (filters.name) {
    const needle = filters.name.toLowerCase()
    if (!course.title.toLowerCase().includes(needle) && !course.code.toLowerCase().includes(needle)) {
      return false
    }
  }
  return true
}

export function buildList(offerings: Offering[], filters: ListFilters): ListRow[] {
  const rows = new Map<string, ListRow>()

  for (const offering of offerings) {
    if (!matches(offering.course, filters)) continue
    const digit = leadingDigit(offering.course)
    const key = `${offering.course.subject}|${digit}|${offering.termOrder}`
    let row = rows.get(key)
    if (!row) {
      row = {
        subject: offering.course.subject,
        digit,
        termName: offering.termName,
        termOrder: offering.termOrder,
        courses: [],
      }
      rows.set(key, row)
    }
    row.courses.push(offering.course)
  }

  const ordered = [...rows.values()].sort(
    (a, b) =>
      a.subject.localeCompare(b.subject) || a.digit - b.digit || a.termOrder - b.termOrder,
  )

  for (const row of ordered) {
    row.courses.sort((a, b) =>
      WITHIN_ROW === 'asc' ? catalogNumber(a) - catalogNumber(b) : catalogNumber(b) - catalogNumber(a),
    )
  }

  return ordered
}

/** Leading digits actually present under the current subject filter, for the toggle row. */
export function availableDigits(offerings: Offering[], subjects: string[]): number[] {
  const digits = new Set<number>()
  for (const offering of offerings) {
    if (subjects.length > 0 && !subjects.includes(offering.course.subject)) continue
    digits.add(leadingDigit(offering.course))
  }
  return [...digits].filter((digit) => digit > 0).sort((a, b) => a - b)
}

/** Split a raw subject query ("csci math") into uppercase four-letter codes. */
export function parseSubjects(value: string): string[] {
  return [...new Set((value.toUpperCase().match(/[A-Z]{4}/g) ?? []))]
}
