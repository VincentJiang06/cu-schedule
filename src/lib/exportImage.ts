import { abbreviateLocation } from './buildingAbbrev.ts'
import { activeTheme, subjectPaint, type CanvasPaint, type PaintTheme } from './color.ts'
import { t } from '../i18n/index.ts'
import type { Plan } from './schedule.ts'
import { displayEndMinutes, durationTag, hhmm } from './time.ts'

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

// 课块文字全部等宽字体(用户拍板 2026-07-14 v4):指定 Red Hat Mono(Google Fonts,
// index.html 挂载 400/700 两档),Menlo/Consolas 仅作字体加载失败时的兜底——课号/
// 地点/组件/时间一律用它;字号按字符预算一次算死(见 blockFontSize),不做自适应。
const MONO_STACK = '"Red Hat Mono", Menlo, Consolas, monospace'

// 字重阶梯(用户拍板 2026-07-14 v5,按行):课号 700 / 地点 600 / 组件 600 / 时间 500。
const WEIGHT_CODE = 700
const WEIGHT_LOC = 600
const WEIGHT_COMP = 600
const WEIGHT_TIME = 500

/** canvas 的 fillText 不会等 webfont——绘制前把 Red Hat Mono 用到的字重显式 load 完。
 * 屏上预览允许 swap 兜底(styles.css font-display: swap),但**导出绝不允许兜底**
 * (用户拍板 2026-07-15):字体已自托管同源(styles.css @font-face,可变字体单文件),
 * load 后仍不可用只会是极早期竞态——小睡重试一次,再不行直接报错中止导出,绝不让
 * 兜底字体混进导出物(兜底 mono 无 500/600 档,字重阶梯会塌)。 */
async function ensureExportFonts(): Promise<void> {
  const specs = [WEIGHT_CODE, WEIGHT_LOC, WEIGHT_TIME].map((weight) => `${weight} 16px "Red Hat Mono"`)
  const ready = () => specs.every((spec) => document.fonts.check(spec))
  await Promise.all(specs.map((spec) => document.fonts.load(spec)))
  if (!ready()) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    await Promise.all(specs.map((spec) => document.fonts.load(spec)))
    if (!ready()) throw new Error(t('导出字体尚未就绪，请稍后重试'))
  }
}

// #导出课块统一排版(用户拍板 2026-07-14,v4 分横竖两种固定模式,对所有导出格式强约束):
// 共同约束:一个课块内所有文字同一字号且整张图一个字号(硬编码,不做逐块自适应);
// 字重阶梯 课号 700 / 地点 600 / 组件 600 / 时间 500(见 WEIGHT_*);字体全部等宽
// (Red Hat Mono);地点恒用简写(abbreviateLocation,不出现全称)。
// - 横屏(W ≥ H,含 PDF):与导出 HTML 同一套两行渲染——恰好两行,一行文字对齐一格
//   30 分钟网格行;字号 =「一列宽放满 17 个等宽字符」(课号 8 + 空格 + 楼宇简写 3 +
//   空格 + 房间号 ≤4 = 17;第 2 行 组件 3 + 空格 + 时间 11 = 15 < 17),按行高封顶。
// - 竖屏(H > W):从头另排——行距 = 半格(15 分钟),最短课块(显示 60 分钟 = 两格)
//   恰好四行:课号 / 地点简写 / 组件 / 「开始时间+时长标记」(无空格,用户拍板);
//   时长标记 4 字符(+45m/+1hr/+2hr/+3hr,>1hr 记 2hr、>2hr 一律 3hr),时间行
//   5+4 = 9 字符 = 竖屏字符预算(课号/地点 ≤8 更短)。
// 等宽字符实宽用 measureText 实测(不猜字宽比)。
const LINE_CHAR_BUDGET_LANDSCAPE = 17
const LINE_CHAR_BUDGET_PORTRAIT = 9

/** 整张导出图共用的课块字号:一列宽(单道课块的文字可用宽)放满 budget 个等宽字符,
 * 再按行距封顶防纵向溢出。 */
