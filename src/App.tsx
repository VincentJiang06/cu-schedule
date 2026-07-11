import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { CommittedList } from './components/CommittedList.tsx'
import { CourseModal } from './components/CourseModal.tsx'
import { ProgramPicker } from './components/ProgramPicker.tsx'
import { ProgramTable } from './components/ProgramTable.tsx'
import {
  SearchResults,
  type LecBusy,
  type LevelBucket,
  type SearchFilters,
  type UnitPick,
} from './components/SearchResults.tsx'
import { SubjectPicker } from './components/SubjectPicker.tsx'
import { TimetableCompare, type GhostBlock } from './components/TimetableCompare.tsx'
import { evaluateCandidates } from './lib/candidates.ts'
import { copyText } from './lib/clipboard.ts'
import { courseColor, huePaint } from './lib/color.ts'
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
import { decodeLiveState, decodeShare, encodeLiveState, type LiveState } from './lib/shareLink.ts'
import { createShare } from './lib/shareStore.ts'
import {
  loadSubjects,
  loadTermList,
  loadYearOfferings,
  type Offering,
  type SubjectInfo,
  type TermRef,
} from './lib/data.ts'
import {
  comboMeetings,
  courseCombos,
  findClashes,
  generatePlans,
  meetingsClash,
  NO_PREFS,
  overlaps,
  planFitsWindow,
  type Pins,
  type Plan,
  type TimeWindow,
} from './lib/schedule.ts'
import { hhmm, parseHHMM } from './lib/time.ts'
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

