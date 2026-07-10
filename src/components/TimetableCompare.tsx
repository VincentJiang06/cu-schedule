import type { CSSProperties } from 'react'
import { courseColor } from '../lib/color.ts'
import { hhmm } from '../lib/time.ts'
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
}: {
  blocks: Omit<Block, 'lane' | 'lanes'>[]
  variant: 'a' | 'b'
  floorHour: number
  span: number
  empty: boolean
}) {
  const pct = (minutes: number) => ((minutes - floorHour * 60) / span) * 100
  const laid = layOutDay(blocks)
  return (
    <div className={`tt2__sub tt2__sub--${variant}`}>
      {laid.length === 0 && !empty && <span className="tt2__free">空闲</span>}
      {laid.map((block) => {
        const width = 100 / block.lanes
        return (
          <article
            className="tt2__block"
            key={block.key}
            style={
              {
                ...courseColor(block.subject),
                top: `${pct(block.start)}%`,
                height: `calc(${((block.end - block.start) / span) * 100}% - 3px)`,
                left: `calc(${block.lane * width}% + 1px)`,
                width: `calc(${width}% - 2px)`,
              } as CSSProperties
            }
            title={`${block.code} ${block.title}\n${block.component} · ${hhmm(block.start)}–${hhmm(block.end)}\n${block.location || '地点待定'}`}
          >
            <b>{block.code}</b>
            <time>
              {hhmm(block.start)}–{hhmm(block.end)}
            </time>
            <span className="tt2__block-meta">
              {block.component}
              {block.location ? ` · ${block.location}` : ''}
            </span>
          </article>
        )
      })}
    </div>
  )
}

export function TimetableCompare({
  planA,
  planB,
  emptyMessage,
}: {
  planA: Plan | null
  planB: Plan | null
  emptyMessage: string
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
  const end = Math.max(CEIL, ...all.map((block) => block.end))
  const floorHour = Math.floor(start / 60)
  const ceilHour = Math.ceil(end / 60)
  const span = (ceilHour - floorHour) * 60

  const hours = Array.from({ length: ceilHour - floorHour + 1 }, (_, index) => (floorHour + index) * 60)
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
        {hours.slice(1, -1).map((minutes) => (
          <div aria-hidden className="tt2__rule" key={minutes} style={{ top: `${pct(minutes)}%` }} />
        ))}
        {Array.from({ length: dayCount }, (_, index) => {
          const dayIndex = index + 1
          return (
            <div className="tt2__col" key={dayIndex}>
              <Column
                blocks={rawA.filter((block) => block.dayIndex === dayIndex)}
                empty={false}
                floorHour={floorHour}
                span={span}
                variant="a"
              />
              <Column
                blocks={rawB.filter((block) => block.dayIndex === dayIndex)}
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
