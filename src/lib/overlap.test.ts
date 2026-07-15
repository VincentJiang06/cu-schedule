import { describe, expect, it } from 'vitest'
import { overlapMidpoints } from './overlap.ts'

// 冲突感叹号的落点计算(里程碑2):用真实 start/end 判定,不看进位后的展示高度。

describe('overlapMidpoints', () => {
  it('无重叠 → 空;同刻相接(end==start)不算重叠(与 schedule.overlaps 同一裁决)', () => {
    expect(overlapMidpoints([{ start: 540, end: 600 }, { start: 600, end: 660 }])).toEqual([])
  })

  it('一对重叠 → 重叠区间中点', () => {
    expect(overlapMidpoints([{ start: 540, end: 600 }, { start: 570, end: 630 }])).toEqual([585])
  })

  it('三块互相重叠 → 每对各一个标记(O(n²) 两两扫描)', () => {
    const marks = overlapMidpoints([
      { start: 540, end: 660 },
      { start: 560, end: 620 },
      { start: 580, end: 640 },
    ])
    expect(marks).toHaveLength(3)
  })
})
