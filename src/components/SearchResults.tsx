import { Fragment, useMemo, type PointerEvent as ReactPointerEvent } from 'react'
import type { CandidateStatus } from '../lib/candidates.ts'
import { courseColor } from '../lib/color.ts'
import type { Offering } from '../lib/data.ts'
import { STANDING_LABEL, type CourseStanding } from '../lib/programs.ts'
import { scoreCourse } from '../lib/search.ts'
import { courseFitsWindow, type TimeWindow } from '../lib/schedule.ts'
import { subjectBlurb } from '../lib/subjectNames.ts'
import type { Course, RequirementStatus } from '../lib/types.ts'

/** Credit bucket by floor(course.units): '1' / '2' / '3' / '4plus' (floor >= 4). */
export type UnitPick = '1' | '2' | '3' | '4plus'
/** Course level bucket from course.level (1-9). '4plus' means level >= 4 (4000+). */
export type LevelBucket = '1' | '2' | '3' | '4plus'

/** A fixed LEC time interval a committed course already occupies (see App's lecBusy). */
export type LecBusy = { dayIndex: number; start: number; end: number }

export type SearchFilters = {
  query: string
  includeSubjects: string[]
  excludeSubjects: string[]
  /** Keep only courses whose prerequisite is not disproven (excludes 'missing'). */
  meetsPrereq: boolean
  /** Keep only courses whose LEC can still fit the committed timetable (仅LEC). */
  lecFits: boolean
  /** Keep only courses with at least one full section combo entirely inside 上下班时间. */
  meetsOfficeHours: boolean
  /** Selected credit buckets (floor of units); empty = no credit filter. */
  units: UnitPick[]
  /** Selected level buckets; empty = no level filter. */
  levels: LevelBucket[]
  /** Always true — non-undergraduate courses are hardcoded out (no UI toggle). */
  ugOnly: boolean
  hideCompleted: boolean
  /** Drop courses whose current-term candidate status is 'tba' (time待定). Loose:
   * only current-term courses carry a status, so other-term courses are unaffected. */
  excludeTba: boolean
  /** When true, drop offerings not in `currentTermSlug` (follows the header Term 1/2). */
  currentTermOnly: boolean
  currentTermSlug: string | null
  /** When set, keep only courses whose key is in the chosen programme's course set. */
  majorKeys: Set<string> | null
  /** Drop courses barred by an already-taken mutually-exclusive/superseding course
   * (course.key ∈ barredKeys — see App's barredKeys). Off just shows them again with
   * the existing 已修替代课 tag (flagFor) instead of hiding them outright. */
  hideSuperseded: boolean
}

// A course's standing outside any chosen programme — 自由选修. Reused so we never
// allocate a fresh object per card when the course is not in the programme's map.
const FREE_STANDING: CourseStanding = { kind: 'free' }

// One unselectability verdict per card. 'blocked' = hard, unselectable (grayed, 马上学 disabled):
// a mutually-exclusive course already taken, a hard time conflict, or an untimed/TBA course.
// 'neutral' = a soft hint that a different plan is needed, still selectable. 'open' → null.
// `tone` drives the tag color independently of `kind`, so 时间冲突 (a real clash → 红) reads
// apart from 时间待定 (course has no fixed time → 灰), even though both block committing.
type CardFlag = { kind: 'blocked' | 'neutral'; tone: 'bad' | 'warn' | 'mute'; text: string }

