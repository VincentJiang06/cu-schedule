/**
 * Official teaching-period dates per term, used by the .ics export so recurring events
 * start on the real first teaching day, stop on the last one, and skip no-class days.
 *
 * Source: CUHK Registration and Examinations Section, "Calendar View for Academic Year
 * 2026-27" (undergraduate) + University Almanac 2026-27 (updated 26 May 2026). Dates are
 * local Hong Kong calendar dates (YYYY-MM-DD). Add one entry per term when a new academic
 * year's almanac is published; unknown terms fall back to a clearly-labelled estimate.
 */
export type TermCalendar = {
  /** First teaching day (inclusive). */
  start: string
  /** Last teaching day (inclusive). */
  end: string
  /** Days with no classes inside the teaching period: general holidays, Lunar New Year
   * vacation, reading week. Single dates or inclusive [from, to] ranges. */
  noClass: Array<string | [string, string]>
}

export const TERM_CALENDARS: Record<string, TermCalendar> = {
  '2026-27-term-1': {
    start: '2026-09-07',
    end: '2026-12-05',
    noClass: [
      '2026-09-26', // The day following the Chinese Mid-Autumn Festival
      '2026-10-01', // National Day
      '2026-10-19', // The day following Chung Yeung Festival
    ],
  },
  '2026-27-term-2': {
    start: '2027-01-11',
    end: '2027-04-24',
    noClass: [
      ['2027-02-05', '2027-02-11'], // Lunar New Year Vacation
      ['2027-03-08', '2027-03-13'], // Reading Week
      '2027-03-26', // Good Friday
      '2027-03-27', // The day following Good Friday
      '2027-03-29', // Easter Monday
      '2027-04-05', // Ching Ming Festival
    ],
  },
}

/** Parse a YYYY-MM-DD string as a local calendar date (no timezone shift). */
export function parseLocalDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Every no-class date of a term, expanded from ranges, as local Date objects. */
export function noClassDates(calendar: TermCalendar): Date[] {
  const out: Date[] = []
  for (const item of calendar.noClass) {
    const [from, to] = typeof item === 'string' ? [item, item] : item
    const day = parseLocalDate(from)
    const last = parseLocalDate(to)
    while (day <= last) {
      out.push(new Date(day))
      day.setDate(day.getDate() + 1)
    }
  }
  return out
}

export function termCalendarFor(termSlug: string | null | undefined): TermCalendar | null {
  return termSlug ? (TERM_CALENDARS[termSlug] ?? null) : null
}
