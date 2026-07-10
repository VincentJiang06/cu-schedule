import { Fragment, useMemo } from 'react'
import type { CandidateStatus } from '../lib/candidates.ts'
import { courseColor } from '../lib/color.ts'
import type { Offering } from '../lib/data.ts'
import { scoreCourse } from '../lib/search.ts'
import { subjectBlurb } from '../lib/subjectNames.ts'
import type { Course, RequirementStatus } from '../lib/types.ts'

export type Selectability = 'all' | 'open' | 'closed'

export type SearchFilters = {
  query: string
  includeSubjects: string[]
  excludeSubjects: string[]
  selectability: Selectability
  ugOnly: boolean
}

const STATUS_TEXT: Record<CandidateStatus, string> = {
  open: '可选',
  rearrange: '换排法',
  conflict: '冲突',
  tba: '待定',
}

const TERM_LABEL: Record<number, string> = { 1: '上学期', 2: '下学期' }
const RENDER_CAP = 500

type TermGroup = { termOrder: number; courses: Course[] }
type SubjectGroup = { subject: string; count: number; terms: TermGroup[] }

export type PrereqInfo = { status: RequirementStatus; text: string }

export function SearchResults({
  offerings,
  statusByCode,
  prereqByCode,
  committedSet,
  takenSet,
  filters,
  titleByCode,
  onCommit,
  onTaken,
}: {
  offerings: Offering[]
  statusByCode: Map<string, CandidateStatus>
  /** Prerequisite verdict per course (current-term candidates only). */
  prereqByCode: Map<string, PrereqInfo>
  committedSet: Set<string>
  takenSet: Set<string>
  filters: SearchFilters
  titleByCode: Map<string, string>
  onCommit: (code: string) => void
  onTaken: (code: string) => void
}) {
  const filtered = useMemo(() => {
    const include = new Set(filters.includeSubjects)
    const exclude = new Set(filters.excludeSubjects)
    return offerings.filter(({ course }) => {
      if (filters.ugOnly && course.career !== 'Undergraduate') return false
      if (include.size > 0 && !include.has(course.subject)) return false
      if (exclude.has(course.subject)) return false
      if (filters.selectability !== 'all') {
        const status = statusByCode.get(course.code)
        if (filters.selectability === 'open' && status !== 'open') return false
        if (filters.selectability === 'closed' && (!status || status === 'open')) return false
      }
      if (filters.query.trim() && scoreCourse(course, filters.query) <= 0) return false
      return true
    })
  }, [filters, offerings, statusByCode])

  const groups = useMemo<SubjectGroup[]>(() => {
    const bySubject = new Map<string, Map<number, Course[]>>()
    for (const { course, termOrder } of filtered) {
      let terms = bySubject.get(course.subject)
      if (!terms) {
        terms = new Map()
        bySubject.set(course.subject, terms)
      }
      terms.set(termOrder, [...(terms.get(termOrder) ?? []), course])
    }

    return [...bySubject.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([subject, terms]) => {
        const termGroups = [...terms.entries()]
          .sort(([a], [b]) => a - b)
          .map(([termOrder, courses]) => ({
            termOrder,
            courses: [...courses].sort((a, b) => a.number.localeCompare(b.number)),
          }))
        return {
          subject,
          count: termGroups.reduce((sum, group) => sum + group.courses.length, 0),
          terms: termGroups,
        }
      })
  }, [filtered])

  const total = filtered.length
  const capped = total > RENDER_CAP

  // Render at most RENDER_CAP courses, walking groups in order.
  let budget = RENDER_CAP
  const shownGroups: SubjectGroup[] = []
  for (const group of groups) {
    if (budget <= 0) break
    const terms: TermGroup[] = []
    for (const term of group.terms) {
      if (budget <= 0) break
      const slice = term.courses.slice(0, budget)
      budget -= slice.length
      terms.push({ termOrder: term.termOrder, courses: slice })
    }
    shownGroups.push({ ...group, terms })
  }

  return (
    <div className="cg">
      <p className="cg__count">
        共 <b>{total}</b> 门 · {groups.length} 个学科{capped ? ` · 已显示前 ${RENDER_CAP} 门，请缩小范围` : ''}
      </p>
      <div className="cg__scroll">
        {total === 0 ? (
          <div className="cg__empty">没有符合条件的课程</div>
        ) : (
          shownGroups.map((group) => (
            <Fragment key={group.subject}>
              <div className="sr__group" style={courseColor(group.subject)}>
                <b>{group.subject}</b>
                <span>{subjectBlurb(group.subject, titleByCode.get(group.subject))}</span>
                <i>{group.count}</i>
              </div>
              {group.terms.map((term) => (
                <Fragment key={term.termOrder}>
                  <div className="cg__term">{TERM_LABEL[term.termOrder] ?? '其他'}</div>
                  <div className="cg__grid">
                    {term.courses.map((course) => {
                      const status = statusByCode.get(course.code)
                      const prereq = prereqByCode.get(course.code)
                      const isCommitted = committedSet.has(course.code)
                      const isTaken = takenSet.has(course.code)
                      return (
                        <article
                          className={`cc${isCommitted ? ' cc--committed' : ''}${isTaken ? ' cc--taken' : ''}`}
                          key={`${course.code}-${term.termOrder}`}
                          style={courseColor(course.subject)}
                        >
                          <div className="cc__head">
                            <span className="cc__code">{course.code}</span>
                            <span className="cc__units">{course.units}学分</span>
                            {status && <span className={`dot dot--${status}`} title={STATUS_TEXT[status]} />}
                            {prereq?.status === 'missing' && (
                              <em className="prereq-tag prereq-tag--missing" title={`先修未满足：${prereq.text}`}>
                                缺先修
                              </em>
                            )}
                            {prereq?.status === 'unverifiable' && prereq.text && (
                              <em className="prereq-tag prereq-tag--maybe" title={`有先修/成绩等要求，请自查：${prereq.text}`}>
                                看先修
                              </em>
                            )}
                          </div>
                          <div className="cc__title" title={course.title}>
                            {course.title}
                          </div>
                          <div className="cc__acts">
                            <button
                              className={`cc__btn cc__btn--done${isTaken ? ' cc__btn--on' : ''}`}
                              type="button"
                              onClick={() => onTaken(course.code)}
                            >
                              {isTaken ? '已完成 ✓' : '标记为已完成'}
                            </button>
                            <button
                              className={`cc__btn cc__btn--soon${isCommitted ? ' cc__btn--on' : ''}`}
                              type="button"
                              onClick={() => onCommit(course.code)}
                            >
                              {isCommitted ? '马上学 ✓' : '标记为马上学'}
                            </button>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </Fragment>
              ))}
            </Fragment>
          ))
        )}
      </div>
    </div>
  )
}
