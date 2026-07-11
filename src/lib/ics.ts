import type { Plan } from './schedule.ts'

/**
 * Serialize one timetable (排法 A) into an RFC 5545 VCALENDAR.
 *
 * Semantics — the schedule bundles carry no term start/end dates, so a truthful
 * recurring feed is impossible. Each meeting becomes a weekly event that starts on
 * the *next upcoming* occurrence of its weekday and repeats 13 times (a rough term
 * length). This is an estimate, stated in X-WR-CALDESC; students must verify real
 * dates against CUSIS. Times are wall-clock Asia/Hong_Kong (no DST), pinned with a
 * TZID plus a static VTIMEZONE block.
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

/** Filesystem-safe slug from a term name (keeps CJK, ASCII word chars, hyphens). */
function slugTerm(name: string): string {
  return name.replace(/[^\w一-龥-]+/g, '-').replace(/^-+|-+$/g, '') || 'term'
}

export function buildIcs(plan: Plan, termName: string, now: Date = new Date()): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CU Schedule//CU Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`CU Schedule ${termName} 排法A`)}`,
    `X-WR-CALDESC:${escapeText(
      '学期起止日期未知：事件自即将到来的对应星期几起按周重复 13 周，仅为估计，请以 CUSIS 为准。',
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
  for (const entry of plan.entries) {
    for (const meeting of entry.section.meetings) {
      const date = nextDateFor(meeting.dayIndex, now)
      const uid = `${entry.course.code}-${entry.section.id}-${meeting.dayIndex}-${meeting.start}@cu-schedule`
      lines.push('BEGIN:VEVENT')
      lines.push(`UID:${escapeText(uid)}`)
      lines.push(`DTSTAMP:${dtstamp}`)
      lines.push(`DTSTART;TZID=Asia/Hong_Kong:${localStamp(date, meeting.start)}`)
      lines.push(`DTEND;TZID=Asia/Hong_Kong:${localStamp(date, meeting.end)}`)
      lines.push(`RRULE:FREQ=WEEKLY;COUNT=${WEEKS}`)
      lines.push(`SUMMARY:${escapeText(`${entry.course.code} ${entry.section.component}`)}`)
      if (meeting.location) lines.push(`LOCATION:${escapeText(meeting.location)}`)
      lines.push(`DESCRIPTION:${escapeText(entry.course.title)}`)
      lines.push('END:VEVENT')
    }
  }

  lines.push('END:VCALENDAR')
  return lines.map(fold).join(CRLF) + CRLF
}

/** Build the .ics for 排法 A, trigger a download, and return the file name. */
export function exportIcs(plan: Plan, termName: string): string {
  const text = buildIcs(plan, termName)
  const filename = `cu-schedule-${slugTerm(termName)}-A.ics`
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return filename
}
