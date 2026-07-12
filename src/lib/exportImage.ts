import { abbreviateLocation } from './buildingAbbrev.ts'
import { activeTheme, subjectPaint, type CanvasPaint, type PaintTheme } from './color.ts'
import type { Plan } from './schedule.ts'
import { displayEndMinutes, hhmm } from './time.ts'

/** Resolve a block's canvas tint. Defaults to the subject-hash colors; App passes the
 * timetable-palette painter so exports carry exactly the on-screen timetable colors.
 * #里程碑2:theme 是可选的第三参——PDF 一次导出明暗两页，同一个 paint 函数要能按页
 * 主题解出对应色阶(不传 = 'light'，向后兼容旧调用点)。 */
export type PaintFn = (code: string, subject: string, theme?: PaintTheme) => CanvasPaint
const defaultPaint: PaintFn = (_code, subject, theme) => subjectPaint(subject, theme)

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
// PDF pages stay fixed at this size; PNG exports pick their own board size from the
// user's chosen aspect ratio (see canvasSize below, #里程碑4).
const BOARD_W = 1600
const BOARD_H = 1000

/** A width:height ratio, e.g. {w:16,h:9}. Only the ratio matters — canvasSize() below
 * turns it into concrete pixel dimensions. */
export type Aspect = { w: number; h: number }

/**
 * #里程碑4:图片 PNG 导出前先选画面比例(1:1/9:16/16:9/4:3/3:4/自定义)。Turns an
 * aspect ratio into concrete canvas pixels, keeping the total pixel budget roughly
 * constant across ratios (same area as the original fixed 1600×1000 board) so a 1:1
 * export isn't tiny and a 9:16 export isn't a giant file.
 */
export function canvasSize(aspect: Aspect): { W: number; H: number } {
  const ratio = Math.min(6, Math.max(1 / 6, aspect.w / Math.max(1, aspect.h)))
  const area = BOARD_W * BOARD_H
  const boardW = Math.round(Math.sqrt(area * ratio))
  const boardH = Math.round(area / boardW)
  return { W: boardW, H: boardH }
}

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

// #TUT/LAB 等非 LEC 课块在导出物里只保留更淡的底色区分——边框、文字粗细、左侧竖条都
// 和 LEC 完全一样，不再额外加粗体/下划线/虚线边（那批视觉噪音已撤销）。
const ALT_FILL_ALPHA = 0.38

// #里程碑1(圆角更明显):课块圆角从 5 调大到 9，与屏幕上加大后的 .tt__block/.tt2__block
// (12px/10px)观感一致（画布坐标系与 CSS px 不是同一把尺子，按块本身的典型高宽比目测对齐）。
const BLOCK_RADIUS = 9

// #里程碑2:课号是等宽字体，与屏幕 .tt__block-code/.tt2__block-code 的 var(--mono) 一致，
// 让导出图和屏幕上的课号字体保持所见即所得。
const MONO_STACK = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'

// #容器查询方法论对齐导出:导出画布的课块按*块自己的实际像素宽高*选档,与屏幕上课表
// 同一套方法论(见 Timetable.tsx/TimetableCompare.tsx + styles.css 的 @container blk)——
// 不再固定画两行。宽档:课号+地点同一行大字、第2行时间；窄档:课号/简写地点/时间三行
// 堆叠、更窄时时间再拆两行；矮块降级(不论宽窄):只画课号+时间，收起地点。
// 宽档字号(课号最大最醒目，地点次之，时间与地点相近)。
const BLOCK_CODE_SIZE = 26
const BLOCK_LOC_SIZE = 22
const BLOCK_TIME_SIZE = 20
// 窄档/矮块降级共用的紧凑字号——矮块不论宽窄都用这一档小字（教训与屏幕版一致：宽档的大
// 字号在矮块的两行预算里放不下，矮块降级必须统一摁回小字号，而不是继承宽档大字号）。
const BLOCK_CODE_SIZE_SM = 20
const BLOCK_LOC_SIZE_SM = 17
const BLOCK_TIME_SIZE_SM = 16

