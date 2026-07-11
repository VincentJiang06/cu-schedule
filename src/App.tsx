import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { CommittedList } from './components/CommittedList.tsx'
import { CourseModal } from './components/CourseModal.tsx'
import { ProgramPicker } from './components/ProgramPicker.tsx'
import { ProgramTable } from './components/ProgramTable.tsx'
import {
  SearchResults,
  type Daypart,
  type LecBusy,
  type LevelBucket,
  type SearchFilters,
  type UnitPick,
} from './components/SearchResults.tsx'
import { SubjectPicker } from './components/SubjectPicker.tsx'
import { TimetableCompare } from './components/TimetableCompare.tsx'
import { evaluateCandidates } from './lib/candidates.ts'
import { courseColor } from './lib/color.ts'
import { courseKey } from './lib/courseKey.ts'
import { exportPlan, type ExportFormat } from './lib/exportPlan.ts'
import {
  classifyPrograms,
  getProgram,
  loadPrograms,
  programCourseKeys,
  reloadPrograms,
  type CourseStanding,
  type Program,
} from './lib/programs.ts'
import { parseCourseCodes } from './lib/search.ts'
import { decodeShare } from './lib/shareLink.ts'
import {
  loadSubjects,
  loadTermList,
  loadYearOfferings,
  type Offering,
  type SubjectInfo,
  type TermRef,
} from './lib/data.ts'
import { findClashes, generatePlans, overlaps, type Pins, type Plan, type Prefs } from './lib/schedule.ts'
import { hhmm } from './lib/time.ts'
import type { Course } from './lib/types.ts'

type Theme = 'light' | 'dark'
type Page = 'info' | 'select' | 'timetable' | 'export'
// 全部课程 / 本专业 — narrows search to the chosen programme's course set (by course key).
type ProgramScope = 'all' | 'program'

const PAGES: Array<{ value: Page; label: string }> = [
  { value: 'info', label: '信息' },
  { value: 'select', label: '选课' },
  { value: 'timetable', label: '课表' },
  { value: 'export', label: '导出' },
]

// 页面在导航栏里的先后顺序。切换方向据此决定：切到更靠后的页 → 旧页向左滑出、新页从右滑入。
const PAGE_ORDER: Record<Page, number> = { info: 0, select: 1, timetable: 2, export: 3 }

// 一次切页动画的描述：从哪一页来、方向（1=前进向左滑 / -1=后退向右滑）。
type PageTransition = { from: Page; dir: 1 | -1 }
const TRANSITION_MS = 260

const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五']
const STORAGE_KEY = 'cu-schedule:v1'

// 学分 多选按钮 — buckets course.units by floor: 1 / 2 / 3 / 4+ (4plus = floor >= 4).
const UNIT_PICKS: Array<{ value: UnitPick; label: string }> = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4plus', label: '4+' },
]

// 课程等级 chips — multi-select over course.level (1-9); '4plus' = level >= 4.
const LEVEL_BUCKETS: Array<{ value: LevelBucket; label: string }> = [
  { value: '1', label: '1000' },
  { value: '2', label: '2000' },
  { value: '3', label: '3000' },
  { value: '4plus', label: '4000+' },
]

// 上课时段 chips — multi-select; semantics live in SearchResults (meetingMask).
const DAYPARTS: Array<{ value: Daypart; label: string }> = [
  { value: 'morning', label: '上午' },
  { value: 'afternoon', label: '下午' },
  { value: 'evening', label: '晚上' },
]

// Add or remove one value from a multi-select chip group.
function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

// iOS-style slide switch: a hidden checkbox drives a CSS track + thumb. The whole row
// (label included) toggles; the selected state is tinted with --brand. Reused across the
// 课程范围 / 时间约束 filter blocks.
function Toggle({
  checked,
  disabled,
  title,
  onChange,
  children,
}: {
  checked: boolean
  disabled?: boolean
  title?: string
  onChange: (value: boolean) => void
  children: ReactNode
}) {
  return (
    <label className={`switch${disabled ? ' switch--disabled' : ''}`} title={title}>
      <input
        checked={checked}
        disabled={disabled}
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch__track">
        <span className="switch__thumb" />
      </span>
      <span className="switch__label">{children}</span>
    </label>
  )
}

// One small inline icon per page, so the nav reads at a glance.
const PAGE_ICON: Record<Page, ReactNode> = {
  info: (
    <svg aria-hidden fill="none" height="18" viewBox="0 0 24 24" width="18">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
      <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  ),
  select: (
    <svg aria-hidden fill="none" height="18" viewBox="0 0 24 24" width="18">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3.2-3.2" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  ),
  timetable: (
    <svg aria-hidden fill="none" height="18" viewBox="0 0 24 24" width="18">
      <rect height="16" rx="2" stroke="currentColor" strokeWidth="2" width="18" x="3" y="4" />
      <path d="M3 9h18M8 2v4M16 2v4" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  ),
  export: (
    <svg aria-hidden fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  ),
}

type Saved = {
  termSlug: string | null
  committed: string[]
  taken: string[]
  /** 可能学 waitlist / cart — tentative picks, separate from 必定学 (committed). */
  cart?: string[]
  pins?: Pins
}

// 课表页专用配色盘：~12 个可区分的 hue。每门 committed 课进入时按顺序领取一个槽位
// （append-only，见 colorForCode），槽位一旦分配永不重排，故新增课不会打乱既有课的颜色。
const TIMETABLE_PALETTE = [210, 145, 275, 25, 330, 190, 95, 300, 50, 240, 170, 10]

// 排课筛选卡的时间段选项（分钟；null=不限）。
const EARLIEST_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: null, label: '不限' },
  { value: 8 * 60, label: '08:00 起' },
  { value: 9 * 60, label: '09:00 起' },
  { value: 10 * 60, label: '10:00 起' },
  { value: 11 * 60, label: '11:00 起' },
  { value: 12 * 60, label: '12:00 起' },
]
const LATEST_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: null, label: '不限' },
  { value: 15 * 60, label: '15:00 前' },
  { value: 16 * 60, label: '16:00 前' },
  { value: 17 * 60, label: '17:00 前' },
  { value: 18 * 60, label: '18:00 前' },
  { value: 19 * 60, label: '19:00 前' },
]

