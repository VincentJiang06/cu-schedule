export function hhmm(minutes: number): string {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
}

export const DAY_SHORT = ['一', '二', '三', '四', '五', '六', '日']