// 两档判定阈值(画布坐标——与屏幕 CSS px 不是同一把尺子；导出字号本来就比屏幕大出
// 一截，阈值按同样比例放大过)。
const EXPORT_WIDE_MIN = 230 // 宽档:课号+地点横排大字
const EXPORT_TIME_SPLIT_MAX = 140 // 窄档再窄一档:时间从一行拆成两行
const EXPORT_SHORT_MAX_H = 80 // 矮块降级:收起地点，只留课号+时间

/** Alpha-blend a solid `hsl(...)` paint color toward whatever is already painted behind
 * it — a `<canvas>` has no `color-mix()`, but painting a translucent fill over an
 * opaque backdrop composites to the same visual result. Every call site here draws
 * over a cell that was already flat-filled with the page background, so this mirrors
 * styles.css's `color-mix(in srgb, hsl(...) 55%, var(--surface))` / `hsl(...) / 0.6`
 * treatment without needing a full HSL↔RGB mixer. Falls back to the input unchanged if
 * it isn't a bare `hsl(...)` string (defensive — every current PaintFn returns one).
 */
function withAlpha(color: string, alpha: number): string {
  return color.endsWith(')') ? `${color.slice(0, -1)} / ${alpha})` : color
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

/** #容器查询方法论对齐导出:按课块*实际像素宽高*(w/h,调用方已经算好、已经是 lane 分道
 * 后的真实宽高)选档画文字，与屏幕课表同一套两档+矮块降级方法论——canvas 没有 CSS 的
 * 自动换行/省略号，这里手动用 ctx.measureText 量出文字宽度决定排法；调用方已经把这段
 * 绘制包在 ctx.clip() 到圆角矩形范围内，量算稍有出入也只会被裁掉，不会真的溢出到相邻
 * 课块上。
 * - 宽档(w ≥ EXPORT_WIDE_MIN)：第1行「课号 + 地点」横排大字——地点优先用全称，量出来
 *   放不下就退到简写，简写也放不下就只画课号；第2行时间整串。
 * - 窄档(w < EXPORT_WIDE_MIN)：课号 / 简写地点 / 时间三行堆叠；块还窄到
 *   < EXPORT_TIME_SPLIT_MAX 时时间从一行拆成两行。
 * - 矮块降级(h < EXPORT_SHORT_MAX_H)：不论宽窄，只画课号+时间两行，收起地点行，字号
 *   统一摁回窄档同一档的紧凑值(宽档大字号在矮块的高度预算里放不下)。
 */
function drawBlockText(
  ctx: CanvasRenderingContext2D,
  block: { code: string; component: string; location: string; start: number; end: number },
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const tx = x + 9
  const avail = x + w - tx - 6 // 右边留 6px 缓冲，量算某段文字是否放得下时用
  const isWide = w >= EXPORT_WIDE_MIN
  const isShort = h < EXPORT_SHORT_MAX_H
  const big = isWide && !isShort
  const codeSize = big ? BLOCK_CODE_SIZE : BLOCK_CODE_SIZE_SM
  const locSize = big ? BLOCK_LOC_SIZE : BLOCK_LOC_SIZE_SM
  const timeSize = big ? BLOCK_TIME_SIZE : BLOCK_TIME_SIZE_SM
  const lineGap = big ? 27 : 20
  const firstBaseline = big ? y + 30 : y + 23
  const monoFont = (size: number) => `700 ${size}px ${MONO_STACK}`
  const locFont = (size: number) => `600 ${size}px system-ui, -apple-system, sans-serif`
  const timeFont = (size: number) => `${size}px system-ui, -apple-system, sans-serif`

  ctx.font = monoFont(codeSize)
  ctx.fillText(block.code, tx, firstBaseline)

  if (isShort) {
    // 矮块降级:不论宽窄，只画课号+时间——短课(45 分钟，进位显示后 60 分钟高)在多道
    // 并排时最容易撞到这一档，与屏幕版矮块降级同一个判定精神。
    ctx.font = timeFont(timeSize)
    ctx.fillText(`${block.component} ${hhmm(block.start)}–${hhmm(block.end)}`, tx, firstBaseline + lineGap)
    return
  }

  if (isWide) {
    // 宽档:课号 + 地点同一行大字。
    if (block.location) {
      const codeW = ctx.measureText(block.code).width
      const full = ` ${block.location}`
      const abbr = ` ${abbreviateLocation(block.location)}`
      ctx.font = locFont(locSize)
      let locText = full
      if (codeW + ctx.measureText(full).width > avail) {
        locText = abbr
        if (codeW + ctx.measureText(abbr).width > avail) locText = ''
      }
      if (locText) ctx.fillText(locText, tx + codeW, firstBaseline)
    }
    ctx.font = timeFont(timeSize)
    ctx.fillText(`${block.component} ${hhmm(block.start)}–${hhmm(block.end)}`, tx, firstBaseline + lineGap)
    return
  }

  // 窄档:课号 / 简写地点 / 时间三行堆叠；块本身太窄时时间从一行拆成两行。
  let ty = firstBaseline
  if (block.location) {
    ty += lineGap
    ctx.font = locFont(locSize)
    ctx.fillText(abbreviateLocation(block.location), tx, ty)
  }
  ty += lineGap
  ctx.font = timeFont(timeSize)
  if (w < EXPORT_TIME_SPLIT_MAX) {
    ctx.fillText(`${block.component} ${hhmm(block.start)}`, tx, ty)
    ctx.fillText(`–${hhmm(block.end)}`, tx, ty + lineGap * 0.85)
  } else {
    ctx.fillText(`${block.component} ${hhmm(block.start)}–${hhmm(block.end)}`, tx, ty)
  }
}

/** #里程碑2:PDF 一次导出明暗两页，页面底色/线条/文字都要按主题切换——这里镜像
 * styles.css 的 --bg/--surface/--line/--line-soft/--ink/--ink-3 浅色与深色取值，让画布页
 * 和屏幕上的对应主题读起来一致。#里程碑4:补上 mid 档——mid 的 --surface/--ink 与 light
 * 相同，只有 --line/--line-soft 更深一档，所以 mid 复用 light 的 page/ink/muted，只有
 * faint/faintHalf(网格线)跟着 mid 的 --line 走。 */
function themeInk(theme: PaintTheme): { page: string; ink: string; faint: string; faintHalf: string; muted: string } {
  if (theme === 'dark') return { page: '#35373e', ink: '#f0f1f4', faint: '#4b4e57', faintHalf: '#3f424a', muted: '#a1a7b2' }
  if (theme === 'mid') return { page: '#ffffff', ink: '#1e2532', faint: '#c5c8cf', faintHalf: '#d7d9df', muted: '#575c67' }
  return { page: '#ffffff', ink: '#1e2532', faint: '#e6e8ee', faintHalf: '#f0f1f5', muted: '#5c616c' }
}

/** #里程碑4:board size 是参数而不是模块常量——PNG 按选中的画面比例算出自己的
 * W/H(canvasSize),PDF 仍固定传 1600×1000。参数名故意仍叫 W/H,函数体内其余代码
 * 不用改。 */
function draw(
  ctx: CanvasRenderingContext2D,
  plan: Plan,
  termName: string,
  paint: PaintFn,
  theme: PaintTheme = 'light',
  W: number = BOARD_W,
  H: number = BOARD_H,
): void {
  const raw = blocksOf(plan)

  const usesWeekend = raw.some((block) => block.dayIndex > 5)
  const dayCount = usesWeekend ? 7 : 5
  const floorHour = Math.floor(Math.min(FLOOR, ...raw.map((block) => block.start)) / 60)
  // 用进位后的显示结束时间算下界，拉高的卡片不会溢出网格底部（与 TimetableCompare 一致）。
  const ceilHour = Math.ceil(Math.max(CEIL, ...raw.map((block) => displayEndMinutes(block.end))) / 60)
  const span = (ceilHour - floorHour) * 60

  const { page, ink, faint, faintHalf, muted } = themeInk(theme)

  ctx.fillStyle = page
  ctx.fillRect(0, 0, W, H)

  // Title.
  ctx.fillStyle = ink
  ctx.font = '700 26px system-ui, -apple-system, "PingFang SC", sans-serif'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillText(`CU Schedule · ${termName} 课表`, 28, 44)

  const gridTop = 108
  const gridBottom = H - 48
  const gridLeft = 28 + 60
  const gridRight = W - 28
  const gridW = gridRight - gridLeft
  const gridH = gridBottom - gridTop
  const colW = gridW / dayCount
  const yOf = (minutes: number) => gridTop + ((minutes - floorHour * 60) / span) * gridH

  // Hour + half-hour rules（半点线更浅），与网格线同一套 floor/ceil 换算——课块的
  // top/height 也用同一个 yOf，保证课块边缘总能落在某条线上。
  ctx.font = '13px system-ui, -apple-system, sans-serif'
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
    ctx.font = '700 17px system-ui, -apple-system, "PingFang SC", sans-serif'
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
  // #里程碑2:课号/时间/地点字号整体加大，让打印出来的 PDF 更清晰易读。
  // #里程碑(两行排版):现在统一只画两行，字号在此基础上再放大一档（见 BLOCK_*_SIZE）。
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
      const tint = paint(block.code, block.subject, theme)
      // #里程碑3:TUT/LAB 等非 LEC 课块只保留更淡的 fill——边框/左侧竖条/文字粗细都和
      // LEC 完全一样，不再靠加粗/下划线/虚线边额外拉开差异。
      const isLec = block.component === 'LEC'

      roundRect(ctx, x, y, w, h, BLOCK_RADIUS)
      ctx.fillStyle = isLec ? tint.fill : withAlpha(tint.fill, ALT_FILL_ALPHA)
      ctx.fill()
      ctx.strokeStyle = tint.edge
      ctx.lineWidth = 1
      ctx.stroke()

      // left accent bar — solid，LEC 与非 LEC 画法一致。
      ctx.fillStyle = tint.text
      ctx.fillRect(x, y, 3, h)

      ctx.save()
      roundRect(ctx, x, y, w, h, BLOCK_RADIUS)
      ctx.clip()
      ctx.fillStyle = tint.text
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      // #容器查询方法论对齐导出:按这个块的实际 w/h 选档画文字(宽档课号+地点横排大字/
      // 窄档三行堆叠/矮块降级只留课号+时间)，见 drawBlockText 顶部注释。
      drawBlockText(ctx, block, x, y, w, h)
      ctx.restore()
    }
  }

  for (let day = 1; day <= dayCount; day += 1) {
    drawColumn(raw.filter((block) => block.dayIndex === day), gridLeft + (day - 1) * colW)
  }

  // 角标署名:只保留「CUS by VinceJiang」(数据来源归属留在仓库 NOTICE.md,不再印在导出物上)。
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = ink
  ctx.font = '700 13px system-ui, -apple-system, sans-serif'
  ctx.fillText('CUS by VinceJiang', gridRight, H - 16)
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
function renderTimetable(
  plan: Plan,
  termName: string,
  paint: PaintFn,
  theme: PaintTheme = 'light',
  boardW: number = BOARD_W,
  boardH: number = BOARD_H,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = boardW * SCALE
  canvas.height = boardH * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.scale(SCALE, SCALE)
  draw(ctx, plan, termName, paint, theme, boardW, boardH)
  return canvas
}

