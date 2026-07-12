import type { CSSProperties } from 'react'
import { abbreviateLocation } from '../lib/buildingAbbrev.ts'
import { shortComponent, squeezeLevel } from '../lib/blockDisplay.ts'
import { courseColor } from '../lib/color.ts'
import { courseKey } from '../lib/courseKey.ts'
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
  lane: number
  lanes: number
}

/** Greedy interval-graph coloring: overlapping blocks in one day get side-by-side lanes. */
function layOutDay(blocks: Omit<Block, 'lane' | 'lanes'>[]): Block[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end)
  const laneEnds: number[] = []
  const placed = sorted.map((block) => {
    let lane = laneEnds.findIndex((end) => end <= block.start)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = block.end
    return { ...block, lane, lanes: 1 }
  })

  // Lane count is per overlap cluster, not per day: a lone evening class stays full width.
  return placed.map((block) => {
    const cluster = placed.filter((other) => other.start < block.end && block.start < other.end)
    return { ...block, lanes: Math.max(...cluster.map((item) => item.lane)) + 1 }
  })
}

export function Timetable({
  plan,
  emptyMessage,
  colorForCode,
}: {
  plan: Plan | null
  emptyMessage: string
  /** #里程碑3:按课程(不是按学科)上色——不传时退回 courseColor(subject)，但那样同学科
   * 的课会全部撞色，调用方(ShareView)应该总是传一个按课程区分的取色函数。 */
  colorForCode?: (code: string) => CSSProperties
}) {
  const raw: Omit<Block, 'lane' | 'lanes'>[] = (plan?.entries ?? []).flatMap((entry) =>
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

  const usesWeekend = raw.some((block) => block.dayIndex > 5)
  const dayCount = usesWeekend ? 7 : 5
  const start = Math.min(FLOOR, ...raw.map((block) => block.start))
  // 用进位后的显示结束时间算下界，拉高的卡片不会溢出底部（与 TimetableCompare 一致）。
  const end = Math.max(CEIL, ...raw.map((block) => displayEndMinutes(block.end)))
  const floorHour = Math.floor(start / 60)
  const ceilHour = Math.ceil(end / 60)
  const span = (ceilHour - floorHour) * 60

  const hours = Array.from({ length: ceilHour - floorHour + 1 }, (_, index) => (floorHour + index) * 60)
  // 每半小时一条横线（整点略深、半点略浅），把课表做成表格。
  const halfHours = Array.from({ length: (ceilHour - floorHour) * 2 + 1 }, (_, index) => floorHour * 60 + index * 30)
  const pct = (minutes: number) => ((minutes - floorHour * 60) / span) * 100

  return (
    <div className="tt" style={{ '--tt-days': dayCount } as CSSProperties}>
      <div className="tt__corner" />
      <div className="tt__head">
        {DAYS.slice(0, dayCount).map((day) => (
          <div className="tt__day-name" key={day}>
            {day}
          </div>
        ))}
      </div>

      <div className="tt__axis">
        {hours.map((minutes) => (
          <span className="tt__tick" key={minutes} style={{ top: `${pct(minutes)}%` }}>
            {hhmm(minutes)}
          </span>
        ))}
      </div>

      <div className="tt__body">
        {halfHours.slice(1, -1).map((minutes) => (
          <div
            aria-hidden
            className={`tt__rule${minutes % 60 === 0 ? '' : ' tt__rule--half'}`}
            key={minutes}
            style={{ top: `${pct(minutes)}%` }}
          />
        ))}
        {Array.from({ length: dayCount }, (_, index) => {
          const dayIndex = index + 1
          const dayRaw = raw.filter((block) => block.dayIndex === dayIndex)
          const blocks = layOutDay(dayRaw)
          // #里程碑2:用真实(未进位)的 start/end 判定,避免卡片为占位而拉高的高度被误判成冲突。
          const conflictMarks = overlapMidpoints(dayRaw)
          return (
            <div className="tt__col" key={dayIndex}>
              {blocks.length === 0 && plan && (
                <span className="tt__free">
                  <span>DAY</span>
                  <span>OFF</span>
                </span>
              )}
              {blocks.map((block) => {
                const width = 100 / block.lanes
                // 进位到下一个半点，仅用于卡片占位高度（本校无 :15/:45 起课，进位后卡片更从容）；
                // 时间标签仍显示真实结束时间（:15 等），真实 end 也用于排课/分道。
                const shownEnd = displayEndMinutes(block.end)
                // #里程碑2:lanes 越多这一列越窄,按压缩等级决定地点缩写/时间折行/component 单字母。
                const squeeze = squeezeLevel(block.lanes)
                const componentText = squeeze >= 3 ? shortComponent(block.component) : block.component
                const locationText = squeeze >= 1 && block.location ? abbreviateLocation(block.location) : block.location
                const foldTime = squeeze >= 2
                return (
                  <article
                    className={`tt__block${squeeze ? ` tt__block--sq${squeeze}` : ''}`}
                    key={block.key}
                    style={
                      {
                        ...(colorForCode ? colorForCode(courseKey(block.code)) : courseColor(block.subject)),
                        top: `${pct(block.start)}%`,
                        height: `calc(${((shownEnd - block.start) / span) * 100}% - 3px)`,
                        left: `calc(${block.lane * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                      } as CSSProperties
                    }
                    title={`${block.code} ${block.title}\n${block.component} · ${hhmm(block.start)}–${hhmm(block.end)}\n${block.location || '地点待定'}`}
                  >
                    {/* 第1行:component + 课号——卡片太矮时,靠 .tt__block 的 overflow:hidden 优雅截断
                       掉下面的行,这一行排最前面永远最先保住。 */}
                    <span className="tt__block-top">
                      <b className="tt__block-comp">{componentText}</b>
                      <span className="tt__block-code">{block.code}</span>
                    </span>
                    {/* 第2行:时间,窄列时折成两行(09:30 / –12:15)。 */}
                    <time className={`tt__block-time${foldTime ? ' tt__block-time--fold' : ''}`}>
                      <span className="tt__block-time-start">{hhmm(block.start)}</span>
                      <span className="tt__block-time-dash">–</span>
                      <span className="tt__block-time-end">{hhmm(block.end)}</span>
                    </time>
                    {/* 第3行:地点,单独一行;窄列时换成官方楼宇缩写。 */}
                    {block.location && <span className="tt__block-loc">{locationText}</span>}
                  </article>
                )
              })}
              {conflictMarks.map((minutes, i) => (
                <span aria-hidden className="tt__conflict" key={`conflict-${i}`} style={{ top: `${pct(minutes)}%` }}>
                  !
                </span>
              ))}
            </div>
          )
        })}

        {!plan && (
          <div className="tt__placeholder">
            <p className="empty-hint">{emptyMessage}</p>
          </div>
        )}
      </div>
    </div>
  )
}
