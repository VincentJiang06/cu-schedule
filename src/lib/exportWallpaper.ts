import { subjectPaint } from './color.ts'
import type { Plan } from './schedule.ts'
import { downloadBlob, slugTerm, type PaintFn } from './exportImage.ts'
import { displayEndMinutes, hhmm } from './time.ts'

/**
 * Phone-wallpaper export. Two portrait PNGs at the iPhone 17 Pro screen ratio
 * (1206 × 2622): one is the plain indigo background, the other adds the current
 * timetable in the lower two-thirds. The top ~36% is deliberately left empty so the
 * schedule never collides with the iOS clock / status area.
 *
 * The background echoes the app icon: a deep indigo (#1E1B4B) gradient with a faint
 * grid. Course blocks use the same per-subject light tints as the on-screen timetable
 * (subjectPaint), which read clearly against the dark ground.
 */

const W = 1206
const H = 2622
const DAYS = ['一', '二', '三', '四', '五', '六', '日']

// The schedule panel lives below this fraction of the height (top band = clock zone).
const PANEL_TOP_FRAC = 0.36

const FLOOR = 8 * 60
const CEIL = 19 * 60

type Block = {
  code: string
  subject: string
  component: string
  dayIndex: number
  start: number
  end: number
  lane: number
  lanes: number
}

function blocksOf(plan: Plan | null): Omit<Block, 'lane' | 'lanes'>[] {
  return (plan?.entries ?? []).flatMap((entry) =>
    entry.section.meetings.map((meeting) => ({
      code: entry.course.code,
      subject: entry.course.subject,
      component: entry.section.component,
      dayIndex: meeting.dayIndex,
      start: meeting.start,
      end: meeting.end,
    })),
  )
}

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

/** Paint the indigo wallpaper ground (gradient + faint grid) — shared by both outputs. */
function paintBackground(ctx: CanvasRenderingContext2D): void {
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#26224f')
  grad.addColorStop(0.5, '#1e1b4b')
  grad.addColorStop(1, '#121030')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // Faint grid, echoing the app icon.
  ctx.strokeStyle = 'rgba(129, 140, 248, 0.10)'
  ctx.lineWidth = 1
  const step = 90
  for (let x = step; x < W; x += step) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, H)
    ctx.stroke()
  }
  for (let y = step; y < H; y += step) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
  }

  // Soft glow low-center so the schedule panel sits on a subtle highlight.
  const glow = ctx.createRadialGradient(W / 2, H * 0.7, 60, W / 2, H * 0.7, W)
  glow.addColorStop(0, 'rgba(99, 102, 241, 0.18)')
  glow.addColorStop(1, 'rgba(99, 102, 241, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)
}

