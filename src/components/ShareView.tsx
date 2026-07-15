import { useEffect, useMemo, useState } from 'react'
import { courseColorPalette } from '../lib/color.ts'
import { courseKey } from '../lib/courseKey.ts'
import { loadSubjects, loadTermList, loadYearOfferings, type Offering } from '../lib/data.ts'
import type { Aspect } from '../lib/exportImage.ts'
import { exportPlan, type ExportFormat } from '../lib/exportPlan.ts'
import { generatePlans, NO_PREFS } from '../lib/schedule.ts'
import { DAY_SHORT, hhmm } from '../lib/time.ts'
import { loadShare, type ShareInstance } from '../lib/shareStore.ts'
import type { Course, Section } from '../lib/types.ts'
import { Timetable } from './Timetable.tsx'
import { t } from '../i18n/index.ts'

/**
 * Read-only share view (approach 2). Rendered when the URL carries `#v=<id>`.
 * Loads the share instance by id, re-derives the timetable from the same course
 * bundle, and presents a mobile-first, non-editable page: the timetable, the course
 * list, and the same PDF / PNG / wallpaper exports. Nothing here mutates local state.
 */

// #Bug D:镜像 App.tsx 的 loadTheme() / color.ts 的 activeTheme()——三档主题
// (light/mid/dark)都认,不只认 light/dark,否则 mid 档会 fall through 到系统偏好,只读分享
// 页显示的主题就会跟用户实际存的 mid 档不一致。
function applyTheme(): void {
  const saved = window.localStorage.getItem('cu-schedule:theme')
  const theme = saved === 'light' || saved === 'mid' || saved === 'dark'
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
  if (timed.length === 0) return t('时间待定')
  return timed.map((m) => t('周{day} {start}–{end}', { day: DAY_SHORT[m.dayIndex - 1], start: hhmm(m.start), end: hhmm(m.end) })).join(' · ')
}

type State =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'error' }
  | { phase: 'ready'; instance: ShareInstance; offerings: Offering[] }

const PNG_ASPECTS: Array<{ label: string; aspect: Aspect }> = [
  { label: '1:1', aspect: { w: 1, h: 1 } },
  { label: '9:16', aspect: { w: 9, h: 16 } },
  { label: '16:9', aspect: { w: 16, h: 9 } },
  { label: '4:3', aspect: { w: 4, h: 3 } },
  { label: '3:4', aspect: { w: 3, h: 4 } },
]