// 页脚友链带：icon 文件已放在 public/assets/sib-icons/，顺序照产品给定的清单。
const SIBLINGS: Array<{ icon: string; url: string; name: string }> = [
  { icon: '/assets/sib-icons/vincejiang.png', url: 'https://vincejiang.com/', name: 'VincentJiang 主站' },
  { icon: '/assets/sib-icons/cuhkwild.png', url: 'https://cuhkwild.com/', name: '中大野史' },
  { icon: '/assets/sib-icons/hkuwild.png', url: 'https://hkuwild.com/', name: '港大野史' },
  { icon: '/assets/sib-icons/hkustwild.png', url: 'https://hkustwild.com/', name: '科大野史' },
  { icon: '/assets/sib-icons/cityuwild.png', url: 'https://cityuwild.com/', name: '城大野史' },
  { icon: '/assets/sib-icons/polyuwild.png', url: 'https://polyuwild.com/', name: '理大野史' },
  { icon: '/assets/sib-icons/hkuniwild.png', url: 'https://hkuniwild.com/', name: '港校通门户' },
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

// 上下班时间的持久化：空字符串=未设置(null)，否则存分钟数字符串。默认 09:00 / 18:00，
// 与原辅助线的默认值保持一致。用两个独立 key（不是一个 JSON blob），风格对齐
// cu-schedule:year / cu-schedule:program 那种单值 key。
function loadWorkStart(): number | null {
  const raw = window.localStorage.getItem('cu-schedule:work-start')
  if (raw === null) return 9 * 60
  if (raw === '') return null
  const minutes = Number(raw)
  return Number.isFinite(minutes) ? minutes : 9 * 60
}
function loadWorkEnd(): number | null {
  const raw = window.localStorage.getItem('cu-schedule:work-end')
  if (raw === null) return 18 * 60
  if (raw === '') return null
  const minutes = Number(raw)
  return Number.isFinite(minutes) ? minutes : 18 * 60
}

// URL 承载会话状态,三层来源互斥,优先级从高到低:
// 1) #st= —— 本会话的实时状态("URL 实时状态同步",见下方 App 组件内的 effect),写入
//    时机由用户操作驱动(切 tab → pushState;编辑 → 防抖 replaceState)。含 page + 选课
//    四要素 + 关键开关。几乎每次刷新都会命中这条——它就是"回到刷新前/返回键落点前"。
// 2) #s= —— 别人发来的分享链接(一次性导入),只含选课四要素,不含 page/开关;
//    导入后仍按旧逻辑落 localStorage 并抹掉 hash(见下方 shared-import effect)。
// 3) 都没有 → 退回 localStorage 存档。
// #v= 是只读分享,由 main.tsx 在渲染 App 之前就分流成 <ShareView>,这里永远遇不到。
function readLive(): LiveState | null {
  if (typeof window === 'undefined') return null
  return decodeLiveState(window.location.hash)
}
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

const live = readLive()
const shared = live ? null : readShared()
const saved = loadSaved()
// 逐字段取值而不是合并出一个 boot 对象:cart(可能学)从不进 URL(#s=/#st= 都不带它,
// 与既有"分享链接不含可能学"的设计一致),必须总是来自 localStorage —— 否则 URL 驱动的
// 首屏(几乎每次刷新都会命中 #st=)会把候选课程清空,是明显的回归。
const bootTermSlug = live?.termSlug ?? shared?.termSlug ?? saved?.termSlug ?? null
const bootCommitted = live?.committed ?? shared?.committed ?? saved?.committed ?? []
const bootTaken = live?.taken ?? shared?.taken ?? saved?.taken ?? []
const bootPins = live?.pins ?? shared?.pins ?? saved?.pins ?? {}
const bootCart = saved?.cart ?? []
const bootPage: Page = live?.page ?? 'select'

export default function App() {
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [terms, setTerms] = useState<TermRef[]>([])
  const [termSlug, setTermSlug] = useState<string | null>(bootTermSlug)
  const [offerings, setOfferings] = useState<Offering[]>([])
  const [subjects, setSubjects] = useState<SubjectInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [committed, setCommitted] = useState<string[]>(bootCommitted)
  const [taken, setTaken] = useState<string[]>(bootTaken)
  // 可能学 waitlist / cart — tentative picks, held apart from 必定学 (committed).
  const [cart, setCart] = useState<string[]>(bootCart)
  // Pinned sections (e.g. TUT T01) constrain which A / B timetables the scheduler builds.
  const [pins, setPins] = useState<Pins>(bootPins)
  const [planIndex, setPlanIndex] = useState(0)
  // 课表页 A / B 各自选中的排法下标（默认第 1、第 2 种）；plans 变化越界时重置回默认。
  const [planAIndex, setPlanAIndex] = useState(0)
  const [planBIndex, setPlanBIndex] = useState(1)
  // #12 单方案模式:点排法横条的方框 → 只看这一个排法(退出 A/B 对比);点 A / B 按钮回到对比。
  const [soloPlanIndex, setSoloPlanIndex] = useState<number | null>(null)
  const [page, setPage] = useState<Page>(bootPage)
  // 当前正在播放的切页动画（null = 无动画，直接渲染单页）。
  const [transition, setTransition] = useState<PageTransition | null>(null)
  // The course whose detail popup is open (null = closed).
  const [detailCourse, setDetailCourse] = useState<Course | null>(null)

  // go() 的 pushState 需要读全部会话字段(termSlug/committed/…/workEnd),但那些 state 声明
  // 在 go 之后才出现;用一个稳定 ref 占位「构建 hash 的函数」,真正实现在下方渲染体里补上
  // （与下面 dragMoveImplRef 同一手法:ref 先占位、useCallback 引用 .current、实现体后补,
  // 因为闭包只在调用时才读取 .current,不受声明顺序影响)。
  const liveHashBuilderRef = useRef<(p: Page) => string>(() => '')
  // popstate 恢复触发的这一轮 state 变化不需要再 replaceState 写回 URL(URL 已经是这个状态
  // 了)——见下方「URL 实时状态同步」两个 effect。
  const restoringUrlRef = useRef(false)

  // 切页统一入口：记录来向与方向，触发一次横向滑动，动画结束后清空 transition 回到单页渲染；
  // 同时 pushState 一条新历史条(hash 里的 page 换成目标页,其它字段读最近一次渲染的状态,
  // 因为它们没变),使浏览器返回键能回到切换前的 tab。
  const go = useCallback(
    (to: Page) => {
      if (to === page) return
      setTransition({ from: page, dir: PAGE_ORDER[to] > PAGE_ORDER[page] ? 1 : -1 })
      setPage(to)
      const hash = liveHashBuilderRef.current(to)
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
    },
    [page],
  )

  // 动画计时结束后落幕：清掉 transition，让 viewport 回到单页（solo）渲染。
  useEffect(() => {
    if (!transition) return
    const timer = window.setTimeout(() => setTransition(null), TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [transition])

  // 课表页「上下班时间」（原「辅助线」）。用户自由输入 <input type="time">，两条虚线画在日历上
  // 供目测；同时也是「不展示不符合上下班限制的方案」与搜索卡「符合上下班时间」两个过滤开关的窗口来源。
  // null=不设该条线。持久化到 localStorage（cu-schedule:work-start / -end），默认 09:00 / 18:00。
  // #st= 里若带了这两个字段(哪怕是 null,即"未设线")就以它为准；没有 #st= 才退回
  // localStorage(与其它字段的 boot 优先级一致——live > 本地存档)。
  const [workStart, setWorkStart] = useState<number | null>(() => (live ? live.workStart : loadWorkStart()))
  const [workEnd, setWorkEnd] = useState<number | null>(() => (live ? live.workEnd : loadWorkEnd()))
  useEffect(() => {
    window.localStorage.setItem('cu-schedule:work-start', workStart === null ? '' : String(workStart))
  }, [workStart])
  useEffect(() => {
    window.localStorage.setItem('cu-schedule:work-end', workEnd === null ? '' : String(workEnd))
  }, [workEnd])
  // 「不展示冲突的方案」开关（默认开），与排法横条配合过滤显示的排法。
  const [hideConflicts, setHideConflicts] = useState(live?.hideConflicts ?? true)
  // 「不展示不符合上下班限制的方案」（默认关——比 hideConflicts 更容易把方案全滤空，交给用户主动开）。
  const [hideOutOfHours, setHideOutOfHours] = useState(live?.hideOutOfHours ?? false)
  // 搜索卡「符合上下班时间」（默认关，同上）。
  const [meetsOfficeHours, setMeetsOfficeHours] = useState(live?.meetsOfficeHours ?? false)
  // 两头都没设时间 → 上面两个开关都禁用，且自动关闭（避免「勾着但禁用」的悬空态）。
  const officeWindow = useMemo<TimeWindow>(() => ({ start: workStart, end: workEnd }), [workEnd, workStart])
  const officeWindowUnset = workStart === null && workEnd === null
  useEffect(() => {
    if (officeWindowUnset) {
      setHideOutOfHours(false)
      setMeetsOfficeHours(false)
    }
  }, [officeWindowUnset])
  // 排课不再做时间自动筛选（上下班窗口是排法横条/搜索卡的显示过滤，不是 scheduler 输入）；
  // prefs 恒为空，scheduler 只负责排出无冲突课表。
  const prefs = NO_PREFS

  // 选课 page filters — subjects support positive (include) and negative (exclude),
  // selectability toggles between all / only 可选 / only 不可选.
  const [search, setSearch] = useState('')
  const [includeSubjects, setIncludeSubjects] = useState<string[]>([])
  const [excludeSubjects, setExcludeSubjects] = useState<string[]>([])
  // 符合先修:排除先修被证伪的课。符合时间表(仅LEC):只留 LEC 能塞进当前课表的课。默认皆关。
  const [meetsPrereq, setMeetsPrereq] = useState(live?.meetsPrereq ?? false)
  const [lecFits, setLecFits] = useState(live?.lecFits ?? false)
  const [units, setUnits] = useState<UnitPick[]>([])
  const [levels, setLevels] = useState<LevelBucket[]>([])
  const [hideCompleted, setHideCompleted] = useState(live?.hideCompleted ?? true)
  const [currentTermOnly, setCurrentTermOnly] = useState(live?.currentTermOnly ?? true)
  const [excludeTba, setExcludeTba] = useState(live?.excludeTba ?? false)
  // Restrict the catalog to the selected programme's courses (needs a chosen major).
  const [programScope, setProgramScope] = useState<ProgramScope>(live?.programScope ?? 'all')

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

  // 浏览器返回/前进键:popstate 只在 history.back()/forward()/go() 时触发(replaceState 本身
  // 不触发,不会自环)。解出 #st= 就整体恢复(含 page);解不出(比如退到最初、pushState 之前
  // 那条没有 #st= 的历史)保持现状不动——好过把已经在内存里的选课清空。restoringUrlRef 置位
  // → 下方「URL 实时状态同步」effect 会在这轮变化后跳过一次 replaceState,避免恢复瞬间的
  // 中间态覆盖刚恢复好的 URL(React 18+ 对原生事件里的这一串 setState 自动批处理成一次渲染,
  // 所以下方 effect 只会在这轮恢复后跑一次,标志位读一次即够)。
  useEffect(() => {
    const onPopState = (): void => {
      const state = decodeLiveState(window.location.hash)
      if (!state) return
      restoringUrlRef.current = true
      setPage(state.page)
      setTermSlug(state.termSlug)
      setCommitted(state.committed)
      setTaken(state.taken)
      setPins(state.pins)
      setHideConflicts(state.hideConflicts)
      setHideOutOfHours(state.hideOutOfHours)
      setMeetsOfficeHours(state.meetsOfficeHours)
      setMeetsPrereq(state.meetsPrereq)
      setLecFits(state.lecFits)
      setHideCompleted(state.hideCompleted)
      setCurrentTermOnly(state.currentTermOnly)
      setExcludeTba(state.excludeTba)
      setProgramScope(state.programScope)
      setWorkStart(state.workStart)
      setWorkEnd(state.workEnd)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
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

  // ---- URL 实时状态同步(用网址记录当前状态 + 返回键恢复) ----------------------------
  // 每次渲染把"构建 #st= hash"的最新实现刷新到 go() 早先占位的 ref 里(与 colorSlotRef 那种
  // 渲染体内直接改 ref 是同一手法),这样 go() 的 pushState 总能读到最新的 committed/pins/
  // 开关等,而不必把 go 挪到这些 state 声明之后。
  liveHashBuilderRef.current = (p: Page): string =>
    encodeLiveState({
      page: p,
      termSlug,
      committed,
      taken,
      pins,
      hideConflicts,
      hideOutOfHours,
      meetsOfficeHours,
      meetsPrereq,
      lecFits,
      hideCompleted,
      currentTermOnly,
      excludeTba,
      programScope,
      workStart,
      workEnd,
    })

  // 切 tab 之外的一切编辑(committed/taken/pins/开关/上下班时间)→ 防抖 replaceState,原地
  // 更新地址栏,不新增历史条——否则每勾一次课都是一步返回键,体验灾难。200ms 防抖避免连续
  // 操作(比如快速勾选好几门课)时高频改写 history。
  useEffect(() => {
    if (restoringUrlRef.current) {
      // 这一轮变化是 popstate 恢复触发的,URL 已经是这个状态了,不用再写回去。
      restoringUrlRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      const hash = liveHashBuilderRef.current(page)
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
    }, 200)
    return () => window.clearTimeout(timer)
  }, [
    committed,
    currentTermOnly,
    excludeTba,
    hideCompleted,
    hideConflicts,
    hideOutOfHours,
    lecFits,
    meetsOfficeHours,
    meetsPrereq,
    page,
    pins,
    programScope,
    taken,
    termSlug,
    workEnd,
    workStart,
  ])

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

  // 效果 a':互斥关系解除后(用户撤销了那门已修课)同步清理提示——否则「已自动移除」会一直挂着。
  // 只保留仍被 barred 的条目;全部解除则数组清空,提示自然消失。
  useEffect(() => {
    setAutoRemoved((prev) => {
      const next = prev.filter((code) => barredKeys.has(courseKey(code)))
      return next.length === prev.length ? prev : next
    })
  }, [barredKeys])

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

  // #7 排法横条数据：每个排法带上它在 plans 中的真实下标（A/B 选择以此为准）、冲突判定
  // （实践中恒为 false，见 planHasConflict 注释）与「是否落在上下班窗口内」判定。
  const planViews = useMemo(
    () =>
      plans.map((plan, index) => ({
        plan,
        index,
        conflict: planHasConflict(plan),
        outOfHours: !planFitsWindow(plan, officeWindow),
      })),
    [officeWindow, plans],
  )
  const shownPlanViews = planViews.filter(
    (view) => (!hideConflicts || !view.conflict) && (!hideOutOfHours || !view.outOfHours),
  )
  // 过滤后仍「可见」的排法下标集合——A / B 的实际展示要跟着这两个开关走，而不是盲选 plans[index]，
  // 否则「不展示不符合上下班限制的方案」开着时,日历仍可能画出一个被过滤掉的排法。
  const visiblePlanIndices = useMemo(() => new Set(shownPlanViews.map((view) => view.index)), [shownPlanViews])

  // The 课表 page compares two user-picked conflict-free timetables side by side, but only
  // among the plans that survive the current filters (见上 visiblePlanIndices)。全部被滤掉时
  // 两者都是 null —— TimetableCompare 据此渲染 #4 全空空态（网格骨架 + 居中提示）。
  // B 允许与 A 相同(用户在排法横条上把同一张卡同时设为 A 和 B——原设计允许,plan-strip 上有
  // 「与 A 相同」的显式标注),这里只在 planBIndex 本身被过滤掉时才回退到另一张可见的排法。
  const visiblePlans = shownPlanViews.map((view) => view.plan)
  const planA = visiblePlanIndices.has(planAIndex) ? plans[planAIndex] : (visiblePlans[0] ?? null)
  const planB = visiblePlans.length < 2 ? null : (visiblePlanIndices.has(planBIndex) ? plans[planBIndex] : (visiblePlans[1] ?? null))
  const totalUnits = committedCourses.reduce((sum, course) => sum + course.units, 0)

  // #12 单方案模式只在被点的排法仍可见时生效;它被过滤掉/列表变化越界时自动退出。
  useEffect(() => {
    if (soloPlanIndex !== null && !visiblePlanIndices.has(soloPlanIndex)) setSoloPlanIndex(null)
  }, [soloPlanIndex, visiblePlanIndices])
  const soloActive = soloPlanIndex !== null && visiblePlanIndices.has(soloPlanIndex)
  // 大课表实际展示的排法:单方案模式 → 只有被点的那个;否则 A / B 对比。
  const shownPlanA = soloActive ? plans[soloPlanIndex!] : planA
  const shownPlanB = soloActive ? null : planB

  // #5 append-only 每课配色：课号（按 courseKey 归一）→ 调色盘槽位。committed 变化时只给
  // 尚未登记的 key 追加 map.size 作为槽位，已有 key 永不改动，故新增课不会重排既有课的颜色。
  // 课表页（TimetableCompare / 右栏列表）与导出图共用；信息/选课页仍走 subject 配色。
  const colorSlotRef = useRef<Map<string, number>>(new Map())
  for (const code of committed) {
    const key = courseKey(code)
    if (!colorSlotRef.current.has(key)) colorSlotRef.current.set(key, colorSlotRef.current.size)
  }
  const slotForCode = useCallback((code: string): number => {
    const map = colorSlotRef.current
    const key = courseKey(code)
    let slot = map.get(key)
    if (slot === undefined) {
      slot = map.size
      map.set(key, slot)
    }
    return slot
  }, [])
  const colorForCode = useCallback(
    (code: string): CSSProperties =>
      ({
        '--hue': TIMETABLE_PALETTE[slotForCode(code) % TIMETABLE_PALETTE.length],
        '--shade': '0%',
      }) as CSSProperties,
    [slotForCode],
  )
  // 导出 PNG/PDF/壁纸 用的画布配色:同一槽位映射解析成具体 hsl() 串(浅色主题基准),
  // 使导出图与屏幕上的大课表颜色一致(#1)。
  const paintForCode = useCallback(
    (code: string) => huePaint(TIMETABLE_PALETTE[slotForCode(code) % TIMETABLE_PALETTE.length]),
    [slotForCode],
  )

  // #3 候选(可能学)课程的试排块:对每门 cart 课取「与该排法不冲突的第一种全组件组合」
  //（没有就退回第一种带时间的组合,与选课页 candidates 的展示口径一致),分别为 A / B
  // (或单方案) 各算一份,叠加到大课表上,右上角小角块标记。
  const ghostBlocksFor = useCallback(
    (plan: Plan | null): GhostBlock[] => {
      if (!plan) return []
      const planMeetings = plan.entries.flatMap((entry) => entry.section.meetings)
      const out: GhostBlock[] = []
      for (const code of cart) {
        const course = byCode.get(courseKey(code))
        if (!course) continue
        const combos = courseCombos(course, NO_PREFS)
        const timed = combos.filter((combo) => comboMeetings(combo).length > 0)
        if (timed.length === 0) continue
        const fit =
          timed.find((combo) => !meetingsClash(comboMeetings(combo), planMeetings)) ?? timed[0]
        for (const section of fit) {
          for (const meeting of section.meetings) {
            out.push({
              key: `ghost-${course.key}-${section.id}-${meeting.dayIndex}-${meeting.start}`,
              code: course.code,
              subject: course.subject,
              title: course.title,
              component: section.component,
              location: meeting.location,
              dayIndex: meeting.dayIndex,
              start: meeting.start,
              end: meeting.end,
              cart: true,
            })
          }
        }
      }
      return out
    },
    [byCode, cart],
  )
  const cartGhostsA = useMemo(() => ghostBlocksFor(shownPlanA), [ghostBlocksFor, shownPlanA])
  const cartGhostsB = useMemo(() => ghostBlocksFor(shownPlanB), [ghostBlocksFor, shownPlanB])

  const [exportNote, setExportNote] = useState('')
  // 只读分享（方案 2）：把当前选择存到后端换一个 /#v=<id> 只读链接（手机可看，一天有效）。
  const [shareNote, setShareNote] = useState('')
  const [shareBusy, setShareBusy] = useState(false)
  async function handleCreateShare(): Promise<void> {
    if (shareBusy) return
    setShareBusy(true)
    setShareNote('正在生成只读分享链接…')
    const result = await createShare({
      termSlug,
      termName: term?.name ?? '',
      committed,
      taken,
      pins,
    })
    if (!result.ok) {
      setShareNote(`生成失败：${result.reason}`)
      setShareBusy(false)
      return
    }
    const copied = await copyText(result.url)
    setShareNote(copied ? `只读链接已复制（一天有效）：${result.url}` : `只读链接（一天有效）：${result.url}`)
    setShareBusy(false)
  }
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
      // #1 导出图配色与大课表一致(同一 colorSlot → hue 映射,浅色主题解析)。
      paint: (code) => paintForCode(code),
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
    meetsOfficeHours,
    units,
    levels,
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

  // ---- #4 拖拽(选课页):按住课程卡/列表行拖到「必定学 / 可能学」目标卡 --------------------
  // 原生 pointer events 实现,零依赖。移动 6px 后才算拖拽(之前松手仍是普通点击);拖拽成立后
  // 用一次性的捕获阶段 click 监听吞掉紧随其后的 click,避免误开课程详情。触摸端浏览器会在
  // 滚动接管时发 pointercancel,拖拽自然让位于滚动,点按不受影响。
  type DragSource = 'catalog' | 'committed' | 'cart'
  type DropTarget = 'committed' | 'cart' | null
  const [dragCourse, setDragCourse] = useState<{ code: string; from: DragSource } | null>(null)
  const [dropHover, setDropHover] = useState<DropTarget>(null)
  const dragInfoRef = useRef<{
    code: string
    from: DragSource
    startX: number
    startY: number
    active: boolean
    pointerId: number
  } | null>(null)
  const dragGhostRef = useRef<HTMLDivElement | null>(null)
  const dragPosRef = useRef({ x: 0, y: 0 })
  const committedDropRef = useRef<HTMLElement | null>(null)
  const cartDropRef = useRef<HTMLElement | null>(null)

  const hitDropTarget = useCallback((x: number, y: number): DropTarget => {
    const within = (el: HTMLElement | null) => {
      if (!el) return false
      const rect = el.getBoundingClientRect()
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    }
    if (within(committedDropRef.current)) return 'committed'
    if (within(cartDropRef.current)) return 'cart'
    return null
  }, [])

  // 拖拽落点动作。目标卡:catalog/另一桶 → 加入该桶(互斥桶自动清理,必定学尊重硬挡);
  // 拖出到空白处:从原桶移除(catalog 来源则什么都不做)。
  const performDrop = (info: { code: string; from: DragSource }, target: DropTarget): void => {
    const key = courseKey(info.code)
    if (target === 'committed') {
      if (info.from === 'committed' || committedSet.has(key)) return
      const status = statusByCode.get(key)
      if (barredKeys.has(key) || status === 'conflict' || status === 'tba') return
      setPlanIndex(0)
      setTaken((codes) => codes.filter((item) => !sameCourse(item, info.code)))
      setCart((codes) => codes.filter((item) => !sameCourse(item, info.code)))
      setCommitted((codes) =>
        codes.some((item) => sameCourse(item, info.code)) ? codes : [...codes, info.code],
      )
    } else if (target === 'cart') {
      if (info.from === 'cart' || cartSet.has(key)) return
      setPlanIndex(0)
      setCommitted((codes) => codes.filter((item) => !sameCourse(item, info.code)))
      dropPins(info.code)
      setTaken((codes) => codes.filter((item) => !sameCourse(item, info.code)))
      setCart((codes) => (codes.some((item) => sameCourse(item, info.code)) ? codes : [...codes, info.code]))
    } else if (info.from === 'committed') {
      removeCommitted(info.code)
    } else if (info.from === 'cart') {
      removeCart(info.code)
    }
  }

  // window 级监听器必须是稳定引用才能成对增删;真正的处理逻辑每次渲染刷新到 ref 里,
  // 使拖拽途中始终读到最新的 state(committedSet / statusByCode 等)。
  const dragMoveImplRef = useRef<(event: PointerEvent) => void>(() => {})
  const dragEndImplRef = useRef<(event: PointerEvent) => void>(() => {})
  const onDragMove = useCallback((event: PointerEvent) => dragMoveImplRef.current(event), [])
  const onDragEnd = useCallback((event: PointerEvent) => dragEndImplRef.current(event), [])
  const squelchClick = useCallback((event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    window.removeEventListener('click', squelchClick, true)
  }, [])
  const stopDragListeners = useCallback(() => {
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragEnd)
    window.removeEventListener('pointercancel', onDragEnd)
  }, [onDragEnd, onDragMove])

  dragMoveImplRef.current = (event: PointerEvent) => {
    const info = dragInfoRef.current
    if (!info || event.pointerId !== info.pointerId) return
    if (!info.active) {
      if (Math.hypot(event.clientX - info.startX, event.clientY - info.startY) < 6) return
      info.active = true
      setDragCourse({ code: info.code, from: info.from })
      // 拖拽已成立:吞掉这次手势松手后的 click,避免触发卡片的「查看详情」。
      window.addEventListener('click', squelchClick, true)
    }
    event.preventDefault()
    dragPosRef.current = { x: event.clientX, y: event.clientY }
    const ghost = dragGhostRef.current
    if (ghost) ghost.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 12}px)`
    setDropHover((current) => {
      const next = hitDropTarget(event.clientX, event.clientY)
      return next === current ? current : next
    })
  }

  dragEndImplRef.current = (event: PointerEvent) => {
    const info = dragInfoRef.current
    if (!info || event.pointerId !== info.pointerId) return
    stopDragListeners()
    dragInfoRef.current = null
    if (info.active && event.type === 'pointerup') {
      performDrop(info, hitDropTarget(event.clientX, event.clientY))
    }
    setDragCourse(null)
    setDropHover(null)
  }

  // 拖拽起点(选课页课程卡 / 右栏列表行都走这里)。点在按钮、输入框等控件上不启动。
  function beginCourseDrag(code: string, from: DragSource, event: ReactPointerEvent<HTMLElement>): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('button, input, select, a')) return
    dragInfoRef.current = {
      code,
      from,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      pointerId: event.pointerId,
    }
    dragPosRef.current = { x: event.clientX, y: event.clientY }
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragEnd)
    window.addEventListener('pointercancel', onDragEnd)
  }

  // ghost 初次挂载时先落到当前指针位置(其后由 pointermove 直接改 transform,不走 React)。
  useEffect(() => {
    if (!dragCourse) return
    const ghost = dragGhostRef.current
    if (ghost) {
      ghost.style.transform = `translate(${dragPosRef.current.x + 14}px, ${dragPosRef.current.y + 12}px)`
    }
  }, [dragCourse])

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

  // 选课页右栏两张卡同时是 #4 拖拽的落点:拖拽中高亮示意,悬停到卡上再加一档。
  const committedCard = (
    <section
      className={`card committed-card${dragCourse ? ' card--droppable' : ''}${dropHover === 'committed' ? ' card--drop-hover' : ''}`}
      ref={(el) => {
        committedDropRef.current = el
      }}
    >
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
        onRowPointerDown={(code, _isCart, event) => beginCourseDrag(code, 'committed', event)}
      />
      {unknownCommitted.length > 0 && (
        <p className="card__warn">本学期没有开设：{unknownCommitted.join('、')}</p>
      )}
    </section>
  )

  // 「当前可能课程」= 可能学 waitlist / cart，单独一张圆角卡，紧接在「当前必修课程」下方（选课页）。
  const cartCard = (
    <section
      className={`card cart-card${dragCourse ? ' card--droppable' : ''}${dropHover === 'cart' ? ' card--drop-hover' : ''}`}
      ref={(el) => {
        cartDropRef.current = el
      }}
    >
      <h2 className="card__title">
        当前可能课程
        <span className="card__note">{cart.length > 0 ? `${cart.length} 门候选` : '可能会学'}</span>
      </h2>
      <CommittedList
        byCode={byCode}
        cartCodes={cart}
        codes={[]}
        currentTermOrder={currentTermOrder}
        emptyHint="还没有候选课程。在中间的课程列表点「可能学」来添加。"
        termOrdersByKey={termOrdersByKey}
        onRemove={removeCart}
        onRowPointerDown={(code, _isCart, event) => beginCourseDrag(code, 'cart', event)}
      />
    </section>
  )

  // 课表页左栏卡：「上下班时间」（上班 / 下班，原「辅助线」）+ 两个 check-row 开关
  // （不展示冲突的方案 / 不展示不符合上下班限制的方案）。两条时间线在日历上画虚线供目测，
  // 同时驱动下面「不展示…」开关与搜索卡「符合上下班时间」的过滤判定。
  const guideLines = useMemo(
    () =>
      [
        workStart != null ? { minutes: workStart, label: '上班', tone: 'am' as const } : null,
        workEnd != null ? { minutes: workEnd, label: '下班', tone: 'pm' as const } : null,
      ].filter((g): g is { minutes: number; label: string; tone: 'am' | 'pm' } => g != null),
    [workEnd, workStart],
  )
  const scheduleFilterCard = (
    <section className="card">
      <h2 className="card__title">
        上下班时间
        <span className="card__note">日历参考线 · 排法过滤</span>
      </h2>
      {/* 上班 / 下班同一排,省纵向空间;语义(不早于/不晚于)收进 title,不再占一行说明。 */}
      <div className="time-row">
        <div className="field" title="希望一天的课不早于此;清空＝不设线">
          <span className="field__label">上班时间</span>
          <div className="time-field">
            <input
              aria-label="上班时间"
              className="time-input"
              step={300}
              type="time"
              value={workStart != null ? hhmm(workStart) : ''}
              onChange={(event) => setWorkStart(parseHHMM(event.target.value))}
            />
            {workStart != null && (
              <button
                aria-label="清除上班时间"
                className="time-field__clear"
                type="button"
                onClick={() => setWorkStart(null)}
              >
                ×
              </button>
            )}
          </div>
        </div>
        <div className="field" title="希望一天的课不晚于此;清空＝不设线">
          <span className="field__label">下班时间</span>
          <div className="time-field">
            <input
              aria-label="下班时间"
              className="time-input"
              step={300}
              type="time"
              value={workEnd != null ? hhmm(workEnd) : ''}
              onChange={(event) => setWorkEnd(parseHHMM(event.target.value))}
            />
            {workEnd != null && (
              <button
                aria-label="清除下班时间"
                className="time-field__clear"
                type="button"
                onClick={() => setWorkEnd(null)}
              >
                ×
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="check-row">
        <label className="check">
          <input
            checked={hideConflicts}
            type="checkbox"
            onChange={(event) => setHideConflicts(event.target.checked)}
          />
          <span>不展示冲突的方案</span>
        </label>
        <label
          className={`check${officeWindowUnset ? ' check--disabled' : ''}`}
          title={officeWindowUnset ? '先设置上下班时间' : undefined}
        >
          <input
            checked={hideOutOfHours}
            disabled={officeWindowUnset}
            type="checkbox"
            onChange={(event) => setHideOutOfHours(event.target.checked)}
          />
          <span>不展示不符合上下班限制的方案</span>
        </label>
      </div>
    </section>
  )

  // #2 课表页右栏列表:必修 + 候选(可能学)一起展示,颜色与大课表一致(colorForCode),
  // 候选行右上角小角块标记;不带「上/下学期」徽标、不提供删除(删课回选课页)。
  const committedCardTT = (
    <section className="card committed-card">
      <h2 className="card__title">
        当前课程
        <span className="card__note">{totalUnits > 0 ? `${totalUnits} 学分 · 选时段` : '选时段'}</span>
      </h2>
      <CommittedList
        byCode={byCode}
        cartCodes={cart}
        codes={committed}
        colorFor={colorForCode}
        currentTermOrder={currentTermOrder}
        pins={pins}
        showTermBadge={false}
        termOrdersByKey={termOrdersByKey}
        onPin={togglePin}
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
        {mainTerms.length > 0 && (
          <div className="field">
            <span className="field__label">当前学期</span>
            <div className="term-switch" aria-label="当前选课学期">
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
          </div>
        )}
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
          只看本专业的课
        </Toggle>
        <Toggle checked={meetsPrereq} onChange={setMeetsPrereq}>
          符合先修
        </Toggle>
        <Toggle checked={hideCompleted} onChange={setHideCompleted}>
          隐藏已完成
        </Toggle>
      </div>
      <div className="filter-block">
        <span className="filter-block__title">时间约束 · 可选性</span>
        <Toggle checked={lecFits} onChange={setLecFits}>
          符合时间表（仅LEC）
        </Toggle>
        <Toggle
          checked={meetsOfficeHours}
          disabled={officeWindowUnset}
          title={officeWindowUnset ? '先在课表页设置上下班时间' : undefined}
          onChange={setMeetsOfficeHours}
        >
          符合上下班时间
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
  // 右侧两个方形小按钮「A」「B」分别设为该排法（选中态高亮）。#12 点卡片本体 → 单方案模式
  //（只看这一个排法,退出 A/B 对比）；点任意 A / B 按钮 → 回到对比模式。
  const planStrip =
    plans.length > 0 ? (
      <div className="plan-strip__rail">
        {shownPlanViews.map(({ plan, index }) => {
          const isA = index === planAIndex
          const isB = plans.length >= 2 && index === planBIndex
          const isSolo = soloActive && index === soloPlanIndex
          return (
            <div
              className={`plan-card${isA ? ' plan-card--a' : ''}${isB ? ' plan-card--b' : ''}${isSolo ? ' plan-card--solo' : ''}`}
              key={plan.id}
              role="button"
              tabIndex={0}
              title="点击单独查看此排法"
              onClick={() => setSoloPlanIndex(index)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSoloPlanIndex(index)
                }
              }}
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
                  className={`plan-card__pick plan-card__pick--a${isA ? ' plan-card__pick--on' : ''}${soloActive ? ' plan-card__pick--dimmed' : ''}`}
                  title="设为 A（回到 A/B 对比）"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setSoloPlanIndex(null)
                    setPlanAIndex(index)
                  }}
                >
                  A
                </button>
                <button
                  aria-label={`排法 ${index + 1} 设为 B`}
                  className={`plan-card__pick plan-card__pick--b${isB ? ' plan-card__pick--on' : ''}${soloActive ? ' plan-card__pick--dimmed' : ''}`}
                  title="设为 B（回到 A/B 对比）"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setSoloPlanIndex(null)
                    setPlanBIndex(index)
                  }}
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

      <h3 className="export-group-title">表格格式</h3>
      <div className="export-grid">
        <section className="card export-card">
          <h3 className="card__title">表格 PDF</h3>
          <p className="card__sub">A / B 对比课表,一页 PDF,适合打印。</p>
          <button
            className="export-btn"
            disabled={!planA}
            type="button"
            onClick={() => void handleExport('pdf')}
          >
            下载 PDF
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
      </div>

      <h3 className="export-group-title">手机壁纸</h3>
      <div className="export-grid">
        <section className="card export-card">
          <h3 className="card__title">iPhone 壁纸</h3>
          <p className="card__sub">
            iPhone 17 Pro 比例,顶部留白避开系统时间。导出两张:纯背景 + 带课表(排法 A)。
          </p>
          <button
            className="export-btn"
            disabled={!planA}
            type="button"
            onClick={() => void handleExport('wallpaper')}
          >
            下载壁纸
          </button>
        </section>
      </div>

      <h3 className="export-group-title">其他</h3>
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
          <h3 className="card__title">分享链接</h3>
          <p className="card__sub">复制链接,打开即恢复选课(可继续编辑)。</p>
          <button
            className="export-btn"
            disabled={committed.length === 0 && taken.length === 0}
            type="button"
            onClick={() => void handleExport('link')}
          >
            复制链接
          </button>
        </section>
        <section className="card export-card">
          <h3 className="card__title">只读分享 · 手机查看</h3>
          <p className="card__sub">生成一个只读页面链接,适合手机查看,一天有效。</p>
          <button
            className="export-btn"
            disabled={committed.length === 0 || shareBusy}
            type="button"
            onClick={() => void handleCreateShare()}
          >
            {shareBusy ? '生成中…' : '生成只读链接'}
          </button>
        </section>
      </div>

      {shareNote && <p className="export-note export-note--share">{shareNote}</p>}
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
                  officeEnd={workEnd}
                  officeStart={workStart}
                  standingByKey={standingByKey}
                  statusByCode={statusByCode}
                  prereqByCode={prereqByCode}
                  takenSet={takenSet}
                  titleByCode={titleByCode}
                  onCardPointerDown={(course, event) => beginCourseDrag(course.code, 'catalog', event)}
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
                cartA={cartGhostsA}
                cartB={cartGhostsB}
                colorForCode={colorForCode}
                emptyMessage={
                  committedCourses.length === 0
                    ? '在左侧选择当前选择课程，A / B 两种排法会自动排出来'
                    : '当前无可行方案'
                }
                guides={guideLines}
                planA={shownPlanA}
                planB={shownPlanB}
                showEmptyGrid={committedCourses.length > 0}
                solo={soloActive}
                onGuideChange={(tone, minutes) =>
                  tone === 'am' ? setWorkStart(minutes) : setWorkEnd(minutes)
                }
              />
            </section>
          </>
        )
      case 'export':
        return exportView
    }
  }

  return (
    <div className={`app${dragCourse ? ' app--dragging' : ''}`}>
      {/* #4 拖拽跟随 ghost:固定定位小签,pointermove 直接改 transform(不经 React)。 */}
      {dragCourse && (
        <div aria-hidden className="drag-ghost" ref={dragGhostRef}>
          <span className="drag-ghost__code">{dragCourse.code}</span>
          <span className="drag-ghost__hint">
            {dropHover === 'committed'
              ? '放开 → 必定学'
              : dropHover === 'cart'
                ? '放开 → 可能学'
                : dragCourse.from === 'catalog'
                  ? '拖到右侧「必定学 / 可能学」'
                  : '拖到另一栏移动 · 拖到空白处移除'}
          </span>
        </div>
      )}
      {/* #布局3:header+主内容包一层 .app-body(独立撑满 100dvh),footer 作为正常块跟在其后，
          文档可整体超过一屏滚动，footer 需向下滚一点才可见，同时 .app-body 内部（.viewport /
          .side 等）保留原有的“撑满剩余高度 + 内部滚动”机制，不受影响。 */}
      <div className="app-body">
        <header className="bar">
          <div className="bar__left">
            <div className="bar__brand">
              <span className="bar__mark" aria-hidden />
              <h1>CU Schedule</h1>
            </div>
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
      </div>

      <footer className="foot">
        <div className="foot__main">
          <a
            className="foot__byline"
            href="https://github.com/VincentJiang06/cu-schedule"
            rel="noopener noreferrer"
            target="_blank"
          >
            <svg aria-hidden fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            by VincentJiang
          </a>
          <span className="foot__sep" aria-hidden>·</span>
          <span>课程和项目信息以 CUSIS 为准</span>
        </div>
        <p className="foot__note">
          抓取管线来自{' '}
          <a href="https://github.com/EagleZhen/another-cuhk-course-planner" rel="noreferrer" target="_blank">
            EagleZhen
          </a>{' '}
          (AGPL-3.0)
        </p>
        <div className="foot__sibs">
          <span className="sib-label">友链</span>
          <div className="sib-row">
            {SIBLINGS.map((sib) => (
              <a
                className="sib-chip"
                href={sib.url}
                key={sib.url}
                rel="noopener noreferrer"
                target="_blank"
              >
                <img alt="" src={sib.icon} />
                {sib.name}
              </a>
            ))}
          </div>
        </div>
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
