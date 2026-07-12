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
import { AppendixPage } from './components/AppendixPage.tsx'
import { CodeInput } from './components/CodeInput.tsx'
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
import {
  cloudAuth,
  cloudErrorText,
  cloudLoad,
  cloudSave,
  clearCreds,
  isAuthError,
  loadCreds,
  saveCreds,
  USERNAME_RE,
  type CloudConfig,
  type CloudCreds,
  type PlanSigs,
} from './lib/cloud.ts'
import { huePaint, TIMETABLE_PALETTE, type PaintTheme } from './lib/color.ts'
import { configMdFilename, decodeConfigMd, encodeConfigMd, type ConfigMdState } from './lib/configMd.ts'
import { courseKey } from './lib/courseKey.ts'
import { downloadBlob } from './lib/exportImage.ts'
import { exportPlan, type ExportFormat } from './lib/exportPlan.ts'
import type { Aspect } from './lib/exportImage.ts'
import {
  classifyPrograms,
  getProgram,
  loadPrograms,
  programCourseKeys,
  reloadPrograms,
  type CourseStanding,
  type Program,
} from './lib/programs.ts'
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
  planMatchesPins,
  planSectionMap,
  type Pins,
  type Plan,
  type TimeWindow,
} from './lib/schedule.ts'
import { hhmm, parseHHMM } from './lib/time.ts'
import type { Course } from './lib/types.ts'

// #里程碑1(三档主题):light(浅色,干净明亮) / mid(中性,中等灰) / dark(深色)。
type Theme = 'light' | 'mid' | 'dark'
type Page = 'info' | 'select' | 'timetable' | 'export' | 'appendix'
// 全部课程 / 本专业 — narrows search to the chosen programme's course set (by course key).
type ProgramScope = 'all' | 'program'

const PAGES: Array<{ value: Page; label: string }> = [
  { value: 'info', label: '信息' },
  { value: 'select', label: '选课' },
  { value: 'timetable', label: '课表' },
  { value: 'export', label: '导出' },
  { value: 'appendix', label: '附录' },
]

// 五页各自的真实路径(History API 路由,不引路由库)。
const PAGE_PATH: Record<Page, string> = {
  info: '/info',
  select: '/select',
  timetable: '/timetable',
  export: '/export',
  appendix: '/appendix',
}

// 从 location.pathname 解析出 page:去掉尾斜杠后精确匹配五条路径之一(/timetable 与
// /timetable/ 都能命中);根 `/` 或任何其它未知路径解析不出、返回 null,由调用方兜底
// (通常落回 'info')。
function pageFromPathname(pathname: string): Page | null {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  switch (trimmed) {
    case '/info':
      return 'info'
    case '/select':
      return 'select'
    case '/timetable':
      return 'timetable'
    case '/export':
      return 'export'
    case '/appendix':
      return 'appendix'
    default:
      return null
  }
}

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