// 一个排法内部两两 meeting 是否重叠。generatePlans/courseCombos 已保证返回的排法无冲突
// （连 pins 强钉也会被 backtrack 的 meetingsClash 过滤或直接排不出），所以此判定在实践中
// 恒为 false —— 它是 #6 的「不展示冲突的方案」与 #7 的「一键清除有冲突的」的防御性依据。
function planHasConflict(plan: Plan): boolean {
  const meetings = plan.entries.flatMap((entry) => entry.section.meetings)
  for (let i = 0; i < meetings.length; i += 1) {
    for (let j = i + 1; j < meetings.length; j += 1) {
      if (overlaps(meetings[i], meetings[j])) return true
    }
  }
  return false
}

function loadSaved(): Saved | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Saved
    if (!Array.isArray(parsed.committed) || !Array.isArray(parsed.taken)) return null
    return parsed
  } catch {
    return null
  }
}

function loadTheme(): Theme {
  const saved = window.localStorage.getItem('cu-schedule:theme')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// A share link (`…#s=<payload>`) overrides localStorage on this first load, so
// opening someone's link restores their selection instead of yours.
function readShared(): Saved | null {
  if (typeof window === 'undefined' || !window.location.hash.startsWith('#s=')) return null
  const decoded = decodeShare(window.location.hash)
  if (!decoded) return null
  return {
    termSlug: decoded.termSlug,
    committed: decoded.committed,
    taken: decoded.taken,
    pins: decoded.pins,
  }
}

const shared = readShared()
const saved = loadSaved()
const boot = shared ?? saved

export default function App() {
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [terms, setTerms] = useState<TermRef[]>([])
  const [termSlug, setTermSlug] = useState<string | null>(boot?.termSlug ?? null)
  const [offerings, setOfferings] = useState<Offering[]>([])
  const [subjects, setSubjects] = useState<SubjectInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [committed, setCommitted] = useState<string[]>(boot?.committed ?? [])
  const [taken, setTaken] = useState<string[]>(boot?.taken ?? [])
  // 可能学 waitlist / cart — tentative picks, held apart from 必定学 (committed).
  const [cart, setCart] = useState<string[]>(boot?.cart ?? [])
  // Pinned sections (e.g. TUT T01) constrain which A / B timetables the scheduler builds.
  const [pins, setPins] = useState<Pins>(boot?.pins ?? {})
  const [planIndex, setPlanIndex] = useState(0)
  // 课表页 A / B 各自选中的排法下标（默认第 1、第 2 种）；plans 变化越界时重置回默认。
  const [planAIndex, setPlanAIndex] = useState(0)
  const [planBIndex, setPlanBIndex] = useState(1)
  const [page, setPage] = useState<Page>('select')
  // 当前正在播放的切页动画（null = 无动画，直接渲染单页）。
  const [transition, setTransition] = useState<PageTransition | null>(null)
  // The course whose detail popup is open (null = closed).
  const [detailCourse, setDetailCourse] = useState<Course | null>(null)

  // 切页统一入口：记录来向与方向，触发一次横向滑动，动画结束后清空 transition 回到单页渲染。
  const go = useCallback(
    (to: Page) => {
      if (to === page) return
      setTransition({ from: page, dir: PAGE_ORDER[to] > PAGE_ORDER[page] ? 1 : -1 })
      setPage(to)
    },
    [page],
  )

  // 动画计时结束后落幕：清掉 transition，让 viewport 回到单页（solo）渲染。
  useEffect(() => {
    if (!transition) return
    const timer = window.setTimeout(() => setTransition(null), TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [transition])

  // 课表页「排课筛选」卡的输出（#6）。默认值与 DEFAULT_PREFS 完全一致，所以用户未动筛选时
  // 行为与原来无异；一旦设值，会通过下方共享的 generatePlans 真正约束排出的课表。
  const [ttEarliest, setTtEarliest] = useState<number | null>(null)
  const [ttLatest, setTtLatest] = useState<number | null>(null)
  const [ttAvoidLunch, setTtAvoidLunch] = useState(false)
  // #6 的「不展示冲突的方案」开关（默认开），与 #7 的排法横条配合过滤显示的排法。
  const [hideConflicts, setHideConflicts] = useState(true)
  const prefs = useMemo<Prefs>(
    () => ({ earliestStart: ttEarliest, latestEnd: ttLatest, avoidLunch: ttAvoidLunch, dayOff: [] }),
    [ttAvoidLunch, ttEarliest, ttLatest],
  )

  // 选课 page filters — subjects support positive (include) and negative (exclude),
  // selectability toggles between all / only 可选 / only 不可选.
  const [search, setSearch] = useState('')
  const [includeSubjects, setIncludeSubjects] = useState<string[]>([])
  const [excludeSubjects, setExcludeSubjects] = useState<string[]>([])
  // 符合先修:排除先修被证伪的课。符合时间表(仅LEC):只留 LEC 能塞进当前课表的课。默认皆关。
  const [meetsPrereq, setMeetsPrereq] = useState(false)
  const [lecFits, setLecFits] = useState(false)
  const [units, setUnits] = useState<UnitPick[]>([])
  const [levels, setLevels] = useState<LevelBucket[]>([])
  const [dayparts, setDayparts] = useState<Daypart[]>([])
  const [hideCompleted, setHideCompleted] = useState(true)
  const [currentTermOnly, setCurrentTermOnly] = useState(true)
  const [excludeTba, setExcludeTba] = useState(false)
  // Restrict the catalog to the selected programme's courses (needs a chosen major).
  const [programScope, setProgramScope] = useState<ProgramScope>('all')

  // Enrolment year + major. Major is now a specific 培养方案 (Program), stored by its
  // stable program.id under 'cu-schedule:program'. The programme bundle loads lazily and
  // must never block the rest of the app (catch → empty list).
  const [enrollYear, setEnrollYear] = useState(() => window.localStorage.getItem('cu-schedule:year') ?? '')
  const [programs, setPrograms] = useState<Program[]>([])
  const [programId, setProgramId] = useState(() => window.localStorage.getItem('cu-schedule:program') ?? '')
  // 大课表数据刷新中（信息页入学年份旁的 ↻ 按钮）。
  const [refreshingPrograms, setRefreshingPrograms] = useState(false)
  // 已完成课程卡的手动录入草稿（回车 / 粘贴 → parseCourseCodes → 按 key 并入 taken）。
  const [takenDraft, setTakenDraft] = useState('')
  // 因已修互斥课而被自动移出「当前选择」的课号(非阻断提示用,按 key 去重累积)。
  const [autoRemoved, setAutoRemoved] = useState<string[]>([])

  useEffect(() => {
    loadPrograms().then(setPrograms).catch(() => {})
  }, [])

  useEffect(() => {
    window.localStorage.setItem('cu-schedule:year', enrollYear)
  }, [enrollYear])

  useEffect(() => {
    window.localStorage.setItem('cu-schedule:program', programId)
  }, [programId])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('cu-schedule:theme', theme)
  }, [theme])

  // An opened share link: persist it immediately and strip the hash so a refresh
  // doesn't re-import (and doesn't keep clobbering later local edits).
  useEffect(() => {
    if (!shared) return
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        termSlug: shared.termSlug,
        committed: shared.committed,
        taken: shared.taken,
        pins: shared.pins ?? {},
      }),
    )
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])

  useEffect(() => {
    loadTermList()
      .then((list) => {
        setTerms(list)
        setTermSlug((current) =>
          current && list.some((term) => term.slug === current) ? current : (list[0]?.slug ?? null),
        )
      })
      .catch((cause: Error) => setError(cause.message))
  }, [])

  const term = useMemo(() => terms.find((item) => item.slug === termSlug) ?? null, [termSlug, terms])
  const year = term?.year ?? null
  const mainTerms = useMemo(() => terms.filter((item) => /Term\s*[12]/.test(item.name)), [terms])

  // The header only offers Term 1 / Term 2, so keep the active term inside that set.
  useEffect(() => {
    if (mainTerms.length > 0 && !mainTerms.some((item) => item.slug === termSlug)) {
      setTermSlug(mainTerms[0].slug)
    }
  }, [mainTerms, termSlug])

  // Load the whole academic year once; switching Term 1/2 then re-derives locally.
  useEffect(() => {
    if (!year) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([loadYearOfferings(year), loadSubjects(year)])
      .then(([list, subjectList]) => {
        if (cancelled) return
        setOfferings(list)
        setSubjects(subjectList)
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [year])

  const courses = useMemo(
    () => offerings.filter((offering) => offering.termSlug === termSlug).map((offering) => offering.course),
    [offerings, termSlug],
  )

  useEffect(() => {
    if (terms.length === 0) return
    const payload: Saved = { termSlug, committed, taken, cart, pins }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [cart, committed, pins, taken, termSlug, terms.length])

  // courseKey → the term orders (1=上学期 / 2=下学期) that key is offered in, across
  // the whole academic year. Keyed by course.key so suffixed variants share an entry.
  const termOrdersByKey = useMemo(() => {
    const map = new Map<string, number[]>()
    for (const { course, termOrder } of offerings) {
      const orders = map.get(course.key) ?? []
      if (!orders.includes(termOrder)) orders.push(termOrder)
      map.set(course.key, orders)
    }
    return map
  }, [offerings])
  const currentTermOrder = useMemo(
    () => Number(term?.name.match(/Term\s*([12])/)?.[1] ?? 0),
    [term],
  )

  // Every course offered anywhere in the academic year, indexed by course.key — the
  // ProgramTable resolves units / titles for the programme's 8-char codes through this,
  // regardless of which term they land in. First offering wins (identity is the key).
  const catalogByKey = useMemo(() => {
    const map = new Map<string, Course>()
    for (const { course } of offerings) if (!map.has(course.key)) map.set(course.key, course)
    return map
  }, [offerings])

  // 已修互斥课导致不可再选的课程 key 集合(course.requirement.exclusions 为 8 字符 key 列表)。
  // 正向:目录里任一课的 exclusions 命中已修课 → 该课被挡;反向:每门已修课自身的
  // exclusions 也一并挡掉。最后排除「已修课自身」,已完成的课不该出现在不可选里。
  const barredKeys = useMemo(() => {
    const takenKeySet = new Set(taken.map(courseKey))
    const barred = new Set<string>()
    for (const course of catalogByKey.values()) {
      if (course.requirement.exclusions.some((code) => takenKeySet.has(code))) barred.add(course.key)
    }
    for (const key of takenKeySet) {
      const course = catalogByKey.get(key)
      if (course) for (const code of course.requirement.exclusions) barred.add(code)
    }
    for (const key of takenKeySet) barred.delete(key)
    return barred
  }, [catalogByKey, taken])

  // 效果 a:被互斥挡下的课若还留在「当前选择」,自动移除并累积到非阻断提示。
  useEffect(() => {
    const removed = committed.filter((code) => barredKeys.has(courseKey(code)))
    if (removed.length === 0) return
    setCommitted((codes) => codes.filter((code) => !barredKeys.has(courseKey(code))))
    setAutoRemoved((prev) => {
      const have = new Set(prev.map(courseKey))
      const additions = removed.filter((code) => !have.has(courseKey(code)))
      return additions.length > 0 ? [...prev, ...additions] : prev
    })
  }, [barredKeys, committed])

  // Keyed by course.key so a committed/taken code matches its offering regardless of
  // any variant suffix (course identity is always the 8-char key, never raw code).
  const byCode = useMemo(() => new Map(courses.map((course) => [course.key, course])), [courses])
  const titleByCode = useMemo(() => new Map(subjects.map((item) => [item.code, item.title])), [subjects])
  const committedCourses = useMemo(
    () =>
      committed
        .map((code) => byCode.get(courseKey(code)))
        .filter((course): course is Course => Boolean(course)),
    [byCode, committed],
  )
  const unknownCommitted = useMemo(
    () => (courses.length === 0 ? [] : committed.filter((code) => !byCode.has(courseKey(code)))),
    [byCode, committed, courses.length],
  )

  // 已选课的「固定 LEC 占用区间」。对每门 committed 课取其 component==='LEC' 的 sections,
  // 仅当去重后只有一个唯一 LEC 排法(时间签名唯一)时才算固定占用 —— 多个 LEC 选项=灵活,不计入。
  // 供搜索卡「符合时间表(仅LEC)」开关判定候选课的 LEC 是否撞车(见 SearchResults.lecFitSet)。
  const lecBusy = useMemo<LecBusy[]>(() => {
    const intervals: LecBusy[] = []
    for (const course of committedCourses) {
      const lecs = course.sections.filter((section) => section.component === 'LEC')
      if (lecs.length === 0) continue
      const bySig = new Map<string, (typeof lecs)[number]>()
      for (const lec of lecs) {
        const sig = lec.meetings
          .map((m) => `${m.dayIndex}:${m.start}:${m.end}`)
          .sort()
          .join('|')
        if (!bySig.has(sig)) bySig.set(sig, lec)
      }
      if (bySig.size !== 1) continue
      const [only] = bySig.values()
      for (const m of only.meetings) {
        intervals.push({ dayIndex: m.dayIndex, start: m.start, end: m.end })
      }
    }
    return intervals
  }, [committedCourses])

  const plans = useMemo(() => generatePlans(committedCourses, prefs, pins), [committedCourses, pins, prefs])
  const clashes = useMemo(
    () => (plans.length === 0 && committedCourses.length > 1 ? findClashes(committedCourses, prefs, pins) : []),
    [committedCourses, pins, plans.length, prefs],
  )
  useEffect(() => {
    if (planIndex >= plans.length) setPlanIndex(0)
  }, [planIndex, plans.length])
  // 排法列表变化时，越界的 A / B 下标回到默认（A→0、B→1）。
  useEffect(() => {
    if (planAIndex >= plans.length) setPlanAIndex(0)
    if (planBIndex >= plans.length) setPlanBIndex(1)
  }, [planAIndex, planBIndex, plans.length])

  // The 课表 page compares two user-picked conflict-free timetables side by side.
  const planA = plans[planAIndex] ?? plans[0] ?? null
  const planB = plans.length < 2 ? null : (plans[planBIndex] ?? plans[1] ?? null)
  const totalUnits = committedCourses.reduce((sum, course) => sum + course.units, 0)

  // #5 append-only 每课配色：课号（按 courseKey 归一）→ 调色盘槽位。committed 变化时只给
  // 尚未登记的 key 追加 map.size 作为槽位，已有 key 永不改动，故新增课不会重排既有课的颜色。
  // 仅课表页使用（传入 TimetableCompare）；信息/选课页仍走 subject 配色，互不影响。
  const colorSlotRef = useRef<Map<string, number>>(new Map())
  for (const code of committed) {
    const key = courseKey(code)
    if (!colorSlotRef.current.has(key)) colorSlotRef.current.set(key, colorSlotRef.current.size)
  }
  const colorForCode = useCallback((code: string): CSSProperties => {
    const map = colorSlotRef.current
    const key = courseKey(code)
    let slot = map.get(key)
    if (slot === undefined) {
      slot = map.size
      map.set(key, slot)
    }
    return { '--hue': TIMETABLE_PALETTE[slot % TIMETABLE_PALETTE.length], '--shade': '0%' } as CSSProperties
  }, [])

  // #7 排法横条数据：每个排法带上它在 plans 中的真实下标（A/B 选择以此为准）与冲突判定。
  const planViews = useMemo(
    () => plans.map((plan, index) => ({ plan, index, conflict: planHasConflict(plan) })),
    [plans],
  )
  const shownPlanViews = hideConflicts ? planViews.filter((view) => !view.conflict) : planViews

  const [exportNote, setExportNote] = useState('')
  async function handleExport(format: ExportFormat): Promise<void> {
    // The link shares the current selection even when no conflict-free plan exists;
    // ics / image need a rendered timetable (排法 A) to export.
    if (format !== 'link' && !planA) return
    setExportNote('正在导出…')
    const result = await exportPlan({
      format,
      planA: planA ?? { id: '', entries: [], units: 0, teachingDays: [] },
      planB,
      termName: term?.name ?? '',
      share: { termSlug, committed, taken, pins },
    })
    setExportNote(result.ok ? result.note : result.reason)
  }

  const candidates = useMemo(() => {
    if (courses.length === 0) return { rows: [], summary: { open: 0, rearrange: 0, conflict: 0, tba: 0, taken: 0, ruledOut: 0 } }
    return evaluateCandidates({ courses, taken, committed, plans, selectedPlanIndex: planIndex, prefs })
  }, [committed, courses, planIndex, plans, prefs, taken])

  // Selectability status is per current-term timetable; other-term courses have none.
  // Keyed by course.key — SearchResults looks these up by course.key too.
  const statusByCode = useMemo(
    () => new Map(candidates.rows.map((row) => [row.course.key, row.status])),
    [candidates.rows],
  )
  const prereqByCode = useMemo(
    () =>
      new Map(
        candidates.rows.map((row) => [
          row.course.key,
          { status: row.prereqStatus, text: row.prereqText },
        ]),
      ),
    [candidates.rows],
  )

  // The chosen 培养方案, resolved from the loaded bundle (undefined until both are ready).
  const selectedProgram = useMemo(
    () => (programId ? getProgram(programs, programId) : undefined),
    [programId, programs],
  )

  // Scope is only meaningful with a programme picked; keep it at 全部课程 otherwise.
  useEffect(() => {
    if (!selectedProgram && programScope !== 'all') setProgramScope('all')
  }, [selectedProgram, programScope])

  // The programme's course keys to narrow the catalog to (by course.key), or null for 全部课程.
  const majorKeys = useMemo(
    () => (selectedProgram && programScope === 'program' ? programCourseKeys(selectedProgram) : null),
    [selectedProgram, programScope],
  )

  // 每门课在所选主修里的地位(必修/选修 + 所属分组),供搜索卡与详情弹窗标注;未选主修则为 null,
  // 命中此 map = 必修/选修,未命中 = 自由选修(free elective)。按 course.key 归一,直接对齐 catalog。
  const standingByKey = useMemo(
    () => (selectedProgram ? classifyPrograms(selectedProgram) : null),
    [selectedProgram],
  )
  // 详情弹窗里当前课的地位:选了主修时,map 命中给必修/选修,未命中给自由选修;未选主修则不标。
  const detailStanding: CourseStanding | null =
    detailCourse && standingByKey ? (standingByKey.get(detailCourse.key) ?? { kind: 'free' }) : null
  // 弹窗「添加到下学期」不可用的原因,与搜索卡「马上学」禁用口径一致(互斥/时间冲突/待定)。
  const detailBlockedReason: string | null = !detailCourse
    ? null
    : barredKeys.has(detailCourse.key)
      ? '已修互斥课，无法添加'
      : statusByCode.get(detailCourse.key) === 'conflict'
        ? '与已选课时间冲突'
        : statusByCode.get(detailCourse.key) === 'tba'
          ? '时间待定，暂不能加入排课'
          : null

  const filters: SearchFilters = {
    query: search,
    includeSubjects,
    excludeSubjects,
    meetsPrereq,
    lecFits,
    units,
    levels,
    dayparts,
    // 「仅本科」硬编码:非本科课恒被排除,无对应开关。
    ugOnly: true,
    hideCompleted,
    currentTermOnly,
    excludeTba,
    currentTermSlug: termSlug,
    majorKeys,
  }
  // Membership sets keyed by course.key — every identity test in the UI goes through
  // the key, while localStorage keeps the raw codes (storage vs identity separation).
  const committedSet = useMemo(() => new Set(committed.map(courseKey)), [committed])
  const takenSet = useMemo(() => new Set(taken.map(courseKey)), [taken])
  const cartSet = useMemo(() => new Set(cart.map(courseKey)), [cart])

  function dropPins(code: string): void {
    setPins((current) => {
      if (!(code in current)) return current
      const next = { ...current }
      delete next[code]
      return next
    })
  }

  // Pin (or unpin, when the same section is clicked again) one section of a component.
  function togglePin(code: string, component: string, sectionId: string): void {
    setPlanIndex(0)
    setPins((current) => {
      const forCourse = { ...(current[code] ?? {}) }
      if (forCourse[component] === sectionId) {
        delete forCourse[component]
      } else {
        forCourse[component] = sectionId
      }
      const next = { ...current }
      if (Object.keys(forCourse).length === 0) delete next[code]
      else next[code] = forCourse
      return next
    })
  }

  // Identity is the course key, so a suffixed variant is treated as the same course
  // when toggling/removing; the raw code is what we store.
  const sameCourse = (a: string, b: string) => courseKey(a) === courseKey(b)

  // 已学完 / 可能学 / 必定学 are mutually exclusive: a course lives in at most one bucket,
  // so adding to one strips it from the other two. Clicking the same button again cancels.
  function toggleCommitted(code: string): void {
    setPlanIndex(0)
    if (committed.some((item) => sameCourse(item, code))) {
      setCommitted((codes) => codes.filter((item) => !sameCourse(item, code)))
      dropPins(code)
      return
    }
    setTaken((codes) => codes.filter((item) => !sameCourse(item, code)))
    setCart((codes) => codes.filter((item) => !sameCourse(item, code)))
    setCommitted((codes) => [...codes, code])
  }

  function toggleTaken(code: string): void {
    setPlanIndex(0)
    if (taken.some((item) => sameCourse(item, code))) {
      setTaken((codes) => codes.filter((item) => !sameCourse(item, code)))
      return
    }
    setCommitted((codes) => codes.filter((item) => !sameCourse(item, code)))
    setCart((codes) => codes.filter((item) => !sameCourse(item, code)))
    setTaken((codes) => [...codes, code])
  }

  // 可能学 waitlist / cart — a tentative bucket, held apart from 必定学 (committed).
  function toggleCart(code: string): void {
    if (cart.some((item) => sameCourse(item, code))) {
      setCart((codes) => codes.filter((item) => !sameCourse(item, code)))
      return
    }
    setCommitted((codes) => codes.filter((item) => !sameCourse(item, code)))
    dropPins(code)
    setTaken((codes) => codes.filter((item) => !sameCourse(item, code)))
    setCart((codes) => [...codes, code])
  }

  // Mark / unmark a whole group of codes as 已完成 in one shot (ProgramTable's group
  // buttons). Dedupe by key on add; drop any newly-completed course from 必定学/可能学 too.
  function bulkTaken(codes: string[], add: boolean): void {
    setPlanIndex(0)
    if (add) {
      const addKeys = new Set(codes.map(courseKey))
      setCommitted((prev) => prev.filter((item) => !addKeys.has(courseKey(item))))
      setCart((prev) => prev.filter((item) => !addKeys.has(courseKey(item))))
      setTaken((prev) => {
        const have = new Set(prev.map(courseKey))
        const additions = codes.filter((code) => !have.has(courseKey(code)))
        return additions.length > 0 ? [...prev, ...additions] : prev
      })
    } else {
      const rmKeys = new Set(codes.map(courseKey))
      setTaken((prev) => prev.filter((item) => !rmKeys.has(courseKey(item))))
    }
  }

  // 已完成课程卡的手动录入:回车 / 粘贴的文本经 parseCourseCodes 拆出课号,按 key 去重并入 taken。
  function addTaken(text: string): void {
    const parsed = parseCourseCodes(text)
    if (parsed.length === 0) return
    setTaken((prev) => {
      const have = new Set(prev.map(courseKey))
      const additions = parsed.filter((code) => !have.has(courseKey(code)))
      return additions.length > 0 ? [...prev, ...additions] : prev
    })
    setTakenDraft('')
  }

  function removeTaken(code: string): void {
    setTaken((codes) => codes.filter((item) => !sameCourse(item, code)))
  }

  function removeCommitted(code: string): void {
    setCommitted((codes) => codes.filter((item) => !sameCourse(item, code)))
    dropPins(code)
    setPlanIndex(0)
  }

  function removeCart(code: string): void {
    setCart((codes) => codes.filter((item) => !sameCourse(item, code)))
  }

  // 信息页「入学年份」旁的刷新:强制重载 programs.json(走版本化通道,非裸 fetch),
  // 并按当前入学年份重解析所选方案——若存在 name_en 相同、year===enrollYear 的另一版本,
  // 则切过去,让「改了入学年份 → 刷新 → 大课表切到该年份版本」成立。无所选/无匹配则仅重载。
  async function refreshPrograms(): Promise<void> {
    if (refreshingPrograms) return
    setRefreshingPrograms(true)
    try {
      const next = await reloadPrograms()
      setPrograms(next)
      if (programId && enrollYear) {
        const current = next.find((p) => p.id === programId)
        if (current) {
          const match = next.find((p) => p.name_en === current.name_en && p.year === enrollYear)
          if (match && match.id !== programId) setProgramId(match.id)
        }
      }
    } catch {
      // 重载失败保持现状,不打断信息页。
    } finally {
      setRefreshingPrograms(false)
    }
  }

  const committedCard = (
    <section className="card committed-card">
      <h2 className="card__title">
        当前必修课程
        <span className="card__note">{totalUnits > 0 ? `${totalUnits} 学分` : '一课一行'}</span>
      </h2>
      <CommittedList
        byCode={byCode}
        codes={committed}
        currentTermOrder={currentTermOrder}
        termOrdersByKey={termOrdersByKey}
        onRemove={removeCommitted}
      />
      {unknownCommitted.length > 0 && (
        <p className="card__warn">本学期没有开设：{unknownCommitted.join('、')}</p>
      )}
    </section>
  )

  // 「当前可能课程」= 可能学 waitlist / cart，单独一张圆角卡，紧接在「当前必修课程」下方（选课页）。
  const cartCard = (
    <section className="card cart-card">
      <h2 className="card__title">
        当前可能课程
        <span className="card__note">{cart.length > 0 ? `${cart.length} 门候选` : '可能会学'}</span>
      </h2>
      <CommittedList
        byCode={byCode}
        codes={cart}
        currentTermOrder={currentTermOrder}
        emptyHint="还没有候选课程。在中间的课程列表点「可能学」来添加。"
        termOrdersByKey={termOrdersByKey}
        onRemove={removeCart}
      />
    </section>
  )

  // #6 排课筛选卡（课表页左栏，位于「当前选择课程」上方）：时间段 + 避开午休写进 prefs，
  // 「不展示冲突的方案」与右侧排法横条配合。默认全为「不限/关/开」，等价于 DEFAULT_PREFS。
  const scheduleFilterCard = (
    <section className="card">
      <h2 className="card__title">
        排课筛选
        <span className="card__note">
          {plans.length > 0 ? `${shownPlanViews.length} 种排法` : '影响右侧排法'}
        </span>
      </h2>
      <div className="field">
        <span className="field__label">最早开始</span>
        <select
          className="mini-select"
          aria-label="最早开始上课时间"
          value={ttEarliest ?? ''}
          onChange={(event) => setTtEarliest(event.target.value === '' ? null : Number(event.target.value))}
        >
          {EARLIEST_OPTIONS.map((option) => (
            <option key={option.label} value={option.value ?? ''}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="field__label">最晚结束</span>
        <select
          className="mini-select"
          aria-label="最晚结束上课时间"
          value={ttLatest ?? ''}
          onChange={(event) => setTtLatest(event.target.value === '' ? null : Number(event.target.value))}
        >
          {LATEST_OPTIONS.map((option) => (
            <option key={option.label} value={option.value ?? ''}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="check-row">
        <label className="check">
          <input
            checked={ttAvoidLunch}
            type="checkbox"
            onChange={(event) => setTtAvoidLunch(event.target.checked)}
          />
          <span>避开午休（12:30–13:30）</span>
        </label>
        <label className="check">
          <input
            checked={hideConflicts}
            type="checkbox"
            onChange={(event) => setHideConflicts(event.target.checked)}
          />
          <span>不展示冲突的方案</span>
        </label>
      </div>
    </section>
  )

  const committedCardTT = (
    <section className="card committed-card">
      <h2 className="card__title">
        当前必修课程
        <span className="card__note">{totalUnits > 0 ? `${totalUnits} 学分 · 选时段` : '选时段'}</span>
      </h2>
      <CommittedList
        byCode={byCode}
        codes={committed}
        currentTermOrder={currentTermOrder}
        pins={pins}
        termOrdersByKey={termOrdersByKey}
        onPin={togglePin}
        onRemove={removeCommitted}
      />
      {unknownCommitted.length > 0 && (
        <p className="card__warn">本学期没有开设：{unknownCommitted.join('、')}</p>
      )}
    </section>
  )

  // 信息页:「我的情况」= 入学年份 + 主修(具体培养方案单选,整宽长条框)。
  const myInfoCard = (
    <section className="card">
      <h2 className="card__title">我的情况</h2>
      <div className="profile-row profile-row--stack">
        <div className="field">
          <span className="field__label">入学年份</span>
          <div className="profile-year__row">
            <select value={enrollYear} onChange={(event) => setEnrollYear(event.target.value)}>
              <option value="">选择</option>
              {['2022', '2023', '2024', '2025', '2026'].map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <button
              aria-label="刷新培养方案课表"
              className={`profile-refresh${refreshingPrograms ? ' profile-refresh--busy' : ''}`}
              disabled={refreshingPrograms}
              title="按入学年份刷新右侧大课表数据"
              type="button"
              onClick={() => void refreshPrograms()}
            >
              ↻
            </button>
          </div>
        </div>
        <div className="field">
          <span className="field__label">主修 Major</span>
          <ProgramPicker
            programs={programs}
            selectedId={programId}
            subjects={subjects}
            year={enrollYear || undefined}
            onChange={(id) => setProgramId(id ?? '')}
          />
        </div>
      </div>
    </section>
  )

  // 信息页:「已完成课程」独立成卡。手动录入框(回车/粘贴)在上,已录入课程以两列网格展示,
  // 每格只显示 课号 + 学分(catalogByKey 查不到则留空),点击整格移除。
  const takenCard = (
    <section className="card">
      <h2 className="card__title">
        已完成课程
        <span className="card__note">排除已修 · 判断先修</span>
      </h2>
      <p className="card__sub">已录入 {taken.length} 门</p>
      <input
        className="search-box"
        placeholder="粘贴成绩单上的课号，回车录入…"
        value={takenDraft}
        onChange={(event) => setTakenDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            addTaken(takenDraft)
          }
        }}
        onPaste={(event) => {
          const parsed = parseCourseCodes(event.clipboardData.getData('text'))
          if (parsed.length > 0) {
            event.preventDefault()
            addTaken(event.clipboardData.getData('text'))
          }
        }}
      />
      {taken.length > 0 && (
        <div className="taken-grid">
          {taken.map((code) => {
            const course = catalogByKey.get(courseKey(code))
            return (
              <button
                className="taken-cell"
                key={code}
                style={courseColor(code)}
                title="点击移除"
                type="button"
                onClick={() => removeTaken(code)}
              >
                <span className="taken-cell__code">{code}</span>
                {course && <span className="taken-cell__units">{course.units}学分</span>}
                <i aria-hidden>×</i>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )

  // 信息页左栏:培养方案大课表(必修 / 选修 / 分流分组)。
  const programTable = (
    <ProgramTable
      catalogByKey={catalogByKey}
      program={selectedProgram ?? null}
      takenSet={takenSet}
      onBulkTaken={bulkTaken}
      onToggleTaken={toggleTaken}
    />
  )

  const searchCard = (
    <section className="card search-card">
      <h2 className="card__title">搜索</h2>
      <label className="field">
        <span className="field__label">关键词</span>
        <input
          className="search-box"
          placeholder="课号或课名…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="field">
        <span className="field__label field__label--include">想要的学科</span>
        <SubjectPicker
          onChange={setIncludeSubjects}
          placeholder="包含，如 CSCI…"
          selected={includeSubjects}
          subjects={subjects}
          variant="include"
        />
      </div>
      <div className="field">
        <span className="field__label field__label--exclude">排除的学科</span>
        <SubjectPicker
          onChange={setExcludeSubjects}
          placeholder="排除…"
          selected={excludeSubjects}
          subjects={subjects}
          variant="exclude"
        />
      </div>
      <div className="filter-block">
        <span className="filter-block__title">课程范围</span>
        <Toggle
          checked={programScope === 'program'}
          disabled={!selectedProgram}
          title={!selectedProgram ? '先在信息页选择主修' : undefined}
          onChange={(on) => setProgramScope(on ? 'program' : 'all')}
        >
          只看在选课信息中的课
        </Toggle>
      </div>
      <div className="filter-block">
        <span className="filter-block__title">时间约束 · 可选性</span>
        <Toggle checked={meetsPrereq} onChange={setMeetsPrereq}>
          符合先修
        </Toggle>
        <Toggle checked={lecFits} onChange={setLecFits}>
          符合时间表（仅LEC）
        </Toggle>
        <Toggle checked={hideCompleted} onChange={setHideCompleted}>
          隐藏已完成
        </Toggle>
        <Toggle checked={currentTermOnly} onChange={setCurrentTermOnly}>
          只包括当前学期
        </Toggle>
        <Toggle checked={excludeTba} onChange={setExcludeTba}>
          排除时间待定
        </Toggle>
      </div>
      <div className="field">
        <span className="field__label">学分</span>
        <div className="chips" role="group" aria-label="学分">
          {UNIT_PICKS.map(({ value, label }) => (
            <button
              className={units.includes(value) ? 'chip chip--on' : 'chip'}
              key={value}
              type="button"
              onClick={() => setUnits((current) => toggleValue(current, value))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field__label">课程等级</span>
        <div className="chips" role="group" aria-label="课程等级">
          {LEVEL_BUCKETS.map(({ value, label }) => (
            <button
              className={levels.includes(value) ? 'chip chip--on' : 'chip'}
              key={value}
              type="button"
              onClick={() => setLevels((current) => toggleValue(current, value))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field__label">上课时段</span>
        <div className="chips" role="group" aria-label="上课时段">
          {DAYPARTS.map(({ value, label }) => (
            <button
              className={dayparts.includes(value) ? 'chip chip--on' : 'chip'}
              key={value}
              type="button"
              onClick={() => setDayparts((current) => toggleValue(current, value))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  )

  const problemsCard =
    clashes.length > 0 ? (
      <section className="card card--problem">
        <h2 className="card__title">排不出课表</h2>
        {clashes.slice(0, 4).map((clash) => (
          <p key={`${clash.codes.join()}-${clash.start}`}>
            <b>{clash.codes[0]}</b> 与 <b>{clash.codes[1]}</b> 在{DAY_NAMES[clash.dayIndex - 1]}{' '}
            {hhmm(clash.start)}–{hhmm(clash.end)} 冲突
          </p>
        ))}
      </section>
    ) : null

  // 非阻断提示:因已修互斥课而被自动移出「当前选择」的课(效果 a)。
  const autoRemovedNote =
    autoRemoved.length > 0 ? (
      <p className="auto-removed" role="status">
        <b>{autoRemoved.join('、')}</b> 因已修互斥课已自动移除
      </p>
    ) : null

  // 导出页:排法选择器复用 A / B mini-select（与课表页同源），供 .ics / 图片选定要导出的排法。
  const abPicker =
    plans.length > 0 ? (
      <div className="ab-legend">
        <label className="ab-legend__item">
          <i className="tt2__tag tt2__tag--a">A</i>
          <select
            className="mini-select"
            aria-label="A 排法"
            value={planAIndex}
            onChange={(event) => setPlanAIndex(Number(event.target.value))}
          >
            {plans.map((plan, index) => (
              <option key={plan.id} value={index}>
                排法 {index + 1} · {plan.teachingDays.length}天
              </option>
            ))}
          </select>
        </label>
        {plans.length >= 2 && (
          <label className="ab-legend__item">
            <i className="tt2__tag tt2__tag--b">B</i>
            <select
              className="mini-select"
              aria-label="B 排法"
              value={planBIndex}
              onChange={(event) => setPlanBIndex(Number(event.target.value))}
            >
              {plans.map((plan, index) => (
                <option key={plan.id} value={index}>
                  排法 {index + 1} · {plan.teachingDays.length}天
                  {index === planAIndex ? '（与 A 相同）' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    ) : null

  // #7 排法横条（课表页右主区顶部，可横向滚动）：每张扁平小卡左侧显示 排法N · 天数 · 学分，
  // 右侧两个方形小按钮「A」「B」分别设为该排法（选中态高亮），压低纵向占用、给大课表让空间。
  const planStrip =
    plans.length > 0 ? (
      <div className="plan-strip__rail">
        {shownPlanViews.map(({ plan, index }) => {
          const isA = index === planAIndex
          const isB = plans.length >= 2 && index === planBIndex
          return (
            <div
              className={`plan-card${isA ? ' plan-card--a' : ''}${isB ? ' plan-card--b' : ''}`}
              key={plan.id}
            >
              <div className="plan-card__info">
                <span className="plan-card__name">排法 {index + 1}</span>
                <span className="plan-card__meta">
                  {plan.teachingDays.length} 天 · {plan.units} 学分
                </span>
              </div>
              <div className="plan-card__actions">
                <button
                  aria-label={`排法 ${index + 1} 设为 A`}
                  className={`plan-card__pick plan-card__pick--a${isA ? ' plan-card__pick--on' : ''}`}
                  title="设为 A"
                  type="button"
                  onClick={() => setPlanAIndex(index)}
                >
                  A
                </button>
                <button
                  aria-label={`排法 ${index + 1} 设为 B`}
                  className={`plan-card__pick plan-card__pick--b${isB ? ' plan-card__pick--on' : ''}`}
                  title="设为 B"
                  type="button"
                  onClick={() => setPlanBIndex(index)}
                >
                  B
                </button>
              </div>
            </div>
          )
        })}
      </div>
    ) : null

  const exportView = (
    <div className="page-center page-center--export">
      <section className="card">
        <h2 className="card__title">
          导出范围
          <span className="card__note">{term?.name ?? ''}</span>
        </h2>
        {plans.length === 0 ? (
          <p className="card__sub">先在选课页选课，才能导出课表</p>
        ) : (
          <>
            {abPicker}
            <p className="card__sub">
              已选 {committedCourses.length} 门 · {totalUnits} 学分
            </p>
          </>
        )}
      </section>

      <div className="export-grid">
        <section className="card export-card">
          <h3 className="card__title">日历 .ics</h3>
          <p className="card__sub">导出排法 A 的每周日程,时间为估计,以 CUSIS 为准。</p>
          <button
            className="export-btn"
            disabled={!planA}
            type="button"
            onClick={() => void handleExport('ics')}
          >
            下载 .ics
          </button>
        </section>
        <section className="card export-card">
          <h3 className="card__title">图片 PNG</h3>
          <p className="card__sub">A / B 对比图,适合分享。</p>
          <button
            className="export-btn"
            disabled={!planA}
            type="button"
            onClick={() => void handleExport('image')}
          >
            下载图片
          </button>
        </section>
        <section className="card export-card">
          <h3 className="card__title">分享链接</h3>
          <p className="card__sub">复制链接,打开即恢复选课。</p>
          <button
            className="export-btn"
            disabled={committed.length === 0 && taken.length === 0}
            type="button"
            onClick={() => void handleExport('link')}
          >
            复制链接
          </button>
        </section>
      </div>

      {exportNote && <p className="export-note">{exportNote}</p>}
    </div>
  )

  const resetButton =
    committed.length > 0 || taken.length > 0 || cart.length > 0 ? (
      <button
        className="reset"
        type="button"
        onClick={() => {
          setCommitted([])
          setTaken([])
          setCart([])
          setPins({})
          setPlanIndex(0)
          setAutoRemoved([])
        }}
      >
        清空全部
      </button>
    ) : null

  // 每一页的内容体（<main> 的直接子节点）。切页动画期间会同时挂载「来向页」与「目标页」两层，
  // 各自套上不同的 grid 列布局与滑动 class，动画结束后只剩目标页（solo）。
  const pageInner = (p: Page): ReactNode => {
    switch (p) {
      case 'info':
        return (
          <>
            <section className="prog-pane">{programTable}</section>
            <aside className="side side--info">
              {myInfoCard}
              {takenCard}
              <p className="info-note">这些信息用于判断先修与本专业筛选。</p>
            </aside>
          </>
        )
      case 'select':
        return (
          <>
            <aside className="side side--filters">{searchCard}</aside>
            <section className="results-pane">
              {loading ? (
                <div className="pane__loading">正在加载 {year ?? ''} 全部课程…</div>
              ) : (
                <SearchResults
                  barredKeys={barredKeys}
                  cartSet={cartSet}
                  committedSet={committedSet}
                  filters={filters}
                  lecBusy={lecBusy}
                  offerings={offerings}
                  standingByKey={standingByKey}
                  statusByCode={statusByCode}
                  prereqByCode={prereqByCode}
                  takenSet={takenSet}
                  titleByCode={titleByCode}
                  onCart={toggleCart}
                  onCommit={toggleCommitted}
                  onOpenDetail={setDetailCourse}
                  onTaken={toggleTaken}
                />
              )}
            </section>
            <aside className="side side--commit">
              {committedCard}
              {cartCard}
              {autoRemovedNote}
              {problemsCard}
              {resetButton}
            </aside>
          </>
        )
      case 'timetable':
        return (
          <>
            {/* #4 左右对调：左窄栏（排课筛选→当前选择→问题/清空）先，右宽栏（排法横条→大课表）后。 */}
            <aside className="side side--tt">
              {scheduleFilterCard}
              {committedCardTT}
              {problemsCard}
              {resetButton}
            </aside>
            <section className="stage">
              {planStrip}
              <TimetableCompare
                colorForCode={colorForCode}
                emptyMessage={
                  committedCourses.length === 0
                    ? '在左侧选择当前选择课程，A / B 两种排法会自动排出来'
                    : '这些课排不出无冲突的课表，左侧列出了卡住的地方'
                }
                planA={planA}
                planB={planB}
              />
            </section>
          </>
        )
      case 'export':
        return exportView
    }
  }

  return (
    <div className="app">
      <header className="bar">
        <div className="bar__left">
          <div className="bar__brand">
            <span className="bar__mark" aria-hidden />
            <h1>CU Schedule</h1>
          </div>
          {mainTerms.length > 0 && (
            <div className="term-switch" aria-label="当前选课学期">
              <span className="term-switch__label">当前选课</span>
              {mainTerms.map((item) => (
                <button
                  className={item.slug === termSlug ? 'term-switch__btn term-switch__btn--on' : 'term-switch__btn'}
                  key={item.slug}
                  type="button"
                  onClick={() => {
                    setTermSlug(item.slug)
                    setPlanIndex(0)
                  }}
                >
                  {item.name.match(/Term\s*[12]/)?.[0] ?? item.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <nav className="bar__nav">
          {PAGES.map(({ value, label }) => (
            <button
              className={page === value ? 'bar__nav-item bar__nav-item--on' : 'bar__nav-item'}
              key={value}
              type="button"
              onClick={() => go(value)}
            >
              <span className="bar__nav-icon">{PAGE_ICON[value]}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="bar__tools">
          <button
            aria-label="切换明暗主题"
            className="bar__theme"
            type="button"
            onClick={() => setTheme((value) => (value === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>
      </header>

      {error && <div className="alert">{error}</div>}

      <main className={`viewport${transition ? ' viewport--anim' : ''}`}>
        {/* 来向页（仅切换时挂载）：向一侧滑出。 */}
        {transition && (
          <div
            aria-hidden
            className={`grid grid--${transition.from} layer layer--exit ${
              transition.dir === 1 ? 'to-left' : 'to-right'
            }`}
            key={transition.from}
          >
            {pageInner(transition.from)}
          </div>
        )}

        {/* 目标页：无动画时为唯一的 solo 层；切换时从另一侧滑入。 */}
        <div
          className={
            !transition
              ? `grid grid--${page} layer layer--solo`
              : `grid grid--${page} layer layer--enter ${transition.dir === 1 ? 'from-right' : 'from-left'}`
          }
          key={page}
        >
          {pageInner(page)}
        </div>
      </main>

      <footer className="foot">
        数据抓取自{' '}
        <a href="https://rgsntl.rgs.cuhk.edu.hk/aqs_prd_applx/Public/tt_dsp_crse_catalog.aspx" rel="noreferrer" target="_blank">
          CUHK 公开课程目录
        </a>
        ，抓取管线来自{' '}
        <a href="https://github.com/EagleZhen/another-cuhk-course-planner" rel="noreferrer" target="_blank">
          EagleZhen/another-cuhk-course-planner
        </a>{' '}
        (AGPL-3.0) · 名额与 Closed 状态请以 CUSIS 实时数据为准
      </footer>

      {detailCourse && (
        <CourseModal
          blockedReason={detailBlockedReason}
          course={detailCourse}
          isCart={cartSet.has(detailCourse.key)}
          isCommitted={committedSet.has(detailCourse.key)}
          isTaken={takenSet.has(detailCourse.key)}
          standing={detailStanding}
          onClose={() => setDetailCourse(null)}
          onToggleCart={() => toggleCart(detailCourse.code)}
          onToggleCommitted={() => toggleCommitted(detailCourse.code)}
          onToggleTaken={() => toggleTaken(detailCourse.code)}
        />
      )}
    </div>
  )
}
