import { describe, expect, it } from 'vitest'
import { buildIcs } from './ics.ts'
import { generatePlans, NO_PREFS } from './schedule.ts'
import { mkCourse, mkMeeting, mkSection } from './testFixtures.ts'

// 周四 14:30–15:15 的单 LEC 课:2026-27 Term 1 第一个周四是 9/10,10/1 国庆是周四 → 必须 EXDATE。
const course = mkCourse('CSCI2100', [mkSection('1', { meetings: [mkMeeting(4, 870, 915, 'BMS G18')] })])
const [plan] = generatePlans([course], NO_PREFS, {})

describe('buildIcs', () => {
  it('uses the official term calendar: first teaching week, UTC UNTIL, holiday EXDATE', () => {
    const text = buildIcs(plan, '2026-27 Term 1', { termSlug: '2026-27-term-1', planLabel: '排法 2' })
    expect(text).toContain('DTSTART;TZID=Asia/Hong_Kong:20260910T143000')
    expect(text).toContain('RRULE:FREQ=WEEKLY;UNTIL=20261205T155900Z')
    expect(text).toContain('EXDATE;TZID=Asia/Hong_Kong:20261001T143000')
    expect(text).toContain('X-WR-CALNAME:CU Schedule 2026-27 Term 1 排法 2')
    expect(text).not.toContain('COUNT=')
  })

  it('skips Lunar New Year and reading week in Term 2', () => {
    const text = buildIcs(plan, '2026-27 Term 2', { termSlug: '2026-27-term-2' })
    expect(text).toContain('DTSTART;TZID=Asia/Hong_Kong:20270114T143000')
    // 2/11 (LNY vacation) and 3/11 (reading week) are Thursdays.
    expect(text).toMatch(/EXDATE;TZID=Asia\/Hong_Kong:[^\r]*20270211T143000/)
    expect(text.replace(/\r\n /g, '')).toContain('20270311T143000')
  })

  it('falls back to a labelled 13-week estimate for unknown terms', () => {
    const text = buildIcs(plan, 'Summer', { termSlug: 'unknown', now: new Date(2026, 9, 1) })
    expect(text).toContain('RRULE:FREQ=WEEKLY;COUNT=13')
    expect(text).not.toContain('EXDATE')
  })
})
