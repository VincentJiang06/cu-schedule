import { subjectPaint } from './color.ts'
import type { Plan } from './schedule.ts'
import { hhmm } from './time.ts'

/**
 * Hand-drawn PNG export of the A / B timetable comparison. No html2canvas or any
 * DOM-capture dependency — the layout of TimetableCompare is replicated onto a 2×
 * canvas: a left time axis, one column per weekday split into A / B sub-columns,
 * and course blocks tinted with the light-theme subject colors (subjectPaint,
 * since a canvas can't read the CSS custom properties the live blocks use).
 */

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const FLOOR = 8 * 60
const CEIL = 19 * 60
const SCALE = 2
const W = 1600
const H = 1000

type Block = {
  code: string
  subject: string
  component: string
  location: string
  dayIndex: number
  start: number
  end: number
}
type Laid = Block & { lane: number; lanes: number }

function blocksOf(plan: Plan | null): Block[] {
  return (plan?.entries ?? []).flatMap((entry) =>
    entry.section.meetings.map((meeting) => ({
      code: entry.course.code,
      subject: entry.course.subject,
      component: entry.section.component,
      location: meeting.location,
      dayIndex: meeting.dayIndex,
      start: meeting.start,
      end: meeting.end,
    })),
  )
}

/** Greedy interval-graph coloring — overlapping blocks get side-by-side lanes. */
function layOutDay(blocks: Block[]): Laid[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end)
  const laneEnds: number[] = []
  const placed: Laid[] = sorted.map((block) => {
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function draw(ctx: CanvasRenderingContext2D, planA: Plan, planB: Plan | null, termName: string): void {
  const rawA = blocksOf(planA)
  const rawB = blocksOf(planB)
  const all = [...rawA, ...rawB]

  const usesWeekend = all.some((block) => block.dayIndex > 5)
  const dayCount = usesWeekend ? 7 : 5
  const floorHour = Math.floor(Math.min(FLOOR, ...all.map((block) => block.start)) / 60)
  const ceilHour = Math.ceil(Math.max(CEIL, ...all.map((block) => block.end)) / 60)
  const span = (ceilHour - floorHour) * 60

  const ink = '#1e2532'
  const faint = '#e6e8ee'
  const muted = '#8b93a4'

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // Title.
  ctx.fillStyle = ink
  ctx.font = '700 24px system-ui, -apple-system, "PingFang SC", sans-serif'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillText(`CU Schedule · ${termName} 课表对比`, 28, 44)

  const gridTop = 108
  const gridBottom = H - 40
  const gridLeft = 28 + 60
  const gridRight = W - 28
  const gridW = gridRight - gridLeft
  const gridH = gridBottom - gridTop
  const colW = gridW / dayCount
  const subW = colW / 2
  const yOf = (minutes: number) => gridTop + ((minutes - floorHour * 60) / span) * gridH

  // Hour rules + axis labels.
  ctx.font = '12px system-ui, -apple-system, sans-serif'
  for (let hour = floorHour; hour <= ceilHour; hour += 1) {
    const y = yOf(hour * 60)
    ctx.strokeStyle = faint
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(gridLeft, y)
    ctx.lineTo(gridRight, y)
    ctx.stroke()
    ctx.fillStyle = muted
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(hhmm(hour * 60), gridLeft - 8, y)
  }

  // Day headers + A/B sub-column separators.
  for (let day = 0; day < dayCount; day += 1) {
    const x = gridLeft + day * colW
    ctx.strokeStyle = faint
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, gridTop)
    ctx.lineTo(x, gridBottom)
    ctx.stroke()
    // dashed A|B divider
    ctx.save()
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(x + subW, gridTop)
    ctx.lineTo(x + subW, gridBottom)
    ctx.stroke()
    ctx.restore()

    ctx.fillStyle = ink
    ctx.font = '600 15px system-ui, -apple-system, "PingFang SC", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(DAYS[day], x + colW / 2, gridTop - 30)
    ctx.font = '11px system-ui, -apple-system, sans-serif'
    ctx.fillStyle = muted
    ctx.fillText('A', x + subW / 2, gridTop - 12)
    ctx.fillText('B', x + subW + subW / 2, gridTop - 12)
  }
  ctx.strokeStyle = faint
  ctx.beginPath()
  ctx.moveTo(gridRight, gridTop)
  ctx.lineTo(gridRight, gridBottom)
  ctx.stroke()

  // Course blocks.
  const drawColumn = (blocks: Block[], baseX: number) => {
    for (const block of layOutDay(blocks)) {
      const laneW = subW / block.lanes
      const x = baseX + block.lane * laneW + 1.5
      const y = yOf(block.start) + 1
      const w = laneW - 3
      const h = yOf(block.end) - yOf(block.start) - 2
      if (h <= 0 || w <= 0) continue
      const paint = subjectPaint(block.subject)

      roundRect(ctx, x, y, w, h, 4)
      ctx.fillStyle = paint.fill
      ctx.fill()
      ctx.strokeStyle = paint.edge
      ctx.lineWidth = 1
      ctx.stroke()
      // left accent bar
      ctx.fillStyle = paint.text
      ctx.fillRect(x, y, 3, h)

      ctx.save()
      roundRect(ctx, x, y, w, h, 4)
      ctx.clip()
      ctx.fillStyle = paint.text
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      const tx = x + 7
      let ty = y + 14
      ctx.font = '700 11px system-ui, -apple-system, sans-serif'
      ctx.fillText(block.code, tx, ty)
      if (h > 30) {
        ty += 13
        ctx.font = '10px system-ui, -apple-system, sans-serif'
        ctx.fillText(`${hhmm(block.start)}–${hhmm(block.end)}`, tx, ty)
      }
      if (h > 44) {
        ty += 13
        const meta = block.location ? `${block.component} · ${block.location}` : block.component
        ctx.fillText(meta, tx, ty)
      }
      ctx.restore()
    }
  }

  for (let day = 1; day <= dayCount; day += 1) {
    const baseX = gridLeft + (day - 1) * colW
    drawColumn(rawA.filter((block) => block.dayIndex === day), baseX)
    drawColumn(rawB.filter((block) => block.dayIndex === day), baseX + subW)
  }

  // AGPL / source note, bottom-right.
  ctx.fillStyle = muted
  ctx.font = '10px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(
    '数据来自 CUHK 公开课程目录 · 管线 EagleZhen/another-cuhk-course-planner (AGPL-3.0)',
    gridRight,
    H - 16,
  )
}

function slugTerm(name: string): string {
  return name.replace(/[^\w一-龥-]+/g, '-').replace(/^-+|-+$/g, '') || 'term'
}

/** Render the A / B comparison to a 2× PNG, trigger a download, and return the file name. */
export async function exportImage(planA: Plan, planB: Plan | null, termName: string): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.scale(SCALE, SCALE)
  draw(ctx, planA, planB, termName)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('生成图片失败')

  const filename = `cu-schedule-${slugTerm(termName)}.png`
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return filename
}