function blockFontSize(ctx: CanvasRenderingContext2D, colW: number, linePitch: number, budget: number): number {
  ctx.font = `700 100px ${MONO_STACK}`
  const charW = ctx.measureText('0').width / 100 // 每字符宽 / 字号 比(等宽字体恒定)
  const textAvail = colW - 6 - 15 // 块宽 = colW-6(左右各 3px 间隙);文字左缩进 9 + 右缓冲 6
  const fitByCol = textAvail / (budget * charW)
  return Math.max(8, Math.floor(Math.min(fitByCol, linePitch * 0.75)))
}

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

/** #导出课块统一排版(见 LINE_CHAR_BUDGET 上方的四条强约束):字号由 blockFontSize
 * 整图算死后传入,本函数只排内容、不再调字号;canvas 没有 CSS 的自动换行/省略号,
 * 这里用 ctx.measureText 量宽决定内容降级;调用方已把这段绘制 clip 到圆角矩形内,
 * 量算稍有出入也只会被裁掉,不会溢出到相邻课块。字体全部等宽。
 * - 第 1 行「课号 700 + 简写地点 600」;并道窄块放不下地点时收起地点。
 * - 第 2 行「组件 600 + 时间 500」;放不下先丢组件前缀。
 * - 两行各自垂直居中于块内第 1/第 2 格 30 分钟行(行高 rowH),块不足两行高(仅出现在
 *   非整半点开始的 45 分钟课)时降级为单行「课号 + 时间」居中。
 */
function drawBlockText(
  ctx: CanvasRenderingContext2D,
  block: { code: string; component: string; location: string; start: number; end: number },
  x: number,
  y: number,
  w: number,
  h: number,
  rowH: number,
  size: number,
): void {
  const tx = x + 9
  const avail = x + w - tx - 6 // 右边留 6px 缓冲，量算某段文字是否放得下时用
  const timeText = `${hhmm(block.start)}–${hhmm(block.end)}`
  const fontCode = `${WEIGHT_CODE} ${size}px ${MONO_STACK}`
  const fontLoc = `${WEIGHT_LOC} ${size}px ${MONO_STACK}`
  const fontComp = `${WEIGHT_COMP} ${size}px ${MONO_STACK}`
  const fontTime = `${WEIGHT_TIME} ${size}px ${MONO_STACK}`
  ctx.textBaseline = 'middle'

  if (h < rowH * 1.8) {
    // 矮块降级:单行「课号 + 时间」在块内垂直居中。
    const cy = y + h / 2
    ctx.font = fontCode
    ctx.fillText(block.code, tx, cy)
    const codeW = ctx.measureText(block.code).width
    ctx.font = fontTime
    if (codeW + ctx.measureText(` ${timeText}`).width <= avail) {
      ctx.fillText(` ${timeText}`, tx + codeW, cy)
    }
    return
  }

  const line1Y = y + rowH * 0.5
  // 第 2 行在"第 2 格行心"基础上向上收 0.12 格——两行贴得更近(用户拍板 2026-07-15
  // "两行之间的距离缩短一点点"),行↔格的对应关系不变。
  const line2Y = y + rowH * 1.38

  ctx.font = fontCode
  ctx.fillText(block.code, tx, line1Y)
  if (block.location) {
    const codeW = ctx.measureText(block.code).width
    const abbr = ` ${abbreviateLocation(block.location)}`
    ctx.font = fontLoc
    if (codeW + ctx.measureText(abbr).width <= avail) ctx.fillText(abbr, tx + codeW, line1Y)
  }

  ctx.font = fontComp
  const compText = `${block.component} `
  const compW = ctx.measureText(compText).width
  ctx.font = fontTime
  if (compW + ctx.measureText(timeText).width <= avail) {
    ctx.font = fontComp
    ctx.fillText(compText, tx, line2Y)
    ctx.font = fontTime
    ctx.fillText(timeText, tx + compW, line2Y)
  } else if (ctx.measureText(timeText).width <= avail) {
    ctx.fillText(timeText, tx, line2Y)
  } else {
    // 并道窄块连整串时间也放不下:画「起始时间–」,不硬裁半个字符(结束时间由块的
    // 高度本身表达)。
    ctx.fillText(`${hhmm(block.start)}–`, tx, line2Y)
  }
}

