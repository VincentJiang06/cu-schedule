import { subjectPaint, type CanvasPaint } from './color.ts'
import type { Plan } from './schedule.ts'
import { displayEndMinutes, hhmm } from './time.ts'

/** Resolve a block's canvas tint. Defaults to the subject-hash colors; App passes the
 * timetable-palette painter so exports carry exactly the on-screen timetable colors. */
export type PaintFn = (code: string, subject: string) => CanvasPaint
const defaultPaint: PaintFn = (_code, subject) => subjectPaint(subject)

/**
 * Hand-drawn PNG export of a single timetable (排法). No html2canvas or any
 * DOM-capture dependency — the layout of TimetableCompare's solo mode is replicated
 * onto a 2× canvas: a left time axis, one column per weekday, and course blocks
 * tinted with the light-theme subject colors (subjectPaint, since a canvas can't
 * read the CSS custom properties the live blocks use).
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

/** Greedy interval-graph coloring — overlapping blocks get side-by-side lanes.
 * Lane occupancy is tracked with the *displayed* (rounded-up) end time, matching
 * the rounding the renderer uses for block height — otherwise a lane can be marked
 * free the instant a block's true end passes, while the block is still drawn taller
 * than that (see time.ts's displayEndMinutes), letting the next block's rectangle
 * overlap it visually even though nothing actually clashes in real time. */
