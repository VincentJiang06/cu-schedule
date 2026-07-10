import { checkRequirement } from './requirements.ts'
import { comboMeetings, courseCombos, meetingsClash, type Plan, type Prefs } from './schedule.ts'
import type { Course, Meeting } from './types.ts'

export type CandidateStatus = 'open' | 'rearrange' | 'conflict' | 'tba'

export type Candidate = {
  course: Course
  status: CandidateStatus
  /** The section choice shown in the 时间 column: the one that fits, or the first if none does. */
  slots: Meeting[]
  instructors: string[]
  /** Parsed from enrollment_requirement; empty when nothing was confidently parsed. */
  missingPrereq: string[]
}

export type CandidateSummary = {
  open: number
  rearrange: number
  conflict: number
  tba: number
  taken: number
  ruledOut: number
}

export type CandidateResult = { rows: Candidate[]; summary: CandidateSummary }

const MAX_ALTERNATES = 5

function planMeetings(plan: Plan): Meeting[] {
  return plan.entries.flatMap((entry) => entry.section.meetings)
}

export function evaluateCandidates(params: {
  courses: Course[]
  taken: string[]
  committed: string[]
  plans: Plan[]
  selectedPlanIndex: number
  prefs: Prefs
}): CandidateResult {
  const takenSet = new Set(params.taken)
  const committedSet = new Set(params.committed)
  const selected = params.plans[params.selectedPlanIndex] ?? null
  const selectedMeetings = selected ? planMeetings(selected) : []
  const alternates = params.plans
    .filter((plan) => plan.id !== selected?.id)
    .slice(0, MAX_ALTERNATES)
    .map(planMeetings)

  const rows: Candidate[] = []
  const summary: CandidateSummary = { open: 0, rearrange: 0, conflict: 0, tba: 0, taken: 0, ruledOut: 0 }

  for (const course of params.courses) {
    if (committedSet.has(course.code)) continue
    if (takenSet.has(course.code)) {
      summary.taken += 1
      continue
    }

    const { ruledOut, missingPrereq } = checkRequirement(course.requirement, takenSet)
    if (ruledOut.length > 0) {
      summary.ruledOut += 1
      continue
    }

    const combos = courseCombos(course, params.prefs)
    if (combos.length === 0) continue

    const timed = combos.filter((combo) => comboMeetings(combo).length > 0)
    if (timed.length === 0) {
      summary.tba += 1
      rows.push({
        course,
        status: 'tba',
        slots: [],
        instructors: combos[0].flatMap((section) => section.instructors),
        missingPrereq,
      })
      continue
    }

    const fitting = timed.find((combo) => !meetingsClash(comboMeetings(combo), selectedMeetings))
    let status: CandidateStatus
    let shown = fitting

    if (fitting) {
      status = 'open'
    } else {
      const fitsAlternate = alternates.some((meetings) =>
        timed.some((combo) => !meetingsClash(comboMeetings(combo), meetings)),
      )
      status = fitsAlternate ? 'rearrange' : 'conflict'
      shown = timed[0]
    }

    summary[status] += 1
    rows.push({
      course,
      status,
      slots: [...comboMeetings(shown!)].sort(
        (a, b) => a.dayIndex - b.dayIndex || a.start - b.start,
      ),
      instructors: [...new Set(shown!.flatMap((section) => section.instructors))],
      missingPrereq,
    })
  }

  return { rows, summary }
}
