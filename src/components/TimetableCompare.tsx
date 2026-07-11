import type { CSSProperties } from 'react'
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
  lane: number
  lanes: number
}

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
}: {
  blocks: Omit<Block, 'lane' | 'lanes'>[]
  variant: 'a' | 'b'
  floorHour: number
  span: number
  empty: boolean
  colorForCode: (code: string) => CSSProperties
}) {
  const pct = (minutes: number) => ((minutes - floorHour * 60) / span) * 100
  const laid = layOutDay(blocks)
  return (
    <div className={`tt2__sub tt2__sub--${variant}`}>
      {laid.length === 0 && !empty && <span className="tt2__free">空闲</span>}
      {laid.map((block) => {
        const width = 100 / block.lanes
        // 显示用结束时间进位到下一个半点（本校无 :15/:45 起课），卡片更高、留白更从容；
        // 真实 end 仍用于排课/冲突/分道，这里只影响占位高度与时间标签。
        const shownEnd = displayEndMinutes(block.end)
        // #8 LEC 实心主色块；TUT/LAB 等同 hue 的浅色斜纹+虚线变体，一眼可分。
        const isLec = block.component === 'LEC'
        return (
          <article
            className={`tt2__block ${isLec ? 'tt2__block--lec' : 'tt2__block--alt'}`}
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
            title={`${block.code} ${block.title}\n${block.component} · ${hhmm(block.start)}–${hhmm(shownEnd)}\n${block.location || '地点待定'}`}
          >
            <span className="tt2__block-top">
              <b className="tt2__block-comp">{block.component}</b>
              <span className="tt2__block-code">{block.code}</span>
            </span>
            <time className="tt2__block-time">
              {hhmm(block.start)}–{hhmm(shownEnd)}
              {block.location ? ` · ${block.location}` : ''}
            </time>
          </article>
        )
      })}
    </div>
  )
}

/** A user-placed dashed reference line drawn across the whole grid (purely visual). */
export type Guide = { minutes: number; label: string; tone: 'am' | 'pm' }

export function TimetableCompare({
  planA,
  planB,
  emptyMessage,
  colorForCode,
  guides = [],
}: {
  planA: Plan | null
  planB: Plan | null
  emptyMessage: string
  colorForCode: (code: string) => CSSProperties
  /** Two optional reference lines (morning / evening) the student drags to eyeball. */
  guides?: Guide[]
}) {
  const rawA = blocksOf(planA)
  const rawB = blocksOf(planB)
  const all = [...rawA, ...rawB]

  if (!planA) {
    return (
      <div className="tt2 tt2--empty">
        <p>{emptyMessage}</p>
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

  return (
    <div className="tt2" style={{ '--tt-days': dayCount } as CSSProperties}>
      <div className="tt2__corner" />
      <div className="tt2__head">
        {DAYS.slice(0, dayCount).map((day) => (
          <div className="tt2__day-name" key={day}>
            <span>{day}</span>
            <div className="tt2__ab-labels">
              <i className="tt2__tag tt2__tag--a">A</i>
              <i className="tt2__tag tt2__tag--b">B</i>
            </div>
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

      <div className="tt2__body">
        {halfHours.slice(1, -1).map((minutes) => (
          <div
            aria-hidden
            className={`tt2__rule${minutes % 60 === 0 ? '' : ' tt2__rule--half'}`}
            key={minutes}
            style={{ top: `${pct(minutes)}%` }}
          />
        ))}
        {guides
          .filter((guide) => guide.minutes >= floorHour * 60 && guide.minutes <= ceilHour * 60)
          .map((guide) => (
            <div
              className={`tt2__guide tt2__guide--${guide.tone}`}
              key={guide.tone}
              style={{ top: `${pct(guide.minutes)}%` }}
            >
              <span className="tt2__guide-tag">
                {guide.label} {hhmm(guide.minutes)}
              </span>
            </div>
          ))}
        {Array.from({ length: dayCount }, (_, index) => {
          const dayIndex = index + 1
          return (
            <div className="tt2__col" key={dayIndex}>
              <Column
                blocks={rawA.filter((block) => block.dayIndex === dayIndex)}
                colorForCode={colorForCode}
                empty={false}
                floorHour={floorHour}
                span={span}
                variant="a"
              />
              <Column
                blocks={rawB.filter((block) => block.dayIndex === dayIndex)}
                colorForCode={colorForCode}
                empty={!planB}
                floorHour={floorHour}
                span={span}
                variant="b"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
