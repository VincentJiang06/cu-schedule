import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
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

/** #修复5(section 高亮改纯函数推导):一个 chip 该带哪些高亮 class，只由三件事决定——
 * 这个 component 有没有被锁定在这个 section 上(pinnedId)、当前 A(或单方案)排法用不用
 * 这个 section、当前 B 排法用不用它。三者都是每次渲染直接从 props 读到的值，这个函数本身
 * 不持有任何状态，调用方每次渲染都重新调用一遍——pin 被取消、排法切换、AB ↔ 单方案切换，
 * 下一帧算出来的结果自然跟着变，不会有「旧高亮清不掉」这回事(没有 imperative 加类，没有
 * ref，没有跨渲染保留的本地状态)。 */
function sectionChipState(
  pinnedId: string | undefined,
  currentA: Record<string, string> | undefined,
  currentB: Record<string, string> | undefined,
  component: string,
  sectionId: string,
): { on: boolean; curClass: string; curHint: string } {
  const on = pinnedId === sectionId
  const isCurA = currentA?.[component] === sectionId
  const isCurB = currentB?.[component] === sectionId
  const curClass = isCurA && isCurB ? ' cl-chip--cur-ab' : isCurA ? ' cl-chip--cur-a' : isCurB ? ' cl-chip--cur-b' : ''
  const curHint = isCurA && isCurB ? ' · A、B 都用这个' : isCurA ? ' · 当前 A 用这个' : isCurB ? ' · 当前 B 用这个' : ''
  return { on, curClass, curHint }
}

