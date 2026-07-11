import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { overlapMidpoints } from '../lib/overlap.ts'
import { displayEndMinutes, hhmm } from '../lib/time.ts'
import type { Plan } from '../lib/schedule.ts'

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const FLOOR = 8 * 60
const CEIL = 19 * 60

type Block = {
  key: string
  code: string
  subject: string
  title: string
  component: string
  location: string
  dayIndex: number
  start: number
  end: number
  /** true = 候选(可能学)课程的试排块,右上角带小角块标记。 */
  cart?: boolean
  /** #里程碑5:该候选课是否被点角停用——只对 cart 块有意义,置灰展示、角标切换成「点击启用」。 */
  disabled?: boolean
  lane: number
  lanes: number
}

/** 候选(可能学)课程的试排块——App 按「不与该排法冲突的第一种组合」算好后传入。 */
export type GhostBlock = Omit<Block, 'lane' | 'lanes'>

function blocksOf(plan: Plan | null): Omit<Block, 'lane' | 'lanes'>[] {
  return (plan?.entries ?? []).flatMap((entry) =>
    entry.section.meetings.map((meeting) => ({
      key: `${entry.section.id}-${meeting.dayIndex}-${meeting.start}`,
      code: entry.course.code,
      subject: entry.course.subject,
      title: entry.course.title,
      component: entry.section.component,
      location: meeting.location,
      dayIndex: meeting.dayIndex,
      start: meeting.start,
      end: meeting.end,
    })),
  )
}

/** Greedy interval-graph coloring: overlapping blocks in one sub-column get side-by-side lanes. */
function layOutDay(blocks: Omit<Block, 'lane' | 'lanes'>[]): Block[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end)
  const laneEnds: number[] = []
  const placed = sorted.map((block) => {
    let lane = laneEnds.findIndex((end) => end <= block.start)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = block.end
    return { ...block, lane, lanes: 1 }
  })
  return placed.map((block) => {
    const cluster = placed.filter((other) => other.start < block.end && block.start < other.end)
    return { ...block, lanes: Math.max(...cluster.map((item) => item.lane)) + 1 }
  })
}

function Column({
  blocks,
  variant,
  floorHour,
  span,
  empty,
  colorForCode,
  onToggleCandidate,
}: {
  blocks: Omit<Block, 'lane' | 'lanes'>[]
  variant: 'a' | 'b'
  floorHour: number
  span: number
  empty: boolean
  colorForCode: (code: string) => CSSProperties
  /** #里程碑5:点候选课试排块右上角的放大三角 → 切换该课在课表上的启用/禁用展示。 */
  onToggleCandidate?: (code: string) => void
}) {
  const pct = (minutes: number) => ((minutes - floorHour * 60) / span) * 100
  const laid = layOutDay(blocks)
  // #里程碑2:同一子列(A 或 B，含候选课试排块)内两两重叠的时间块，标出碰撞处的纵坐标。
  // 用真实(未进位) start/end 判定，避免卡片为占位而拉高的高度被误判成冲突。
  const conflictMarks = overlapMidpoints(blocks)
  return (
    <div className={`tt2__sub tt2__sub--${variant}`}>
      {laid.length === 0 && !empty && (
        <span className="tt2__free">
          <span>DAY</span>
          <span>OFF</span>
        </span>
      )}
      {laid.map((block) => {
        const width = 100 / block.lanes
        // 进位到下一个半点，仅用于卡片占位高度（本校无 :15/:45 起课，卡片更高、留白更从容）；
        // 时间标签仍显示真实结束时间（:15 等）；真实 end 也用于排课/冲突/分道。
        const shownEnd = displayEndMinutes(block.end)
        // #8 LEC 实心主色块；TUT/LAB 等同 hue 的浅色斜纹+虚线变体，一眼可分。
        const isLec = block.component === 'LEC'
        // #里程碑5:候选课试排块——即使被停用也照常渲染(只是置灰)，角上的放大三角必须留在
        // DOM 里才点得到，用来切回启用。
        const cartOff = Boolean(block.cart) && Boolean(block.disabled)
        return (
          <article
            className={`tt2__block ${isLec ? 'tt2__block--lec' : 'tt2__block--alt'}${block.cart ? ' tt2__block--cart' : ''}${cartOff ? ' tt2__block--cart-off' : ''}`}
            key={block.key}
            style={
              {
                ...colorForCode(block.code),
                top: `${pct(block.start)}%`,
                height: `calc(${((shownEnd - block.start) / span) * 100}% - 3px)`,
                left: `calc(${block.lane * width}% + 1px)`,
                width: `calc(${width}% - 2px)`,
              } as CSSProperties
            }
            title={`${block.code} ${block.title}${block.cart ? (cartOff ? '（可能学 · 已停用展示，点右上角重新启用）' : '（可能学 · 试排）') : ''}\n${block.component} · ${hhmm(block.start)}–${hhmm(block.end)}\n${block.location || '地点待定'}`}
          >
            <span className="tt2__block-top">
              <b className="tt2__block-comp">{block.component}</b>
              <span className="tt2__block-code">{block.code}</span>
            </span>
            <time className="tt2__block-time">
              {hhmm(block.start)}–{hhmm(block.end)}
              {block.location ? ` · ${block.location}` : ''}
            </time>
            {block.cart && onToggleCandidate && (
              <button
                aria-label={cartOff ? `启用候选课 ${block.code}` : `停用候选课 ${block.code}`}
                className="tt2__cart-corner"
                title={cartOff ? '点击重新启用该候选课' : '点击停用该候选课（灰显）'}
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleCandidate(block.code)
                }}
              />
            )}
          </article>
        )
      })}
      {conflictMarks.map((minutes, i) => (
        <span aria-hidden className="tt2__conflict" key={`conflict-${i}`} style={{ top: `${pct(minutes)}%` }}>
          !
        </span>
      ))}
    </div>
  )
}

