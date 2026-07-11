import { useEffect, useMemo, useState } from 'react'
import { courseColor } from '../lib/color.ts'
import { courseKey } from '../lib/courseKey.ts'
import { loadSubjects, loadTermList, loadYearOfferings, type Offering } from '../lib/data.ts'
import { exportPlan, type ExportFormat } from '../lib/exportPlan.ts'
import { generatePlans, NO_PREFS } from '../lib/schedule.ts'
import { DAY_SHORT, hhmm } from '../lib/time.ts'
import { loadShare, type ShareInstance } from '../lib/shareStore.ts'
import type { Course, Section } from '../lib/types.ts'
import { Timetable } from './Timetable.tsx'

/**
 * Read-only share view (approach 2). Rendered when the URL carries `#v=<id>`.
 * Loads the share instance by id, re-derives the timetable from the same course
 * bundle, and presents a mobile-first, non-editable page: the timetable, the course
 * list, and the same PDF / PNG / wallpaper exports. Nothing here mutates local state.
 */

function applyTheme(): void {
  const saved = window.localStorage.getItem('cu-schedule:theme')
  const theme = saved === 'light' || saved === 'dark'
    ? saved
    : window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  document.documentElement.dataset.theme = theme
}

function sectionTimes(section: Section): string {
  const timed = section.meetings
    .filter((m) => m.dayIndex >= 1 && m.dayIndex <= 7)
    .sort((a, b) => a.dayIndex - b.dayIndex || a.start - b.start)
  if (timed.length === 0) return '时间待定'
  return timed.map((m) => `周${DAY_SHORT[m.dayIndex - 1]} ${hhmm(m.start)}–${hhmm(m.end)}`).join(' · ')
}

type State =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'error' }
  | { phase: 'ready'; instance: ShareInstance; offerings: Offering[] }

export function ShareView({ id }: { id: string }) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [exportNote, setExportNote] = useState('')

  useEffect(() => {
    applyTheme()
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result = await loadShare(id)
      if (cancelled) return
      if (!result.ok) {
        setState({ phase: result.reason === 'not_found' ? 'missing' : 'error' })
        return
      }
      const instance = result.instance
      try {
        const terms = await loadTermList()
        const term = terms.find((t) => t.slug === instance.termSlug) ?? terms[0]
        if (!term) {
          setState({ phase: 'error' })
          return
        }
        const offerings = await loadYearOfferings(term.year)
        // subjects aren't needed for rendering; load lazily and ignore failures.
        void loadSubjects(term.year).catch(() => [])
        if (!cancelled) setState({ phase: 'ready', instance, offerings })
      } catch {
        if (!cancelled) setState({ phase: 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const derived = useMemo(() => {
    if (state.phase !== 'ready') return null
    const { instance, offerings } = state
    const termCourses = offerings
      .filter((o) => o.termSlug === instance.termSlug)
      .map((o) => o.course)
    const byCode = new Map(termCourses.map((course) => [course.key, course]))
    const committedCourses = instance.committed
      .map((code) => byCode.get(courseKey(code)))
      .filter((course): course is Course => Boolean(course))
    const plans = generatePlans(committedCourses, NO_PREFS, instance.pins ?? {})
    const planA = plans[0] ?? null
    const totalUnits = committedCourses.reduce((sum, course) => sum + course.units, 0)
    return { committedCourses, planA, totalUnits }
  }, [state])

  async function handleExport(format: ExportFormat): Promise<void> {
    if (state.phase !== 'ready' || !derived?.planA) return
    setExportNote('正在导出…')
    const result = await exportPlan({
      format,
      planA: derived.planA,
      planB: null,
      termName: state.instance.termName,
      share: { termSlug: state.instance.termSlug, committed: state.instance.committed, taken: state.instance.taken, pins: state.instance.pins },
    })
    setExportNote(result.ok ? result.note : result.reason)
  }

  if (state.phase === 'loading') {
    return <div className="sv sv--msg">正在加载分享的课表…</div>
  }
  if (state.phase === 'missing') {
    return (
      <div className="sv sv--msg">
        <p className="sv__msg-title">链接已过期或不存在</p>
        <p className="sv__msg-sub">只读分享链接的有效期为一天，过期后请让对方重新分享。</p>
        <a className="sv__home" href={window.location.pathname}>去 CU Schedule 首页</a>
      </div>
    )
  }
  if (state.phase === 'error' || !derived) {
    return (
      <div className="sv sv--msg">
        <p className="sv__msg-title">加载失败</p>
        <a className="sv__home" href={window.location.pathname}>去 CU Schedule 首页</a>
      </div>
    )
  }

  const { instance } = state
  const { committedCourses, planA, totalUnits } = derived

  return (
    <div className="sv">
      <header className="sv__bar">
        <div className="sv__brand">
          <span className="bar__mark" aria-hidden />
          <div>
            <h1 className="sv__title">CU Schedule</h1>
            <p className="sv__term">{instance.termName || '课表分享'} · 只读分享</p>
          </div>
        </div>
        <a className="sv__home" href={window.location.pathname}>做自己的课表 →</a>
      </header>

      <section className="sv__card">
        <div className="sv__card-head">
          <h2>课表</h2>
          <span>{committedCourses.length} 门 · {totalUnits} 学分</span>
        </div>
        <div className="sv__tt">
          <Timetable emptyMessage="这个分享里没有可排的课表" plan={planA} />
        </div>
      </section>

      <section className="sv__card">
        <h2 className="sv__card-head">课程</h2>
        <ul className="sv__courses">
          {committedCourses.map((course) => (
            <li className="sv__course" key={course.key} style={courseColor(course.code)}>
              <div className="sv__course-top">
                <span className="sv__course-code">{course.code}</span>
                <span className="sv__course-units">{course.units} 学分</span>
              </div>
              <div className="sv__course-title">{course.title}</div>
              {course.sections
                .filter((s) => s.component === 'LEC')
                .slice(0, 4)
                .map((s, i) => (
                  <div className="sv__course-time" key={s.id}>
                    LEC{course.sections.filter((x) => x.component === 'LEC').length > 1 ? ` ${i + 1}` : ''} · {sectionTimes(s)}
                  </div>
                ))}
            </li>
          ))}
          {committedCourses.length === 0 && <li className="sv__empty">这个分享里没有课程</li>}
        </ul>
      </section>

      <section className="sv__card">
        <h2 className="sv__card-head">导出</h2>
        <div className="sv__exports">
          <button className="export-btn" disabled={!planA} type="button" onClick={() => void handleExport('pdf')}>
            表格 PDF
          </button>
          <button className="export-btn" disabled={!planA} type="button" onClick={() => void handleExport('image')}>
            图片 PNG
          </button>
          <button className="export-btn" disabled={!planA} type="button" onClick={() => void handleExport('wallpaper')}>
            手机壁纸
          </button>
        </div>
        {exportNote && <p className="export-note">{exportNote}</p>}
      </section>

      <footer className="sv__foot">
        课程和项目信息以 CUSIS 为准 · 抓取管线{' '}
        <a href="https://github.com/EagleZhen/another-cuhk-course-planner" rel="noreferrer" target="_blank">
          EagleZhen
        </a>{' '}
        (AGPL-3.0)
      </footer>
    </div>
  )
}
