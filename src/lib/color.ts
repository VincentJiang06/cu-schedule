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

/** Which on-screen theme a canvas paint should mirror — the app has three
 * (light/mid/dark), each with its own `:root[data-theme=…]` block in styles.css. */
export type PaintTheme = 'light' | 'mid' | 'dark'

/** Read whichever theme is currently applied to `<html>` — kept in sync by App's
 * theme effect (and ShareView's applyTheme on mount). This is the literal "what's
 * on screen right now" default for exporters that don't get an explicit theme
 * (#里程碑4:PNG/HTML 单张导出要跟着用户当前正在看的主题走，不能再硬编码 'light'). */
export function activeTheme(): PaintTheme {
  const raw = typeof document === 'undefined' ? undefined : document.documentElement.dataset.theme
  return raw === 'mid' || raw === 'dark' ? raw : 'light'
}

// Mirrors styles.css's three `:root[data-theme=…]` blocks' course-block tokens —
// used only as a defensive fallback if a computed-style read is unavailable
// (e.g. no `document`); the browser's real computed values are the source of truth.
const FALLBACK_THEME_VARS: Record<PaintTheme, readonly [sat: number, fillL: number, edgeL: number, textL: number]> = {
  light: [38, 93, 54, 29],
  mid: [38, 93, 54, 29],
  dark: [32, 24, 52, 82],
}

function parsePercent(raw: string): number | null {
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : null
}

/**
 * Resolve one theme's course-block CSS custom properties (`--sat`/`--fill-l`/
 * `--edge-l`/`--text-l`) by reading them straight off styles.css via
 * `getComputedStyle` — the single source of truth, not a hand-copied table
 * (#里程碑4: the old hardcoded table drifted from styles.css once the three-theme
 * light/mid/dark palette landed). If `theme` isn't the one currently applied to
 * `<html>`, this briefly flips `data-theme` to it, reads, and flips it back before
 * anything repaints — synchronous, so there's no visible flash (this is exactly the
 * "探测元素/根" trick, applied to the root since the rules are `:root[data-theme=…]`).
 */
function readThemeVars(theme: PaintTheme): readonly [sat: number, fillL: number, edgeL: number, textL: number] {
  const fallback = FALLBACK_THEME_VARS[theme]
  if (typeof document === 'undefined') return fallback
  const root = document.documentElement
  const live = root.dataset.theme
  const swapped = live !== theme
  if (swapped) root.dataset.theme = theme
  const style = getComputedStyle(root)
  const sat = parsePercent(style.getPropertyValue('--sat')) ?? fallback[0]
  const fillL = parsePercent(style.getPropertyValue('--fill-l')) ?? fallback[1]
  const edgeL = parsePercent(style.getPropertyValue('--edge-l')) ?? fallback[2]
  const textL = parsePercent(style.getPropertyValue('--text-l')) ?? fallback[3]
  if (swapped) {
    if (live === undefined) root.removeAttribute('data-theme')
    else root.dataset.theme = live
  }
  return [sat, fillL, edgeL, textL]
}

/**
 * Resolve one hue (+ optional shade offset) into the block tint used by the canvas
 * exporters — reads the real, currently-computed `--sat`/`--fill-l`/`--edge-l`/
 * `--text-l` for the given theme (defaults to whatever theme is active on screen
 * right now), so exported blocks are pixel-for-pixel the same hsl() as the on-screen
 * ones in the same theme. Shared by subjectPaint (subject hash colors) and the
 * timetable-palette painter App builds for exports.
 */
export function huePaint(hue: number, shade = 0, theme?: PaintTheme): CanvasPaint {
  const [sat, fillL, edgeL, textL] = readThemeVars(theme ?? activeTheme())
  return {
    fill: `hsl(${hue} ${sat}% ${fillL + shade}%)`,
    edge: `hsl(${hue} ${sat}% ${edgeL + shade}%)`,
    text: `hsl(${hue} ${sat}% ${textL + shade}%)`,
  }
}

/**
 * The same subject tint resolved to concrete `hsl()` strings for canvas rendering.
 * A `<canvas>` cannot read the `--hue`/`--shade`/`--sat`/… custom properties that
 * the DOM blocks rely on, so this reads them live off `<html>` (see huePaint) plus
 * the same per-subject shade offset.
 */
export function subjectPaint(subjectOrCode: string, theme?: PaintTheme): CanvasPaint {
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
