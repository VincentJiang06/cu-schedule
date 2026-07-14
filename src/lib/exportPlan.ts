import { exportIcs } from './ics.ts'
import { exportImage, exportPdf, type Aspect, type PaintFn } from './exportImage.ts'
import { exportHtmlFile } from './exportHtml.ts'
import { exportWallpaper } from './exportWallpaper.ts'
import type { Plan } from './schedule.ts'
import { t } from '../i18n/index.ts'

export type ExportFormat = 'ics' | 'image' | 'pdf' | 'wallpaper' | 'html'

export type ExportRequest = {
  format: ExportFormat
  /** The one user-selected timetable to export — every format renders this and only this. */
  plan: Plan
  termName: string
  /** Per-course canvas tint. App passes the timetable-palette painter so PNG/PDF/壁纸/HTML
   * carry the same colors as the on-screen timetable; omitted (ShareView) = subject colors. */
  paint?: PaintFn
  /** #里程碑4:画面比例，只有 format:'image' 用得到——导出页六个比例按钮(或自定义
   * w:h)选中的那个,不传 = 原来的 8:5。 */
  aspect?: Aspect
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
        return { ok: true, note: t('已下载 {filename}', { filename }) }
      }
      case 'image': {
        const filename = await exportImage(request.plan, request.termName, request.paint, request.aspect)
        return { ok: true, note: t('已下载 {filename}', { filename }) }
      }
      case 'pdf': {
        const filename = await exportPdf(request.plan, request.termName, request.paint)
        return { ok: true, note: t('已下载 {filename}', { filename }) }
      }
      case 'wallpaper': {
        const note = await exportWallpaper(request.plan, request.termName, request.paint)
        return { ok: true, note }
      }
      case 'html': {
        const filename = exportHtmlFile(request.plan, request.termName, request.paint)
        return { ok: true, note: t('已下载 {filename}', { filename }) }
      }
    }
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : t('导出失败') }
  }
}
