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
  /** Term slug — the .ics export looks up the official teaching period with it. */
  termSlug?: string | null
  /** Display label of the plan, e.g. "排法 3" (calendar name, wallpaper/HTML caption). */
  planLabel?: string
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
 *   - `pdf`      → two-page (light + dark) A4 landscape PDF (download)
 *   - `wallpaper`→ portrait PNG with the timetable, iPhone ratio (share sheet / download)
 *   - `html`     → self-contained offline-openable .html (download)
 * Async because several encoders resolve through `canvas.toBlob`.
 */
export async function exportPlan(request: ExportRequest): Promise<ExportResult> {
  try {
    switch (request.format) {
      case 'ics': {
        const filename = exportIcs(request.plan, request.termName, {
          termSlug: request.termSlug,
          planLabel: request.planLabel,
        })
        return { ok: true, note: t('已下载 {filename}', { filename }) }
      }
      case 'image': {
        const filename = await exportImage(request.plan, request.termName, request.paint, request.aspect)
        if (!filename) return { ok: true, note: t('已取消') }
        return { ok: true, note: t('已导出 {filename}', { filename }) }
      }
      case 'pdf': {
        const filename = await exportPdf(request.plan, request.termName, request.paint)
        return { ok: true, note: t('已下载 {filename}', { filename }) }
      }
      case 'wallpaper': {
        const note = await exportWallpaper(request.plan, request.termName, request.paint, request.planLabel)
        return { ok: true, note }
      }
      case 'html': {
        const filename = exportHtmlFile(request.plan, request.termName, request.paint, request.planLabel)
        return { ok: true, note: t('已下载 {filename}', { filename }) }
      }
    }
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : t('导出失败') }
  }
}
