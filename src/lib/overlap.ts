/** 里程碑2「冲突圆形感叹号」共用的重叠检测：给定同一天/同一子列内的一组时间块，
 * 两两比较找出真正重叠的那些，连同重叠区间本身一并返回——渲染方只需把徽标放在
 * `(start+end)/2` 这个纵坐标、该列水平居中即可，不用重复写 O(n²) 扫描。
 * 用真实 start/end(不是进位后的展示高度)判定，避免"卡片为了美观拉高"被误判成冲突。 */
export type TimeSpan = { start: number; end: number }

export function overlapMidpoints<T extends TimeSpan>(spans: T[]): number[] {
  const marks: number[] = []
  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length; j += 1) {
      const start = Math.max(spans[i].start, spans[j].start)
      const end = Math.min(spans[i].end, spans[j].end)
      if (start < end) marks.push((start + end) / 2)
    }
  }
  return marks
}
