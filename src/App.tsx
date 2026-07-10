import { useEffect, useMemo, useState } from 'react'
import { CodeInput } from './components/CodeInput.tsx'
import { CourseList } from './components/CourseList.tsx'
import { CourseTable } from './components/CourseTable.tsx'
import { Timetable } from './components/Timetable.tsx'
import { evaluateCandidates } from './lib/candidates.ts'
import { loadTermList, loadYearOfferings, type Offering, type TermRef } from './lib/data.ts'
import { blockedByPrefs, findClashes, generatePlans, type Prefs } from './lib/schedule.ts'
import { hhmm } from './lib/time.ts'
import type { Course } from './lib/types.ts'

type Theme = 'light' | 'dark'
type Page = 'select' | 'timetable'
type RightMode = 'candidates' | 'list'

const EARLY_START = 9 * 60 + 30
const EVENING_END = 18 * 60 + 30
const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五']
const STORAGE_KEY = 'cu-schedule:v1'

type Saved = {
  termSlug: string | null
  committed: string[]
  taken: string[]
  prefs: Prefs
}

const DEFAULT_PREFS: Prefs = { earliestStart: null, latestEnd: null, avoidLunch: false, dayOff: [] }

function loadSaved(): Saved | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Saved
    if (!Array.isArray(parsed.committed) || !Array.isArray(parsed.taken)) return null
    return { ...parsed, prefs: { ...DEFAULT_PREFS, ...parsed.prefs } }
  } catch {
    return null
  }
}

