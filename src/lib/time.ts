export function hhmm(minutes: number): string {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
}

// 课表卡片的结束时间显示标准：本校无 :15 / :45 开始的课，故把结束时间进位到下一个半点
// （14:15 → 14:30、12:45 → 13:00），让卡片更高、内容更从容——中间那 15 分钟本就是赶路时间。
// 仅用于展示/占位高度，不改动真实排课与冲突判定。
export function displayEndMinutes(minutes: number): number {
  return Math.ceil(minutes / 30) * 30
}

export const DAY_SHORT = ['一', '二', '三', '四', '五', '六', '日']
