import type { Course, Meeting, Section } from './types.ts'

export type Prefs = {
  earliestStart: number | null
  latestEnd: number | null
  avoidLunch: boolean
  dayOff: number[]
}

export const NO_PREFS: Prefs = { earliestStart: null, latestEnd: null, avoidLunch: false, dayOff: [] }

const LUNCH_START = 12 * 60 + 30
const LUNCH_END = 13 * 60 + 30

/** One section per component, chosen so the cohort letters agree. */
export type Combo = Section[]

export type Plan = {
  id: string
  entries: Array<{ course: Course; section: Section }>
  units: number
  teachingDays: number[]
}

export function overlaps(left: Meeting, right: Meeting): boolean {
  return left.dayIndex === right.dayIndex && left.start < right.end && right.start < left.end
}

/** 上下班时间窗口：null 一侧=不限。用于「不展示不符合上下班限制的方案」与
 * 搜索卡「符合上下班时间」——两处判定共用同一套时间比较逻辑。 */
export type TimeWindow = { start: number | null; end: number | null }

/** True when every meeting starts at/after `window.start` (if set) and ends at/before
 * `window.end` (if set). A meeting-less list (TBA-only) trivially fits — nothing to judge. */
export function meetingsFitWindow(meetings: Meeting[], window: TimeWindow): boolean {
  if (window.start === null && window.end === null) return true
  return meetings.every((meeting) => {
    if (window.start !== null && meeting.start < window.start) return false
    if (window.end !== null && meeting.end > window.end) return false
    return true
  })
}

export function comboMeetings(combo: Combo): Meeting[] {
  return combo.flatMap((section) => section.meetings)
}

export function meetingsClash(left: Meeting[], right: Meeting[]): boolean {
  return left.some((a) => right.some((b) => overlaps(a, b)))
}

/** A meeting-level self-check, since one course's own components can collide. */
function comboSelfConsistent(combo: Combo): boolean {
  const meetings = comboMeetings(combo)
  for (let i = 0; i < meetings.length; i += 1) {
    for (let j = i + 1; j < meetings.length; j += 1) {
      if (overlaps(meetings[i], meetings[j])) return false
    }
  }
  return true
}

/**
 * CUHK pairs components by cohort letter: `A-LEC` goes with `AT01-TUT` and `AE01-EXR`,
 * never with `BT01-TUT`. Sections without a cohort letter pair with anything.
 */
function cohortsAgree(combo: Combo): boolean {
  const cohorts = new Set(combo.map((section) => section.cohort).filter(Boolean))
  return cohorts.size <= 1
}

function violatesPrefs(meetings: Meeting[], prefs: Prefs): boolean {
  return meetings.some((meeting) => {
    if (prefs.earliestStart !== null && meeting.start < prefs.earliestStart) return true
    if (prefs.latestEnd !== null && meeting.end > prefs.latestEnd) return true
    if (prefs.avoidLunch && meeting.start < LUNCH_END && LUNCH_START < meeting.end) return true
    return prefs.dayOff.includes(meeting.dayIndex)
  })
}

const MAX_COMBOS = 240

/** code -> component -> pinned section id. A pin forces one section for that component. */
export type Pins = Record<string, Record<string, string>>

/** Every viable one-section-per-component choice for a course, filtered by preferences. */
export function courseCombos(course: Course, prefs: Prefs, pin?: Record<string, string>): Combo[] {
  const byComponent = course.components.map((component) => {
    const sections = course.sections.filter((section) => section.component === component)
    const pinnedId = pin?.[component]
    if (pinnedId) {
      const only = sections.filter((section) => section.id === pinnedId)
      if (only.length > 0) return only
    }
    return sections
  })
  if (byComponent.some((group) => group.length === 0)) return []

  let combos: Combo[] = [[]]
  for (const group of byComponent) {
    const next: Combo[] = []
    for (const prefix of combos) {
      for (const section of group) {
        const candidate = [...prefix, section]
        if (!cohortsAgree(candidate)) continue
        next.push(candidate)
        if (next.length >= MAX_COMBOS) break
      }
      if (next.length >= MAX_COMBOS) break
    }
    combos = next
    if (combos.length === 0) return []
  }

  return combos.filter(
    (combo) => comboSelfConsistent(combo) && !violatesPrefs(comboMeetings(combo), prefs),
  )
}

/** 符合上下班时间(搜索卡开关):课程只要存在一种全组件 section 组合、其每个 meeting 都落在
 * window 内,就算「符合」——不考虑当前已选课/pins,纯粹是这门课本身的可选时段是否够早/够晚。 */
export function courseFitsWindow(course: Course, window: TimeWindow): boolean {
  if (window.start === null && window.end === null) return true
  return courseCombos(course, NO_PREFS).some((combo) => meetingsFitWindow(comboMeetings(combo), window))
}

// #里程碑5(排法编号稳定化):App 现在总是先在「全集」上生成(不带用户的 section 约束
// pins,只受 cohort/冲突规则),再用 pins 过滤出可见排法——过滤不重新生成、不重排。这比
// 旧模型(pins 直接喂进 courseCombos 再 backtrack)更容易在候选量大的科目组合下把 12 个
// 名额提前耗在同一批"前缀"相近的排法上，所以把上限从 12 调高到 48，给"先生成全集、再靠
// 约束筛掉大半"这个新流程留够素材（约束越严，能命中的全集样本就要求越多）。
const MAX_PLANS = 48