export function ShareView({ id }: { id: string }) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [exportNote, setExportNote] = useState('')
  // #里程碑4:图片 PNG 导出前先选画面比例，与主 app 导出页的六按钮同一套。
  const [customAspectOpen, setCustomAspectOpen] = useState(false)
  const [customAspectW, setCustomAspectW] = useState('1')
  const [customAspectH, setCustomAspectH] = useState('1')

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
    // #里程碑3:按课程(不是按学科)上色，与课表大格子共用同一份取色——固定列表，一次算好即可
    // (不像主 app 的 committed 会增删，不需要 append-only 的槽位 ref)。
    const colorForCode = courseColorPalette(committedCourses.map((course) => course.key))
    return { committedCourses, planA, totalUnits, colorForCode }
  }, [state])

  async function handleExport(format: ExportFormat, aspect?: Aspect): Promise<void> {
    if (state.phase !== 'ready' || !derived?.planA) return
    setExportNote(t('正在导出…'))
    const result = await exportPlan({
      format,
      plan: derived.planA,
      termName: state.instance.termName,
      aspect,
    })
    setExportNote(result.ok ? result.note : result.reason)
  }

  if (state.phase === 'loading') {
    return <div className="sv sv--msg">{t('正在加载分享的课表…')}</div>
  }
  if (state.phase === 'missing') {
    return (
      <div className="sv sv--msg">
        <p className="sv__msg-title">{t('链接已过期或不存在')}</p>
        <p className="sv__msg-sub">{t('只读分享链接的有效期为一天，过期后请让对方重新分享。')}</p>
        <a className="sv__home" href={window.location.pathname}>{t('去 CU Schedule 首页')}</a>
      </div>
    )
  }
  if (state.phase === 'error' || !derived) {
    return (
      <div className="sv sv--msg">
        <p className="sv__msg-title">{t('加载失败')}</p>
        <a className="sv__home" href={window.location.pathname}>{t('去 CU Schedule 首页')}</a>
      </div>
    )
  }

  const { instance } = state
  const { committedCourses, planA, totalUnits, colorForCode } = derived

  return (
    <div className="sv">
      <header className="sv__bar">
        <div className="sv__brand">
          <span className="bar__mark" aria-hidden />
          <div>
            <h1 className="sv__title">CU Schedule</h1>
            <p className="sv__term">{instance.termName || t('课表分享')} · {t('只读分享')}</p>
          </div>
        </div>
      </header>

      {/* #里程碑3:左右布局——左窄栏放课程列表/CTA/导出,右栏用整页高度放课表,时间轴才看得清。
          grid-template-areas 决定视觉位置,与 DOM 顺序无关：移动端媒体查询把 tt 挪到 list 上方，
          不需要 order/reorder 任何 DOM 节点。 */}
      <div className="sv__layout">
        <aside className="sv__col sv__col--list">
          <section className="sv__card">
            <h2 className="sv__card-head">{t('课程')}</h2>
            <ul className="sv__courses">
              {committedCourses.map((course) => (
                <li className="sv__course" key={course.key} style={colorForCode(course.key)}>
                  <div className="sv__course-top">
                    <span className="sv__course-code">{course.code}</span>
                    <span className="sv__course-units">{t('{n} 学分', { n: course.units })}</span>
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
              {committedCourses.length === 0 && <li className="sv__empty empty-hint">{t('这个分享里没有课程')}</li>}
            </ul>
            <p className="sv__meta">{t('{count} 门 · {units} 学分', { count: committedCourses.length, units: totalUnits })}</p>
          </section>

          <a className="sv__cta" href={window.location.pathname}>{t('做自己的课表 →')}</a>

          <section className="sv__card">
            <h2 className="sv__card-head">{t('导出')}</h2>
            <div className="sv__exports">
              <button className="export-btn" disabled={!planA} type="button" onClick={() => void handleExport('pdf')}>
                {t('表格 PDF')}
              </button>
              <button className="export-btn" disabled={!planA} type="button" onClick={() => void handleExport('wallpaper')}>
                {t('手机壁纸')}
              </button>
            </div>
            {/* #里程碑4:图片 PNG 先选画面比例，与主 app 导出页同一套六按钮。 */}
            <p className="sv__exports-label">{t('图片 PNG · 选画面比例')}</p>
            <div className="aspect-picker">
              {PNG_ASPECTS.map((item) => (
                <button
                  className="aspect-btn"
                  disabled={!planA}
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
                disabled={!planA}
                type="button"
                onClick={() => setCustomAspectOpen((value) => !value)}
              >
                {t('自定义')}
              </button>
              {customAspectOpen && (
                <div className="aspect-custom">
                  <input
                    aria-label={t('宽')}
                    className="aspect-custom__input"
                    inputMode="decimal"
                    value={customAspectW}
                    onChange={(event) => setCustomAspectW(event.target.value)}
                  />
                  <span aria-hidden>:</span>
                  <input
                    aria-label={t('高')}
                    className="aspect-custom__input"
                    inputMode="decimal"
                    value={customAspectH}
                    onChange={(event) => setCustomAspectH(event.target.value)}
                  />
                  <button
                    className="export-btn aspect-custom__go"
                    disabled={!planA}
                    type="button"
                    onClick={() => {
                      const w = Number(customAspectW)
                      const h = Number(customAspectH)
                      void handleExport('image', { w: w > 0 ? w : 1, h: h > 0 ? h : 1 })
                    }}
                  >
                    {t('按此比例导出')}
                  </button>
                </div>
              )}
            </div>
            {exportNote && <p className="export-note">{exportNote}</p>}
          </section>
        </aside>

        <section className="sv__col sv__col--tt">
          <div className="sv__card sv__tt-card">
            <div className="sv__card-head">
              <h2>{t('课表')}</h2>
            </div>
            <div className="sv__tt">
              <Timetable colorForCode={colorForCode} emptyMessage={t('这个分享里没有可排的课表')} plan={planA} portrait />
            </div>
          </div>
        </section>
      </div>

      <footer className="sv__foot">
        <a
          className="sv__foot-byline"
          href="https://github.com/VincentJiang06/cu-schedule"
          rel="noopener noreferrer"
          target="_blank"
        >
          CUS by VinceJiang
        </a>
      </footer>
    </div>
  )
}