function flagFor(status: CandidateStatus | undefined, isBarred: boolean): CardFlag | null {
  if (isBarred) return { kind: 'blocked', tone: 'bad', text: '已修替代课' }
  if (status === 'conflict') return { kind: 'blocked', tone: 'bad', text: '时间冲突' }
  if (status === 'tba') return { kind: 'blocked', tone: 'mute', text: '时间待定' }
  // rearrange: 塞不进当前排法,但换一种可行排法就能共存 —— 中性提示,不禁用。
  if (status === 'rearrange') return { kind: 'neutral', tone: 'warn', text: '时间可能冲突' }
  return null
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
  cartSet,
  barredKeys,
  standingByKey,
  lecBusy,
  officeStart,
  officeEnd,
  filters,
  titleByCode,
  onCommit,
  onTaken,
  onCart,
  onOpenDetail,
  onCardPointerDown,
}: {
  offerings: Offering[]
  statusByCode: Map<string, CandidateStatus>
  /** Prerequisite verdict per course (current-term candidates only). */
  prereqByCode: Map<string, PrereqInfo>
  committedSet: Set<string>
  takenSet: Set<string>
  /** The 可能学 waitlist / cart bucket (tentative picks), keyed by course.key. */
  cartSet: Set<string>
  /** Course keys barred by a mutually-exclusive course the student already took. */
  barredKeys: Set<string>
  /** Each course's standing in the chosen programme (必修/选修 + section), or null when
   * no major is picked — courses absent from a non-null map are 自由选修 (free elective). */
  standingByKey: Map<string, CourseStanding> | null
  /** Fixed LEC time intervals occupied by committed courses (for the 符合时间表 toggle). */
  lecBusy: LecBusy[]
  /** 上班时间(null=不限). */
  officeStart: number | null
  /** 下班时间(null=不限). */
  officeEnd: number | null
  filters: SearchFilters
  titleByCode: Map<string, string>
  onCommit: (code: string) => void
  onTaken: (code: string) => void
  onCart: (code: string) => void
  /** Open the course-detail popup for a course. */
  onOpenDetail: (course: Course) => void
  /** 拖拽起点(可选):按住课程卡拖到右侧「必定学 / 可能学」目标区,由 App 统一实现。 */
  onCardPointerDown?: (course: Course, event: ReactPointerEvent<HTMLElement>) => void
}) {
  // Precompute the set of courses whose LEC can fit the committed timetable, so the
  // 符合时间表(仅LEC) toggle never re-walks sections on every keystroke — it only
  // recomputes when the committed selection (→ lecBusy) changes. A course fits when it
  // has no LEC section (no LEC constraint) or at least one LEC section whose every
  // meeting avoids all lecBusy intervals on the same day (overlap: a.s<b.e && b.s<a.e).
  const lecFitSet = useMemo(() => {
    const fit = new Set<Course>()
    const seen = new Set<Course>()
    for (const { course } of offerings) {
      if (seen.has(course)) continue
      seen.add(course)
      const lecs = course.sections.filter((section) => section.component === 'LEC')
      const fits =
        lecs.length === 0 ||
        lecs.some((lec) =>
          lec.meetings.every(
            (m) =>
              !lecBusy.some(
                (b) => b.dayIndex === m.dayIndex && m.start < b.end && b.start < m.end,
              ),
          ),
        )
      if (fits) fit.add(course)
    }
    return fit
  }, [lecBusy, offerings])

  // 符合上下班时间:每门课是否存在至少一种全组件组合、每个 meeting 都落在 [officeStart, officeEnd]
  // 内(courseFitsWindow,见 schedule.ts)。同 lecFitSet 的记忆化套路——只随 offerings / 窗口变化重算。
  const officeWindow = useMemo<TimeWindow>(() => ({ start: officeStart, end: officeEnd }), [officeEnd, officeStart])
  const officeFitSet = useMemo(() => {
    const fit = new Set<Course>()
    const seen = new Set<Course>()
    for (const { course } of offerings) {
      if (seen.has(course)) continue
      seen.add(course)
      if (courseFitsWindow(course, officeWindow)) fit.add(course)
    }
    return fit
  }, [offerings, officeWindow])

  const filtered = useMemo(() => {
    const include = new Set(filters.includeSubjects)
    const exclude = new Set(filters.excludeSubjects)
    const levels = new Set(filters.levels)
    const units = new Set(filters.units)
    return offerings.filter(({ course, termSlug }) => {
      if (filters.currentTermOnly && termSlug !== filters.currentTermSlug) return false
      if (filters.majorKeys && !filters.majorKeys.has(course.key)) return false
      if (filters.ugOnly && course.career !== 'Undergraduate') return false
      if (filters.hideCompleted && takenSet.has(course.key)) return false
      if (filters.excludeTba && statusByCode.get(course.key) === 'tba') return false
      // 隐藏已替代修课:滤掉 barredKeys 里的课(已修互斥/替代课挡下的);关闭时照常显示，
      // 仍带下面 flagFor 算出的「已修替代课」角标(不隐藏，只是不再默认硬挡在列表里)。
      if (filters.hideSuperseded && barredKeys.has(course.key)) return false
      if (include.size > 0 && !include.has(course.subject)) return false
      if (exclude.has(course.subject)) return false
      if (units.size > 0) {
        // Bucket by floor(units): 4+ catches everything from 4 credits up, else the floor.
        const floor = Math.floor(course.units)
        const bucket: UnitPick = floor >= 4 ? '4plus' : (String(floor) as UnitPick)
        if (!units.has(bucket)) return false
      }
      if (levels.size > 0) {
        const bucket: LevelBucket = course.level >= 4 ? '4plus' : (String(course.level) as LevelBucket)
        if (!levels.has(bucket)) return false
      }
      // 符合先修:排除先修被证伪(missing)的课;met / none / unverifiable 均保留。
      if (filters.meetsPrereq && prereqByCode.get(course.key)?.status === 'missing') return false
      // 符合时间表(仅LEC):只保留 LEC 能塞进已选课表的课(见 lecFitSet)。
      if (filters.lecFits && !lecFitSet.has(course)) return false
      // 符合上下班时间:只保留有组合能全落进 [上班,下班] 窗口的课(见 officeFitSet)。
      if (filters.meetsOfficeHours && !officeFitSet.has(course)) return false
      if (filters.query.trim() && scoreCourse(course, filters.query) <= 0) return false
      return true
    })
  }, [barredKeys, filters, lecFitSet, offerings, officeFitSet, prereqByCode, statusByCode, takenSet])

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
          <div className="cg__empty empty-hint">没有符合条件的课程</div>
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
                      const status = statusByCode.get(course.key)
                      const prereq = prereqByCode.get(course.key)
                      const isCommitted = committedSet.has(course.key)
                      const isTaken = takenSet.has(course.key)
                      const isCart = cartSet.has(course.key)
                      const isBarred = barredKeys.has(course.key)
                      // 统一「不可选」判定:已修互斥课 / 时间冲突 / 时间待定 → 硬挡(灰化 + 禁用马上学);
                      // 时间可能冲突(rearrange) → 中性提示但不禁用;open 保持醒目可点。
                      const flag = flagFor(status, isBarred)
                      const blocked = flag?.kind === 'blocked'
                      // 本专业地位:选了主修才有(map 命中 = 必修/选修,未命中 = 自由选修);未选主修则不标。
                      const standing = standingByKey
                        ? (standingByKey.get(course.key) ?? FREE_STANDING)
                        : null
                      // 右上角角标:缺先修 / 看先修 + 时间类提示(冲突/待定/时间可能冲突/已修替代课),特殊切角格式。
                      const tags: Array<{ tone: 'bad' | 'warn' | 'mute'; text: string; title: string }> = []
                      if (prereq?.status === 'missing') {
                        tags.push({ tone: 'bad', text: '缺先修', title: `先修未满足：${prereq.text}` })
                      } else if (prereq?.status === 'unverifiable' && prereq.text) {
                        tags.push({ tone: 'mute', text: '看先修', title: `有先修/成绩等要求，请自查：${prereq.text}` })
                      }
                      if (flag) {
                        tags.push({ tone: flag.tone, text: flag.text, title: flag.text })
                      }
                      return (
                        <article
                          className={`cc${isCommitted ? ' cc--committed' : ''}${isCart ? ' cc--cart' : ''}${isTaken ? ' cc--taken' : ''}${blocked ? ' cc--blocked' : ''}`}
                          key={`${course.code}-${term.termOrder}`}
                          style={courseColor(course.subject)}
                          onPointerDown={
                            onCardPointerDown ? (event) => onCardPointerDown(course, event) : undefined
                          }
                        >
                          <div
                            className="cc__info"
                            role="button"
                            tabIndex={0}
                            title="查看课程详情"
                            onClick={() => onOpenDetail(course)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                onOpenDetail(course)
                              }
                            }}
                          >
                            <div className="cc__head">
                              <span className="cc__code">{course.code}</span>
                              <span className="cc__units">[{course.units}学分]</span>
                              {tags.length > 0 && (
                                <div className="cc__tags">
                                  {tags.map((tag) => (
                                    <span className={`cc__tag cc__tag--${tag.tone}`} key={tag.text} title={tag.title}>
                                      {tag.text}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            {standing && (
                              <div className={`cc__class cc__class--${standing.kind}`}>
                                <span className="cc__class-kind">
                                  {STANDING_LABEL[standing.kind].zh}
                                  <em>{STANDING_LABEL[standing.kind].en}</em>
                                </span>
                                {standing.kind !== 'free' && (standing.section.zh || standing.section.en) && (
                                  <span className="cc__class-sec">
                                    {standing.section.zh && <>{standing.section.zh} </>}
                                    <em>{standing.section.en}</em>
                                  </span>
                                )}
                              </div>
                            )}
                            <div className="cc__title" title={course.title}>
                              {course.title}
                            </div>
                          </div>
                          <div className="cc__acts">
                            <button
                              className={`cc__btn cc__btn--done${isTaken ? ' cc__btn--on' : ''}`}
                              type="button"
                              onClick={() => onTaken(course.code)}
                            >
                              {isTaken ? '已学完 ✓' : '已学完'}
                            </button>
                            <button
                              className={`cc__btn cc__btn--maybe${isCart ? ' cc__btn--on' : ''}`}
                              type="button"
                              onClick={() => onCart(course.code)}
                            >
                              {isCart ? '可能学 ✓' : '可能学'}
                            </button>
                            <button
                              className={`cc__btn cc__btn--soon${isCommitted ? ' cc__btn--on' : ''}`}
                              disabled={blocked}
                              title={blocked ? flag?.text : undefined}
                              type="button"
                              onClick={() => onCommit(course.code)}
                            >
                              {isCommitted ? '必定学 ✓' : '必定学'}
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