/** Conflict-free timetables covering every committed course, best (fewest teaching days) first. */
export function generatePlans(courses: Course[], prefs: Prefs, pins: Pins = {}): Plan[] {
  if (courses.length === 0) return []

  const optionsPerCourse = courses.map((course) => courseCombos(course, prefs, pins[course.code]))
  if (optionsPerCourse.some((options) => options.length === 0)) return []

  // Fewest options first: the search fails fast on the tightest course.
  const order = courses
    .map((_, index) => index)
    .sort((a, b) => optionsPerCourse[a].length - optionsPerCourse[b].length)

  const plans: Plan[] = []
  const chosen: Combo[] = []

  function backtrack(depth: number, usedMeetings: Meeting[]): void {
    if (plans.length >= MAX_PLANS) return
    if (depth === order.length) {
      const entries = order.flatMap((courseIndex, slot) =>
        chosen[slot].map((section) => ({ course: courses[courseIndex], section })),
      )
      plans.push(toPlan(entries))
      return
    }

    const courseIndex = order[depth]
    for (const combo of optionsPerCourse[courseIndex]) {
      const meetings = comboMeetings(combo)
      if (meetingsClash(meetings, usedMeetings)) continue
      chosen[depth] = combo
      backtrack(depth + 1, [...usedMeetings, ...meetings])
      if (plans.length >= MAX_PLANS) return
    }
  }

  backtrack(0, [])

  return plans.sort(
    (a, b) => a.teachingDays.length - b.teachingDays.length || a.id.localeCompare(b.id),
  )
}

/** 排法过滤「不展示不符合上下班限制的方案」:排法里所有 section 的所有 meeting 都要落在
 * window 内才算符合(两头都没设时 meetingsFitWindow 恒真,调用方应连同 disabled 一起处理)。 */
export function planFitsWindow(plan: Plan, window: TimeWindow): boolean {
  return meetingsFitWindow(
    plan.entries.flatMap((entry) => entry.section.meetings),
    window,
  )
}

/**
 * #里程碑5(排法编号稳定化):排法编号固定在「全集」(generatePlans(courses, prefs, {})，
 * 不带用户的 section 约束)上——每个 allPlans[i] 的编号永远是 i+1。用户在左栏点 section
 * (togglePin)产生的 pins 不再重新生成/重新编号，只是把 allPlans 过滤成"幸存排法"，幸存者
 * 展示时仍用它在 allPlans 里的原始编号(例:全集 4 个排法，约束后只剩「排法 1」「排法 4」
 * 两张卡，不会缩成「排法 1」「排法 2」)。
 *
 * 这个函数就是那把过滤器:一个排法"匹配" pins,当且仅当它每个 entry(某课某 component
 * 选的具体 section)都跟该课该 component 的 pin(如果设了的话)一致——pins 里没提到的
 * component 不做限制。 */
export function planMatchesPins(plan: Plan, pins: Pins): boolean {
  for (const entry of plan.entries) {
    const pinnedId = pins[entry.course.code]?.[entry.section.component]
    if (pinnedId && pinnedId !== entry.section.id) return false
  }
  return true
}

/** #里程碑6(左栏 section 高亮):把一个排法拆成 code → component → sectionId 的映射，
 * 形状与 Pins 完全一样(所以可以直接拿去跟 pins 比对)——用来在左栏"当前课程"列表里标出
 * 「这门课这个 component，当前选中的排法（A / B / 单方案）用的是哪个 section」。 */
export function planSectionMap(plan: Plan): Pins {
  const map: Pins = {}
  for (const entry of plan.entries) {
    const forCourse = map[entry.course.code] ?? (map[entry.course.code] = {})
    forCourse[entry.section.component] = entry.section.id
  }
  return map
}

function toPlan(entries: Plan['entries']): Plan {
  const codes = [...new Set(entries.map((entry) => entry.course.code))]
  const units = codes.reduce(
    (sum, code) => sum + (entries.find((entry) => entry.course.code === code)?.course.units ?? 0),
    0,
  )
  const teachingDays = [
    ...new Set(entries.flatMap((entry) => entry.section.meetings.map((meeting) => meeting.dayIndex))),
  ].sort((a, b) => a - b)
  return {
    id: entries
      .map((entry) => entry.section.id)
      .sort()
      .join('-'),
    entries,
    units,
    teachingDays,
  }
}

export type Clash = {
  codes: [string, string]
  dayIndex: number
  start: number
  end: number
}

/** When no plan exists, surface the pairs of courses that actually collide. */
export function findClashes(courses: Course[], prefs: Prefs, pins: Pins = {}): Clash[] {
  const clashes: Clash[] = []
  const combos = courses.map((course) => courseCombos(course, prefs, pins[course.code]))

  for (let i = 0; i < courses.length; i += 1) {
    for (let j = i + 1; j < courses.length; j += 1) {
      if (combos[i].length === 0 || combos[j].length === 0) continue
      const anyFit = combos[i].some(
        (left) => combos[j].some((right) => !meetingsClash(comboMeetings(left), comboMeetings(right))),
      )
      if (anyFit) continue

      const left = comboMeetings(combos[i][0])
      const right = comboMeetings(combos[j][0])
      for (const a of left) {
        const hit = right.find((b) => overlaps(a, b))
        if (hit) {
          clashes.push({
            codes: [courses[i].code, courses[j].code],
            dayIndex: a.dayIndex,
            start: Math.max(a.start, hit.start),
            end: Math.min(a.end, hit.end),
          })
          break
        }
      }
    }
  }

  return clashes
}

/** Courses whose preferences alone leave no viable section combination. */
export function blockedByPrefs(courses: Course[], prefs: Prefs, pins: Pins = {}): string[] {
  return courses
    .filter(
      (course) =>
        courseCombos(course, prefs, pins[course.code]).length === 0 &&
        courseCombos(course, NO_PREFS).length > 0,
    )
    .map((course) => course.code)
}
