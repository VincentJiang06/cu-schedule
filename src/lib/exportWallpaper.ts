import { subjectPaint } from './color.ts'
import type { Plan } from './schedule.ts'
import { downloadBlob, slugTerm, type PaintFn } from './exportImage.ts'

/**
 * Phone-wallpaper export. A single portrait PNG at the iPhone 17 Pro screen ratio
 * (1206 × 2622): a clean indigo gradient, a soft glow, and a small centered brand
 * mark — no timetable, no grid. The top ~34% and bottom ~24% are deliberately left
 * empty so the wallpaper never fights the iOS clock/status area up top or the home
 * indicator / lock-screen date down below.
 */

const W = 1206
const H = 2622

// Vertical safe zones — everything above TOP_SAFE and below BOTTOM_SAFE stays plain
// gradient (aside from the faint corner signature), so the wallpaper reads as
// generous top/bottom whitespace rather than a filled screen.
const TOP_SAFE = H * 0.34
const BOTTOM_SAFE = H * 0.76

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

/**
 * Paint the whole wallpaper: a smooth vertical indigo gradient, a soft radial glow
 * behind the middle band, a small app-icon-style rounded-square mark with the term
 * name under it, and a faint "CUS by VinceJiang" signature tucked into the bottom
 * safe zone. No grid, no hour lines, no course blocks — the image is background only.
 */
function paintBackground(ctx: CanvasRenderingContext2D, termName: string): void {
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#2c2761')
  grad.addColorStop(0.45, '#1e1b4b')
  grad.addColorStop(1, '#100e28')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // Soft glow centered on the middle band, behind the brand mark — the only texture
  // besides the gradient itself.
  const midY = (TOP_SAFE + BOTTOM_SAFE) / 2
  const glow = ctx.createRadialGradient(W / 2, midY, 40, W / 2, midY, W * 0.75)
  glow.addColorStop(0, 'rgba(129, 140, 248, 0.22)')
  glow.addColorStop(1, 'rgba(129, 140, 248, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // Small app-icon-style mark, centered in the middle band between the two safe zones.
  const markSize = 132
  const markX = W / 2 - markSize / 2
  const markY = midY - markSize / 2 - 60
  const markGrad = ctx.createLinearGradient(markX, markY, markX, markY + markSize)
  markGrad.addColorStop(0, 'rgba(165, 180, 252, 0.92)')
  markGrad.addColorStop(1, 'rgba(99, 102, 241, 0.92)')
  roundRect(ctx, markX, markY, markSize, markSize, 34)
  ctx.fillStyle = markGrad
  ctx.fill()
  ctx.fillStyle = 'rgba(30, 27, 75, 0.85)'
  ctx.beginPath()
  ctx.arc(markX + markSize * 0.72, markY + markSize * 0.72, 13, 0, Math.PI * 2)
  ctx.fill()

  // Title + term name, small and centered just below the mark.
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#eef2ff'
  ctx.font = '700 46px system-ui, -apple-system, "PingFang SC", sans-serif'
  ctx.fillText('CU Schedule', W / 2, markY + markSize + 78)
  ctx.fillStyle = 'rgba(199, 210, 254, 0.7)'
  ctx.font = '400 28px system-ui, -apple-system, "PingFang SC", sans-serif'
  ctx.fillText(termName || '本学期课表', W / 2, markY + markSize + 122)

  // Faint signature, tucked well inside the bottom safe zone — doesn't compete with
  // the lock-screen date.
  ctx.fillStyle = 'rgba(199, 210, 254, 0.28)'
  ctx.font = '600 22px system-ui, -apple-system, sans-serif'
  ctx.fillText('CUS by VinceJiang', W / 2, H - 60)
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('生成壁纸失败')
  return blob
}

function freshCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  return { canvas, ctx }
}

/**
 * Produce and download one wallpaper PNG: a clean indigo gradient with generous
 * empty space top and bottom, no timetable. `plan` and `paint` stay in the signature
 * for call-site compatibility with exportPlan.ts, but the wallpaper never renders
 * course data, so neither is used here.
 */
export async function exportWallpaper(
  _plan: Plan,
  termName: string,
  _paint: PaintFn = (_code, subject) => subjectPaint(subject),
): Promise<string> {
  const slug = slugTerm(termName)

  const { canvas, ctx } = freshCanvas()
  paintBackground(ctx, termName)
  downloadBlob(await canvasToPng(canvas), `cu-schedule-壁纸-${slug}.png`)

  return '已下载壁纸（纯渐变，无课表），iPhone 比例 1206×2622'
}
