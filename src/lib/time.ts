export function hhmm(minutes: number): string {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
}

// Inverse of hhmm: parses an <input type="time"> value ("HH:MM", optionally "HH:MM:SS")
// back into minutes-since-midnight. Empty / malformed input means "not set" (null) —
// used by the 上下班时间 free-text time fields, whose empty state means "no line".
export function parseHHMM(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

// 课表卡片的结束时间显示标准：本校无 :15 / :45 开始的课，故把结束时间进位到下一个半点
// （14:15 → 14:30、12:45 → 13:00），让卡片更高、内容更从容——中间那 15 分钟本就是赶路时间。
// 仅用于展示/占位高度，不改动真实排课与冲突判定。
export function displayEndMinutes(minutes: number): number {
  return Math.ceil(minutes / 30) * 30
}

export const DAY_SHORT = ['一', '二', '三', '四', '五', '六', '日']
