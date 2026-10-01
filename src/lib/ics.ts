import type { Plan } from './schedule.ts'
import { downloadBlob, slugTerm } from './exportImage.ts'
import { t } from '../i18n/index.ts'
import { noClassDates, parseLocalDate, termCalendarFor } from './termCalendar.ts'

/**
 * Serialize one timetable (the plan chosen on the 导出 page) into an RFC 5545 VCALENDAR.
 *
 * When the term is in TERM_CALENDARS (official almanac dates), each meeting becomes a
 * weekly event from its first occurrence on/after the first teaching day, repeating
 * UNTIL the last teaching day, with EXDATEs for every general holiday / Lunar New Year
 * vacation / reading-week day that lands on it. Unknown terms fall back to the old
 * estimate (next upcoming weekday, 13 weeks) and say so in X-WR-CALDESC. Times are
 * wall-clock Asia/Hong_Kong (no DST), pinned with a TZID plus a static VTIMEZONE block.
 */

const CRLF = '\r\n'
const WEEKS = 13

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

/** Wall-clock stamp `YYYYMMDDTHHMMSS` (floating, paired with a TZID). */
function localStamp(date: Date, minutes: number): string {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(hour)}${pad(minute)}00`
}

/** UTC stamp `YYYYMMDDTHHMMSSZ` for DTSTAMP. */
function utcStamp(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

/** The next date (today inclusive) whose ISO weekday matches `dayIndex` (1=Mon…7=Sun). */
function nextDateFor(dayIndex: number, from: Date): Date {
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const current = day.getDay() === 0 ? 7 : day.getDay()
  let delta = dayIndex - current
  if (delta < 0) delta += 7
  day.setDate(day.getDate() + delta)
  return day
}

/** Fold content lines to ≤75 octets per RFC 5545, never splitting a UTF-8 char. */
function fold(line: string): string {
  const encoder = new TextEncoder()
  let out = ''
  let bytes = 0
  for (const ch of line) {
    const size = encoder.encode(ch).length
    if (bytes + size > 73) {
      out += `${CRLF} `
      bytes = 1
    }
    out += ch
    bytes += size
  }
  return out
}

export type IcsOptions = {
  /** Term slug — looks up the official teaching period in termCalendar.ts. */
  termSlug?: string | null
  /** Display label of the exported plan, e.g. "排法 3". */
  planLabel?: string
  now?: Date
}

export function buildIcs(plan: Plan, termName: string, options: IcsOptions = {}): string {
  const now = options.now ?? new Date()
  const calendar = termCalendarFor(options.termSlug)
  const label = options.planLabel ?? ''
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CU Schedule//CU Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`CU Schedule ${termName}${label ? ` ${label}` : ''}`)}`,
    `X-WR-CALDESC:${escapeText(
      calendar
        ? t('按中大官方校历生成：{start} 至 {end}，已跳过公众假期、农历新年假期与阅读周。临时调课请以 CUSIS 为准。', {
            start: calendar.start,
            end: calendar.end,
          })
        : t('学期起止日期未知：事件自即将到来的对应星期几起按周重复 13 周，仅为估计，请以 CUSIS 为准。'),
    )}`,
    'X-WR-TIMEZONE:Asia/Hong_Kong',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Hong_Kong',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'TZNAME:HKT',
    'END:STANDARD',
    'END:VTIMEZONE',
  ]

  const dtstamp = utcStamp(now)
  const termStart = calendar ? parseLocalDate(calendar.start) : now
  const termEnd = calendar ? parseLocalDate(calendar.end) : null
  const skipped = calendar ? noClassDates(calendar) : []
  for (const entry of plan.entries) {
    for (const meeting of entry.section.meetings) {
      if (meeting.dayIndex < 1 || meeting.dayIndex > 7) continue
      const date = nextDateFor(meeting.dayIndex, termStart)
      if (termEnd && date > termEnd) continue
      const uid = `${entry.course.code}-${entry.section.id}-${meeting.dayIndex}-${meeting.start}@cu-schedule`
      lines.push('BEGIN:VEVENT')
      lines.push(`UID:${escapeText(uid)}`)
      lines.push(`DTSTAMP:${dtstamp}`)
      lines.push(`DTSTART;TZID=Asia/Hong_Kong:${localStamp(date, meeting.start)}`)
      lines.push(`DTEND;TZID=Asia/Hong_Kong:${localStamp(date, meeting.end)}`)
      if (termEnd) {
        // RFC 5545 §3.3.10: with a TZID'd DTSTART, UNTIL must be UTC. 23:59 HKT = 15:59Z.
        const untilUtc = new Date(Date.UTC(termEnd.getFullYear(), termEnd.getMonth(), termEnd.getDate(), 15, 59, 0))
        lines.push(`RRULE:FREQ=WEEKLY;UNTIL=${utcStamp(untilUtc)}`)
        const weekday = meeting.dayIndex % 7 // ISO 1..7 → JS 1..6,0
        const exdates = skipped.filter((day) => day.getDay() === weekday && day >= date)
        if (exdates.length > 0) {
          lines.push(`EXDATE;TZID=Asia/Hong_Kong:${exdates.map((day) => localStamp(day, meeting.start)).join(',')}`)
        }
      } else {
        lines.push(`RRULE:FREQ=WEEKLY;COUNT=${WEEKS}`)
      }
      lines.push(`SUMMARY:${escapeText(`${entry.course.code} ${entry.section.component}`)}`)
      if (meeting.location) lines.push(`LOCATION:${escapeText(meeting.location)}`)
      const section = `${entry.section.cohort}${entry.section.group}` || entry.section.id
      const teachers = entry.section.instructors.filter((name) => name && name !== 'Staff')
      lines.push(
        `DESCRIPTION:${escapeText(
          [entry.course.title, `${entry.section.component} ${section}`, teachers.join(', ')].filter(Boolean).join('\n'),
        )}`,
      )
      lines.push('END:VEVENT')
    }
  }

  lines.push('END:VCALENDAR')
  return lines.map(fold).join(CRLF) + CRLF
}

/** Build the .ics for the chosen plan, trigger a download, and return the file name. */
export function exportIcs(plan: Plan, termName: string, options: IcsOptions = {}): string {
  const text = buildIcs(plan, termName, options)
  const filename = `cu-schedule-${slugTerm(termName)}.ics`
  downloadBlob(new Blob([text], { type: 'text/calendar;charset=utf-8' }), filename)
  return filename
}
