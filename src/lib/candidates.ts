import { evaluateRequirement } from './requirements.ts'
import type { RequirementStatus } from './types.ts'
import { comboMeetings, courseCombos, meetingsClash, type Plan, type Prefs } from './schedule.ts'
import type { Course, Meeting } from './types.ts'

/**
 * 'open'      — 至少一种 section 组合能塞进「当前选中的排法」。
 * 'rearrange' — 塞不进当前排法，但能塞进已选课的其他某个可行排法(UI 标「时间可能冲突」)。
 * 'conflict'  — 该课的所有 section 组合对已选课的所有可行排法(generatePlans 枚举到的全部,
 *               上限 MAX_PLANS)都无法共存,才判死「时间冲突」。
 * 'tba'       — 没有任何带时间的组合(时间待定)。
 */
export type CandidateStatus = 'open' | 'rearrange' | 'conflict' | 'tba'

export type Candidate = {
  course: Course
  status: CandidateStatus
  /** The section choice shown in the 时间 column: the one that fits, or the first if none does. */
  slots: Meeting[]
  instructors: string[]
  /** 'missing' = provably unmet prerequisite; 'unverifiable' = grade/consent we can't check. */
  prereqStatus: RequirementStatus
  /** Cleaned original prerequisite text, shown on hover. */
  prereqText: string
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
  // 「冲突」的判定基准是已选课的**全部**可行排法(不再截断到前几个):候选课只要能与其中
  // 任何一个共存就不算死冲突,只算「时间可能冲突」(rearrange)。generatePlans 本身已按
  // MAX_PLANS 枚举了所有 section 组合下的可行排法(封顶数量见 schedule.ts 的 MAX_PLANS，
  // 与课表页可选的排法一致)。
  const alternates = params.plans
    .filter((plan) => plan.id !== selected?.id)
    .map(planMeetings)

  const rows: Candidate[] = []
  const summary: CandidateSummary = { open: 0, rearrange: 0, conflict: 0, tba: 0, taken: 0, ruledOut: 0 }

  for (const course of params.courses) {
    if (committedSet.has(course.code)) continue
    if (takenSet.has(course.code)) {
      summary.taken += 1
      continue
    }

    const requirement = evaluateRequirement(course.requirement, takenSet, committedSet)
    if (requirement.ruledOut.length > 0) {
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
        prereqStatus: requirement.prereqStatus,
        prereqText: requirement.prereqText,
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
      prereqStatus: requirement.prereqStatus,
      prereqText: requirement.prereqText,
    })
  }

  return { rows, summary }
}
