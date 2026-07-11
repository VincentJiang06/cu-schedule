import { exportIcs } from './ics.ts'
import { exportImage, exportPdf, type PaintFn } from './exportImage.ts'
import { exportHtmlFile } from './exportHtml.ts'
import { exportWallpaper } from './exportWallpaper.ts'
import type { Plan } from './schedule.ts'

export type ExportFormat = 'ics' | 'image' | 'pdf' | 'wallpaper' | 'html'

export type ExportRequest = {
  format: ExportFormat
  /** The one user-selected timetable to export — every format renders this and only this. */
  plan: Plan
  termName: string
  /** Per-course canvas tint. App passes the timetable-palette painter so PNG/PDF/壁纸/HTML
   * carry the same colors as the on-screen timetable; omitted (ShareView) = subject colors. */
  paint?: PaintFn
}

export type ExportResult = { ok: true; note: string } | { ok: false; reason: string }

/**
 * Export one timetable. Dispatches to the encoders:
 *   - `ics`      → RFC 5545 calendar (download)
 *   - `image`    → hand-drawn 2× PNG (download)
 *   - `pdf`      → single-page A4 PDF (download)
 *   - `wallpaper`→ two portrait PNGs, iPhone ratio (download)
 *   - `html`     → self-contained offline-openable .html (download)
 * Async because several encoders resolve through `canvas.toBlob`.
 */
export async function exportPlan(request: ExportRequest): Promise<ExportResult> {
  try {
    switch (request.format) {
      case 'ics': {
        const filename = exportIcs(request.plan, request.termName)
        return { ok: true, note: `已下载 ${filename}` }
      }
      case 'image': {
        const filename = await exportImage(request.plan, request.termName, request.paint)
        return { ok: true, note: `已下载 ${filename}` }
      }
      case 'pdf': {
        const filename = await exportPdf(request.plan, request.termName, request.paint)
        return { ok: true, note: `已下载 ${filename}` }
      }
      case 'wallpaper': {
        const note = await exportWallpaper(request.plan, request.termName, request.paint)
        return { ok: true, note }
      }
      case 'html': {
        const filename = exportHtmlFile(request.plan, request.termName, request.paint)
        return { ok: true, note: `已下载 ${filename}` }
      }
    }
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : '导出失败' }
  }
}
