import { useEffect, useMemo, useState } from 'react'
import { CodeInput } from './components/CodeInput.tsx'
import { CommittedList } from './components/CommittedList.tsx'
import { SearchResults, type SearchFilters, type Selectability } from './components/SearchResults.tsx'
import { SubjectPicker } from './components/SubjectPicker.tsx'
import { TimetableCompare } from './components/TimetableCompare.tsx'
import { evaluateCandidates } from './lib/candidates.ts'
import { exportPlan, type ExportFormat } from './lib/exportPlan.ts'
import {
  loadSubjects,
  loadTermList,
  loadYearOfferings,
  type Offering,
  type SubjectInfo,
  type TermRef,
} from './lib/data.ts'
import { findClashes, generatePlans, type Pins, type Prefs } from './lib/schedule.ts'
import { hhmm } from './lib/time.ts'
import type { Course } from './lib/types.ts'

type Theme = 'light' | 'dark'
type Page = 'select' | 'timetable'

const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五']
const STORAGE_KEY = 'cu-schedule:v1'

// Five primary-color options to choose from. Each is just an HSL hue; the brand
// tints in styles.css are all derived from --accent, so setting the hue recolors
// the whole app in both light and dark. One will be picked and hard-coded.
const ACCENTS: Array<{ id: string; label: string; hue: number }> = [
  { id: 'indigo', label: '靛蓝', hue: 244 },
  { id: 'teal', label: '青碧', hue: 190 },
  { id: 'emerald', label: '翠绿', hue: 156 },
  { id: 'rose', label: '玫红', hue: 344 },
  { id: 'amber', label: '琥珀', hue: 32 },
]

function loadAccent(): number {
  const saved = Number(window.localStorage.getItem('cu-schedule:accent'))
  return ACCENTS.some((item) => item.hue === saved) ? saved : ACCENTS[0].hue
}

type Saved = {
  termSlug: string | null
  committed: string[]
  taken: string[]
  pins?: Pins
}

const DEFAULT_PREFS: Prefs = { earliestStart: null, latestEnd: null, avoidLunch: false, dayOff: [] }

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

const saved = loadSaved()

