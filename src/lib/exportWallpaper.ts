import { subjectPaint } from './color.ts'
import { t } from '../i18n/index.ts'
import type { Plan } from './schedule.ts'
import { deliverImage, draw, ensureExportFonts, slugTerm, type PaintFn, type ThemeInk } from './exportImage.ts'

/**
 * Phone-wallpaper export: one portrait PNG at the iPhone 17 Pro screen ratio
 * (1206 × 2622) — an indigo gradient with the chosen timetable laid into the band
 * between the lock-screen clock (top ~30%) and the flashlight / camera buttons
 * (bottom ~11%), so the clock and controls never sit on top of a course block.
 * The grid itself is the same renderer as the PNG/PDF exports (exportImage.draw in
 * bare mode, portrait four-line blocks), recoloured for the dark background.
 */

const W = 1206
const H = 2622

// Vertical safe zones — the lock-screen clock/date live above TOP_SAFE and the
// flashlight/camera buttons + home indicator below BOTTOM_SAFE; the timetable panel
// only occupies the band between them.
const TOP_SAFE = Math.round(H * 0.3)
const BOTTOM_SAFE = H - 290
const SIDE = 44

// Grid ink tuned for the indigo gradient (light lines / text on dark).
const WALL_INK: ThemeInk = {
  page: '#1e1b4b',
  ink: '#eef2ff',
  faint: 'rgba(199, 210, 254, 0.22)',
  faintHalf: 'rgba(199, 210, 254, 0.09)',
  muted: 'rgba(199, 210, 254, 0.72)',
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/** Background layer: vertical indigo gradient, a soft glow behind the timetable band,
 * the term caption, and a faint signature inside the bottom safe zone. */
function paintBackground(ctx: CanvasRenderingContext2D, caption: string): void {
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#2c2761')
  grad.addColorStop(0.45, '#1e1b4b')
  grad.addColorStop(1, '#100e28')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // Soft glow centered on the timetable band — the only texture besides the gradient.
  const midY = (TOP_SAFE + BOTTOM_SAFE) / 2
  const glow = ctx.createRadialGradient(W / 2, midY, 40, W / 2, midY, W * 0.75)
  glow.addColorStop(0, 'rgba(129, 140, 248, 0.22)')
  glow.addColorStop(1, 'rgba(129, 140, 248, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // Term + plan caption just above the timetable panel.
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = 'rgba(199, 210, 254, 0.78)'
  ctx.font = '600 30px system-ui, -apple-system, "PingFang SC", sans-serif'
  ctx.fillText(caption, W / 2, TOP_SAFE - 26)

  // Faint signature, tucked well inside the bottom safe zone — doesn't compete with
  // the lock-screen date.
  ctx.fillStyle = 'rgba(199, 210, 254, 0.28)'
  ctx.font = '600 22px system-ui, -apple-system, sans-serif'
  ctx.fillText('CUS by VinceJiang', W / 2, H - 60)
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error(t('生成壁纸失败'))
  return blob
}

function freshCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(t('无法创建画布'))
  return { canvas, ctx }
}

/** Produce the wallpaper (gradient + timetable) and hand it to the user — share sheet
 * on phones (save to Photos), plain download elsewhere. */
export async function exportWallpaper(
  plan: Plan,
  termName: string,
  paint: PaintFn = (_code, subject, theme) => subjectPaint(subject, theme),
  planLabel = '',
): Promise<string> {
  await ensureExportFonts()
  const slug = slugTerm(termName)

  const { canvas, ctx } = freshCanvas()
  paintBackground(ctx, [termName || t('本学期课表'), planLabel].filter(Boolean).join(' · '))

  // Frosted panel the grid sits on.
  const panelX = SIDE
  const panelY = TOP_SAFE
  const panelW = W - SIDE * 2
  const panelH = BOTTOM_SAFE - TOP_SAFE
  roundRect(ctx, panelX, panelY, panelW, panelH, 40)
  ctx.fillStyle = 'rgba(12, 10, 34, 0.5)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(165, 180, 252, 0.18)'
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.save()
  ctx.translate(panelX + 14, panelY + 18)
  draw(ctx, plan, termName, paint, 'dark', panelW - 28, panelH - 30, { bare: true, ink: WALL_INK })
  ctx.restore()

  const how = await deliverImage(await canvasToPng(canvas), `cu-schedule-${t('壁纸')}-${slug}.png`)
  if (how === 'cancelled') return t('已取消')
  return how === 'shared'
    ? t('已打开系统分享，可「存储图像」到相册后设为锁屏壁纸')
    : t('已下载壁纸（{w}×{h}），在相册里设为锁屏壁纸即可', { w: W, h: H })
}