/** Render the timetable to a 2× PNG at the chosen aspect ratio (defaults to the
 * original 8:5 board), trigger a download, and return the file name.
 * #里程碑4:aspect 由导出页的六个比例按钮(或自定义 w:h)决定;theme 不传时用
 * activeTheme() 读取用户当前正在看的主题(light/mid/dark)，导出图与屏幕所见即所得——
 * 不再像以前那样不管用户在哪个主题下都硬导 'light'。 */
export async function exportImage(
  plan: Plan,
  termName: string,
  paint: PaintFn = defaultPaint,
  aspect: Aspect = { w: 8, h: 5 },
  theme?: PaintTheme,
): Promise<string> {
  const { W, H } = canvasSize(aspect)
  const canvas = renderTimetable(plan, termName, paint, theme ?? activeTheme(), W, H)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('生成图片失败')
  const filename = `cu-schedule-${slugTerm(termName)}.png`
  downloadBlob(blob, filename)
  return filename
}

function canvasToJpegBytes(canvas: HTMLCanvasElement): Uint8Array {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
  return base64ToBytes(dataUrl.slice(dataUrl.indexOf(',') + 1))
}

/**
 * Export the same timetable as a two-page PDF. No PDF library: each page's canvas is
 * encoded to a JPEG and embedded directly as a `/DCTDecode` image XObject in a minimal,
 * hand-assembled PDF — the standard dependency-free trick. Both pages are A4 landscape,
 * image scaled to fit. #里程碑2:一次导出即含两页——第一页浅色主题、第二页深色主题，
 * 同一份课表两种配色各一页，不用分两次导出。
 */