/** 竖屏四行渲染(见 LINE_CHAR_BUDGET_PORTRAIT 上方说明):行距 = 半格 15 分钟,最短
 * 课块(显示 60 分钟)恰好四行——课号 700 / 地点简写 600 / 组件 600 / 「开始+时长」500
 * (时间与 + 号间无空格,用户拍板)。块高不足四行时按优先级取行:3 行 = 课号/地点/
 * 时间,2 行 = 课号/时间,1 行 = 课号。 */
function drawBlockTextPortrait(
  ctx: CanvasRenderingContext2D,
  block: { code: string; component: string; location: string; start: number; end: number },
  x: number,
  y: number,
  h: number,
  linePitch: number,
  size: number,
): void {
  const tx = x + 9
  ctx.textBaseline = 'middle'

  const timeLine = {
    text: `${hhmm(block.start)}${durationTag(block.start, block.end)}`,
    font: `${WEIGHT_TIME} ${size}px ${MONO_STACK}`,
  }
  const codeLine = { text: block.code, font: `${WEIGHT_CODE} ${size}px ${MONO_STACK}` }
  const locLine = block.location
    ? { text: abbreviateLocation(block.location), font: `${WEIGHT_LOC} ${size}px ${MONO_STACK}` }
    : null
  const compLine = { text: block.component, font: `${WEIGHT_COMP} ${size}px ${MONO_STACK}` }

  const fit = Math.floor(h / linePitch + 0.05)
  const lines =
    fit >= 4
      ? [codeLine, locLine, compLine, timeLine].filter((line) => line !== null)
      : fit === 3
        ? [codeLine, locLine ?? compLine, timeLine]
        : fit === 2
          ? [codeLine, timeLine]
          : [codeLine]

  lines.forEach((line, index) => {
    ctx.font = line.font
    ctx.fillText(line.text, tx, y + linePitch * (index + 0.5))
  })
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
  ctx.fillText(t('CU Schedule · {termName} 课表', { termName }), 28, 44)

  const gridTop = 108
  const gridBottom = H - 48
  const gridLeft = 28 + 60
  const gridRight = W - 28
  const gridW = gridRight - gridLeft
  const gridH = gridBottom - gridTop
  const colW = gridW / dayCount
  const yOf = (minutes: number) => gridTop + ((minutes - floorHour * 60) / span) * gridH
  // 横竖模式(v4)+ 一格 30 分钟网格行的像素高 + 整图统一的课块字号——都在此一次
  // 算死,所有课块共用。横屏:行距 = 一格、17 字符预算、两行渲染(与导出 HTML 同构);
  // 竖屏:行距 = 半格、10 字符预算、四行渲染。
  const portrait = H > W
  const rowH = (gridH / span) * 30
  const linePitch = portrait ? rowH / 2 : rowH
  const blockFont = blockFontSize(
    ctx,
    colW,
    linePitch,
    portrait ? LINE_CHAR_BUDGET_PORTRAIT : LINE_CHAR_BUDGET_LANDSCAPE,
  )

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
    ctx.fillText(t(DAYS[day]), x + colW / 2, gridTop - 14)
  }
  ctx.strokeStyle = faint
  ctx.beginPath()
  ctx.moveTo(gridRight, gridTop)
  ctx.lineTo(gridRight, gridBottom)
  ctx.stroke()

  // Course blocks — one column per weekday (single plan, no A/B split).
  // #导出课块统一排版:两行文字各对齐一格 30 分钟行、全块同一字号(见 drawBlockText)。
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
      // #导出课块统一排版(v4):横屏两行(对齐 30 分钟格)/竖屏四行(行距半格),
      // 见各 drawBlockText* 顶部注释(textBaseline 在其内部设为 middle,包在本层
      // save/restore 里不外泄)。
      if (portrait) drawBlockTextPortrait(ctx, block, x, y, h, linePitch, blockFont)
      else drawBlockText(ctx, block, x, y, w, h, rowH, blockFont)
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
  if (!ctx) throw new Error(t('无法创建画布'))
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
  await ensureExportFonts()
  const { W, H } = canvasSize(aspect)
  const canvas = renderTimetable(plan, termName, paint, theme ?? activeTheme(), W, H)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error(t('生成图片失败'))
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
  await ensureExportFonts()
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
