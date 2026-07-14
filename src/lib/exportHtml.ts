import { abbreviateLocation } from './buildingAbbrev.ts'
import { RED_HAT_MONO_WOFF2_DATA_URI } from '../fonts/redHatMonoInline.ts'
import { subjectPaint, type CanvasPaint } from './color.ts'
import type { Plan } from './schedule.ts'
import { downloadBlob, slugTerm, type PaintFn } from './exportImage.ts'
import { displayEndMinutes, hhmm } from './time.ts'
import { t } from '../i18n/index.ts'

/**
 * Self-contained, offline-openable HTML export of a single timetable (排法). No
 * external stylesheet, font, or script — everything (CSS, colors) is inlined into
 * one file so double-clicking it works with no network access.
 *
 * Layout mirrors TimetableCompare's solo mode: a left time axis, one column per
 * weekday, course blocks absolutely positioned by percentage within each day's
 * column. Positioning uses the same floor/ceil/displayEndMinutes rounding as the
 * canvas exporters, so the rendered page matches what the app shows on screen.
 */

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const FLOOR = 8 * 60
const CEIL = 19 * 60

type Block = {
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

function blocksOf(plan: Plan): Omit<Block, 'lane' | 'lanes'>[] {
  return plan.entries.flatMap((entry) =>
    entry.section.meetings.map((meeting) => ({
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

/** Greedy interval-graph coloring, lane occupancy tracked via the *displayed*
 * (rounded-up) end so lane packing agrees with the rounded block height used for
 * rendering — see exportImage.ts's layOutDay for the same reasoning. */
function layOutDay(blocks: Omit<Block, 'lane' | 'lanes'>[]): Block[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end)
  const laneEnds: number[] = []
  const placed = sorted.map((block) => {
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Build the full, self-contained HTML document string for one timetable. */
export function buildScheduleHtml(
  plan: Plan,
  termName: string,
  paint: PaintFn = (_code, subject, theme) => subjectPaint(subject, theme),
): string {
  const raw = blocksOf(plan)
  const usesWeekend = raw.some((block) => block.dayIndex > 5)
  const dayCount = usesWeekend ? 7 : 5

  const floorHour = Math.floor(Math.min(FLOOR, ...raw.map((block) => block.start)) / 60)
  const ceilHour = Math.ceil(Math.max(CEIL, ...raw.map((block) => displayEndMinutes(block.end))) / 60)
  const span = (ceilHour - floorHour) * 60
  const pct = (minutes: number) => ((minutes - floorHour * 60) / span) * 100

  // #导出课块统一排版(用户拍板 2026-07-14,v3 硬编码,与 exportImage.ts 同一套强约束):
  // 导出 HTML 是固定尺寸版面(页宽 PAGE_W 写死,窄屏横向滚动,不做响应式),课块文字
  // 恰好两行、一行文字对齐一格 30 分钟网格行(行高 = GRID_H × 30/span);字号硬编码:
  // 「一列宽恰好放下一行 17 个等宽字符」(课号 8 + 空格 + 楼宇 3 + 空格 + 房间 ≤4;
  // 时间行 组件3+空格+时间11 = 15 字符 < 17),按行高封顶。字重:课号/地点/组件 bold、
  // 时间 normal。全部尺寸构建时算死,px 内联进 <style>,零运行时自适应。
  const GRID_H = 640
  const PAGE_W = 1100
  const rowPx = (GRID_H * 30) / span
  const rowLine = rowPx.toFixed(2)
  const CHAR_RATIO = 0.62 // 等宽字符宽/字号 保守比(Menlo .60 / Consolas .55 / DejaVu .602)
  const colPx = (PAGE_W - 2 - 56) / dayCount // .tt 边框 2 + 时间轴 56
  const textAvailPx = colPx - 4 - 4 - 16 // 块 margin 2×2 + 边框 1+3 + padding 8×2
  const fontPx = Math.max(8, Math.floor(Math.min(textAvailPx / (17 * CHAR_RATIO), rowPx * 0.75)))
  // 内容降级断点(并道窄块):第 2 行放不下 15 字符时收起组件前缀;第 1 行放不下 17
  // 字符时收起地点。断点按硬编码字号换算成固定 px;@container 尺寸查询对的是容器的
  // *内容盒*(不含 padding/边框),所以这里不加盒模型开销。
  const needCompPx = Math.round(15 * CHAR_RATIO * fontPx)
  const needLocPx = Math.round(17 * CHAR_RATIO * fontPx)
  // 矮块降级线:不足两行高(仅非整半点开始的 45 分钟课会撞到)时收起第 2 行。
  const shortMaxPx = Math.round(rowPx * 1.8)

  const hourTicks: number[] = []
  for (let tick = floorHour * 60; tick <= ceilHour * 60; tick += 30) hourTicks.push(tick)

  const dayColumns = Array.from({ length: dayCount }, (_, index) => {
    const dayIndex = index + 1
    const laid = layOutDay(raw.filter((block) => block.dayIndex === dayIndex))
    const blocksHtml = laid
      .map((block) => {
        const shownEnd = displayEndMinutes(block.end)
        const top = pct(block.start)
        const height = pct(shownEnd) - pct(block.start)
        const width = 100 / block.lanes
        const left = block.lane * width
        // #里程碑5:明暗两套色阶都算好，塞进 CSS 自定义属性——切主题只是换哪组变量生效
        // (见下方 .block / :root[data-theme='dark'] .block)，课块不用重新渲染整份 HTML。
        const light: CanvasPaint = paint(block.code, block.subject, 'light')
        const dark: CanvasPaint = paint(block.code, block.subject, 'dark')
        // 地点恒用简写(abbreviateLocation,用户拍板 2026-07-14 v2,不再渲染全称片段);
        // `<style>` 里的 `@container` 规则(见下方)按块实际宽高做*内容*降级(收起地点/
        // 组件前缀/第 2 行)——字号不分档,全块统一。地点为空(TBA)时不渲染,天然不占位。
        const locAbbr = block.location ? escapeHtml(abbreviateLocation(block.location)) : ''
        // LEC 保持 .block 的实心样式；TUT/LAB 等非 LEC 加 .block--alt，与屏幕上
        // .tt2__block--lec vs .tt2__block--alt 的区分一致（见下方 CSS）。
        const isLec = block.component === 'LEC'
        const style =
          `top:${top}%;height:${height}%;left:${left}%;width:${width}%;` +
          `--fill-l:${light.fill};--edge-l:${light.edge};--text-l:${light.text};` +
          `--fill-d:${dark.fill};--edge-d:${dark.edge};--text-d:${dark.text}`
        // #Bug C:时间文案用真实结束时间(与屏幕 Timetable/TimetableCompare、PNG 导出
        // exportImage.ts 一致的 hhmm(block.end)),shownEnd(进位后的 displayEndMinutes)只用
        // 于上面算块高度,不进这里的文案,否则会出现「PNG 显示 12:15、HTML 显示 12:30」的
        // 进位不一致。
        const timeText = `${hhmm(block.start)}–${hhmm(block.end)}`
        return `<article class="block${isLec ? '' : ' block--alt'}" style="${style}">` +
          `<span class="block__l1"><span class="block__code">${escapeHtml(block.code)}</span>` +
          (block.location ? `<span class="block__loc"> ${locAbbr}</span>` : '') +
          // 矮块降级备用片段:默认隐藏,矮块(第 2 行被收起)时改为显示,把时间并进第 1
          // 行——与画布导出的矮块单行「课号 + 时间」一致。
          `<span class="block__time-inline"> ${timeText}</span>` +
          `</span>` +
          `<span class="block__l2"><span class="block__comp">${escapeHtml(block.component)} </span>` +
          `<span class="block__time">${timeText}</span></span>` +
          `</article>`
      })
      .join('')
    return `<div class="day"><div class="day__cells">${blocksHtml}</div></div>`
  }).join('')

  const dayHeaders = DAYS.slice(0, dayCount)
    .map((day) => `<div class="head__day">${t(day)}</div>`)
    .join('')

  const axisTicks = hourTicks
    .filter((minutes) => minutes % 60 === 0)
    .map((minutes) => `<span class="axis__tick" style="top:${pct(minutes)}%">${hhmm(minutes)}</span>`)
    .join('')

  const gridLines = hourTicks
    .map((minutes) => `<div class="grid-line${minutes % 60 === 0 ? '' : ' grid-line--half'}" style="top:${pct(minutes)}%"></div>`)
    .join('')

  const now = new Date()
  const generated = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  return `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CU Schedule · ${escapeHtml(termName)}</title>
<style>
/* 课块等宽字体 Red Hat Mono **内嵌**进本文件(可变字体 300–700 latin 子集 data URI,
   用户拍板 2026-07-15)——离线打开照常渲染,不依赖任何 CDN,字体绝不兜底。 */
@font-face {
  font-family: 'Red Hat Mono';
  font-style: normal;
  font-weight: 300 700;
  src: url(${RED_HAT_MONO_WOFF2_DATA_URI}) format('woff2');
}
</style>
<script>
  // #里程碑5:在首次绘制前就把 data-theme 定下来(存过的选择 > 系统偏好)，避免切页闪一下。
  (function () {
    var saved = null
    try { saved = localStorage.getItem('cu-schedule-html-theme') } catch (e) {}
    var theme = saved === 'light' || saved === 'dark'
      ? saved
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.style.colorScheme = theme
  })()
</script>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    color: #141a2b;
    background: #e7e9f0;
  }
  /* 固定版面宽(v3 硬编码):列宽/字号都按这个宽度算死,窄屏横向滚动,不缩排版。 */
  .wrap { width: ${PAGE_W}px; margin: 0 auto; }
  h1 { margin: 0 0 2px; font-size: 22px; font-weight: 750; }
  .sub { margin: 0 0 18px; font-size: 13px; color: #6c7488; }
  .tt {
    display: grid;
    grid-template-columns: 56px repeat(${dayCount}, minmax(0, 1fr));
    background: #ffffff;
    border: 1px solid #ccd2df;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 1px 2px rgb(20 26 43 / 0.06), 0 3px 10px -6px rgb(20 26 43 / 0.16);
  }
  .corner { border-bottom: 1px solid #dde1eb; }
  .head__day {
    padding: 10px 4px;
    text-align: center;
    font-size: 13px;
    font-weight: 700;
    border-bottom: 1px solid #dde1eb;
    border-left: 1px solid #dde1eb;
  }
  .axis {
    position: relative;
    border-right: 1px solid #dde1eb;
  }
  .axis__tick {
    position: absolute;
    right: 8px;
    transform: translateY(-50%);
    font-size: 11px;
    color: #8b93a4;
    font-variant-numeric: tabular-nums;
  }
  .days {
    display: contents;
  }
  .body-row {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: 56px repeat(${dayCount}, minmax(0, 1fr));
    grid-template-rows: ${GRID_H}px;
    position: relative;
  }
  .axis, .day {
    height: 100%;
  }
  .day {
    position: relative;
    border-left: 1px solid #dde1eb;
  }
  .day__cells {
    position: absolute;
    inset: 0;
  }
  /* #里程碑5:格线置底——之前 .grid-line 在标记里排在 .day/.block 后面，无 z-index 时按
     文档顺序层叠，格线反而画在课程块上面。.block 显式给正 z-index，稳赢任何 z-index:auto
     的同层元素(格线保持 auto)，不用依赖标记顺序也能保证格线永远在课块下面。 */
  .grid-line {
    position: absolute;
    left: 56px;
    right: 0;
    height: 1px;
    background: #e6e8ee;
    z-index: 0;
  }
  .grid-line--half {
    background: #f0f1f5;
  }
  /* #导出课块统一排版(用户拍板 2026-07-14,与 exportImage.ts 同一套强约束):
     恰好两行,每行行高 = 一格 30 分钟网格行的像素高(构建时从 span 算好内联进来),
     两行合起来刚好占满最短课块(45 分钟课进位显示为 60 分钟 = 两格);全块统一字号,
     不再按宽窄分字号档。@container 规则只做*内容*降级:全称地点↔简写、极窄收起
     组件前缀/地点、矮块收起第 2 行。.block 挂 container-type:size + container-name:blk。 */
  .block {
    position: absolute;
    z-index: 1;
    margin: 1px 2px;
    padding: 0 8px;
    /* #里程碑1(圆角更明显):6px → 10px，与屏幕上加大后的 .tt2__block 一致。 */
    border-radius: 10px;
    border: 1px solid;
    border-left-width: 3px;
    overflow: hidden;
    line-height: ${rowLine}px;
    /* 课块文字全部等宽、字号硬编码(用户拍板 2026-07-14 v2/v3/v4)——课号/地点/组件/
       时间一律 Red Hat Mono,一个字号,与画布横屏导出同一套 17 字符预算。 */
    font-family: "Red Hat Mono", Menlo, Consolas, monospace;
    font-size: ${fontPx}px;
    container-type: size;
    container-name: blk;
    /* #里程碑5:明暗两套色阶都以自定义属性内联在每个课块上，切主题只是换用哪一组，
       不需要重新生成/重新渲染整份 HTML(见下方 dayColumns 的 style 拼接)。 */
    background: var(--fill-l);
    border-color: var(--edge-l);
    color: var(--text-l);
  }
  /* #里程碑3:TUT/LAB 等非 LEC 课块只保留更淡的填充(向面板底色混)区分，边框/左侧竖条/
     文字粗细都继承 .block(与 LEC 完全一样)——不再加粗体/下划线/虚线左条。 */
  .block.block--alt {
    background: color-mix(in srgb, var(--fill-l) 38%, #ffffff);
  }
  /* 两个行盒:各占一格 30 分钟行的高度，行内垂直居中(line-height = height)，超宽用
     省略号截断——一行文字对表格的一行。字号继承 .block 的硬编码值,不再自适应。 */
  .block__l1, .block__l2 {
    display: block;
    height: ${rowLine}px;
    line-height: ${rowLine}px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* 第 2 行向上收 0.12 格,两行贴得更近(用户拍板 2026-07-15)——与画布导出的
     line2Y = rowH×1.38 同一收紧量。 */
  .block__l2 { margin-top: -${(rowPx * 0.12).toFixed(2)}px; }
  /* 字重阶梯(用户拍板 2026-07-14 v5):课号 700 / 地点 600 / 组件 600 / 时间 500。
     字号/字体全部继承 .block。 */
  .block__code { font-weight: 700; }
  .block__loc { font-weight: 600; }
  .block__comp { font-weight: 600; }
  .block__time { font-weight: 500; font-variant-numeric: tabular-nums; }
  .block__time-inline { font-weight: 500; font-variant-numeric: tabular-nums; display: none; }
  /* 并道窄块的内容降级(只增删内容,字号不变;断点由硬编码字号换算成固定 px):
     第 1 行放不下 17 字符 → 收起地点;第 2 行放不下 15 字符 → 收起组件前缀。 */
  @container blk (max-width: ${needLocPx}px) {
    .block__loc { display: none; }
  }
  @container blk (max-width: ${needCompPx}px) {
    .block__comp { display: none; }
  }
  /* 矮块降级(不足两行高,仅非整半点开始的 45 分钟课会撞到):收起第 2 行和地点,
     把时间并进第 1 行——与画布导出的矮块单行「课号 + 时间」一致。 */
  @container blk (max-height: ${shortMaxPx}px) {
    .block__l2, .block__loc { display: none; }
    .block__time-inline { display: inline; }
  }
  footer { margin-top: 14px; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
  .foot-byline { font-size: 12.5px; font-weight: 750; color: #141a2b; text-decoration: none; }
  .foot-byline:hover { text-decoration: underline; }
  .foot-note { margin: 0; font-size: 10.5px; color: #8b93a4; }
  .theme-toggle {
    position: fixed;
    top: 16px;
    right: 16px;
    width: 40px;
    height: 40px;
    border-radius: 999px;
    border: 1px solid #ccd2df;
    background: #ffffff;
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 1px 2px rgb(20 26 43 / 0.06), 0 3px 10px -6px rgb(20 26 43 / 0.16);
  }
  .theme-toggle:hover { transform: translateY(-1px); }
  :root[data-theme='dark'] body { background: #0b0e16; color: #eceff6; }
  :root[data-theme='dark'] .sub { color: #7a8397; }
  :root[data-theme='dark'] .tt { background: #141926; border-color: #2e3648; }
  :root[data-theme='dark'] .corner, :root[data-theme='dark'] .head__day, :root[data-theme='dark'] .axis { border-color: #242b3b; }
  :root[data-theme='dark'] .day { border-color: #242b3b; }
  :root[data-theme='dark'] .grid-line { background: #242b3b; }
  :root[data-theme='dark'] .grid-line--half { background: #1c2230; }
  :root[data-theme='dark'] .axis__tick { color: #7a8397; }
  :root[data-theme='dark'] .foot-byline { color: #eceff6; }
  :root[data-theme='dark'] .foot-note { color: #7a8397; }
  :root[data-theme='dark'] .block { background: var(--fill-d); border-color: var(--edge-d); color: var(--text-d); }
  /* #里程碑3:同浅色主题——只覆盖更淡的 background，边框/左侧竖条继承上面 .block(dark)。 */
  :root[data-theme='dark'] .block.block--alt {
    background: color-mix(in srgb, var(--fill-d) 38%, #141926);
  }
  :root[data-theme='dark'] .theme-toggle { background: #141926; border-color: #2e3648; color: #eceff6; }
</style>
</head>
<body>
  <button aria-label="${t('切换明暗主题')}" class="theme-toggle" id="theme-toggle" type="button">🌙</button>
  <div class="wrap">
    <h1>CU Schedule · ${escapeHtml(termName || t('课表'))}</h1>
    <p class="sub">${t('导出于 {date} · 离线可直接打开 · 时间以 CUSIS 为准', { date: generated })}</p>
    <div class="tt">
      <div class="corner"></div>
      ${dayHeaders}
      <div class="body-row">
        <div class="axis">${axisTicks}</div>
        <div class="days">${dayColumns}</div>
        ${gridLines}
      </div>
    </div>
    <footer>
      <a class="foot-byline" href="https://github.com/VincentJiang06/cu-schedule" rel="noreferrer" target="_blank">CUS by VinceJiang</a>
    </footer>
  </div>
  <script>
    // #里程碑5:明暗切换——点一下即时生效，选择存 localStorage，下次离线打开这份 HTML 还记得。
    (function () {
      var root = document.documentElement
      var btn = document.getElementById('theme-toggle')
      function icon(theme) { return theme === 'dark' ? '☀️' : '🌙' }
      btn.textContent = icon(root.getAttribute('data-theme') || 'light')
      btn.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
        root.setAttribute('data-theme', next)
        root.style.colorScheme = next
        btn.textContent = icon(next)
        try { localStorage.setItem('cu-schedule-html-theme', next) } catch (e) {}
      })
    })()
  </script>
</body>
</html>
`
}

/** Build the self-contained HTML file, trigger a download, and return the file name. */
export function exportHtmlFile(
  plan: Plan,
  termName: string,
  paint: PaintFn = (_code, subject, theme) => subjectPaint(subject, theme),
): string {
  const html = buildScheduleHtml(plan, termName, paint)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const filename = `cu-schedule-${slugTerm(termName)}.html`
  downloadBlob(blob, filename)
  return filename
}
