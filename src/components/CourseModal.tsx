import { useEffect } from 'react'
import { courseColor } from '../lib/color.ts'
import { STANDING_LABEL, type CourseStanding } from '../lib/programs.ts'
import { hhmm } from '../lib/time.ts'
import type { Course, Section } from '../lib/types.ts'

/**
 * In-page course-detail popup: shows the structured data we hold for one course —
 * identity, its standing in the chosen programme (必修/选修/自由选修), enrolment
 * conditions, and every section's meeting times. Lets the student mark the course
 * 已完成 or 添加到下学期 without leaving the popup, and offers a one-click Google
 * search. Closes on Escape, on the ✕, or on a backdrop click.
 */

const DAY = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

// 每个 meeting 单独一行（不再用「；」挤成一行自动换行）。空数组 = 时间待定。
function sectionTimeLines(section: Section): string[] {
  const timed = section.meetings
    .filter((m) => m.dayIndex >= 1 && m.dayIndex <= 7)
    .sort((a, b) => a.dayIndex - b.dayIndex || a.start - b.start)
  if (timed.length === 0) return ['时间待定']
  return timed.map(
    (m) => `${DAY[m.dayIndex - 1]} ${hhmm(m.start)}–${hhmm(m.end)}${m.location ? ` · ${m.location}` : ''}`,
  )
}

export function CourseModal({
  course,
  standing,
  isTaken,
  isCommitted,
  isCart,
  blockedReason,
  onToggleTaken,
  onToggleCommitted,
  onToggleCart,
  onClose,
}: {
  course: Course
  /** The course's standing in the chosen programme, or null when no major is picked. */
  standing: CourseStanding | null
  isTaken: boolean
  isCommitted: boolean
  /** In the 可能学 waitlist / cart bucket. */
  isCart: boolean
  /** Why 必定学 is unavailable (已修互斥 / 时间冲突 / 待定), or null when it's fine. */
  blockedReason: string | null
  onToggleTaken: () => void
  onToggleCommitted: () => void
  onToggleCart: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const byComponent = new Map<string, Section[]>()
  for (const section of course.sections) {
    byComponent.set(section.component, [...(byComponent.get(section.component) ?? []), section])
  }

  const req = course.requirement
  const hasConditions = Boolean(req.prereqText || req.coreqText || req.exclusions.length > 0)

  function searchGoogle(): void {
    const query = encodeURIComponent(`CUHK ${course.code} ${course.title}`)
    window.open(`https://www.google.com/search?q=${query}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="cmodal-overlay" onClick={onClose}>
      <div
        aria-label={`${course.code} 课程详情`}
        aria-modal="true"
        className="cmodal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <button aria-label="关闭" className="cmodal__x" type="button" onClick={onClose}>
          ×
        </button>

        <header className="cmodal__head" style={courseColor(course.code)}>
          <div className="cmodal__code">{course.code}</div>
          <div className="cmodal__title">{course.title}</div>
          <div className="cmodal__meta">
            {course.units} 学分 · {course.subject}
            {course.department ? ` · ${course.department}` : ''}
            {course.career ? ` · ${course.career}` : ''}
          </div>
          {standing && (
            <div className={`cmodal__standing cmodal__standing--${standing.kind}`}>
              <span className="cmodal__standing-kind">
                {STANDING_LABEL[standing.kind].zh}
                <em>{STANDING_LABEL[standing.kind].en}</em>
              </span>
              <span className="cmodal__standing-sec">
                {standing.kind === 'free'
                  ? '不在本专业培养方案内 · not in this programme'
                  : [standing.section.zh, standing.section.en].filter(Boolean).join(' ')}
              </span>
            </div>
          )}
        </header>

        <div className="cmodal__body">
          {hasConditions && (
            <section className="cmodal__sec">
              <h4 className="cmodal__sec-title">修读条件</h4>
              {req.prereqText && (
                <p className="cmodal__line">
                  <b>先修</b>
                  {req.prereqText}
                </p>
              )}
              {req.coreqText && (
                <p className="cmodal__line">
                  <b>同修</b>
                  {req.coreqText}
                </p>
              )}
              {req.exclusions.length > 0 && (
                <p className="cmodal__line">
                  <b>互斥</b>
                  {req.exclusions.join('、')}
                </p>
              )}
            </section>
          )}

          <section className="cmodal__sec">
            <h4 className="cmodal__sec-title">上课安排</h4>
            {course.components.length === 0 ? (
              <p className="cmodal__empty">暂无时间信息</p>
            ) : (
              course.components.map((component) => (
                <div className="cmodal__comp" key={component}>
                  <div className="cmodal__comp-name">{component}</div>
                  <ul className="cmodal__sections">
                    {(byComponent.get(component) ?? []).map((section) => (
                      <li className="cmodal__section" key={section.id}>
                        <span className="cmodal__section-label">
                          {`${section.cohort}${section.group}` || section.id}
                        </span>
                        <div className="cmodal__section-times">
                          {sectionTimeLines(section).map((line) => (
                            <span className="cmodal__section-time" key={line}>
                              {line}
                            </span>
                          ))}
                        </div>
                        {section.instructors.length > 0 && (
                          <span className="cmodal__section-inst">{section.instructors.join('、')}</span>
                        )}
                        {section.status && <span className="cmodal__section-status">{section.status}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>
        </div>

        <footer className="cmodal__foot">
          <div className="cmodal__acts">
            <button
              className={`cmodal__act cmodal__act--done${isTaken ? ' is-on' : ''}`}
              type="button"
              onClick={onToggleTaken}
            >
              {isTaken ? '已学完 ✓' : '已学完'}
            </button>
            <button
              className={`cmodal__act cmodal__act--maybe${isCart ? ' is-on' : ''}`}
              type="button"
              onClick={onToggleCart}
            >
              {isCart ? '可能学 ✓' : '可能学'}
            </button>
            <button
              className={`cmodal__act cmodal__act--soon${isCommitted ? ' is-on' : ''}`}
              disabled={Boolean(blockedReason) && !isCommitted}
              title={!isCommitted && blockedReason ? blockedReason : undefined}
              type="button"
              onClick={onToggleCommitted}
            >
              {isCommitted ? '必定学 ✓' : '必定学'}
            </button>
          </div>
          <button className="cmodal__google" type="button" onClick={searchGoogle}>
            <svg aria-hidden height="16" viewBox="0 0 24 24" width="16">
              <path
                d="M12 11v3.2h4.5c-.2 1.2-1.4 3.5-4.5 3.5A5 5 0 1 1 15 8l2.3-2.2A8 8 0 1 0 12 20c4.6 0 7.7-3.2 7.7-7.8 0-.5 0-.9-.1-1.2H12z"
                fill="currentColor"
              />
            </svg>
            用 Google 搜索这门课
          </button>
        </footer>
      </div>
    </div>
  )
}