export async function exportPdf(
  plan: Plan,
  termName: string,
  paint: PaintFn = defaultPaint,
): Promise<string> {
  const pageW = 842 // A4 landscape width, points.
  const pages = (['light', 'dark'] as const).map((theme) => {
    const canvas = renderTimetable(plan, termName, paint, theme)
    const jpeg = canvasToJpegBytes(canvas)
    const pageH = Math.round((pageW * canvas.height) / canvas.width)
    return { jpeg, imgW: canvas.width, imgH: canvas.height, pageW, pageH }
  })

  const blob = buildImagePdf(pages)
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

type PdfPage = { jpeg: Uint8Array; imgW: number; imgH: number; pageW: number; pageH: number }

/**
 * Assemble an N-page PDF whose every page's only content is a full-page JPEG
 * (DCTDecode) image — #里程碑2 把原来的单页版本泛化成多页：objects 1/2 are the
 * catalog and the shared Pages node; each page then contributes exactly 3 objects
 * (page / image / content stream), so object numbers are assigned up front and every
 * page object can reference its own image + content objects by number.
 */
function buildImagePdf(pages: PdfPage[]): Blob {
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

  // obj 1 = catalog, obj 2 = pages node, then 3 objects per page (page/image/content).
  const pageObjNum = (i: number) => 3 + i * 3
  const imgObjNum = (i: number) => 4 + i * 3
  const contentObjNum = (i: number) => 5 + i * 3
  const totalObjects = 2 + pages.length * 3

  push('%PDF-1.3\n')
  mark() // obj 1
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  mark() // obj 2
  const kids = pages.map((_, i) => `${pageObjNum(i)} 0 R`).join(' ')
  push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`)

  pages.forEach((page, i) => {
    mark() // page object
    push(
      `${pageObjNum(i)} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.pageW} ${page.pageH}] ` +
        `/Resources << /XObject << /Im0 ${imgObjNum(i)} 0 R >> >> /Contents ${contentObjNum(i)} 0 R >>\nendobj\n`,
    )
    mark() // image object
    push(
      `${imgObjNum(i)} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.imgW} /Height ${page.imgH} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    )
    push(page.jpeg)
    push('\nendstream\nendobj\n')
    // Content stream: place the image to fill the whole page.
    const content = `q\n${page.pageW} 0 0 ${page.pageH} 0 0 cm\n/Im0 Do\nQ\n`
    mark() // content object
    push(`${contentObjNum(i)} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`)
  })

  const xrefStart = length
  const pad = (n: number) => n.toString().padStart(10, '0')
  let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) xref += `${pad(offset)} 00000 n \n`
  push(xref)
  push(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`)

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}
