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

function utf8ToBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)))
}

function base64ToUtf8(base64: string): string {
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

/** Build the share URL for the current selection and copy it; report whether the copy succeeded.
 * Tries the async Clipboard API first, then falls back to `execCommand('copy')` (see
 * clipboard.ts) — the async API alone is unavailable outside a secure context (plain
 * HTTP / bare IP deployments), which otherwise makes 复制链接 silently do nothing. */
export async function copyShareLink(payload: SharePayload): Promise<{ copied: boolean; url: string }> {
  const url = encodeShare(payload)
  const copied = await copyText(url)
  return { copied, url }
}