/** Interactive rows: every component with more than one section becomes pinnable chips. */
function CoursePicker({
  course,
  pinned,
  onPin,
  currentA,
  currentB,
}: {
  course: Course
  pinned: Record<string, string>
  onPin: (component: string, sectionId: string) => void
  /** #里程碑6:当前排法(A / solo)在这门课各 component 用的 section id。 */
  currentA?: Record<string, string>
  /** 对比模式下 B 排法的对应映射；不传 = 没有第二个排法要对比(solo 或还没排出来)。 */
  currentB?: Record<string, string>
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
                // LEC 的多个可选段用 1/2/3/4 编号（而非 cohort 字母），更直观；
                // 其余 component（TUT/LAB…）保留原本的 cohort+组号标签。
                const label = component === 'LEC' ? String(index + 1) : sectionLabel(section, index)
                // #修复5:高亮/锁定 class 全部由 sectionChipState 纯推导——A / B 各自独特样式
                // (环形描边颜色不同)，两者都用同一 section 时叠两圈描边，一眼分得出
                // 「A 专属 / B 专属 / A、B 都用它」。与 on(锁定/已约束)是两套独立视觉，
                // 互不覆盖，可以同时出现在同一个 chip 上；两者都是每次渲染重新算，state
                // 一变(取消 pin、切 A/B/单方案)下一帧就跟着变，不会残留。
                const { on, curClass, curHint } = sectionChipState(chosenId, currentA, currentB, component, section.id)
                return (
                  <button
                    className={`cl-chip${on ? ' cl-chip--on' : ''}${curClass}`}
                    key={section.id}
                    title={`${sectionTimes(section)}${on ? ' · 已约束' : ''}${curHint}`}
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
  cartCodes,
  colorFor,
  showTermBadge = true,
  onRowPointerDown,
  disabledCandidateKeys,
  onToggleCandidateDisabled,
  collapsed = false,
  currentA,
  currentB,
}: {
  codes: string[]
  byCode: Map<string, Course>
  /** 移除按钮(×)。不传 = 该列表不允许删课(课表页,删课去选课页)。 */
  onRemove?: (code: string) => void
  /** When provided, components render as pinnable T01/T02-style chips (课表 page). */
  pins?: Pins
  onPin?: (code: string, component: string, sectionId: string) => void
  /** courseKey → the term orders (1=上学期, 2=下学期) the course is offered in. */
  termOrdersByKey: Map<string, number[]>
  /** The term order the header is currently on; picked when a course spans both. */
  currentTermOrder: number
  /** Placeholder line when the list is empty. */
  emptyHint?: string
  /** 候选(可能学)课程,渲染在 codes 之后,带右上角小角块标记;不参与 pin 选时段。 */
  cartCodes?: string[]
  /** 每行的配色来源。默认按学科 hash(courseColor);课表页传 colorForCode,与大课表一致。 */
  colorFor?: (code: string) => CSSProperties
  /** 「上学期/下学期」徽标开关。课表页关掉(学期语境已经确定,徽标是噪音)。 */
  showTermBadge?: boolean
  /** 拖拽起点(可选,选课页):按住整行拖到「必定学 / 可能学」目标区或拖出移除。 */
  onRowPointerDown?: (code: string, isCart: boolean, event: ReactPointerEvent<HTMLElement>) => void
  /** #里程碑5:被点角停用的候选课(按 courseKey)——课表页这份列表用来给对应候选行加
   * 置灰样式，与大课表上试排块的禁用展示保持一致（"并在筛选里体现"）。 */
  disabledCandidateKeys?: Set<string>
  /** #里程碑5(隐藏/显示快速开关):候选行右侧的眼睛按钮——快速禁用/启用该候选课在课表
   * 上的展示，与大课表试排块右上角的三角 toggle 走同一个 App.toggleCandidateDisabled，
   * 两处状态互相同步。只对 isCart 行渲染；不传则不显示这个按钮。 */
  onToggleCandidateDisabled?: (code: string) => void
  /** #里程碑2(整卡折叠):true 时每行只剩 head 一行(课号+基本信息)，时间/地点/pin 选择器
   * 收起——列表内部滚动区域(见 .cl__rows)本身与折叠无关，两者独立生效。 */
  collapsed?: boolean
  /** #里程碑6:当前选中排法(A,或单方案模式下唯一的那个)在各课各 component 用的
   * section，按 course.code 索引(与 pins 同一把 key)——供左栏 section 选择器高亮。 */
  currentA?: Pins
  /** 对比模式下 B 排法的对应映射；solo 模式下 B 不存在，传空对象/不传即可，各 chip 的
   * 「当前 B」判定自然都不命中。 */
  currentB?: Pins
}) {
  const interactive = Boolean(onPin)
  const rows: Array<{ code: string; isCart: boolean }> = [
    ...codes.map((code) => ({ code, isCart: false })),
    ...(cartCodes ?? []).map((code) => ({ code, isCart: true })),
  ]

  return (
    <div className="cl">
      {rows.length === 0 ? (
        <p className="cl__empty empty-hint">{emptyHint ?? '还没有课程。在中间的课程列表点「必定学」来添加。'}</p>
      ) : (
        <ul className="cl__rows">
          {rows.map(({ code, isCart }) => {
            const course = byCode.get(courseKey(code))
            const orders = termOrdersByKey.get(courseKey(code)) ?? []
            const badge = orders.includes(currentTermOrder) ? currentTermOrder : orders[0]
            const isDisabledCandidate = isCart && (disabledCandidateKeys?.has(courseKey(code)) ?? false)
            return (
              <li
                className={`${isCart ? 'cl-row cl-row--cart' : 'cl-row'}${isDisabledCandidate ? ' cl-row--cart-off' : ''}`}
                key={code}
                style={(colorFor ?? courseColor)(code)}
                title={isCart ? (isDisabledCandidate ? '可能学（候选课程 · 已在课表上停用展示）' : '可能学（候选课程）') : undefined}
                onPointerDown={
                  onRowPointerDown ? (event) => onRowPointerDown(code, isCart, event) : undefined
                }
              >
                <div className="cl-row__head">
                  <span className="cl-row__code">{code}</span>
                  {course && <span className="cl-row__units">{course.units}学分</span>}
                  {showTermBadge && badge ? <span className="cl-row__term">{TERM_LABEL[badge]}</span> : null}
                  {(onRemove || (isCart && onToggleCandidateDisabled)) && (
                    <span className="cl-row__actions">
                      {isCart && onToggleCandidateDisabled && (
                        <button
                          aria-label={isDisabledCandidate ? `启用候选课 ${code}` : `隐藏候选课 ${code}`}
                          className={`cl-row__eye${isDisabledCandidate ? ' cl-row__eye--off' : ''}`}
                          title={isDisabledCandidate ? '已停用课表展示，点击重新启用' : '点击隐藏（停用课表展示，不移除候选）'}
                          type="button"
                          onClick={() => onToggleCandidateDisabled(code)}
                        >
                          {isDisabledCandidate ? '👁‍🗨' : '👁'}
                        </button>
                      )}
                      {onRemove && (
                        <button className="cl-row__x" title="移除" type="button" onClick={() => onRemove(code)}>
                          ×
                        </button>
                      )}
                    </span>
                  )}
                </div>
                {/* #里程碑2:折叠态下每门课只剩上面的 head 一行，时间/地点/pin 选择器/
                    「本学期无此课」提示统统收起，不渲染。 */}
                {course && !collapsed ? (
                  interactive && onPin && !isCart ? (
                    <CoursePicker
                      course={course}
                      currentA={currentA?.[code]}
                      currentB={currentB?.[code]}
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
                ) : !course && !collapsed ? (
                  <div className="cl-row__missing">本学期无此课</div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