/** Draw the timetable (plan A) into the lower panel. */
function paintSchedule(
  ctx: CanvasRenderingContext2D,
  plan: Plan,
  termName: string,
  paint: PaintFn,
): void {
  const raw = blocksOf(plan)
  const usesWeekend = raw.some((block) => block.dayIndex > 5)
  const dayCount = usesWeekend ? 7 : 5

  const margin = 54
  const panelTop = H * PANEL_TOP_FRAC
  const panelBottom = H - 150

  // Header label above the grid.
  ctx.fillStyle = '#eef2ff'
  ctx.font = '700 52px system-ui, -apple-system, "PingFang SC", sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('CU Schedule', margin, panelTop - 70)
  ctx.fillStyle = 'rgba(199, 210, 254, 0.85)'
  ctx.font = '400 32px system-ui, -apple-system, "PingFang SC", sans-serif'
  ctx.fillText(termName || '本学期课表', margin, panelTop - 28)

  const gridLeft = margin + 58
  const gridRight = W - margin
  const gridTop = panelTop + 44
  const gridBottom = panelBottom
  const gridW = gridRight - gridLeft
  const gridH = gridBottom - gridTop
  const colW = gridW / dayCount

  const floorHour = Math.floor(Math.min(FLOOR, ...raw.map((b) => b.start)) / 60)
  const ceilHour = Math.ceil(Math.max(CEIL, ...raw.map((b) => displayEndMinutes(b.end))) / 60)
  const span = (ceilHour - floorHour) * 60
  const yOf = (minutes: number) => gridTop + ((minutes - floorHour * 60) / span) * gridH

  // Hour rules + axis labels.
  ctx.font = '400 24px system-ui, -apple-system, monospace'
  for (let hour = floorHour; hour <= ceilHour; hour += 1) {
    const y = yOf(hour * 60)
    ctx.strokeStyle = 'rgba(165, 180, 252, 0.16)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(gridLeft, y)
    ctx.lineTo(gridRight, y)
    ctx.stroke()
    ctx.fillStyle = 'rgba(199, 210, 254, 0.65)'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(hhmm(hour * 60), gridLeft - 12, y)
  }

  // Day headers + column separators.
  for (let day = 0; day < dayCount; day += 1) {
    const x = gridLeft + day * colW
    ctx.strokeStyle = 'rgba(165, 180, 252, 0.16)'
    ctx.beginPath()
    ctx.moveTo(x, gridTop)
    ctx.lineTo(x, gridBottom)
    ctx.stroke()
    ctx.fillStyle = '#e0e7ff'
    ctx.font = '700 30px system-ui, -apple-system, "PingFang SC", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(DAYS[day], x + colW / 2, gridTop - 14)
  }
  ctx.strokeStyle = 'rgba(165, 180, 252, 0.16)'
  ctx.beginPath()
  ctx.moveTo(gridRight, gridTop)
  ctx.lineTo(gridRight, gridBottom)
  ctx.stroke()

  // Course blocks.
  for (let day = 1; day <= dayCount; day += 1) {
    const baseX = gridLeft + (day - 1) * colW
    const laid = layOutDay(raw.filter((block) => block.dayIndex === day))
    for (const block of laid) {
      const laneW = (colW - 6) / block.lanes
      const x = baseX + 3 + block.lane * laneW + 2
      const shownEnd = displayEndMinutes(block.end)
      const y = yOf(block.start) + 2
      const w = laneW - 4
      const h = yOf(shownEnd) - yOf(block.start) - 4
      if (h <= 0 || w <= 0) continue
      const tint = paint(block.code, block.subject)

      roundRect(ctx, x, y, w, h, 10)
      ctx.fillStyle = tint.fill
      ctx.fill()
      ctx.fillStyle = tint.text
      ctx.fillRect(x, y, 5, h)

      ctx.save()
      roundRect(ctx, x, y, w, h, 10)
      ctx.clip()
      ctx.fillStyle = tint.text
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      const tx = x + 14
      let ty = y + 32
      ctx.font = '700 25px system-ui, -apple-system, sans-serif'
      ctx.fillText(block.code, tx, ty)
      if (h > 66) {
        ty += 28
        ctx.font = '400 22px system-ui, -apple-system, monospace'
        ctx.fillText(`${hhmm(block.start)}–${hhmm(shownEnd)}`, tx, ty)
      }
      ctx.restore()
    }
  }

  // Footer note.
  ctx.fillStyle = 'rgba(165, 180, 252, 0.55)'
  ctx.font = '400 22px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('数据来自 CUHK 公开课程目录 · 名额以 CUSIS 为准', W / 2, H - 90)
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('生成壁纸失败')
  return blob
}

function freshCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  return { canvas, ctx }
}

/**
 * Produce two wallpapers and download both: the plain indigo background, and the same
 * background with the timetable in the lower panel. Returns a short summary note.
 */
export async function exportWallpaper(
  plan: Plan,
  termName: string,
  paint: PaintFn = (_code, subject) => subjectPaint(subject),
): Promise<string> {
  const slug = slugTerm(termName)

  // 1) Plain background.
  const plain = freshCanvas()
  paintBackground(plain.ctx)
  downloadBlob(await canvasToPng(plain.canvas), `cu-schedule-壁纸-背景.png`)

  // 2) Background + schedule.
  const withSchedule = freshCanvas()
  paintBackground(withSchedule.ctx)
  paintSchedule(withSchedule.ctx, plan, termName, paint)
  downloadBlob(await canvasToPng(withSchedule.canvas), `cu-schedule-壁纸-${slug}.png`)

  return '已下载两张壁纸（纯背景 + 带课表），iPhone 比例 1206×2622'
}