// #修复3(整卡折叠 → 单个折叠):卡片标题栏原来的整卡 +/− 折叠角标已撤——折叠粒度下放到
// CommittedList 内部,每门课一个折叠图标(见 CommittedList.tsx 的 FoldIcon /
// collapsedRows),标题栏不再需要这个按钮。

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
  appendix: (
    <svg aria-hidden fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path
        d="M4 5.5C4 4.4 5 4 7 4c2.5 0 4 .9 5 1.8C13 4.9 14.5 4 17 4c2 0 3 .4 3 1.5v13c0 1-1 .5-3 .5-2.5 0-4 .9-5 1.8-1-.9-2.5-1.8-5-1.8-2 0-3 .5-3-.5v-13Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path d="M12 5.8V19" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
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

// 课表页专用配色盘：~12 个可区分的 hue（TIMETABLE_PALETTE 定义搬到 color.ts，
// ShareView 的只读课程列表/课表也复用同一份，颜色口径统一）。每门 committed 课进入时
// 按顺序领取一个槽位（append-only，见 colorForCode），槽位一旦分配永不重排，故新增课
// 不会打乱既有课的颜色。

// 页脚友链带 + 附录页「友链邀请」大卡共用同一份数据源：icon 文件已放在
// public/assets/sib-icons/，顺序照产品给定的清单。desc 只有附录页的大卡会用到。
const SIBLINGS: Array<{ icon: string; url: string; name: string; desc: string }> = [
  {
    icon: '/assets/sib-icons/vincejiang.png',
    url: 'https://vincejiang.com/',
    name: 'VincentJiang 主站',
    desc: '本站作者的个人主页：博客与作品集',
  },
  {
    icon: '/assets/sib-icons/cuhkwild.png',
    url: 'https://cuhkwild.com/',
    name: '中大野史',
    desc: '中大生的野史吐槽站，你不知道的校园故事',
  },
  {
    icon: '/assets/sib-icons/hkuwild.png',
    url: 'https://hkuwild.com/',
    name: '港大野史',
    desc: '港大生的野史吐槽站',
  },
  {
    icon: '/assets/sib-icons/hkustwild.png',
    url: 'https://hkustwild.com/',
    name: '科大野史',
    desc: '科大生的野史吐槽站',
  },
  {
    icon: '/assets/sib-icons/cityuwild.png',
    url: 'https://cityuwild.com/',
    name: '城大野史',
    desc: '城大生的野史吐槽站',
  },
  {
    icon: '/assets/sib-icons/polyuwild.png',
    url: 'https://polyuwild.com/',
    name: '理大野史',
    desc: '理大生的野史吐槽站',
  },
  {
    icon: '/assets/sib-icons/hkuniwild.png',
    url: 'https://hkuniwild.com/',
    name: '港校通门户',
    desc: '港校信息门户，五校资讯一站看',
  },
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
  if (saved === 'light' || saved === 'mid' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// 三态循环:浅色 → 中性 → 深色 → 浅色。图标/文案与 THEME_ICON/THEME_LABEL 一一对应，
// 供切换按钮的 aria-label/title 说明"当前是哪一档、点了会去哪一档"。
const THEME_ORDER: Theme[] = ['light', 'mid', 'dark']
const THEME_ICON: Record<Theme, string> = { light: '☀️', mid: '◐', dark: '🌙' }
const THEME_LABEL: Record<Theme, string> = { light: '浅色', mid: '中性', dark: '深色' }
function nextTheme(current: Theme): Theme {
  return THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length]
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

// 上下班时间锁定开关。默认锁住（防止拖动虚线 / 改时间输入框被误操作），持久化到
// localStorage（cu-schedule:work-locked）。读取口径与其它布尔开关不同——只有存了
// 显式 'false' 才判定为解锁，其余任何值（含缺省/首次访问）一律按「锁定」处理。
function loadWorkLocked(): boolean {
  return window.localStorage.getItem('cu-schedule:work-locked') !== 'false'
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

// #里程碑1(首屏防闪):在 React 挂载渲染之前就把 data-theme 打到 <html> 上。模块顶层
// 代码在 createRoot().render() 之前同步执行——比等 useEffect(要等到 commit 之后才跑)
// 早一整轮，避免开屏先闪一下默认主题、等 JS 跑完 effect 才跳到用户实际选的主题。
const bootTheme = loadTheme()
if (typeof document !== 'undefined') document.documentElement.dataset.theme = bootTheme

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
// 真路由:page 现在由 location.pathname 决定(History API,不引路由库)——命中
// /info|/select|/timetable|/export|/appendix 之一就用它。路径解不出时(根 `/`、或旧书签/
// 旧分享出去的 #st= 链接——那种链接 page 编在 hash 里、路径还是根 /)才退回 live?.page,
// 解不出 live.page 就再退到 'info'。下方 App 组件内的 mount effect 会把地址栏一次性
// 纠正到这个落地页对应的真实路径,向后兼容旧链接的同时不需要一直读 #st= 里的 page。
const bootPage: Page =
  pageFromPathname(typeof window !== 'undefined' ? window.location.pathname : '/') ?? live?.page ?? 'info'

// ---- #里程碑4 排法横条:隐藏原生滚动条 + 按住拖动(pan) + 边缘自动滚动 ----------------------
// 6px 阈值区分 tap(触发选中)与 drag(平移,不触发选中)——与选课页课程卡的拖拽判定同一手法
// (见 App 组件内 dragMoveImplRef 附近的 6px 阈值 + squelchClick 吞点击)，这里是独立的一份
// 实现(纯 DOM/ref，不依赖任何组件 state)，供排法横条与导出页的单选横条共用。
const PLAN_PAN_THRESHOLD = 6
const PLAN_EDGE_ZONE = 36
const PLAN_EDGE_SPEED = 11

function usePlanStripPan() {
  const railRef = useRef<HTMLDivElement | null>(null)
  const panRef = useRef<{ pointerId: number; startX: number; startScrollLeft: number; moved: boolean } | null>(null)
  const autoScrollFrame = useRef<number | null>(null)
  const pointerXRef = useRef(0)

  // 拖拽成立后吞掉紧随其后的 click，避免松手时误触发卡片的「单独查看该排法」选中。
  const squelchClick = useCallback((event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    window.removeEventListener('click', squelchClick, true)
  }, [])

  const stopAutoScroll = useCallback(() => {
    if (autoScrollFrame.current != null) {
      cancelAnimationFrame(autoScrollFrame.current)
      autoScrollFrame.current = null
    }
  }, [])

  // 拖动到横条左/右边缘附近时自动继续滚动，越靠边缘滚动越快；离开边缘区或松手就停。
  const runAutoScroll = useCallback(() => {
    const rail = railRef.current
    if (!rail || !panRef.current) {
      autoScrollFrame.current = null
      return
    }
    const rect = rail.getBoundingClientRect()
    const x = pointerXRef.current
    let dx = 0
    if (x < rect.left + PLAN_EDGE_ZONE) {
      dx = -PLAN_EDGE_SPEED * Math.min(1, (rect.left + PLAN_EDGE_ZONE - x) / PLAN_EDGE_ZONE)
    } else if (x > rect.right - PLAN_EDGE_ZONE) {
      dx = PLAN_EDGE_SPEED * Math.min(1, (x - (rect.right - PLAN_EDGE_ZONE)) / PLAN_EDGE_ZONE)
    }
    if (dx !== 0) {
      rail.scrollLeft += dx
      autoScrollFrame.current = requestAnimationFrame(runAutoScroll)
    } else {
      autoScrollFrame.current = null
    }
  }, [])

  const onMove = useCallback(
    (event: PointerEvent) => {
      const pan = panRef.current
      const rail = railRef.current
      if (!pan || !rail || event.pointerId !== pan.pointerId) return
      const dx = event.clientX - pan.startX
      if (!pan.moved && Math.abs(dx) > PLAN_PAN_THRESHOLD) {
        pan.moved = true
        window.addEventListener('click', squelchClick, true)
      }
      if (pan.moved) {
        event.preventDefault()
        rail.scrollLeft = pan.startScrollLeft - dx
        pointerXRef.current = event.clientX
        if (autoScrollFrame.current == null) autoScrollFrame.current = requestAnimationFrame(runAutoScroll)
      }
    },
    [runAutoScroll, squelchClick],
  )

  const onUp = useCallback(
    (event: PointerEvent) => {
      if (!panRef.current || event.pointerId !== panRef.current.pointerId) return
      panRef.current = null
      stopAutoScroll()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    },
    [onMove, stopAutoScroll],
  )

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      const rail = railRef.current
      if (!rail) return
      panRef.current = { pointerId: event.pointerId, startX: event.clientX, startScrollLeft: rail.scrollLeft, moved: false }
      pointerXRef.current = event.clientX
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [onMove, onUp],
  )

  return { railRef, onPointerDown }
}

/** 排法横条 / 导出页单选横条共用的滚动容器:隐藏滚动条(CSS)、支持按住拖动平移、选中项
 * 变化时自动 scrollIntoView 到可见区。子项需要各自带 data-plan-id 供这里定位。
 * #里程碑5:定位键从数组下标改成 plan.id(下标会随 pins 过滤/删除漂移，id 不会)。 */
function PlanStripRail({ selectedId, children }: { selectedId: string | null; children: ReactNode }) {
  const { railRef, onPointerDown } = usePlanStripPan()
  useEffect(() => {
    if (selectedId == null) return
    const card = railRef.current?.querySelector<HTMLElement>(`[data-plan-id="${CSS.escape(selectedId)}"]`)
    card?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedId])
  return (
    <div className="plan-strip__rail" onPointerDown={onPointerDown} ref={railRef}>
      {children}
    </div>
  )
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(bootTheme)
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
  // #里程碑5/#修复4:候选课在大课表上的「启用/禁用展示」开关，按 courseKey 记；纯会话内
  // UI 状态(不进 localStorage/URL/配置导出——与 dropHover 等临时态同一档次)。禁用只影响
  // 候选试排块在课表上的展示(彻底不生成该课的 ghost 块,见 ghostBlocksFor),不影响 cart
  // 本身的成员关系。
  const [disabledCandidates, setDisabledCandidates] = useState<Set<string>>(() => new Set())
  const toggleCandidateDisabled = useCallback((code: string): void => {
    const key = courseKey(code)
    setDisabledCandidates((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  // #修复3:整卡折叠开关已撤(折叠状态现在活在 CommittedList 内部,按每门课记，见该文件
  // 的 collapsedRows)，这里不再需要三张卡各自的整卡开关。
  // Pinned sections (e.g. TUT T01) constrain which A / B timetables the scheduler builds.
  const [pins, setPins] = useState<Pins>(bootPins)
  const [planIndex, setPlanIndex] = useState(0)
  // #里程碑5(排法编号稳定化):A / B / 导出 / 单方案的选中排法全部按 plan.id 引用，不是
  // 数组下标——pins 约束/删除排法都只是过滤 allPlans，下标会随之漂移，id 不会。默认落在
  // 第一 / 第二个可见排法上，靠下面的派生值(planA/planB/…)在渲染期兜底,不需要专门的
  // 越界回退 effect(id 不在当前可见集合里时,派生值自己会 fallback，等它以后又满足过滤
  // 条件时也会自动"复活"，比数组下标更贴合"约束只是过滤、不改变身份"的模型)。
  const [planAId, setPlanAId] = useState<string | null>(null)
  const [planBId, setPlanBId] = useState<string | null>(null)
  // 导出页:用户从可行排法里【只选一个】要导出的确定方案(不再 A / B)。
  const [selectedExportPlanId, setSelectedExportPlanId] = useState<string | null>(null)
  // #12 单方案模式:点排法横条的方框 → 只看这一个排法(退出 A/B 对比);点 A / B 按钮回到对比。
  const [soloPlanId, setSoloPlanId] = useState<string | null>(null)
  // #里程碑4(排法逐个删除):按 plan.id 记(不是下标——下标会随过滤/生成结果漂移，id 不会)。
  // 被删的排法从排法横条里彻底移除、不参与 A/B/solo 选择;纯会话内状态,不持久化。
  const [deletedPlanIds, setDeletedPlanIds] = useState<Set<string>>(() => new Set())
  const [page, setPage] = useState<Page>(bootPage)
  // The course whose detail popup is open (null = closed).
  const [detailCourse, setDetailCourse] = useState<Course | null>(null)

  // go() 的 pushState 需要读全部会话字段(termSlug/committed/…/workEnd),但那些 state 声明
  // 在 go 之后才出现;用一个稳定 ref 占位「构建 hash 的函数」,真正实现在下方渲染体里补上
  // （与下面 dragMoveImplRef 同一手法:ref 先占位、useCallback 引用 .current、实现体后补,
  // 因为闭包只在调用时才读取 .current,不受声明顺序影响)。page 现在由路径决定、不再编进
  // #st=,所以这个 hash builder 不再需要接收目标页参数。
  const liveHashBuilderRef = useRef<() => string>(() => '')
  // popstate 恢复触发的这一轮 state 变化不需要再 replaceState 写回 URL(URL 已经是这个状态
  // 了)——见下方「URL 实时状态同步」两个 effect。
  const restoringUrlRef = useRef(false)

  // 切页统一入口：直接切到目标页（无动画，瞬切）；同时 pushState 一条新历史条,地址栏
  // 换成目标页的真实路径(PAGE_PATH[to]),hash 部分照旧带最近一次渲染的选课状态(因为它们
  // 没变),使浏览器返回键能回到切换前的 tab。
  const go = useCallback(
    (to: Page) => {
      if (to === page) return
      setPage(to)
      const hash = liveHashBuilderRef.current()
      window.history.pushState(null, '', `${PAGE_PATH[to]}${window.location.search}${hash}`)
    },
    [page],
  )

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
  // 上下班时间上锁：默认锁住,防止大课表上的拖动虚线 / 卡片里的时间输入框被误改。纯本地设置
  // （不进 #st= URL 状态、不进配置 Markdown 导出）,与 hideConflicts 等排课口径开关不同。
  const [workTimeLocked, setWorkTimeLocked] = useState<boolean>(loadWorkLocked)
  useEffect(() => {
    window.localStorage.setItem('cu-schedule:work-locked', workTimeLocked ? 'true' : 'false')
  }, [workTimeLocked])
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
  // 隐藏已替代修课:默认开——把 barredKeys(已修互斥/替代课挡下的课)从课程列表里滤掉；
  // 关掉则照常显示，仍带「已替代/不可选」角标(见 SearchResults 的 flagFor)。
  const [hideSuperseded, setHideSuperseded] = useState(live?.hideSuperseded ?? true)
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
  // 因已修互斥课而被自动移出「当前选择」的课号(非阻断提示用,按 key 去重累积)。
  const [autoRemoved, setAutoRemoved] = useState<string[]>([])

  // ---- 账号(云存档槽,见 lib/cloud.ts 顶部约定) --------------------------------------
  // 入口在 header 右上角:人头按钮 → 锚定弹层(登录表单 / 账号菜单)。
  const [acctOpen, setAcctOpen] = useState(false)
  const [account, setAccount] = useState<CloudCreds | null>(loadCreds)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle')
  const [syncNote, setSyncNote] = useState('')
  // 登录时云端已有存档且本地非空 → 挂起,等用户二选一(载入云端 / 用本地覆盖)。
  const [pendingCloud, setPendingCloud] = useState<{ config: CloudConfig; updatedAt: string | null } | null>(null)
  const [acctUser, setAcctUser] = useState('')
  const [acctPass, setAcctPass] = useState('')
  const [acctBusy, setAcctBusy] = useState(false)
  const [acctNote, setAcctNote] = useState('')
  // 云端配置里的排法签名,等 plans 就绪后按 plan.id 回配(数据更新后序号会漂,签名不会)。
  const pendingPlanSigsRef = useRef<PlanSigs | null>(null)
  // 开机拉取(boot pull)结束前不许自动上传——否则本地 boot 态会抢先覆盖云端最新存档。
  const cloudReadyRef = useRef(false)

  // 账号弹层 Esc 关闭(点击遮罩关闭在 JSX 里)。
  useEffect(() => {
    if (!acctOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAcctOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [acctOpen])

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
  // 不触发,不会自环)。page 现在独立于 #st=,直接从 location.pathname 解出(命中五页之一才
  // setPage,未知路径保持现状不动)。#st= 部分:解出就整体恢复其余选课字段;解不出(比如退到
  // 最初、pushState 之前那条没有 #st= 的历史)保持现状不动——好过把已经在内存里的选课清空。
  // restoringUrlRef 置位 → 下方「URL 实时状态同步」effect 会在这轮变化后跳过一次
  // replaceState,避免恢复瞬间的中间态覆盖刚恢复好的 URL(React 18+ 对原生事件里的这一串
  // setState 自动批处理成一次渲染,所以下方 effect 只会在这轮恢复后跑一次,标志位读一次即够)。
  useEffect(() => {
    const onPopState = (): void => {
      const pathPage = pageFromPathname(window.location.pathname)
      if (pathPage) setPage(pathPage)
      const state = decodeLiveState(window.location.hash)
      if (!state) return
      restoringUrlRef.current = true
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
      setHideSuperseded(state.hideSuperseded)
      setProgramScope(state.programScope)
      setWorkStart(state.workStart)
      setWorkEnd(state.workEnd)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // 首屏路径纠正(仅挂载时跑一次):地址栏路径不是五页之一(根 `/`、或任何未知路径)时,把它
  // 一次性 replaceState 成 bootPage 落地的真实路径,不新增历史条,也不动 search/hash。
  useEffect(() => {
    if (pageFromPathname(window.location.pathname)) return
    window.history.replaceState(
      null,
      '',
      `${PAGE_PATH[bootPage]}${window.location.search}${window.location.hash}`,
    )
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
  // 开关等,而不必把 go 挪到这些 state 声明之后。page 现在由路径决定,不再写进 #st=(旧链接
  // 里带的 page 仍能被 decodeLiveState 解出、供首屏向后兼容用,只是这里不再编码它)。
  liveHashBuilderRef.current = (): string =>
    encodeLiveState({
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
      hideSuperseded,
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
      const hash = liveHashBuilderRef.current()
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
    hideSuperseded,
    lecFits,
    meetsOfficeHours,
    meetsPrereq,
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
  // 全年去重课程列表(不按当前学期 tab 过滤)——已修课手动录入的搜索提示池:已修过的课
  // 很可能是另一学期开的,不该被当前 Term 1/2 tab 限制住。
  const allCourses = useMemo(() => [...catalogByKey.values()], [catalogByKey])

  // 已修互斥课导致不可再选的课程 key 集合(course.requirement.exclusions 为 8 字符 key 列表)。
  // 只走正向:目录里任一课的 exclusions 命中已修课 → 该课被挡。单向排斥不反向传导——
  // 修过 A 不代表 A.exclusions 里列的 B 也该被挡(A 不为修过 B 者开 ≠ 修过 A 者不能选 B)。
  // 真正互斥的等价课(如 CSCI2100↔ESTR2102)各自 exclusions 互列对方,正向本就能双向抓到。
  // 最后排除「已修课自身」,已完成的课不该出现在不可选里。
  const barredKeys = useMemo(() => {
    const takenKeySet = new Set(taken.map(courseKey))
    const barred = new Set<string>()
    for (const course of catalogByKey.values()) {
      if (course.requirement.exclusions.some((code) => takenKeySet.has(code))) barred.add(course.key)
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
  // #里程碑2(加课后重新生成所有方案):committedCourses 变化(加/删课)时 allPlans 本就会
  // 随之重新生成,但 deletedPlanIds 记的是"旧方案集"里被删掉的那些 plan.id——对新方案集毫
  // 无意义,残留下来只会让新方案集莫名少几个选项(万一 id 恰好撞上新方案里的某个)。这里在
  // committedCourses 变化时清空它,恢复新方案集全部可见。pins 是用户对具体课 section 的
  // 约束,加新课不影响旧课的约束意图,继续保留、不在这里清。用函数式更新 + size 守卫避免
  // 已经是空集时还创建一个新 Set 引用,省一次无意义的下游 re-render。
  useEffect(() => {
    setDeletedPlanIds((current) => (current.size === 0 ? current : new Set()))
  }, [committedCourses])
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

  // #里程碑5(排法编号稳定化):allPlans = 全集——不带用户的 section 约束(pins),只受基础
  // cohort/冲突规则,按现有排序稳定生成;每个 allPlans[i] 的编号固定为 i+1("排法 i")，
  // 后面不管怎么约束/删除都不会重新生成、重新编号，只会做过滤。
  const allPlans = useMemo(() => generatePlans(committedCourses, prefs, {}), [committedCourses, prefs])
  const allPlanNumberById = useMemo(() => {
    const map = new Map<string, number>()
    allPlans.forEach((plan, index) => map.set(plan.id, index + 1))
    return map
  }, [allPlans])
  // 「排不出课表」看的是全集是否为空——不受用户的 pins/删除影响到"这些课本身排不排得出来"
  // 这件事(pins 造成的可见排法为 0 是另一种状态,见下面的 plans,不在这里报"排不出")。
  const clashes = useMemo(
    () => (allPlans.length === 0 && committedCourses.length > 1 ? findClashes(committedCourses, prefs, pins) : []),
    [allPlans.length, committedCourses, pins, prefs],
  )
  // pins(左栏点 section 约束,见 togglePin/#里程碑6)与 deletedPlanIds(#里程碑4 逐个删除)
  // 都只做过滤,不重新生成、不重新编号——这就是"约束/删除只减少可见数量、保留编号"的核心。
  const plans = useMemo(
    () => allPlans.filter((plan) => planMatchesPins(plan, pins) && !deletedPlanIds.has(plan.id)),
    [allPlans, deletedPlanIds, pins],
  )
  // #里程碑1(默认单方案预览):约束(pins)/删除方案(deletedPlanIds)/加课(committedCourses,
  // 继而带动 allPlans→plans 变化)这三类"方案集改变"事件后,默认回落到单方案模式(solo)
  // 展示第一个可见排法,不再像之前那样隐式落进 A/B 对比(A/B 只应在用户显式点排法横条上的
  // A / B 按钮时才进入——那两个按钮会自己 setSoloPlanId(null) 退出单方案模式)。初始态同理:
  // mount 时这个 effect 也会跑一次,默认就是 solo 展示排法 1,不是 A/B。
  // 源码顺序特意排在下面「排法签名回配」那个 effect 之前——云端/分享链接带回的显式 A/B 选择
  // 在同一渲染批次里后跑、后写赢,能正确覆盖这里的默认值,不会被打断。
  useEffect(() => {
    setSoloPlanId(plans[0]?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 故意只在这三类"方案集改变"
    // 触发时重置,plans 本身是它们的纯派生值,不需要单独再列一次
  }, [committedCourses, deletedPlanIds, pins])
  useEffect(() => {
    if (planIndex >= plans.length) setPlanIndex(0)
  }, [planIndex, plans.length])
  const plansById = useMemo(() => new Map(plans.map((plan) => [plan.id, plan])), [plans])
  // 导出页选中方案:按 plan.id 引用;约束/删除把它滤掉了就回退到第一个可见排法。
  const selectedExportPlan = (selectedExportPlanId && plansById.get(selectedExportPlanId)) || plans[0] || null

  // #7 排法横条数据：每个排法带上冲突判定（实践中恒为 false，见 planHasConflict 注释）与
  // 「是否落在上下班窗口内」判定；展示编号一律查 allPlanNumberById，不再用数组下标。
  const planViews = useMemo(
    () =>
      plans.map((plan) => ({
        plan,
        conflict: planHasConflict(plan),
        outOfHours: !planFitsWindow(plan, officeWindow),
      })),
    [officeWindow, plans],
  )
  const shownPlanViews = planViews.filter(
    (view) => (!hideConflicts || !view.conflict) && (!hideOutOfHours || !view.outOfHours),
  )
  const shownPlans = shownPlanViews.map((view) => view.plan)
  // 过滤后仍「可见」的排法(plan.id 为键)——A / B 的实际展示要跟着这两个开关走，而不是盲选
  // plansById.get(id)，否则「不展示不符合上下班限制的方案」开着时,日历仍可能画出一个被
  // 过滤掉的排法。
  const shownById = useMemo(() => new Map(shownPlans.map((plan) => [plan.id, plan])), [shownPlans])

  // The 课表 page compares two user-picked conflict-free timetables side by side, but only
  // among the plans that survive the current filters (见上 shownById)。全部被滤掉时
  // 两者都是 null —— TimetableCompare 据此渲染 #4 全空空态（网格骨架 + 居中提示）。
  // B 允许与 A 相同(用户在排法横条上把同一张卡同时设为 A 和 B——原设计允许,plan-strip 上有
  // 「与 A 相同」的显式标注),这里只在 planBId 本身被过滤掉时才回退到另一张可见的排法。
  const planA = (planAId && shownById.get(planAId)) || shownPlans[0] || null
  const planB = shownPlans.length < 2 ? null : (planBId && shownById.get(planBId)) || shownPlans[1] || null
  const totalUnits = committedCourses.reduce((sum, course) => sum + course.units, 0)

  // #12 单方案模式只在被点的排法仍可见时生效——soloActive 每次渲染直接判定成员关系，不需要
  // 专门的 effect 去清空 soloPlanId:被过滤掉时 soloActive 自然为 false(回到 A/B 对比)，
  // 以后约束/删除撤销、这个排法又满足过滤条件时也会自动恢复选中，比数组下标更贴合
  // "约束只是过滤、不改变身份"的模型。
  const soloActive = soloPlanId !== null && shownById.has(soloPlanId)
  // 大课表实际展示的排法:单方案模式 → 只有被点的那个;否则 A / B 对比。
  const shownPlanA = soloActive ? (shownById.get(soloPlanId!) ?? null) : planA
  const shownPlanB = soloActive ? null : planB
  // #里程碑6(左栏 section 高亮):当前实际展示的排法(单方案模式的那个，或对比模式的 A / B)
  // 各自拆成 code → component → sectionId,喂给左栏「当前课程」列表的 section 选择器
  // (CoursePicker)去标出"这个 section 属于 A/B/两者都是"。solo 模式下 shownPlanB 恒为
  // null，映射自然是空对象，不会误标出 B。
  const planASectionMap = useMemo(() => (shownPlanA ? planSectionMap(shownPlanA) : {}), [shownPlanA])
  const planBSectionMap = useMemo(() => (shownPlanB ? planSectionMap(shownPlanB) : {}), [shownPlanB])

  // #里程碑4(#11):课表页当前选中的排法(单方案模式的 soloPlanId，或对比模式下的 A)
  // 同步到导出页的 selectedExportPlanId——课表选了排法 5,进导出页时默认就是排法 5。
  // 单向同步:只在"课表这边的选择"变化时推一次,导出页自己再挑(exportPlanPicker 直接
  // setSelectedExportPlanId)不会被这里覆盖回去,因为这个 effect 不依赖它。
  useEffect(() => {
    const sourceId = soloActive ? soloPlanId : (planA?.id ?? null)
    if (sourceId) setSelectedExportPlanId(sourceId)
  }, [planA, soloActive, soloPlanId])

  // ---- 账号:三个 effect(开机拉取 / 排法签名回配 / 防抖自动上传) ------------------------

  // 当前完整可携带状态 → 云端配置(与 .md 导出同一形状 + 个人信息 + 排法签名)。
  function buildCloudConfig(): CloudConfig {
    return {
      termSlug,
      committed,
      taken,
      cart,
      pins,
      hideConflicts,
      hideOutOfHours,
      meetsOfficeHours,
      meetsPrereq,
      lecFits,
      hideCompleted,
      currentTermOnly,
      excludeTba,
      hideSuperseded,
      programScope,
      workStart,
      workEnd,
      enrollYear,
      programId,
      planSigs: {
        solo: soloActive ? soloPlanId : null,
        a: planA?.id ?? null,
        b: planB?.id ?? null,
      },
    }
  }

  // 开机拉取:带着已存凭据启动 → 以云端存档为准(自动上传保证云端总是最后编辑态)。
  // 例外:URL 带 #st=(别人分享的实时状态链接)时不拉——用户点开链接就是要看链接里的状态。
  const termsReady = terms.length > 0
  useEffect(() => {
    if (!termsReady) return
    if (!account || live) {
      cloudReadyRef.current = true
      return
    }
    let cancelled = false
    setSyncStatus('syncing')
    cloudLoad(account)
      .then(({ config, updatedAt }) => {
        if (cancelled) return
        if (config) applyCloudConfig(config)
        setSyncStatus('synced')
        setSyncNote(updatedAt ?? '')
      })
      .catch((cause) => {
        if (cancelled) return
        setSyncStatus('error')
        setSyncNote(cloudErrorText(cause))
        if (isAuthError(cause)) handleSignOut()
      })
      .finally(() => {
        if (!cancelled) cloudReadyRef.current = true
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在 terms 首次就绪时跑一次
  }, [termsReady])

  // 排法签名回配:allPlans 就绪后按 plan.id 找回云端记录的选中排法;找不到(数据已变)静默
  // 放弃。#里程碑5:直接校验 id 是否存在于全集里就够了,不用再转换成下标——A/B/solo 现在
  // 本来就是按 id 引用(哪怕当前被 pins/删除过滤掉，一旦条件解除也能自动复原)。
  useEffect(() => {
    const sigs = pendingPlanSigsRef.current
    if (!sigs || allPlans.length === 0) return
    pendingPlanSigsRef.current = null
    const exists = (sig: string | null): boolean => Boolean(sig) && allPlans.some((plan) => plan.id === sig)
    if (exists(sigs.a)) setPlanAId(sigs.a)
    if (exists(sigs.b)) setPlanBId(sigs.b)
    if (exists(sigs.solo)) {
      setSoloPlanId(sigs.solo)
      const idx = plans.findIndex((plan) => plan.id === sigs.solo)
      if (idx >= 0) setPlanIndex(idx)
    } else if (exists(sigs.a)) {
      const idx = plans.findIndex((plan) => plan.id === sigs.a)
      if (idx >= 0) setPlanIndex(idx)
    }
  }, [allPlans, plans])

  // 防抖自动上传:登录期间任何可携带状态的编辑,1.5s 静默推到云端(与 #st= 的 replaceState
  // 同一手感)。冲突二选一挂起时暂停;凭据失效自动退出。
  useEffect(() => {
    if (!account || pendingCloud || !cloudReadyRef.current) return
    const timer = window.setTimeout(() => {
      setSyncStatus('syncing')
      cloudSave(account, buildCloudConfig())
        .then((updatedAt) => {
          setSyncStatus('synced')
          setSyncNote(updatedAt ?? '')
        })
        .catch((cause) => {
          setSyncStatus('error')
          setSyncNote(cloudErrorText(cause))
          if (isAuthError(cause)) handleSignOut()
        })
    }, 1500)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildCloudConfig 的输入全在依赖里
  }, [
    account,
    pendingCloud,
    cart,
    committed,
    taken,
    pins,
    termSlug,
    workStart,
    workEnd,
    enrollYear,
    programId,
    hideConflicts,
    hideOutOfHours,
    meetsOfficeHours,
    meetsPrereq,
    lecFits,
    hideCompleted,
    currentTermOnly,
    excludeTba,
    hideSuperseded,
    programScope,
    planA,
    planB,
    soloActive,
    soloPlanId,
  ])

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
  // 导出 PNG/PDF/壁纸 用的画布配色:同一槽位映射解析成具体 hsl() 串,使导出图与屏幕上
  // 的大课表颜色一致(#1)。theme 可选(默认浅色)——#里程碑2:PDF 一次导出明暗两页，
  // 深色那页要解出深色主题的色阶，不能整页都用浅色课块糊在深底上。
  const paintForCode = useCallback(
    (code: string, theme?: PaintTheme) =>
      huePaint(TIMETABLE_PALETTE[slotForCode(code) % TIMETABLE_PALETTE.length], 0, theme),
    [slotForCode],
  )

  // #3 候选(可能学)课程的试排块:对每门 cart 课取「与该排法不冲突的第一种全组件组合」
  //（没有就退回第一种带时间的组合,与选课页 candidates 的展示口径一致),分别为 A / B
  // (或单方案) 各算一份,叠加到大课表上,右上角小角块标记。
  // #修复4(隐藏=彻底移除,不是置灰):被眼睛(disabledCandidates)停用的候选课直接 continue
  // 跳过——大课表上完全不出现这门课的 ghost 块(不渲染,不是置灰)。重新启用走 CommittedList
  // 那一侧的眼睛按钮(不再靠课表上的角标点回来,因为隐藏后角标本身也不存在了)。
  // #里程碑3(核实,导出继承隐藏):这些 ghost 块只喂给 <TimetableCompare> 做屏幕叠加展示，
  // 从不进入任何导出路径——exportPlan()/exportImage.ts/exportHtml.ts/exportWallpaper.ts/
  // ics.ts 的 blocksOf() 都只读 plan.entries(committedCourses 排出来的那个 Plan)，cart
  // courses 本身从未混进 generatePlans 的输入。所以被眼睛(disabledCandidates)隐藏的
  // 候选课"不出现在导出图里"是这条数据流天然成立的，不需要额外过滤 cartGhostsA/B。
  const ghostBlocksFor = useCallback(
    (plan: Plan | null): GhostBlock[] => {
      if (!plan) return []
      const planMeetings = plan.entries.flatMap((entry) => entry.section.meetings)
      const out: GhostBlock[] = []
      for (const code of cart) {
        const course = byCode.get(courseKey(code))
        if (!course) continue
        if (disabledCandidates.has(course.key)) continue
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
    [byCode, cart, disabledCandidates],
  )
  const cartGhostsA = useMemo(() => ghostBlocksFor(shownPlanA), [ghostBlocksFor, shownPlanA])
  const cartGhostsB = useMemo(() => ghostBlocksFor(shownPlanB), [ghostBlocksFor, shownPlanB])

  const [exportNote, setExportNote] = useState('')
  // #里程碑4:图片 PNG 导出前先选画面比例——六个按钮之一是「自定义」，点开才展示 w:h 输入框。
  const [customAspectOpen, setCustomAspectOpen] = useState(false)
  const [customAspectW, setCustomAspectW] = useState('1')
  const [customAspectH, setCustomAspectH] = useState('1')
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
  // 导出页六张卡全部只导出顶部选中的那一个方案（selectedExportPlan），不再 A / B。
  // #里程碑4:aspect 只有 format:'image' 用得到——导出页的六个比例按钮点哪个传哪个。
  // #里程碑3(核实):exportPlan 只收 selectedExportPlan 这一个 Plan，从不带 cart/ghost 数据——
  // 见 ghostBlocksFor 注释,候选课(可能学)不管是否被眼睛隐藏,本就从未出现在任何导出物里。
  async function handleExport(format: ExportFormat, aspect?: Aspect): Promise<void> {
    if (!selectedExportPlan) return
    setExportNote('正在导出…')
    const result = await exportPlan({
      format,
      plan: selectedExportPlan,
      termName: term?.name ?? '',
      // #1 导出图配色与大课表一致(同一 colorSlot → hue 映射);theme 透传给 PDF 的明暗两页。
      paint: (code, _subject, theme) => paintForCode(code, theme),
      aspect,
    })
    setExportNote(result.ok ? result.note : result.reason)
  }
  // 底部「其他」栏:导出全部配置(committed/taken/cart/pins/term/开关)为一份 Markdown，
  // 人肉可读 + 末尾机读块(见 configMd.ts),下载文件名用当天日期。
  const [configNote, setConfigNote] = useState('')
  function handleExportConfigMd(): void {
    const state: ConfigMdState = {
      termSlug,
      committed,
      taken,
      cart,
      pins,
      hideConflicts,
      hideOutOfHours,
      meetsOfficeHours,
      meetsPrereq,
      lecFits,
      hideCompleted,
      currentTermOnly,
      excludeTba,
      hideSuperseded,
      programScope,
      workStart,
      workEnd,
    }
    const md = encodeConfigMd(state, {
      termName: term?.name,
      titleFor: (code) => catalogByKey.get(courseKey(code))?.title,
    })
    downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), configMdFilename())
    setConfigNote('已下载配置文件')
  }

  // 信息页「我的情况」区「导入之前的配置」:读取 .md 文件 → decodeConfigMd → 整体恢复状态。
  const configFileInputRef = useRef<HTMLInputElement | null>(null)
  function handleConfigFile(file: File): void {
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      const state = decodeConfigMd(text)
      if (!state) {
        setConfigNote('导入失败：文件内容无法识别')
        return
      }
      setTermSlug(state.termSlug)
      setCommitted(state.committed)
      setTaken(state.taken)
      setCart(state.cart)
      setPins(state.pins)
      setHideConflicts(state.hideConflicts)
      setHideOutOfHours(state.hideOutOfHours)
      setMeetsOfficeHours(state.meetsOfficeHours)
      setMeetsPrereq(state.meetsPrereq)
      setLecFits(state.lecFits)
      setHideCompleted(state.hideCompleted)
      setCurrentTermOnly(state.currentTermOnly)
      setExcludeTba(state.excludeTba)
      setHideSuperseded(state.hideSuperseded)
      setProgramScope(state.programScope)
      setWorkStart(state.workStart)
      setWorkEnd(state.workEnd)
      setPlanIndex(0)
      setConfigNote('已导入配置')
    }
    reader.onerror = () => setConfigNote('导入失败：无法读取文件')
    reader.readAsText(file)
  }

  // ---- 账号:整体应用云端配置(与 handleConfigFile 同一套 setter 序,另加个人信息与排法签名) ----
  function applyCloudConfig(cfg: CloudConfig): void {
    // termSlug 为空/已不在本年 term 清单(数据换学年)时保持现状,别把课程清空。
    if (cfg.termSlug && terms.some((item) => item.slug === cfg.termSlug)) setTermSlug(cfg.termSlug)
    setCommitted(cfg.committed)
    setTaken(cfg.taken)
    setCart(cfg.cart)
    setPins(cfg.pins)
    setHideConflicts(cfg.hideConflicts)
    setHideOutOfHours(cfg.hideOutOfHours)
    setMeetsOfficeHours(cfg.meetsOfficeHours)
    setMeetsPrereq(cfg.meetsPrereq)
    setLecFits(cfg.lecFits)
    setHideCompleted(cfg.hideCompleted)
    setCurrentTermOnly(cfg.currentTermOnly)
    setExcludeTba(cfg.excludeTba)
    setHideSuperseded(cfg.hideSuperseded)
    setProgramScope(cfg.programScope)
    setWorkStart(cfg.workStart)
    setWorkEnd(cfg.workEnd)
    setEnrollYear(cfg.enrollYear)
    setProgramId(cfg.programId)
    setPlanIndex(0)
    setAutoRemoved([])
    pendingPlanSigsRef.current = cfg.planSigs
  }

  // 本地"还是白纸"的判定:登录遇到云端存档时,白纸直接载入,非白纸才让用户二选一。
  function localIsEmpty(): boolean {
    return (
      committed.length === 0 && taken.length === 0 && cart.length === 0 && enrollYear === '' && programId === ''
    )
  }

  async function pushToCloud(creds: CloudCreds): Promise<void> {
    setSyncStatus('syncing')
    const updatedAt = await cloudSave(creds, buildCloudConfig())
    setSyncStatus('synced')
    setSyncNote(updatedAt ?? '')
  }

  // 登录 / 注册(注册即登录):见 cloud.ts 顶部语义。成功后按「云端有没有存档 × 本地是否白纸」分流。
  async function handleAccountSubmit(): Promise<void> {
    const username = acctUser.trim()
    if (!USERNAME_RE.test(username)) {
      setAcctNote('用户名只能用 2–32 位字母、数字、点、横线、下划线')
      return
    }
    if (acctPass.length === 0) {
      setAcctNote('口令不能为空')
      return
    }
    setAcctBusy(true)
    setAcctNote('')
    try {
      const creds: CloudCreds = { username, password: acctPass }
      const { created, hasConfig } = await cloudAuth(creds)
      saveCreds(creds)
      setAccount(creds)
      setAcctUser('')
      setAcctPass('')
      cloudReadyRef.current = true
      if (!hasConfig) {
        await pushToCloud(creds)
        setAcctNote(created ? '账号已创建,当前配置已存云端' : '已登录,当前配置已存云端')
      } else {
        const { config, updatedAt } = await cloudLoad(creds)
        if (!config) {
          await pushToCloud(creds)
        } else if (localIsEmpty()) {
          applyCloudConfig(config)
          setSyncStatus('synced')
          setAcctNote('已载入云端存档')
        } else {
          setPendingCloud({ config, updatedAt })
        }
      }
    } catch (cause) {
      setAcctNote(cloudErrorText(cause))
      setSyncStatus('idle')
    } finally {
      setAcctBusy(false)
    }
  }

  function handleSignOut(): void {
    clearCreds()
    setAccount(null)
    setPendingCloud(null)
    setSyncStatus('idle')
    setSyncNote('')
    setAcctNote('已退出,本地数据保留在这台设备上')
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
    hideSuperseded,
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
        <span className="card__title-actions">
          <span className="card__note">{totalUnits > 0 ? `${totalUnits} 学分` : '一课一行'}</span>
        </span>
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
        <span className="card__title-actions">
          <span className="card__note">{cart.length > 0 ? `${cart.length} 门候选` : '可能会学'}</span>
        </span>
      </h2>
      <CommittedList
        byCode={byCode}
        cartCodes={cart}
        codes={[]}
        currentTermOrder={currentTermOrder}
        disabledCandidateKeys={disabledCandidates}
        emptyHint="还没有候选课程。在中间的课程列表点「可能学」来添加。"
        termOrdersByKey={termOrdersByKey}
        onRemove={removeCart}
        onRowPointerDown={(code, _isCart, event) => beginCourseDrag(code, 'cart', event)}
        onToggleCandidateDisabled={toggleCandidateDisabled}
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
      {/* #里程碑3:锁按钮从两个时间框正旁边挪到卡片标题栏右上角，做成一个小角标——不再挤占
          输入框的空间，功能不变（默认锁住,防止拖动虚线 / 改这两个输入框被误操作）。 */}
      <h2 className="card__title">
        上下班时间
        <span className="card__title-actions">
          <span className="card__note">日历参考线 · 排法过滤</span>
          <button
            aria-label={workTimeLocked ? '解锁上下班时间设置' : '锁定上下班时间设置'}
            className={`lock-toggle lock-toggle--corner${workTimeLocked ? '' : ' lock-toggle--unlocked'}`}
            title={
              workTimeLocked
                ? '已锁定：日历上的拖动虚线与下方两个输入框都已禁用，点击解锁'
                : '已解锁：可拖动虚线、修改时间，点击重新锁定防止误改'
            }
            type="button"
            onClick={() => setWorkTimeLocked((locked) => !locked)}
          >
            <span aria-hidden>{workTimeLocked ? '🔒' : '🔓'}</span>
          </button>
        </span>
      </h2>
      {/* 上班 / 下班同一排,省纵向空间;语义(不早于/不晚于)收进 title,不再占一行说明。
          #里程碑3:去掉了旁边的清除(×)按钮——上下班时间是默认需要的功能，不需要专门的
          清空入口；仍可通过原生 time input 自带的清除方式取消设置（值语义仍是
          number|null，未破坏排课/渲染）。 */}
      <div className="time-row">
        <div className="field" title="希望一天的课不早于此">
          <span className="field__label">上班时间</span>
          <input
            aria-label="上班时间"
            className="time-input"
            disabled={workTimeLocked}
            step={300}
            type="time"
            value={workStart != null ? hhmm(workStart) : ''}
            onChange={(event) => setWorkStart(parseHHMM(event.target.value))}
          />
        </div>
        <div className="field" title="希望一天的课不晚于此">
          <span className="field__label">下班时间</span>
          <input
            aria-label="下班时间"
            className="time-input"
            disabled={workTimeLocked}
            step={300}
            type="time"
            value={workEnd != null ? hhmm(workEnd) : ''}
            onChange={(event) => setWorkEnd(parseHHMM(event.target.value))}
          />
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
        <span className="card__title-actions">
          <span className="card__note">{totalUnits > 0 ? `${totalUnits} 学分 · 选时段` : '选时段'}</span>
        </span>
      </h2>
      <CommittedList
        byCode={byCode}
        cartCodes={cart}
        codes={committed}
        colorFor={colorForCode}
        currentA={planASectionMap}
        currentB={planBSectionMap}
        currentTermOrder={currentTermOrder}
        disabledCandidateKeys={disabledCandidates}
        pins={pins}
        showTermBadge={false}
        termOrdersByKey={termOrdersByKey}
        onPin={togglePin}
        onToggleCandidateDisabled={toggleCandidateDisabled}
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
        <div className="field">
          <span className="field__label">配置备份</span>
          <input
            accept=".md,text/markdown"
            hidden
            ref={configFileInputRef}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) handleConfigFile(file)
              event.target.value = ''
            }}
          />
          <button
            className="export-btn"
            type="button"
            onClick={() => configFileInputRef.current?.click()}
          >
            导入之前的配置
          </button>
          {configNote && <p className="card__sub">{configNote}</p>}
        </div>
      </div>
    </section>
  )

  // 账号弹层(右上角人头按钮打开):未登录=登录/注册表单;已登录=账号菜单(同步状态/
  // 冲突二选一/退出)。语义细节(注册即登录、无找回)不在界面上预先说教——错口令时的
  // 错误文案(cloudErrorText)会在真正需要的时刻解释。
  const syncStatusText =
    syncStatus === 'syncing'
      ? '同步中…'
      : syncStatus === 'synced'
        ? '已同步到云端'
        : syncStatus === 'error'
          ? syncNote || '同步失败'
          : '未同步'
  const accountPop = acctOpen ? (
    <>
      <div aria-hidden className="acct-overlay" onClick={() => setAcctOpen(false)} />
      <div aria-label="账号" className="acct-pop" role="dialog">
        {!account ? (
          <>
            <h3 className="acct-pop__title">登录 CU Schedule</h3>
            <p className="acct-pop__sub">登录后配置自动保存到云端,换设备接着排。</p>
            <div className="acct-form">
              <input
                autoComplete="username"
                autoFocus
                maxLength={32}
                placeholder="用户名"
                value={acctUser}
                onChange={(event) => setAcctUser(event.target.value)}
              />
              <input
                autoComplete="current-password"
                maxLength={64}
                placeholder="口令"
                type="password"
                value={acctPass}
                onChange={(event) => setAcctPass(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleAccountSubmit()
                }}
              />
              <button
                className="acct-primary"
                disabled={acctBusy}
                type="button"
                onClick={() => void handleAccountSubmit()}
              >
                {acctBusy ? '正在登录…' : '登录 / 注册'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="acct-me">
              <span aria-hidden className="acct-avatar acct-avatar--lg">
                {account.username.slice(0, 1).toUpperCase()}
              </span>
              <div className="acct-me__text">
                <span className="acct-user">{account.username}</span>
                <span className="acct-status">
                  <span aria-hidden className={`acct-dot acct-dot--${syncStatus}`} />
                  {syncStatusText}
                </span>
              </div>
            </div>
            {pendingCloud && (
              <div className="acct-conflict">
                <p className="acct-pop__sub">云端已有存档,这台设备上也有内容。用哪份?</p>
                <div className="acct-conflict__btns">
                  <button
                    className="acct-primary"
                    type="button"
                    onClick={() => {
                      applyCloudConfig(pendingCloud.config)
                      setPendingCloud(null)
                      setSyncStatus('synced')
                      setAcctNote('已载入云端存档')
                    }}
                  >
                    载入云端存档
                  </button>
                  <button
                    className="acct-primary acct-primary--ghost"
                    type="button"
                    onClick={() => {
                      setPendingCloud(null)
                      void pushToCloud(account).catch((cause) => {
                        setSyncStatus('error')
                        setSyncNote(cloudErrorText(cause))
                      })
                      setAcctNote('已用本地配置覆盖云端')
                    }}
                  >
                    用本地覆盖云端
                  </button>
                </div>
              </div>
            )}
            <button className="acct-signout" type="button" onClick={handleSignOut}>
              退出登录
            </button>
          </>
        )}
        {acctNote && <p className="acct-note">{acctNote}</p>}
      </div>
    </>
  ) : null

  // 信息页:「已完成课程」独立成卡。CodeInput 一体化承担手动录入(边打边搜提示 + IME 拼字
  // 安全)与已录入课程的 chip 展示/点击移除,搜索池用全年课程(已修课可能开在另一学期)。
  const takenCard = (
    <section className="card">
      <h2 className="card__title">
        已完成课程
        <span className="card__note">排除已修 · 判断先修</span>
      </h2>
      <p className="card__sub">已录入 {taken.length} 门</p>
      <CodeInput
        codes={taken}
        courses={allCourses}
        placeholder="粘贴成绩单上的课号，回车录入…"
        variant="taken"
        onChange={setTaken}
      />
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
        <Toggle checked={hideSuperseded} onChange={setHideSuperseded}>
          隐藏已替代修课
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

  // 导出页:顶部「课表导出方案」——从可行排法里只选一个（单选，非 A / B）作为要导出的确定
  // 方案。视觉复用课表页排法横条的卡片样式（.plan-strip__rail / .plan-card），选中态直接
  // 借用既有的 .plan-card--solo 高亮，不需要额外的 A / B 拾取按钮。#里程碑4:同样套
  // PlanStripRail(去滚动条 + 按住拖动 + 选中项自动滚入可见区)。#里程碑5:标签一律查
  // allPlanNumberById，不是这里的数组下标——排法在全集里的编号不受 pins/删除影响。
  const exportPlanPicker =
    plans.length > 0 ? (
      <PlanStripRail selectedId={selectedExportPlan?.id ?? null}>
        {plans.map((plan) => {
          const isSelected = plan.id === selectedExportPlan?.id
          const label = allPlanNumberById.get(plan.id) ?? '?'
          return (
            <div
              className={`plan-card${isSelected ? ' plan-card--solo' : ''}`}
              data-plan-id={plan.id}
              key={plan.id}
              role="button"
              tabIndex={0}
              title="选为要导出的方案"
              onClick={() => setSelectedExportPlanId(plan.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedExportPlanId(plan.id)
                }
              }}
            >
              <div className="plan-card__info">
                <span className="plan-card__name">排法 {label}</span>
                <span className="plan-card__meta">
                  {plan.teachingDays.length} 天 · {plan.units} 学分
                </span>
              </div>
              {isSelected && (
                <span aria-hidden className="plan-card__selected-mark">
                  ✓
                </span>
              )}
            </div>
          )
        })}
      </PlanStripRail>
    ) : null

  // #7 排法横条（课表页右主区顶部，可横向滚动）：每张扁平小卡左侧显示 排法N · 天数 · 学分，
  // 右侧两个方形小按钮「A」「B」分别设为该排法（选中态高亮）。#12 点卡片本体 → 单方案模式
  //（只看这一个排法,退出 A/B 对比）；点任意 A / B 按钮 → 回到对比模式。
  // #里程碑4(#10):isA/isB 都额外 && !soloActive——单方案模式下不再显示任何 A/B 徽标/
  // 特殊样式(哪怕某张卡片恰好等于 planA/planB)，只有被选中的单排法本身高亮
  // (plan-card--solo)。点 A / B 按钮会先 setSoloPlanId(null) 退出单方案模式，回到对比态
  // 后 isA/isB 才重新按 !soloActive 生效。
  // #里程碑5:选中态与展示编号全部按 plan.id / allPlanNumberById 走，不再是数组下标——
  // 约束(pins)/删除只改变"这张卡在不在横条上"，不改变它显示的是「排法几」。
  const planStrip =
    plans.length > 0 ? (
      <PlanStripRail selectedId={soloActive ? soloPlanId : (planA?.id ?? null)}>
        {shownPlanViews.map(({ plan }) => {
          const label = allPlanNumberById.get(plan.id) ?? '?'
          const isA = !soloActive && plan.id === planA?.id
          const isB = !soloActive && shownPlans.length >= 2 && plan.id === planB?.id
          const isSolo = soloActive && plan.id === soloPlanId
          return (
            <div
              className={`plan-card${isA ? ' plan-card--a' : ''}${isB ? ' plan-card--b' : ''}${isSolo ? ' plan-card--solo' : ''}`}
              data-plan-id={plan.id}
              key={plan.id}
              role="button"
              tabIndex={0}
              title="点击单独查看此排法"
              onClick={() => setSoloPlanId(plan.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSoloPlanId(plan.id)
                }
              }}
            >
              <div className="plan-card__info">
                <span className="plan-card__name">排法 {label}</span>
                <span className="plan-card__meta">
                  {plan.teachingDays.length} 天 · {plan.units} 学分
                </span>
              </div>
              <div className="plan-card__actions">
                <button
                  aria-label={`排法 ${label} 设为 A`}
                  className={`plan-card__pick plan-card__pick--a${isA ? ' plan-card__pick--on' : ''}${soloActive ? ' plan-card__pick--dimmed' : ''}`}
                  title="设为 A（回到 A/B 对比）"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setSoloPlanId(null)
                    setPlanAId(plan.id)
                  }}
                >
                  A
                </button>
                <button
                  aria-label={`排法 ${label} 设为 B`}
                  className={`plan-card__pick plan-card__pick--b${isB ? ' plan-card__pick--on' : ''}${soloActive ? ' plan-card__pick--dimmed' : ''}`}
                  title="设为 B（回到 A/B 对比）"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setSoloPlanId(null)
                    setPlanBId(plan.id)
                  }}
                >
                  B
                </button>
              </div>
              {/* #里程碑4:逐个删除——按 plan.id 记，其余排法不受影响(不重排/不改标号)。 */}
              <button
                aria-label={`删除排法 ${label}`}
                className="plan-card__del"
                title="从横条移除这个排法（不影响其它排法）"
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  setDeletedPlanIds((current) => {
                    const next = new Set(current)
                    next.add(plan.id)
                    return next
                  })
                }}
              >
                ×
              </button>
            </div>
          )
        })}
      </PlanStripRail>
    ) : null

  // #里程碑4:图片 PNG 卡不再是一个按钮，而是六个比例按钮(1:1/9:16/16:9/4:3/3:4/自定义)，
  // 点哪个就以哪个比例导出——不用先选按钮再点下载,少一步。
  const PNG_ASPECTS: Array<{ label: string; aspect: Aspect }> = [
    { label: '1:1', aspect: { w: 1, h: 1 } },
    { label: '9:16', aspect: { w: 9, h: 16 } },
    { label: '16:9', aspect: { w: 16, h: 9 } },
    { label: '4:3', aspect: { w: 4, h: 3 } },
    { label: '3:4', aspect: { w: 3, h: 4 } },
  ]
  const pngAspectPicker = (
    <div className="aspect-picker">
      {PNG_ASPECTS.map((item) => (
        <button
          className="aspect-btn"
          disabled={!selectedExportPlan}
          key={item.label}
          type="button"
          onClick={() => void handleExport('image', item.aspect)}
        >
          {item.label}
        </button>
      ))}
      <button
        aria-expanded={customAspectOpen}
        className={`aspect-btn${customAspectOpen ? ' aspect-btn--on' : ''}`}
        disabled={!selectedExportPlan}
        type="button"
        onClick={() => setCustomAspectOpen((value) => !value)}
      >
        自定义
      </button>
      {customAspectOpen && (
        <div className="aspect-custom">
          <input
            aria-label="宽"
            className="aspect-custom__input"
            inputMode="decimal"
            value={customAspectW}
            onChange={(event) => setCustomAspectW(event.target.value)}
          />
          <span aria-hidden>:</span>
          <input
            aria-label="高"
            className="aspect-custom__input"
            inputMode="decimal"
            value={customAspectH}
            onChange={(event) => setCustomAspectH(event.target.value)}
          />
          <button
            className="export-btn aspect-custom__go"
            disabled={!selectedExportPlan}
            type="button"
            onClick={() => {
              const w = Number(customAspectW)
              const h = Number(customAspectH)
              void handleExport('image', { w: w > 0 ? w : 1, h: h > 0 ? h : 1 })
            }}
          >
            按此比例导出
          </button>
        </div>
      )}
    </div>
  )

  // 导出方式六卡：图标 + 名称 + 较完整介绍，2 个一行、共 3 行（.export-methods-grid 强制两列）。
  // 每卡都只导出顶部选中的 selectedExportPlan（只读分享除外——它分享的是整份选课状态，
  // 沿用既有 #v= 只读分享逻辑，见 handleCreateShare 注释）。图片 PNG 卡用 footer 换掉默认按钮，
  // 换成六个比例按钮(见上方 pngAspectPicker)。
  const exportMethods: Array<{
    key: string
    icon: ReactNode
    title: string
    desc: string
    ctaLabel: string
    disabled: boolean
    busy?: boolean
    onClick: () => void
    footer?: ReactNode
  }> = [
    {
      key: 'wallpaper',
      icon: (
        <svg aria-hidden fill="none" height="20" viewBox="0 0 24 24" width="20">
          <rect height="18" rx="3" stroke="currentColor" strokeWidth="2" width="12" x="6" y="3" />
          <path d="M10 19h4" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      ),
      title: '手机壁纸',
      desc: '竖屏壁纸图，把选中的课表铺成手机锁屏背景，顶部留白避开系统时间。导出两张：纯背景 + 带课表。',
      ctaLabel: '下载壁纸',
      disabled: !selectedExportPlan,
      onClick: () => void handleExport('wallpaper'),
    },
    {
      key: 'ics',
      icon: (
        <svg aria-hidden fill="none" height="20" viewBox="0 0 24 24" width="20">
          <rect height="17" rx="2" stroke="currentColor" strokeWidth="2" width="18" x="3" y="4.5" />
          <path d="M3 9.5h18M8 2.5v4M16 2.5v4" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      ),
      title: '日历（.ics）',
      desc: '导入手机系统日历 / Google Calendar，每周自动重复。周期为按学期估算，开学后请回 CUSIS 核对真实起止日期。',
      ctaLabel: '下载 .ics',
      disabled: !selectedExportPlan,
      onClick: () => void handleExport('ics'),
    },
    {
      key: 'share',
      icon: (
        <svg aria-hidden fill="none" height="20" viewBox="0 0 24 24" width="20">
          <path
            d="M12 3C7 3 3 7 3 12s4 9 9 9 9-4 9-9-4-9-9-9Z"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path d="M8 12c0-2.2 1.8-4 4-4s4 1.8 4 4-1.8 4-4 4-4-1.8-4-4Z" stroke="currentColor" strokeWidth="2" />
        </svg>
      ),
      title: '只读分享',
      desc: '生成一个一天有效的只读链接，手机打开即可查看当前选课与课表，无需登录，对方不能编辑。',
      ctaLabel: shareBusy ? '生成中…' : '生成只读链接',
      disabled: committed.length === 0 || shareBusy,
      busy: shareBusy,
      onClick: () => void handleCreateShare(),
    },
    {
      key: 'pdf',
      icon: (
        <svg aria-hidden fill="none" height="20" viewBox="0 0 24 24" width="20">
          <path
            d="M6 2.5h8l4 4V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path d="M14 2.5V7h4" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      ),
      title: '表格 PDF',
      desc: '一页 A4 的课表，线条清晰，适合打印出来贴在墙上或夹进笔记本。',
      ctaLabel: '下载 PDF',
      disabled: !selectedExportPlan,
      onClick: () => void handleExport('pdf'),
    },
    {
      key: 'image',
      icon: (
        <svg aria-hidden fill="none" height="20" viewBox="0 0 24 24" width="20">
          <rect height="16" rx="2" stroke="currentColor" strokeWidth="2" width="18" x="3" y="4" />
          <circle cx="8.5" cy="9.5" fill="currentColor" r="1.4" stroke="none" />
          <path d="m4 17 5-5 4 3 3-3 4 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        </svg>
      ),
      title: '图片 PNG',
      desc: '课表截图，先选画面比例(六选一，也可自定义 w:h)，再导出这张比例的图。',
      ctaLabel: '下载图片',
      disabled: !selectedExportPlan,
      onClick: () => void handleExport('image', { w: 8, h: 5 }),
      footer: pngAspectPicker,
    },
    {
      key: 'html',
      icon: (
        <svg aria-hidden fill="none" height="20" viewBox="0 0 24 24" width="20">
          <path
            d="M6 2.5h8l4 4V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path d="M14 2.5V7h4" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="m9.5 13-1.7 1.7 1.7 1.7M14.5 13l1.7 1.7-1.7 1.7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
        </svg>
      ),
      title: '导出为 HTML',
      desc: '独立的自包含网页文件，不依赖网络，离线也能双击打开，内含完整课表，适合长期留存。',
      ctaLabel: '下载 HTML',
      disabled: !selectedExportPlan,
      onClick: () => void handleExport('html'),
    },
  ]

  const exportView = (
    <div className="page-center page-center--export">
      <section className="card">
        <h2 className="card__title">
          课表导出方案
          <span className="card__note">{term?.name ?? ''}</span>
        </h2>
        {plans.length === 0 ? (
          <p className="card__sub">先在选课页选课，才能导出课表</p>
        ) : (
          <>
            <p className="card__sub">从可行排法里选一个作为要导出的方案（下面所有导出方式都只导出这一个）。</p>
            {exportPlanPicker}
            <p className="card__sub">
              已选 {committedCourses.length} 门 · {totalUnits} 学分
              {selectedExportPlan
                ? ` · 排法 ${allPlanNumberById.get(selectedExportPlan.id) ?? '?'}（${selectedExportPlan.teachingDays.length} 天）`
                : ''}
            </p>
          </>
        )}
      </section>

      <h3 className="export-group-title">导出方式</h3>
      <div className="export-methods-grid">
        {exportMethods.map((method) => (
          <section className="card export-card export-method-card" key={method.key}>
            <div className="export-method-card__head">
              <span aria-hidden className="export-method-card__icon">
                {method.icon}
              </span>
              <h3 className="card__title">{method.title}</h3>
            </div>
            <p className="card__sub export-method-card__desc">{method.desc}</p>
            {method.footer ?? (
              <button
                className="export-btn"
                disabled={method.disabled}
                type="button"
                onClick={method.onClick}
              >
                {method.ctaLabel}
              </button>
            )}
          </section>
        ))}
      </div>

      <h3 className="export-group-title">其他</h3>
      <section className="card export-bar">
        <div className="export-bar__text">
          <h3 className="card__title">导出所有配置</h3>
          <p className="card__sub">
            把要上的课、已修过的课、备选课、锁定时段与筛选开关打包成一份 Markdown，方便备份或换设备导入。
          </p>
        </div>
        <button className="export-btn export-bar__btn" type="button" onClick={handleExportConfigMd}>
          下载 .md
        </button>
      </section>

      {shareNote && <p className="export-note export-note--share">{shareNote}</p>}
      {exportNote && <p className="export-note">{exportNote}</p>}
      {configNote && <p className="export-note">{configNote}</p>}
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
                locked={workTimeLocked}
                planA={shownPlanA}
                planB={shownPlanB}
                showEmptyGrid={committedCourses.length > 0}
                solo={soloActive}
                onGuideChange={(tone, minutes) =>
                  tone === 'am' ? setWorkStart(minutes) : setWorkEnd(minutes)
                }
                onToggleCandidate={toggleCandidateDisabled}
              />
            </section>
          </>
        )
      case 'export':
        return exportView
      case 'appendix':
        return <AppendixPage siblings={SIBLINGS} />
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
            {/* 账号入口:未登录=描边人头;已登录=首字母圆角矩形头像(与按钮同语言),
                同步状态由按钮边框色标识(绿=已同步/黄=同步中/红=失败),不再用独立圆点。 */}
            <button
              aria-expanded={acctOpen}
              aria-label={account ? `账号 ${account.username}` : '登录账号'}
              className={account ? `bar__acct bar__acct--in acct-sync--${syncStatus}` : 'bar__acct'}
              title={account ? `${account.username} · ${syncStatusText}` : '登录 / 注册'}
              type="button"
              onClick={() => {
                setAcctNote('')
                setAcctOpen((open) => !open)
              }}
            >
              {account ? (
                <span aria-hidden className="acct-avatar">
                  {account.username.slice(0, 1).toUpperCase()}
                </span>
              ) : (
                <svg aria-hidden fill="none" height="19" viewBox="0 0 24 24" width="19">
                  <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
                  <path
                    d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="2"
                  />
                </svg>
              )}
            </button>
            <button
              aria-label={`当前主题：${THEME_LABEL[theme]}，点击切换到${THEME_LABEL[nextTheme(theme)]}`}
              className="bar__theme"
              title={`当前：${THEME_LABEL[theme]}主题 · 点击切换到${THEME_LABEL[nextTheme(theme)]}`}
              type="button"
              onClick={() => setTheme((value) => nextTheme(value))}
            >
              <span aria-hidden>{THEME_ICON[theme]}</span>
            </button>
          </div>
        </header>

        {/* 账号弹层:fixed 定位锚到 header 右下方。作为 header 的兄弟渲染——放进 .bar 会被
            其 backdrop-filter 变成 containing block,fixed 定位就不再相对视口。 */}
        {accountPop}

        {error && <div className="alert">{error}</div>}

        <main className="viewport">
          {/* 只渲染当前 active 页一层：切页即瞬间替换，不叠层、不做过渡动画。 */}
          <div className={`grid grid--${page}`} key={page}>
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
            CUS by VinceJiang
          </a>
        </div>
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
