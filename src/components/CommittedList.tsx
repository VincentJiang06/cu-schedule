import { courseColor } from '../lib/color.ts'
import { courseKey } from '../lib/courseKey.ts'
import type { Pins } from '../lib/schedule.ts'
import { DAY_SHORT, hhmm } from '../lib/time.ts'
import type { Course, Section } from '../lib/types.ts'

const TERM_LABEL: Record<number, string> = { 1: '上学期', 2: '下学期' }

function sectionTimes(section: Section): string {
  const timed = section.meetings
    .filter((meeting) => meeting.dayIndex >= 1 && meeting.dayIndex <= 7)
    .sort((a, b) => a.dayIndex - b.dayIndex || a.start - b.start)
  if (timed.length === 0) return '时间待定'
  return timed.map((m) => `周${DAY_SHORT[m.dayIndex - 1]} ${hhmm(m.start)}–${hhmm(m.end)}`).join(' · ')
}

function sectionLabel(section: Section, index: number): string {
  // Cohort-specific tutorials (AT01 vs BT01) share a group number, so keep the
  // cohort letter in front to disambiguate; a bare cohort or index is the fallback.
  const label = `${section.cohort}${section.group}`
  return label || section.cohort || section.group || String(index + 1)
}

type Line = { key: string; label: string; time: string; muted: boolean }

/**
 * Each LEC section gets its own line with its real time; every non-LEC component
 * (TUT / LAB / …) collapses to a single line, because a course can carry a dozen
 * interchangeable tutorial slots and listing them all is noise here.
 */
function courseLines(course: Course): Line[] {
  const byComponent = groupByComponent(course)
  const lines: Line[] = []
  for (const component of course.components) {
    const sections = byComponent.get(component) ?? []
    if (component === 'LEC') {
      sections.forEach((section, index) => {
        // 多个 LEC 用 1/2/3/4 编号；单个 LEC 不带编号。
        const tag = sections.length > 1 ? String(index + 1) : ''
        lines.push({ key: `LEC-${section.id}`, label: tag ? `LEC ${tag}` : 'LEC', time: sectionTimes(section), muted: false })
      })
    } else if (sections.length === 1) {
      lines.push({ key: component, label: component, time: sectionTimes(sections[0]), muted: false })
    } else {
      lines.push({ key: component, label: component, time: `${sections.length} 个时段（待选）`, muted: true })
    }
  }
  return lines
}

function groupByComponent(course: Course): Map<string, Section[]> {
  const byComponent = new Map<string, Section[]>()
  for (const section of course.sections) {
    byComponent.set(section.component, [...(byComponent.get(section.component) ?? []), section])
  }
  return byComponent
}

/** Interactive rows: every component with more than one section becomes pinnable chips. */
function CoursePicker({
  course,
  pinned,
  onPin,
}: {
  course: Course
  pinned: Record<string, string>
  onPin: (component: string, sectionId: string) => void
}) {
  const byComponent = groupByComponent(course)
  return (
    <div className="cl-row__picks">
      {course.components.map((component) => {
        const sections = byComponent.get(component) ?? []
        const chosenId = pinned[component]
        if (sections.length === 1) {
          return (
            <div className="cl-pick" key={component}>
              <span className="cl-pick__label">{component}</span>
              <span className="cl-pick__time">{sectionTimes(sections[0])}</span>
            </div>
          )
        }
        return (
          <div className="cl-pick" key={component}>
            <span className="cl-pick__label">{component}</span>
            <div className="cl-pick__chips">
              {sections.map((section, index) => {
                const on = chosenId === section.id
                // LEC 的多个可选段用 1/2/3/4 编号（而非 cohort 字母），更直观；
                // 其余 component（TUT/LAB…）保留原本的 cohort+组号标签。
                const label = component === 'LEC' ? String(index + 1) : sectionLabel(section, index)
                return (
                  <button
                    className={on ? 'cl-chip cl-chip--on' : 'cl-chip'}
                    key={section.id}
                    title={sectionTimes(section)}
                    type="button"
                    onClick={() => onPin(component, section.id)}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <span className="cl-pick__time">
              {chosenId
                ? sectionTimes(sections.find((section) => section.id === chosenId) ?? sections[0])
                : `${sections.length} 个时段 · 自动`}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function CommittedList({
  codes,
  byCode,
  onRemove,
  pins,
  onPin,
  termOrdersByKey,
  currentTermOrder,
  emptyHint,
}: {
  codes: string[]
  byCode: Map<string, Course>
  onRemove: (code: string) => void
  /** When provided, components render as pinnable T01/T02-style chips (课表 page). */
  pins?: Pins
  onPin?: (code: string, component: string, sectionId: string) => void
  /** courseKey → the term orders (1=上学期, 2=下学期) the course is offered in. */
  termOrdersByKey: Map<string, number[]>
  /** The term order the header is currently on; picked when a course spans both. */
  currentTermOrder: number
  /** Placeholder line when the list is empty. */
  emptyHint?: string
}) {
  const interactive = Boolean(onPin)

  return (
    <div className="cl">
      {codes.length === 0 ? (
        <p className="cl__empty empty-hint">{emptyHint ?? '还没有课程。在中间的课程列表点「必定学」来添加。'}</p>
      ) : (
        <ul className="cl__rows">
          {codes.map((code) => {
            const course = byCode.get(courseKey(code))
            const orders = termOrdersByKey.get(courseKey(code)) ?? []
            const badge = orders.includes(currentTermOrder) ? currentTermOrder : orders[0]
            return (
              <li className="cl-row" key={code} style={courseColor(code)}>
                <div className="cl-row__head">
                  <span className="cl-row__code">{code}</span>
                  {course && <span className="cl-row__units">{course.units}学分</span>}
                  {badge ? <span className="cl-row__term">{TERM_LABEL[badge]}</span> : null}
                  <button className="cl-row__x" title="移除" type="button" onClick={() => onRemove(code)}>
                    ×
                  </button>
                </div>
                {course ? (
                  interactive && onPin ? (
                    <CoursePicker
                      course={course}
                      pinned={pins?.[code] ?? {}}
                      onPin={(component, sectionId) => onPin(code, component, sectionId)}
                    />
                  ) : (
                    <div className="cl-row__lines">
                      {courseLines(course).map((line) => (
                        <div className={line.muted ? 'cl-line cl-line--muted' : 'cl-line'} key={line.key}>
                          <span className="cl-line__label">{line.label}</span>
                          <span className="cl-line__time">{line.time}</span>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="cl-row__missing">本学期无此课</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
