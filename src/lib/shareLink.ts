import { copyText } from './clipboard.ts'
import type { Pins } from './schedule.ts'

/**
 * Share links carry the whole selection in the URL fragment — no backend. The
 * payload is JSON, UTF-8-safe base64 (btoa can't take multi-byte chars directly),
 * then percent-encoded, and lives after `#s=`. decodeShare is fully defensive:
 * any malformed payload yields null so a bad link never corrupts local state.
 */

export type SharePayload = {
  termSlug: string | null
  committed: string[]
  taken: string[]
  pins: Pins
}

const MARKER = '#s='

// The 5 tabs, duplicated here (rather than imported from App.tsx) to avoid a
// lib → App import cycle. Structurally identical to App.tsx's `Page` union, so
// TypeScript treats values of either type as interchangeable at call sites.
type PageSlug = 'info' | 'select' | 'timetable' | 'export' | 'appendix'
const PAGE_SLUGS: readonly PageSlug[] = ['info', 'select', 'timetable', 'export', 'appendix']

// Exported so other modules that need the same UTF-8-safe base64 envelope (e.g.
// configMd.ts's machine-readable block) don't have to reinvent it.
export function utf8ToBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)))
}

export function base64ToUtf8(base64: string): string {
  return decodeURIComponent(escape(atob(base64)))
}

export function encodeShare(payload: SharePayload): string {
  const json = JSON.stringify({
    termSlug: payload.termSlug,
    committed: payload.committed,
    taken: payload.taken,
    pins: payload.pins,
  })
  const encoded = encodeURIComponent(utf8ToBase64(json))
  return `${location.origin}${location.pathname}${MARKER}${encoded}`
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function decodeShare(hash: string): SharePayload | null {
  try {
    const index = hash.indexOf(MARKER)
    if (index === -1) return null
    const raw = hash.slice(index + MARKER.length)
    if (!raw) return null
    const json = base64ToUtf8(decodeURIComponent(raw))
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Record<string, unknown>
    if (!isStringArray(record.committed) || !isStringArray(record.taken)) return null
    const termSlug = typeof record.termSlug === 'string' ? record.termSlug : null
    const pins =
      typeof record.pins === 'object' && record.pins !== null ? (record.pins as Pins) : {}
    return { termSlug, committed: record.committed, taken: record.taken, pins }
  } catch {
    return null
  }
}

/**
 * Live session state — a superset of SharePayload used to keep the address bar in sync
 * with everything the user can edit (active tab, selection, and the filter/hours switches
 * that shape what's shown). Lives after `#st=`, a marker distinct from `#s=` on purpose:
 * `#s=` is a deliberate, immutable snapshot the user hands to someone else (imported once,
 * then the hash is stripped — see App.tsx's shared-import effect), while `#st=` is the
 * app's own continuously-rewritten bookmark of "where you are right now". Folding live
 * state into `#s=` would break that one-shot-import-then-strip contract, since the live
 * writer would keep re-populating `#s=` on every click. Same base64 helpers, separate
 * marker, separate lifecycle.
 */
export type LiveState = SharePayload & {
  /** #里程碑4(真路由):page 不再由 #st= 决定——路由页面现在来自 location.pathname。这个
   *  字段只为向后兼容旧链接保留:encodeLiveState 不再写它(调用方不再传),但
   *  decodeLiveState 解到旧链接里的合法 page 时仍会带出来,供调用方一次性纠正到对应路径。*/
  page?: PageSlug
  hideConflicts: boolean
  hideOutOfHours: boolean
  meetsOfficeHours: boolean
  meetsPrereq: boolean
  lecFits: boolean
  hideCompleted: boolean
  currentTermOnly: boolean
  excludeTba: boolean
  hideSuperseded: boolean
  programScope: 'all' | 'program'
  workStart: number | null
  workEnd: number | null
}

const LIVE_MARKER = '#st='

/** Encode live state into just the `#st=...` hash fragment — callers splice it onto
 * `location.pathname + location.search` for history.pushState/replaceState (unlike
 * encodeShare, which returns a full absolute URL meant for the clipboard). */
export function encodeLiveState(state: LiveState): string {
  const encoded = encodeURIComponent(utf8ToBase64(JSON.stringify(state)))
  return `${LIVE_MARKER}${encoded}`
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asMinutes(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Fully defensive, like decodeShare: any malformed/foreign hash yields null rather
 * than throwing or partially applying state. */
export function decodeLiveState(hash: string): LiveState | null {
  try {
    if (!hash.startsWith(LIVE_MARKER)) return null
    const raw = hash.slice(LIVE_MARKER.length)
    if (!raw) return null
    const json = base64ToUtf8(decodeURIComponent(raw))
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null) return null
    const r = parsed as Record<string, unknown>
    if (!isStringArray(r.committed) || !isStringArray(r.taken)) return null
    // #里程碑4:不再兜底默认页——page 现在由路径决定,这里只在旧链接确实带了合法 page 时才
    // 把它带出去(供调用方一次性向后兼容 redirect),解不出就整个不带这个字段。
    const page = typeof r.page === 'string' && (PAGE_SLUGS as string[]).includes(r.page) ? (r.page as PageSlug) : undefined
    const termSlug = typeof r.termSlug === 'string' ? r.termSlug : null
    const pins = typeof r.pins === 'object' && r.pins !== null ? (r.pins as Pins) : {}
    return {
      page,
      termSlug,
      committed: r.committed,
      taken: r.taken,
      pins,
      hideConflicts: asBool(r.hideConflicts, true),
      hideOutOfHours: asBool(r.hideOutOfHours, false),
      meetsOfficeHours: asBool(r.meetsOfficeHours, false),
      meetsPrereq: asBool(r.meetsPrereq, false),
      lecFits: asBool(r.lecFits, false),
      hideCompleted: asBool(r.hideCompleted, true),
      currentTermOnly: asBool(r.currentTermOnly, true),
      excludeTba: asBool(r.excludeTba, false),
      hideSuperseded: asBool(r.hideSuperseded, true),
      programScope: r.programScope === 'program' ? 'program' : 'all',
      workStart: asMinutes(r.workStart),
      workEnd: asMinutes(r.workEnd),
    }
  } catch {
    return null
  }
}

/** Build the share URL for the current selection and copy it; report whether the copy succeeded.
 * Tries the async Clipboard API first, then falls back to `execCommand('copy')` (see
 * clipboard.ts) — the async API alone is unavailable outside a secure context (plain
 * HTTP / bare IP deployments), which otherwise makes 复制链接 silently do nothing. */
export async function copyShareLink(payload: SharePayload): Promise<{ copied: boolean; url: string }> {
  const url = encodeShare(payload)
  const copied = await copyText(url)
  return { copied, url }
}
