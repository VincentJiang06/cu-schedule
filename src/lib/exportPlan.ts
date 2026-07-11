import { exportIcs } from './ics.ts'
import { exportImage } from './exportImage.ts'
import type { Plan, Pins } from './schedule.ts'
import { copyShareLink, type SharePayload } from './shareLink.ts'

export type ExportFormat = 'ics' | 'image' | 'link'

export type ExportRequest = {
  format: ExportFormat
  /** The two compared timetables; B may be absent when only one plan exists. */
  planA: Plan
  planB: Plan | null
  termName: string
  /** Current selection, used by the share-link export (ignored by ics / image). */
  share: { termSlug: string | null; committed: string[]; taken: string[]; pins: Pins }
}

export type ExportResult = { ok: true; note: string } | { ok: false; reason: string }

/**
 * Export the A/B timetable comparison. Dispatches to the three real encoders:
 *   - `ics`   → RFC 5545 calendar of 排法 A (download)
 *   - `image` → hand-drawn 2× PNG of the A/B comparison (download)
 *   - `link`  → shareable permalink of the current selection (clipboard)
 * Async because the image encoder resolves through `canvas.toBlob` and the link
 * encoder awaits the clipboard.
 */
export async function exportPlan(request: ExportRequest): Promise<ExportResult> {
  try {
    switch (request.format) {
      case 'ics': {
        const filename = exportIcs(request.planA, request.termName)
        return { ok: true, note: `已下载 ${filename}（排法 A）` }
      }
      case 'image': {
        const filename = await exportImage(request.planA, request.planB, request.termName)
        return { ok: true, note: `已下载 ${filename}（A / B 对比）` }
      }
      case 'link': {
        const payload: SharePayload = { ...request.share }
        const { copied, url } = await copyShareLink(payload)
        return copied
          ? { ok: true, note: '链接已复制，打开即可恢复当前选课' }
          : { ok: true, note: `无法自动复制，请手动复制链接：${url}` }
      }
    }
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : '导出失败' }
  }
}