function layOutDay(blocks: Block[]): Laid[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end)
  const laneEnds: number[] = []
  const placed: Laid[] = sorted.map((block) => {
    const shownEnd = displayEndMinutes(block.end)
    let lane = laneEnds.findIndex((end) => end <= block.start)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = shownEnd
    return { ...block, lane, lanes: 1 }
  })
  return placed.map((block) => {
    const blockShownEnd = displayEndMinutes(block.end)
    const cluster = placed.filter(
      (other) => other.start < blockShownEnd && block.start < displayEndMinutes(other.end),
    )
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

function draw(ctx: CanvasRenderingContext2D, plan: Plan, termName: string, paint: PaintFn): void {
  const raw = blocksOf(plan)

  const usesWeekend = raw.some((block) => block.dayIndex > 5)
  const dayCount = usesWeekend ? 7 : 5
  const floorHour = Math.floor(Math.min(FLOOR, ...raw.map((block) => block.start)) / 60)
  // 用进位后的显示结束时间算下界，拉高的卡片不会溢出网格底部（与 TimetableCompare 一致）。
  const ceilHour = Math.ceil(Math.max(CEIL, ...raw.map((block) => displayEndMinutes(block.end))) / 60)
  const span = (ceilHour - floorHour) * 60

  const ink = '#1e2532'
  const faint = '#e6e8ee'
  const faintHalf = '#f0f1f5'
  const muted = '#8b93a4'

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // Title.
  ctx.fillStyle = ink
  ctx.font = '700 24px system-ui, -apple-system, "PingFang SC", sans-serif'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillText(`CU Schedule · ${termName} 课表`, 28, 44)

  const gridTop = 108
  const gridBottom = H - 40
  const gridLeft = 28 + 60
  const gridRight = W - 28
  const gridW = gridRight - gridLeft
  const gridH = gridBottom - gridTop
  const colW = gridW / dayCount
  const yOf = (minutes: number) => gridTop + ((minutes - floorHour * 60) / span) * gridH

  // Hour + half-hour rules（半点线更浅），与网格线同一套 floor/ceil 换算——课块的
  // top/height 也用同一个 yOf，保证课块边缘总能落在某条线上。
  ctx.font = '12px system-ui, -apple-system, sans-serif'
  for (let tick = floorHour * 60; tick <= ceilHour * 60; tick += 30) {
    const isHour = tick % 60 === 0
    const y = yOf(tick)
    ctx.strokeStyle = isHour ? faint : faintHalf
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(gridLeft, y)
    ctx.lineTo(gridRight, y)
    ctx.stroke()
    if (isHour) {
      ctx.fillStyle = muted
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(hhmm(tick), gridLeft - 8, y)
    }
  }

  // Day headers + column separators.
  for (let day = 0; day < dayCount; day += 1) {
    const x = gridLeft + day * colW
    ctx.strokeStyle = faint
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, gridTop)
    ctx.lineTo(x, gridBottom)
    ctx.stroke()

    ctx.fillStyle = ink
    ctx.font = '600 15px system-ui, -apple-system, "PingFang SC", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(DAYS[day], x + colW / 2, gridTop - 14)
  }
  ctx.strokeStyle = faint
  ctx.beginPath()
  ctx.moveTo(gridRight, gridTop)
  ctx.lineTo(gridRight, gridBottom)
  ctx.stroke()

  // Course blocks — one column per weekday (single plan, no A/B split).
  const drawColumn = (blocks: Block[], baseX: number) => {
    for (const block of layOutDay(blocks)) {
      const laneW = colW / block.lanes
      const x = baseX + block.lane * laneW + 3
      const y = yOf(block.start) + 1
      const w = laneW - 6
      // 显示用结束时间进位到下一个半点，与屏幕上的大课表卡片高度一致。
      const shownEnd = displayEndMinutes(block.end)
      const h = yOf(shownEnd) - yOf(block.start) - 2
      if (h <= 0 || w <= 0) continue
      const tint = paint(block.code, block.subject)

      roundRect(ctx, x, y, w, h, 5)
      ctx.fillStyle = tint.fill
      ctx.fill()
      ctx.strokeStyle = tint.edge
      ctx.lineWidth = 1
      ctx.stroke()
      // left accent bar
      ctx.fillStyle = tint.text
      ctx.fillRect(x, y, 3, h)

      ctx.save()
      roundRect(ctx, x, y, w, h, 5)
      ctx.clip()
      ctx.fillStyle = tint.text
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      const tx = x + 9
      let ty = y + 17
      ctx.font = '700 13px system-ui, -apple-system, sans-serif'
      ctx.fillText(block.code, tx, ty)
      if (h > 30) {
        ty += 16
        ctx.font = '11px system-ui, -apple-system, sans-serif'
        ctx.fillText(`${hhmm(block.start)}–${hhmm(shownEnd)}`, tx, ty)
      }
      if (h > 50) {
        ty += 15
        const meta = block.location ? `${block.component} · ${block.location}` : block.component
        ctx.fillText(meta, tx, ty)
      }
      ctx.restore()
    }
  }

  for (let day = 1; day <= dayCount; day += 1) {
    drawColumn(raw.filter((block) => block.dayIndex === day), gridLeft + (day - 1) * colW)
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

export function slugTerm(name: string): string {
  return name.replace(/[^\w一-龥-]+/g, '-').replace(/^-+|-+$/g, '') || 'term'
}

/** Push a blob to the browser as a file download. Shared by every exporter. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** Draw one timetable onto a fresh 2× canvas (shared by PNG and PDF exports). */
function renderTimetable(plan: Plan, termName: string, paint: PaintFn): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.scale(SCALE, SCALE)
  draw(ctx, plan, termName, paint)
  return canvas
}

/** Render the timetable to a 2× PNG, trigger a download, and return the file name. */
export async function exportImage(
  plan: Plan,
  termName: string,
  paint: PaintFn = defaultPaint,
): Promise<string> {
  const canvas = renderTimetable(plan, termName, paint)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('生成图片失败')
  const filename = `cu-schedule-${slugTerm(termName)}.png`
  downloadBlob(blob, filename)
  return filename
}

/**
 * Export the same timetable as a single-page PDF. No PDF library: the canvas is
 * encoded to a JPEG and embedded directly as a `/DCTDecode` image XObject in a minimal,
 * hand-assembled PDF — the standard dependency-free trick. The page is A4 landscape,
 * with the image scaled to fit its aspect ratio.
 */
export async function exportPdf(
  plan: Plan,
  termName: string,
  paint: PaintFn = defaultPaint,
): Promise<string> {
  const canvas = renderTimetable(plan, termName, paint)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
  const jpeg = base64ToBytes(dataUrl.slice(dataUrl.indexOf(',') + 1))

  // Page: fit the image into A4 landscape width (842pt), height follows the aspect.
  const pageW = 842
  const pageH = Math.round((pageW * canvas.height) / canvas.width)
  const blob = buildImagePdf(jpeg, canvas.width, canvas.height, pageW, pageH)
  const filename = `cu-schedule-${slugTerm(termName)}.pdf`
  downloadBlob(blob, filename)
  return filename
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const encoder = new TextEncoder()

/** Assemble a one-page PDF whose only content is a full-page JPEG (DCTDecode) image. */
function buildImagePdf(
  jpeg: Uint8Array,
  imgW: number,
  imgH: number,
  pageW: number,
  pageH: number,
): Blob {
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part
    chunks.push(bytes)
    length += bytes.length
  }
  // Record the byte offset of an object as it is written (for the xref table).
  const mark = () => offsets.push(length)

  push('%PDF-1.3\n')
  mark() // obj 1
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  mark() // obj 2
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
  mark() // obj 3
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  )
  mark() // obj 4 (image)
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  )
  push(jpeg)
  push('\nendstream\nendobj\n')
  // Content stream: place the image to fill the whole page.
  const content = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`
  mark() // obj 5
  push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`)

  const xrefStart = length
  const pad = (n: number) => n.toString().padStart(10, '0')
  let xref = `xref\n0 6\n0000000000 65535 f \n`
  for (const offset of offsets) xref += `${pad(offset)} 00000 n \n`
  push(xref)
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`)

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}