function loadTheme(): Theme {
  const saved = window.localStorage.getItem('cu-schedule:theme')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const saved = loadSaved()

export default function App() {
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [terms, setTerms] = useState<TermRef[]>([])
  const [termSlug, setTermSlug] = useState<string | null>(saved?.termSlug ?? null)
  const [offerings, setOfferings] = useState<Offering[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [committed, setCommitted] = useState<string[]>(saved?.committed ?? [])
  const [taken, setTaken] = useState<string[]>(saved?.taken ?? [])
  const [prefs, setPrefs] = useState<Prefs>(saved?.prefs ?? DEFAULT_PREFS)
  const [planIndex, setPlanIndex] = useState(0)
  const [page, setPage] = useState<Page>('select')
  const [rightMode, setRightMode] = useState<RightMode>('candidates')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('cu-schedule:theme', theme)
  }, [theme])

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

  // Load the whole academic year once: the planner schedules within the selected
  // term, but the course list compares 上学期 and 下学期 side by side.
  useEffect(() => {
    if (!year) return
    let cancelled = false
    setLoading(true)
    setError(null)
    loadYearOfferings(year)
      .then((list) => {
        if (!cancelled) setOfferings(list)
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
    const payload: Saved = { termSlug, committed, taken, prefs }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [committed, prefs, taken, termSlug, terms.length])

  const byCode = useMemo(() => new Map(courses.map((course) => [course.code, course])), [courses])
  const committedCourses = useMemo(
    () => committed.map((code) => byCode.get(code)).filter((course): course is Course => Boolean(course)),
    [byCode, committed],
  )
  const unknownCommitted = useMemo(
    () => (courses.length === 0 ? [] : committed.filter((code) => !byCode.has(code))),
    [byCode, committed, courses.length],
  )

  const plans = useMemo(() => generatePlans(committedCourses, prefs), [committedCourses, prefs])
  const clashes = useMemo(
    () => (plans.length === 0 && committedCourses.length > 1 ? findClashes(committedCourses, prefs) : []),
    [committedCourses, plans.length, prefs],
  )
  const prefBlocked = useMemo(
    () => (plans.length === 0 && committedCourses.length > 0 ? blockedByPrefs(committedCourses, prefs) : []),
    [committedCourses, plans.length, prefs],
  )

  useEffect(() => {
    if (planIndex >= plans.length) setPlanIndex(0)
  }, [planIndex, plans.length])

  const plan = plans[planIndex] ?? null
  const totalUnits = committedCourses.reduce((sum, course) => sum + course.units, 0)

  const candidates = useMemo(() => {
    if (courses.length === 0) return { rows: [], summary: { open: 0, rearrange: 0, conflict: 0, tba: 0, taken: 0, ruledOut: 0 } }
    return evaluateCandidates({ courses, taken, committed, plans, selectedPlanIndex: planIndex, prefs })
  }, [committed, courses, planIndex, plans, prefs, taken])

  function addCommitted(code: string): void {
    setTaken((codes) => codes.filter((item) => item !== code))
    setCommitted((codes) => (codes.includes(code) ? codes : [...codes, code]))
    setPlanIndex(0)
  }

  function toggleDayOff(dayIndex: number): void {
    setPrefs((current) => ({
      ...current,
      dayOff: current.dayOff.includes(dayIndex)
        ? current.dayOff.filter((value) => value !== dayIndex)
        : [...current.dayOff, dayIndex].sort(),
    }))
  }

  return (
    <div className="app">
      <header className="bar">
        <div className="bar__brand">
          <span className="bar__mark" aria-hidden />
          <h1>CU Schedule</h1>
          <small>中大选课助手</small>
        </div>
        <nav className="bar__nav">
          <button
            className={page === 'select' ? 'bar__nav-item bar__nav-item--on' : 'bar__nav-item'}
            type="button"
            onClick={() => setPage('select')}
          >
            选课
          </button>
          <button
            className={page === 'timetable' ? 'bar__nav-item bar__nav-item--on' : 'bar__nav-item'}
            type="button"
            onClick={() => setPage('timetable')}
          >
            课表
          </button>
        </nav>
        <div className="bar__tools">
          <button
            aria-label="切换主题"
            className="bar__theme"
            type="button"
            onClick={() => setTheme((value) => (value === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>
      </header>

      {error && <div className="alert">{error}</div>}

      <main className="grid">
        <aside className="side">
          <section className="card">
            <h2 className="card__title">
              要上的课
              <span className="card__note">
                {totalUnits > 0 ? `${totalUnits} 学分` : '回车确认，可整段粘贴'}
              </span>
            </h2>
            <CodeInput
              codes={committed}
              courses={courses}
              placeholder="MATH2050 CSCI2100…"
              variant="commit"
              onChange={(codes) => {
                setCommitted(codes)
                setPlanIndex(0)
              }}
            />
            {unknownCommitted.length > 0 && (
              <p className="card__warn">本学期没有开设：{unknownCommitted.join('、')}</p>
            )}
          </section>

          <section className="card">
            <h2 className="card__title">
              上过的课
              <span className="card__note">用于排除已修与判断先修</span>
            </h2>
            <CodeInput
              codes={taken}
              courses={courses}
              placeholder="粘贴成绩单上的课号…"
              variant="taken"
              onChange={setTaken}
            />
          </section>

          <section className="card">
            <h2 className="card__title">时间偏好</h2>
            <div className="chips">
              <button
                className={prefs.earliestStart !== null ? 'chip chip--on' : 'chip'}
                type="button"
                onClick={() =>
                  setPrefs((current) => ({
                    ...current,
                    earliestStart: current.earliestStart === null ? EARLY_START : null,
                  }))
                }
              >
                不上早课
              </button>
              <button
                className={prefs.latestEnd !== null ? 'chip chip--on' : 'chip'}
                type="button"
                onClick={() =>
                  setPrefs((current) => ({
                    ...current,
                    latestEnd: current.latestEnd === null ? EVENING_END : null,
                  }))
                }
              >
                不上夜课
              </button>
              <button
                className={prefs.avoidLunch ? 'chip chip--on' : 'chip'}
                type="button"
                onClick={() => setPrefs((current) => ({ ...current, avoidLunch: !current.avoidLunch }))}
              >
                留出午休
              </button>
            </div>
            <div className="chips">
              {DAY_NAMES.map((day, index) => (
                <button
                  className={prefs.dayOff.includes(index + 1) ? 'chip chip--on' : 'chip'}
                  key={day}
                  type="button"
                  onClick={() => toggleDayOff(index + 1)}
                >
                  {day}空
                </button>
              ))}
            </div>
          </section>

          {(clashes.length > 0 || prefBlocked.length > 0) && (
            <section className="card card--problem">
              <h2 className="card__title">排不出课表</h2>
              {prefBlocked.length > 0 && (
                <p>
                  时间偏好把这些课的所有 section 都筛掉了：<b>{prefBlocked.join('、')}</b>
                </p>
              )}
              {clashes.slice(0, 4).map((clash) => (
                <p key={`${clash.codes.join()}-${clash.start}`}>
                  <b>{clash.codes[0]}</b> 与 <b>{clash.codes[1]}</b> 在{DAY_NAMES[clash.dayIndex - 1]}{' '}
                  {hhmm(clash.start)}–{hhmm(clash.end)} 冲突
                </p>
              ))}
            </section>
          )}

          {(committed.length > 0 || taken.length > 0) && (
            <button
              className="reset"
              type="button"
              onClick={() => {
                setCommitted([])
                setTaken([])
                setPrefs(DEFAULT_PREFS)
                setPlanIndex(0)
              }}
            >
              清空全部
            </button>
          )}
        </aside>

        {page === 'timetable' ? (
          <section className="stage">
            <div className="stage__head">
              <h2>课表</h2>
              {plans.length > 0 && (
                <div className="plans">
                  {plans.map((item, index) => (
                    <button
                      className={index === planIndex ? 'plan plan--on' : 'plan'}
                      key={item.id}
                      type="button"
                      onClick={() => setPlanIndex(index)}
                    >
                      排法 {index + 1}
                      <i>{item.teachingDays.length} 天</i>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Timetable
              emptyMessage={
                committedCourses.length === 0
                  ? '在左侧填入要上的课，课表会自动排出来'
                  : '这些课排不出无冲突的课表，左侧列出了卡住的地方'
              }
              plan={plan}
            />
          </section>
        ) : (
          <section className="table-pane">
            <div className="pane__head">
              <div className="pane__tabs">
                <button
                  className={rightMode === 'candidates' ? 'pane__tab pane__tab--on' : 'pane__tab'}
                  type="button"
                  onClick={() => setRightMode('candidates')}
                >
                  可选课
                </button>
                <button
                  className={rightMode === 'list' ? 'pane__tab pane__tab--on' : 'pane__tab'}
                  type="button"
                  onClick={() => setRightMode('list')}
                >
                  课程列表
                </button>
              </div>
              {rightMode === 'candidates' && <span className="pane__hint">根据你的课表主动筛选</span>}
              {rightMode === 'list' && <span className="pane__hint">按 科目 → 首位数字 → 学期 排列</span>}
            </div>
            {loading ? (
              <div className="pane__loading">正在加载 {year ?? ''} 全部课程…</div>
            ) : rightMode === 'candidates' ? (
              <CourseTable onAdd={addCommitted} rows={candidates.rows} summary={candidates.summary} />
            ) : (
              <CourseList committed={committed} offerings={offerings} onAdd={addCommitted} />
            )}
          </section>
        )}
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
    </div>
  )
}
