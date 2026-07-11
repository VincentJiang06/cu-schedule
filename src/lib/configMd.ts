import type { Pins } from './schedule.ts'
import { base64ToUtf8, utf8ToBase64 } from './shareLink.ts'

/**
 * Export / import the whole selection as a human-readable Markdown file, with a
 * machine-readable snapshot embedded as an HTML comment so a round-trip import is
 * exact (not a best-effort re-parse of the prose).
 *
 * Import is layered:
 *   1. Machine-readable block present → decode it, exact restore.
 *   2. Absent/corrupt → fall back to scraping course codes out of each Markdown
 *      section by heading, a lossy but still useful recovery (loses pins/switches).
 * Both paths are fully defensive: malformed input yields `null`, never a throw.
 */

export type ConfigMdState = {
  termSlug: string | null
  committed: string[]
  taken: string[]
  /** 可能学 waitlist / cart. */
  cart: string[]
  pins: Pins
  hideConflicts: boolean
  hideOutOfHours: boolean
  meetsOfficeHours: boolean
  meetsPrereq: boolean
  lecFits: boolean
  hideCompleted: boolean
  currentTermOnly: boolean
  excludeTba: boolean
  programScope: 'all' | 'program'
  workStart: number | null
  workEnd: number | null
}

export type ConfigMdOptions = {
  /** Display-only, e.g. "2026-27 Term 1"; not restored on import (termSlug is). */
  termName?: string
  /** Resolve a course code to its title for the human-readable lists; omitted/undefined
   * codes render without a title (still a valid, parseable line). */
  titleFor?: (code: string) => string | undefined
}

const MARKER_OPEN = '<!-- cuhk-schedule-config:v1'
const MARKER_CLOSE = '-->'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** `YYYY-MM-DD` for the given date (local time), used by both the Markdown body's
 * 导出日期 line and the downloaded file's name. */
export function todayLabel(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** `${YYYY-MM-DD} CUHK Schedule.md`. */
export function configMdFilename(date: Date = new Date()): string {
  return `${todayLabel(date)} CUHK Schedule.md`
}

function courseLine(code: string, titleFor?: (code: string) => string | undefined): string {
  const title = titleFor?.(code)
  return title ? `- ${code} — ${title}` : `- ${code}`
}

function courseSection(heading: string, codes: string[], titleFor?: (code: string) => string | undefined): string {
  if (codes.length === 0) return `## ${heading}\n\n（无）\n`
  return `## ${heading}\n\n${codes.map((code) => courseLine(code, titleFor)).join('\n')}\n`
}

function pinsSection(pins: Pins): string {
  const codes = Object.keys(pins)
  if (codes.length === 0) return `## 锁定时段\n\n（无）\n`
  const lines = codes.map((code) => {
    const forCourse = pins[code]
    const parts = Object.entries(forCourse).map(([component, sectionId]) => `${component}=${sectionId}`)
    return `- ${code}: ${parts.join(', ')}`
  })
  return `## 锁定时段\n\n${lines.join('\n')}\n`
}

/** Encode the full selection into a readable Markdown string, with an exact,
 * machine-readable snapshot appended as a trailing HTML comment. */
export function encodeConfigMd(state: ConfigMdState, options: ConfigMdOptions = {}): string {
  const { termName, titleFor } = options
  const parts: string[] = [
    '# CUHK Schedule 选课配置',
    '',
    `导出日期：${todayLabel()}`,
    `学期：${termName || '（未设置）'}`,
    '',
    courseSection('要上的课', state.committed, titleFor),
    courseSection('已修过的课', state.taken, titleFor),
    courseSection('备选课（可能学）', state.cart, titleFor),
    pinsSection(state.pins),
  ]

  const machine = utf8ToBase64(JSON.stringify(state))
  parts.push(`${MARKER_OPEN}\n${machine} ${MARKER_CLOSE}`)

  return parts.join('\n') + '\n'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isPins(value: unknown): value is Pins {
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value as Record<string, unknown>).every(
    (forCourse) =>
      typeof forCourse === 'object' &&
      forCourse !== null &&
      Object.values(forCourse as Record<string, unknown>).every((id) => typeof id === 'string'),
  )
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asMinutes(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Validate + normalize a decoded machine-readable payload; malformed → null. */
function readMachineState(json: string): ConfigMdState | null {
  const parsed: unknown = JSON.parse(json)
  if (typeof parsed !== 'object' || parsed === null) return null
  const r = parsed as Record<string, unknown>
  if (!isStringArray(r.committed) || !isStringArray(r.taken)) return null
  return {
    termSlug: typeof r.termSlug === 'string' ? r.termSlug : null,
    committed: r.committed,
    taken: r.taken,
    cart: isStringArray(r.cart) ? r.cart : [],
    pins: isPins(r.pins) ? r.pins : {},
    hideConflicts: asBool(r.hideConflicts, true),
    hideOutOfHours: asBool(r.hideOutOfHours, false),
    meetsOfficeHours: asBool(r.meetsOfficeHours, false),
    meetsPrereq: asBool(r.meetsPrereq, false),
    lecFits: asBool(r.lecFits, false),
    hideCompleted: asBool(r.hideCompleted, true),
    currentTermOnly: asBool(r.currentTermOnly, true),
    excludeTba: asBool(r.excludeTba, false),
    programScope: r.programScope === 'program' ? 'program' : 'all',
    workStart: asMinutes(r.workStart),
    workEnd: asMinutes(r.workEnd),
  }
}

const CODE_RE = /[A-Z]{4}\d{4}/g

/** Lossy fallback: scrape course codes out of each Markdown section by heading.
 * No machine block, so pins/switches/termSlug can't be recovered — codes only. */
function decodeFromProse(text: string): ConfigMdState | null {
  const sectionRe = (heading: string): RegExp =>
    new RegExp(`##\\s*${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i')
  const codesIn = (heading: string): string[] => {
    const match = sectionRe(heading).exec(text)
    if (!match) return []
    return [...new Set(match[1].match(CODE_RE) ?? [])]
  }

  const committed = codesIn('要上的课')
  const taken = codesIn('已修过的课')
  const cart = codesIn('备选课')
  if (committed.length === 0 && taken.length === 0 && cart.length === 0) return null

  return {
    termSlug: null,
    committed,
    taken,
    cart,
    pins: {},
    hideConflicts: true,
    hideOutOfHours: false,
    meetsOfficeHours: false,
    meetsPrereq: false,
    lecFits: false,
    hideCompleted: true,
    currentTermOnly: true,
    excludeTba: false,
    programScope: 'all',
    workStart: null,
    workEnd: null,
  }
}

/** Decode a Markdown config file back into state. Prefers the exact machine-readable
 * block; falls back to scraping course codes from the prose. Fully defensive — any
 * malformed content (missing sections, corrupt base64, foreign file) yields `null`
 * rather than throwing or partially applying state. */
export function decodeConfigMd(text: string): ConfigMdState | null {
  if (typeof text !== 'string' || text.trim().length === 0) return null

  const openIndex = text.indexOf(MARKER_OPEN)
  if (openIndex !== -1) {
    const closeIndex = text.indexOf(MARKER_CLOSE, openIndex)
    if (closeIndex !== -1) {
      const raw = text.slice(openIndex + MARKER_OPEN.length, closeIndex).trim()
      try {
        const state = readMachineState(base64ToUtf8(raw))
        if (state) return state
      } catch {
        // Fall through to the prose fallback below.
      }
    }
  }

  try {
    return decodeFromProse(text)
  } catch {
    return null
  }
}
