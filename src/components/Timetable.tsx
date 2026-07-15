import type { CSSProperties } from 'react'
import { t } from '../i18n/index.ts'
import { abbreviateLocation } from '../lib/buildingAbbrev.ts'
import { courseColor } from '../lib/color.ts'
import { courseKey } from '../lib/courseKey.ts'
import { overlapMidpoints } from '../lib/overlap.ts'
import { displayEndMinutes, durationTag, hhmm } from '../lib/time.ts'
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
  portrait = false,
}: {
  plan: Plan | null
  emptyMessage: string
  /** #里程碑3:按课程(不是按学科)上色——不传时退回 courseColor(subject)，但那样同学科
   * 的课会全部撞色，调用方(ShareView)应该总是传一个按课程区分的取色函数。 */
  colorForCode?: (code: string) => CSSProperties
  /** 竖屏四行渲染(课号/地点/组件/开始+时长):只读分享/预览页整页恒用(用户拍板
   * 2026-07-15),不按块形状一个个触发、避免同页四行/两行混排;每块仍按自身高度灵活收行
   * (4→3→2→1)。主课表页/编辑页不传 = 横屏两行。 */
  portrait?: boolean
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
    <div className={`tt${portrait ? ' tt--portrait' : ''}`} style={{ '--tt-days': dayCount } as CSSProperties}>
      <div className="tt__corner" />
      <div className="tt__head">
        {DAYS.slice(0, dayCount).map((day) => (
          <div className="tt__day-name" key={day}>
            {t(day)}
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
                // #容器查询方法论:课号/全称地点/简写地点/时间四个内容片段一次性全部渲染进 DOM，
                // 具体哪档可见、多挤要不要折行/降级，全部交给 .tt__block 的 CSS 容器查询
                // (container-type:size，见 styles.css)按这个块*实际渲染出的*宽高决定——
                // lane 数只决定这里的位置/宽度几何，不再用来猜文字该显示成什么样。
                return (
                  <article
                    className="tt__block"
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
                    title={`${block.code} ${block.title}\n${block.component} · ${hhmm(block.start)}–${hhmm(block.end)}\n${block.location || t('地点待定')}`}
                  >
                    <span className="tt__block-code">{block.code}</span>
                    {/* 地点恒用官方简写(与 PNG/HTML 导出一致,不再渲染全称片段)。 */}
                    {block.location && (
                      <span className="tt__block-loc-abbr">{abbreviateLocation(block.location)}</span>
                    )}
                    {/* 组件(LEC/TUT/LAB)——仅竖屏四行档显示(容器查询 max-aspect-ratio),横屏两行档隐藏。 */}
                    <span className="tt__block-comp">{block.component}</span>
                    {/* 横屏两行档的整段时间(09:30–10:15);竖屏四行档隐藏,由下面 -time-portrait 取代。 */}
                    <time className="tt__block-time">
                      <span className="tt__block-time-start">{hhmm(block.start)}</span>
                      <span className="tt__block-time-dash">–</span>
                      <span className="tt__block-time-end">{hhmm(block.end)}</span>
                    </time>
                    {/* 竖屏四行档的时间行:开始时间 + 时长标记(09:30 +45m),与竖屏 PNG 一致。 */}
                    <span className="tt__block-time-portrait">
                      {hhmm(block.start)} {durationTag(block.start, block.end)}
                    </span>
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