/** A user-placed dashed reference line drawn across the whole grid (also draggable). */
export type Guide = { minutes: number; label: string; tone: 'am' | 'pm' }

export function TimetableCompare({
  planA,
  planB,
  emptyMessage,
  colorForCode,
  guides = [],
  showEmptyGrid = false,
  cartA = [],
  cartB = [],
  solo = false,
  locked = false,
  onGuideChange,
  onToggleCandidate,
}: {
  planA: Plan | null
  planB: Plan | null
  emptyMessage: string
  colorForCode: (code: string) => CSSProperties
  /** Two optional reference lines (上班 / 下班) — draggable when onGuideChange is set. */
  guides?: Guide[]
  /** #4 全空空态:true 时(committed 课非空但没有可展示的排法——本来排不出 或 被过滤器清空)
   * 渲染完整的星期/时间轴网格骨架(无课程块),而不是裸消息;emptyMessage 移到网格下方居中显示。
   * false(默认)沿用旧行为——用于「还没选任何课」那种更简单的提示场景。 */
  showEmptyGrid?: boolean
  /** 候选(可能学)课程的试排块,分别叠加到 A / B 子列(右上角小角块标记)。 */
  cartA?: GhostBlock[]
  cartB?: GhostBlock[]
  /** 单方案模式(点排法横条的方框进入):每天只画一整列(planA),不再 A/B 对比。 */
  solo?: boolean
  /** 上下班时间上锁(默认锁住,由 App 的锁按钮控制):true 时虚线不可拖——即便传了
   * onGuideChange,拖动手势也在起手时直接放弃,鼠标样式也不再示意「可拖」。 */
  locked?: boolean
  /** 上下班虚线的拖动回调(吸附 15 分钟由本组件完成);不传 = 线不可拖。 */
  onGuideChange?: (tone: 'am' | 'pm', minutes: number) => void
  /** #里程碑5:点候选课试排块右上角的放大三角 → 切换该课启用/禁用展示;不传 = 角标不可点。 */
  onToggleCandidate?: (code: string) => void
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const rawA = [...blocksOf(planA), ...cartA]
  const rawB = solo ? [] : [...blocksOf(planB), ...cartB]
  const all = [...rawA, ...rawB]

  if (!planA && !showEmptyGrid) {
    return (
      <div className="tt2 tt2--empty">
        <p className="empty-hint">{emptyMessage}</p>
      </div>
    )
  }

  const usesWeekend = all.some((block) => block.dayIndex > 5)
  const dayCount = usesWeekend ? 7 : 5
  const start = Math.min(FLOOR, ...all.map((block) => block.start))
  // 用进位后的显示结束时间算网格下界，确保拉高后的卡片不会溢出底部。
  const end = Math.max(CEIL, ...all.map((block) => displayEndMinutes(block.end)))
  const floorHour = Math.floor(start / 60)
  const ceilHour = Math.ceil(end / 60)
  const span = (ceilHour - floorHour) * 60

  const hours = Array.from({ length: ceilHour - floorHour + 1 }, (_, index) => (floorHour + index) * 60)
  // 每半小时一条横线，把课表做成表格（整点线略深、半点线略浅）。
  const halfHours = Array.from({ length: (ceilHour - floorHour) * 2 + 1 }, (_, index) => floorHour * 60 + index * 30)
  const pct = (minutes: number) => ((minutes - floorHour * 60) / span) * 100

  // 只画落在当前网格范围内的参考线。
  const shownGuides = guides.filter(
    (guide) => guide.minutes >= floorHour * 60 && guide.minutes <= ceilHour * 60,
  )

  // 上下班线拖动:pointerdown 在虚线上 → window 级 pointermove 实时换算成分钟(按网格身高
  // 线性映射),吸附 15 分钟并夹在网格范围内,每次变化直接回调 App(state → time input +
  // localStorage 同步)。用 window 监听而非指针捕获:guide 元素每次重渲染都会换,捕获会丢。
  // 锁住时(locked)直接不启动这套拖动 —— 连第一次 pointerdown 换算都不做。
  const draggable = Boolean(onGuideChange) && !locked
  const beginGuideDrag = (tone: 'am' | 'pm') => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggable || !onGuideChange || !bodyRef.current) return
    event.preventDefault()
    const rect = bodyRef.current.getBoundingClientRect()
    const pointerId = event.pointerId
    const toMinutes = (clientY: number) => {
      const frac = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
      const raw = floorHour * 60 + frac * span
      const snapped = Math.round(raw / 15) * 15
      return Math.min(ceilHour * 60, Math.max(floorHour * 60, snapped))
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      ev.preventDefault()
      onGuideChange(tone, toMinutes(ev.clientY))
    }
    const finish = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    onGuideChange(tone, toMinutes(event.clientY))
  }

  const grid = (
    <div className={`tt2${solo ? ' tt2--solo' : ''}`} style={{ '--tt-days': dayCount } as CSSProperties}>
      <div className="tt2__corner" />
      <div className="tt2__head">
        {DAYS.slice(0, dayCount).map((day) => (
          <div className="tt2__day-name" key={day}>
            <span>{day}</span>
            {!solo && (
              <div className="tt2__ab-labels">
                <i className="tt2__tag tt2__tag--a">A</i>
                <i className="tt2__tag tt2__tag--b">B</i>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="tt2__axis">
        {hours.map((minutes) => (
          <span className="tt2__tick" key={minutes} style={{ top: `${pct(minutes)}%` }}>
            {hhmm(minutes)}
          </span>
        ))}
      </div>

      <div className="tt2__body" ref={bodyRef}>
        {halfHours.slice(1, -1).map((minutes) => (
          <div
            aria-hidden
            className={`tt2__rule${minutes % 60 === 0 ? '' : ' tt2__rule--half'}`}
            key={minutes}
            style={{ top: `${pct(minutes)}%` }}
          />
        ))}
        {Array.from({ length: dayCount }, (_, index) => {
          const dayIndex = index + 1
          return (
            <div className="tt2__col" key={dayIndex}>
              <Column
                blocks={rawA.filter((block) => block.dayIndex === dayIndex)}
                colorForCode={colorForCode}
                empty={!planA}
                floorHour={floorHour}
                span={span}
                variant="a"
                onToggleCandidate={onToggleCandidate}
              />
              {!solo && (
                <Column
                  blocks={rawB.filter((block) => block.dayIndex === dayIndex)}
                  colorForCode={colorForCode}
                  empty={!planA || !planB}
                  floorHour={floorHour}
                  span={span}
                  variant="b"
                  onToggleCandidate={onToggleCandidate}
                />
              )}
            </div>
          )
        })}
        {shownGuides.map((guide) => (
          <div
            className={`tt2__guide tt2__guide--${guide.tone}${draggable ? ' tt2__guide--drag' : ''}`}
            key={guide.tone}
            style={{ top: `${pct(guide.minutes)}%` }}
            title={draggable ? '按住上下拖动调整时间（15 分钟粒度）' : undefined}
            onPointerDown={beginGuideDrag(guide.tone)}
          >
            <span className="tt2__guide-tag">
              {guide.label} {hhmm(guide.minutes)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )

  // #4 全空空态:committed 课非空、但没有排法能展示——保留网格骨架,提示挪到网格正下方居中、
  // 用全站统一的 .empty-hint(明显大于正文)。
  if (!planA) {
    return (
      <div className="tt2-shell">
        {grid}
        <p className="tt2-shell__hint empty-hint">{emptyMessage}</p>
      </div>
    )
  }

  return grid
}
