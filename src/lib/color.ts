import type { CSSProperties } from 'react'

/**
 * Every colored surface derives its color from the course's four-letter subject
 * prefix, so a course looks the same everywhere it appears.
 *
 * The University GE subjects (UGEA/UGEB/UGEC/UGED) are four faces of one
 * requirement, so they collapse to a single color.
 */
const UNIVERSITY_GE = new Set(['UGEA', 'UGEB', 'UGEC', 'UGED'])

export function colorKey(subjectOrCode: string): string {
  const prefix = subjectOrCode.slice(0, 4).toUpperCase()
  return UNIVERSITY_GE.has(prefix) ? 'UGE' : prefix
}

function hash(key: string): number {
  let value = 2166136261
  for (const char of key) {
    value ^= char.charCodeAt(0)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

/**
 * Golden-ratio hash: neighbouring codes (CSCI/CSCM) land far apart on the wheel
 * rather than in one narrow band.
 */
export function subjectHue(subjectOrCode: string): number {
  return Math.round(((hash(colorKey(subjectOrCode)) * 0.618033988749895) % 1) * 360)
}

/**
 * 188 subjects into 360 hues collide by the birthday bound. A second hash nudges
 * lightness across five steps, so two subjects must collide twice to look alike —
 * which drops full collisions to single digits catalog-wide.
 *
 * No scheme makes 188 categories mutually distinguishable; the goal is only that
 * the handful of subjects on screen together read apart.
 */
export function subjectShade(subjectOrCode: string): number {
  return (hash(`${colorKey(subjectOrCode)}#shade`) % 5) - 2
}

const SHADE_STEP = 3

/** Inline custom properties consumed by the `hsl(var(--hue) …)` rules in styles.css. */
export function courseColor(subjectOrCode: string): CSSProperties {
  return {
    '--hue': subjectHue(subjectOrCode),
    '--shade': `${subjectShade(subjectOrCode) * SHADE_STEP}%`,
  } as CSSProperties
}

/** Concrete hsl() strings for canvas rendering (fill / edge / text of one block). */
export type CanvasPaint = { fill: string; edge: string; text: string }

/** Which on-screen theme a canvas paint should mirror — a `<canvas>` can't read
 * `:root[data-theme]`, so every canvas/HTML exporter that wants theme-correct
 * blocks has to pick light or dark explicitly and pass it through. */
export type PaintTheme = 'light' | 'dark'

/**
 * Resolve one hue (+ optional shade offset) into the block tint used by the canvas
 * exporters — mirrors styles.css's light values (`--sat: 38%`, `--fill-l: 93%`,
 * `--edge-l: 54%`, `--text-l: 29%`) and dark values (`--sat: 32%`, `--fill-l: 24%`,
 * `--edge-l: 52%`, `--text-l: 82%`) exactly (#里程碑2:PDF 一次导出明暗两页，两页的
 * 课块颜色都要跟屏幕上对应主题下的课表一致). Shared by subjectPaint (subject hash
 * colors) and the timetable-palette painter App builds for exports.
 */
export function huePaint(hue: number, shade = 0, theme: PaintTheme = 'light'): CanvasPaint {
  const [sat, fillL, edgeL, textL] = theme === 'dark' ? [32, 24, 52, 82] : [38, 93, 54, 29]
  return {
    fill: `hsl(${hue} ${sat}% ${fillL + shade}%)`,
    edge: `hsl(${hue} ${sat}% ${edgeL + shade}%)`,
    text: `hsl(${hue} ${sat}% ${textL + shade}%)`,
  }
}

/**
 * The same subject tint resolved to concrete `hsl()` strings for canvas rendering.
 * A `<canvas>` cannot read the `--hue`/`--shade`/`--sat`/… custom properties that
 * the DOM blocks rely on, so this mirrors styles.css's light/dark values (theme
 * defaults to light) plus the same per-subject shade offset (see huePaint).
 */
export function subjectPaint(subjectOrCode: string, theme: PaintTheme = 'light'): CanvasPaint {
  return huePaint(subjectHue(subjectOrCode), subjectShade(subjectOrCode) * SHADE_STEP, theme)
}

/**
 * #里程碑3:timetable-only palette — courseColor() above hashes only the four-letter
 * subject prefix, which is correct for browse/catalog UI (group by subject) but
 * wrong for a timetable, where two courses in the same subject (CSCI3130 vs
 * CSCI3230) must NOT collapse to one color. The main app's live TimetableCompare
 * assigns each distinct committed course a slot from this palette (append-only, so
 * adding/removing a course never reshuffles existing colors); ShareView's read-only
 * course list is fixed once loaded, so it can build the same slot map in one shot
 * with courseColorPalette() below — same palette, same hsl() formula, so a course
 * reads as the same color in the live app and in a shared link.
 */
export const TIMETABLE_PALETTE = [210, 145, 275, 25, 330, 190, 95, 300, 50, 240, 170, 10]

/** Build a stable per-course (by key) color lookup over a fixed list of course keys —
 * first-appearance order decides the palette slot. */
export function courseColorPalette(keys: string[]): (key: string) => CSSProperties {
  const slots = new Map<string, number>()
  for (const key of keys) {
    if (!slots.has(key)) slots.set(key, slots.size)
  }
  return (key: string): CSSProperties =>
    ({
      '--hue': TIMETABLE_PALETTE[(slots.get(key) ?? 0) % TIMETABLE_PALETTE.length],
      '--shade': '0%',
    }) as CSSProperties
}
