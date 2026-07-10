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
