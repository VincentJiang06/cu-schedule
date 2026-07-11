/**
 * Clipboard write with a legacy fallback.
 *
 * `navigator.clipboard` is only defined in a secure context (HTTPS or localhost) —
 * on a plain-HTTP deployment (or an IP address without TLS) it is simply `undefined`,
 * so `navigator.clipboard.writeText` throws synchronously before any permission
 * prompt ever appears. Some browsers (older WebKit, some in-app webviews) also reject
 * the promise outright even when the API exists. Either way the async Clipboard API
 * alone silently fails there — this wraps it with the old `execCommand('copy')`
 * trick (hidden, focused, selected textarea) so a copy still lands on the system
 * clipboard in those environments. Only when *both* paths fail does the caller need
 * to fall back to showing the text for a manual copy.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the legacy path below.
    }
  }
  return legacyCopy(text)
}

/** `document.execCommand('copy')` via a hidden, selected textarea — works without the
 * async Clipboard API / outside a secure context. Returns false if the browser has no
 * DOM (SSR) or execCommand support at all. */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const textarea = document.createElement('textarea')
  textarea.value = text
  // Keep it in-flow but visually and interactively invisible, off-screen rather than
  // display:none (some browsers refuse to select a non-rendered element), and sized so
  // iOS doesn't zoom in on focus (needs a >=16px font).
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  textarea.style.width = '1px'
  textarea.style.height = '1px'
  textarea.style.fontSize = '16px'
  textarea.setAttribute('readonly', '')
  document.body.appendChild(textarea)
  const previousFocus = document.activeElement as HTMLElement | null
  try {
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
    previousFocus?.focus?.()
  }
}