export default function App() {
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [terms, setTerms] = useState<TermRef[]>([])
  const [termSlug, setTermSlug] = useState<string | null>(saved?.termSlug ?? null)
  const [offerings, setOfferings] = useState<Offering[]>([])
  const [subjects, setSubjects] = useState<SubjectInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [committed, setCommitted] = useState<string[]>(saved?.committed ?? [])
  const [taken, setTaken] = useState<string[]>(saved?.taken ?? [])
  // Pinned sections (e.g. TUT T01) constrain which A / B timetables the scheduler builds.
  const [pins, setPins] = useState<Pins>(saved?.pins ?? {})
  const [planIndex, setPlanIndex] = useState(0)
  const [page, setPage] = useState<Page>('select')
  const [accent, setAccent] = useState<number>(loadAccent)

  // Preference UI has been removed; schedule.ts's Prefs parameter surface is kept as-is —
  // DEFAULT_PREFS is a static placeholder passed straight through to the scheduling engine.
  const prefs = DEFAULT_PREFS

  // 选课 page filters — subjects support positive (include) and negative (exclude),
  // selectability toggles between all / only 可选 / only 不可选.
  const [search, setSearch] = useState('')
  const [includeSubjects, setIncludeSubjects] = useState<string[]>([])
  const [excludeSubjects, setExcludeSubjects] = useState<string[]>([])
  const [selectability, setSelectability] = useState<Selectability>('all')
  const [ugOnly, setUgOnly] = useState(true)

  // Enrolment year + major — collected now, to drive major-requirement checks later.
  const [enrollYear, setEnrollYear] = useState(() => window.localStorage.getItem('cu-schedule:year') ?? '')
  const [major, setMajor] = useState(() => window.localStorage.getItem('cu-schedule:major') ?? '')

  useEffect(() => {
    window.localStorage.setItem('cu-schedule:year', enrollYear)
    window.localStorage.setItem('cu-schedule:major', major)
  }, [enrollYear, major])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('cu-schedule:theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', String(accent))
    window.localStorage.setItem('cu-schedule:accent', String(accent))
  }, [accent])

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
    const payload: Saved = { termSlug, committed, taken, pins }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [committed, pins, taken, termSlug, terms.length])

  const byCode = useMemo(() => new Map(courses.map((course) => [course.code, course])), [courses])
  const titleByCode = useMemo(() => new Map(subjects.map((item) => [item.code, item.title])), [subjects])
  const committedCourses = useMemo(
    () => committed.map((code) => byCode.get(code)).filter((course): course is Course => Boolean(course)),
    [byCode, committed],
  )
  const unknownCommitted = useMemo(
    () => (courses.length === 0 ? [] : committed.filter((code) => !byCode.has(code))),
    [byCode, committed, courses.length],
  )

  const plans = useMemo(() => generatePlans(committedCourses, prefs, pins), [committedCourses, pins, prefs])
  const clashes = useMemo(
    () => (plans.length === 0 && committedCourses.length > 1 ? findClashes(committedCourses, prefs, pins) : []),
    [committedCourses, pins, plans.length, prefs],
  )
  useEffect(() => {
    if (planIndex >= plans.length) setPlanIndex(0)
  }, [planIndex, plans.length])

  // The 课表 page compares the two best conflict-free timetables side by side.
  const planA = plans[0] ?? null
  const planB = plans[1] ?? null
  const totalUnits = committedCourses.reduce((sum, course) => sum + course.units, 0)

  const [exportNote, setExportNote] = useState('')
  function handleExport(format: ExportFormat): void {
    if (!planA) return
    const result = exportPlan({ format, planA, planB, termName: term?.name ?? '' })
    setExportNote(result.ok ? result.note : result.reason)
  }

  const candidates = useMemo(() => {
    if (courses.length === 0) return { rows: [], summary: { open: 0, rearrange: 0, conflict: 0, tba: 0, taken: 0, ruledOut: 0 } }
    return evaluateCandidates({ courses, taken, committed, plans, selectedPlanIndex: planIndex, prefs })
  }, [committed, courses, planIndex, plans, prefs, taken])

  // Selectability status is per current-term timetable; other-term courses have none.
  const statusByCode = useMemo(
    () => new Map(candidates.rows.map((row) => [row.course.code, row.status])),
    [candidates.rows],
  )
  const prereqByCode = useMemo(
    () =>
      new Map(
        candidates.rows.map((row) => [
          row.course.code,
          { status: row.prereqStatus, text: row.prereqText },
        ]),
      ),
    [candidates.rows],
  )

  const filters: SearchFilters = { query: search, includeSubjects, excludeSubjects, selectability, ugOnly }
  const committedSet = useMemo(() => new Set(committed), [committed])
  const takenSet = useMemo(() => new Set(taken), [taken])

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

  // Clicking a course's button a second time cancels the mark.
  function toggleCommitted(code: string): void {
    setPlanIndex(0)
    if (committed.includes(code)) {
      setCommitted((codes) => codes.filter((item) => item !== code))
      dropPins(code)
      return
    }
    setTaken((codes) => codes.filter((item) => item !== code))
    setCommitted((codes) => [...codes, code])
  }

  function toggleTaken(code: string): void {
    setPlanIndex(0)
    if (taken.includes(code)) {
      setTaken((codes) => codes.filter((item) => item !== code))
      return
    }
    setCommitted((codes) => codes.filter((item) => item !== code))
    setTaken((codes) => [...codes, code])
  }

  function removeCommitted(code: string): void {
    setCommitted((codes) => codes.filter((item) => item !== code))
    dropPins(code)
    setPlanIndex(0)
  }

  const committedCard = (
    <section className="card committed-card">
      <h2 className="card__title">
        下学期课表
        <span className="card__note">{totalUnits > 0 ? `${totalUnits} 学分` : '一课一行'}</span>
      </h2>
      <CommittedList byCode={byCode} codes={committed} onAdd={toggleCommitted} onRemove={removeCommitted} />
      {unknownCommitted.length > 0 && (
        <p className="card__warn">本学期没有开设：{unknownCommitted.join('、')}</p>
      )}
    </section>
  )

  const committedCardTT = (
    <section className="card committed-card">
      <h2 className="card__title">
        下学期课表
        <span className="card__note">{totalUnits > 0 ? `${totalUnits} 学分 · 选时段` : '选时段'}</span>
      </h2>
      <CommittedList
        byCode={byCode}
        codes={committed}
        pins={pins}
        onAdd={toggleCommitted}
        onPin={togglePin}
        onRemove={removeCommitted}
      />
      {unknownCommitted.length > 0 && (
        <p className="card__warn">本学期没有开设：{unknownCommitted.join('、')}</p>
      )}
    </section>
  )

  const takenCard = (
    <section className="card">
      <h2 className="card__title">
        已完成课程
        <span className="card__note">排除已修 · 判断先修</span>
      </h2>
      <CodeInput
        codes={taken}
        courses={courses}
        placeholder="粘贴成绩单上的课号…"
        variant="taken"
        onChange={setTaken}
      />
    </section>
  )

  const profileCard = (
    <section className="card">
      <h2 className="card__title">我的情况</h2>
      <div className="profile-row">
        <label className="field">
          <span className="field__label">入学年份</span>
          <select value={enrollYear} onChange={(event) => setEnrollYear(event.target.value)}>
            <option value="">选择</option>
            {['2022', '2023', '2024', '2025', '2026'].map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">主修 Major</span>
          <input
            className="search-box"
            placeholder="如 计算机科学 / CSCI"
            value={major}
            onChange={(event) => setMajor(event.target.value)}
          />
        </label>
      </div>
    </section>
  )

  const searchCard = (
    <section className="card search-card">
      <h2 className="card__title">搜索</h2>
      <input
        className="search-box"
        placeholder="课号或课名关键词…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="field">
        <label className="field__label field__label--include">想要的学科</label>
        <SubjectPicker
          onChange={setIncludeSubjects}
          placeholder="包含这些学科，如 CSCI…"
          selected={includeSubjects}
          subjects={subjects}
          variant="include"
        />
      </div>
      <div className="field">
        <label className="field__label field__label--exclude">排除的学科</label>
        <SubjectPicker
          onChange={setExcludeSubjects}
          placeholder="排除这些学科…"
          selected={excludeSubjects}
          subjects={subjects}
          variant="exclude"
        />
      </div>
      <div className="field">
        <label className="field__label">可选性</label>
        <div className="seg" role="group" aria-label="可选性">
          {(['all', 'open', 'closed'] as const).map((value) => (
            <button
              className={selectability === value ? 'seg__btn seg__btn--on' : 'seg__btn'}
              key={value}
              type="button"
              onClick={() => setSelectability(value)}
            >
              {value === 'all' ? '全部' : value === 'open' ? '可选' : '不可选'}
            </button>
          ))}
        </div>
      </div>
      <label className="check">
        <input checked={ugOnly} type="checkbox" onChange={(event) => setUgOnly(event.target.checked)} />
        <span>仅本科</span>
      </label>
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

  const exportCard = (
    <section className="card">
      <h2 className="card__title">
        导出课表
        <span className="card__note">A / B 对比</span>
      </h2>
      <div className="export-row">
        <button className="export-btn" disabled={!planA} type="button" onClick={() => handleExport('ics')}>
          日历 .ics
        </button>
        <button className="export-btn" disabled={!planA} type="button" onClick={() => handleExport('image')}>
          图片
        </button>
        <button className="export-btn" disabled={!planA} type="button" onClick={() => handleExport('link')}>
          链接
        </button>
      </div>
      {exportNote && <p className="export-note">{exportNote}</p>}
    </section>
  )

  const resetButton =
    committed.length > 0 || taken.length > 0 ? (
      <button
        className="reset"
        type="button"
        onClick={() => {
          setCommitted([])
          setTaken([])
          setPins({})
          setPlanIndex(0)
        }}
      >
        清空全部
      </button>
    ) : null

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
          <div className="palette" aria-label="主色方案">
            {ACCENTS.map((item) => (
              <button
                className={item.hue === accent ? 'palette__dot palette__dot--on' : 'palette__dot'}
                key={item.id}
                style={{ background: `hsl(${item.hue} 80% 58%)` }}
                title={item.label}
                type="button"
                onClick={() => setAccent(item.hue)}
              />
            ))}
          </div>
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

      <main className={page === 'select' ? 'grid grid--select' : 'grid grid--timetable'}>
        {page === 'select' ? (
          <>
            <aside className="side side--picks">
              {committedCard}
              {problemsCard}
              {resetButton}
            </aside>

            <section className="results-pane">
              {loading ? (
                <div className="pane__loading">正在加载 {year ?? ''} 全部课程…</div>
              ) : (
                <SearchResults
                  committedSet={committedSet}
                  filters={filters}
                  offerings={offerings}
                  statusByCode={statusByCode}
                  prereqByCode={prereqByCode}
                  takenSet={takenSet}
                  titleByCode={titleByCode}
                  onCommit={toggleCommitted}
                  onTaken={toggleTaken}
                />
              )}
            </section>

            <aside className="side side--search">
              {profileCard}
              {searchCard}
              {takenCard}
            </aside>
          </>
        ) : (
          <>
            <section className="stage">
              <div className="stage__head">
                <h2>课表对比</h2>
                <div className="ab-legend">
                  <span className="ab-legend__item">
                    <i className="tt2__tag tt2__tag--a">A</i>
                    {planA ? `${planA.teachingDays.length} 天上课` : '暂无'}
                  </span>
                  <span className="ab-legend__item">
                    <i className="tt2__tag tt2__tag--b">B</i>
                    {planB ? `${planB.teachingDays.length} 天上课` : '仅一种排法'}
                  </span>
                </div>
              </div>
              <TimetableCompare
                emptyMessage={
                  committedCourses.length === 0
                    ? '在右侧填入下学期课表，A / B 两种排法会自动排出来'
                    : '这些课排不出无冲突的课表，右侧列出了卡住的地方'
                }
                planA={planA}
                planB={planB}
              />
            </section>

            <aside className="side side--tt">
              {committedCardTT}
              {exportCard}
              {problemsCard}
            </aside>
          </>
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
