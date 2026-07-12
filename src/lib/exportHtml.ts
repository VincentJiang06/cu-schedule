import { subjectPaint, type CanvasPaint } from './color.ts'
import type { Plan } from './schedule.ts'
import { downloadBlob, slugTerm, type PaintFn } from './exportImage.ts'
import { displayEndMinutes, hhmm } from './time.ts'

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
        const meta = block.location ? `${block.component} · ${escapeHtml(block.location)}` : block.component
        // LEC 保持 .block 的实心样式；TUT/LAB 等非 LEC 加 .block--alt，与屏幕上
        // .tt2__block--lec vs .tt2__block--alt 的区分一致（见下方 CSS）。
        const isLec = block.component === 'LEC'
        const style =
          `top:${top}%;height:${height}%;left:${left}%;width:${width}%;` +
          `--fill-l:${light.fill};--edge-l:${light.edge};--text-l:${light.text};` +
          `--fill-d:${dark.fill};--edge-d:${dark.edge};--text-d:${dark.text}`
        return `<article class="block${isLec ? '' : ' block--alt'}" style="${style}">` +
          `<span class="block__code">${escapeHtml(block.code)}</span>` +
          `<span class="block__time">${hhmm(block.start)}–${hhmm(shownEnd)}</span>` +
          `<span class="block__meta">${meta}</span>` +
          `</article>`
      })
      .join('')
    return `<div class="day"><div class="day__cells">${blocksHtml}</div></div>`
  }).join('')

  const dayHeaders = DAYS.slice(0, dayCount)
    .map((day) => `<div class="head__day">${day}</div>`)
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
  .wrap { max-width: 1100px; margin: 0 auto; }
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
    grid-template-rows: 640px;
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
  .block {
    position: absolute;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 1px 2px;
    padding: 5px 7px;
    /* #里程碑1(圆角更明显):6px → 10px，与屏幕上加大后的 .tt2__block 一致。 */
    border-radius: 10px;
    border: 1px solid;
    border-left-width: 3px;
    overflow: hidden;
    font-size: 11.5px;
    /* #里程碑5:明暗两套色阶都以自定义属性内联在每个课块上，切主题只是换用哪一组，
       不需要重新生成/重新渲染整份 HTML(见下方 dayColumns 的 style 拼接)。 */
    background: var(--fill-l);
    border-color: var(--edge-l);
    color: var(--text-l);
  }
  /* TUT/LAB 等非 LEC 课块：比 LEC 更淡的填充(向面板底色混)、更浅边框、虚线左条，
     再加粗体+下划线文字(text-decoration 会顺带覆盖到子级 span，font-weight 靠继承)——
     和屏幕上 .tt2__block--lec(实心) vs .tt2__block--alt 的区分一致。 */
  .block.block--alt {
    background: color-mix(in srgb, var(--fill-l) 38%, #ffffff);
    border-color: color-mix(in srgb, var(--edge-l) 50%, #ffffff);
    border-left-style: dashed;
    border-left-color: var(--text-l);
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .block__code { font-weight: 750; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .block__time { font-variant-numeric: tabular-nums; opacity: 0.9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .block__meta { opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
  :root[data-theme='dark'] .block.block--alt {
    background: color-mix(in srgb, var(--fill-d) 38%, #141926);
    border-color: color-mix(in srgb, var(--edge-d) 50%, #141926);
    border-left-color: var(--text-d);
  }
  :root[data-theme='dark'] .theme-toggle { background: #141926; border-color: #2e3648; color: #eceff6; }
</style>
</head>
<body>
  <button aria-label="切换明暗主题" class="theme-toggle" id="theme-toggle" type="button">🌙</button>
  <div class="wrap">
    <h1>CU Schedule · ${escapeHtml(termName || '课表')}</h1>
    <p class="sub">导出于 ${generated} · 离线可直接打开 · 时间以 CUSIS 为准</p>
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
