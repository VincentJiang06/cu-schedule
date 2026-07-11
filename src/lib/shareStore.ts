import type { Pins } from './schedule.ts'

/**
 * Server-backed read-only share (approach 2). A share instance is the student's
 * selection at export time; POSTing it to /api/share mints a short id, and the
 * read-only viewer at `#v=<id>` fetches it back and re-renders the timetable from
 * the same course data. The instance lives ~1 day in the server's memory.
 *
 * We store only the selection (not a rendered plan) — the viewer loads the same
 * year bundle and re-derives the timetable, keeping the payload tiny and the view
 * always consistent with the catalog.
 */

export type ShareInstance = {
  termSlug: string | null
  termName: string
  committed: string[]
  taken: string[]
  pins: Pins
}

const HASH_MARKER = '#v='

/** The read-only share id in the current URL hash (`#v=<id>`), or null. */
export function readShareId(): string | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash
  if (!hash.startsWith(HASH_MARKER)) return null
  const id = hash.slice(HASH_MARKER.length).trim()
  return /^[A-Za-z0-9]+$/.test(id) ? id : null
}

/** Build the shareable read-only URL for an id (`…/#v=<id>`, at the app root). */
export function shareUrl(id: string): string {
  return `${window.location.origin}${window.location.pathname}${HASH_MARKER}${id}`
}

export type CreateResult =
  | { ok: true; id: string; url: string; expiresAt: number }
  | { ok: false; reason: string }

export async function createShare(instance: ShareInstance): Promise<CreateResult> {
  try {
    const res = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(instance),
    })
    if (!res.ok) return { ok: false, reason: `服务返回 ${res.status}` }
    const body = (await res.json()) as { id?: string; expiresAt?: number }
    if (!body.id) return { ok: false, reason: '服务未返回 id' }
    return { ok: true, id: body.id, url: shareUrl(body.id), expiresAt: body.expiresAt ?? 0 }
  } catch {
    return { ok: false, reason: '无法连接分享服务' }
  }
}

export type LoadResult =
  | { ok: true; instance: ShareInstance; expiresAt: number }
  | { ok: false; reason: 'not_found' | 'error' }

export async function loadShare(id: string): Promise<LoadResult> {
  try {
    const res = await fetch(`/api/share/${encodeURIComponent(id)}`)
    if (res.status === 404) return { ok: false, reason: 'not_found' }
    if (!res.ok) return { ok: false, reason: 'error' }
    const body = (await res.json()) as { data?: ShareInstance; expiresAt?: number }
    if (!body.data) return { ok: false, reason: 'error' }
    return { ok: true, instance: body.data, expiresAt: body.expiresAt ?? 0 }
  } catch {
    return { ok: false, reason: 'error' }
  }
}
