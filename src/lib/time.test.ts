import { describe, expect, it } from 'vitest'
import { DAY_SHORT, displayEndMinutes, durationTag, hhmm, parseHHMM } from './time.ts'

describe('hhmm / parseHHMM(逆运算,04 §3.7)', () => {
  it('分钟 → HH:MM 补零', () => {
    expect(hhmm(0)).toBe('00:00')
    expect(hhmm(570)).toBe('09:30')
    expect(hhmm(1155)).toBe('19:15')
  })

  it('round-trip:parseHHMM(hhmm(x)) === x', () => {
    for (const x of [0, 545, 570, 750, 1439]) expect(parseHHMM(hhmm(x))).toBe(x)
  })

  it('非法输入一律 null(空串=未设置;25 时/60 分越界)', () => {
    expect(parseHHMM('')).toBeNull()
    expect(parseHHMM('25:00')).toBeNull()
    expect(parseHHMM('12:60')).toBeNull()
    expect(parseHHMM('aa:bb')).toBeNull()
  })
})

describe('displayEndMinutes(:15 结束时间的展示规则——标签真实、高度进位,02 §3 已定勿反复)', () => {
  it('进位到下一个半点;恰在半点不动', () => {
    expect(displayEndMinutes(855)).toBe(870) // 14:15 → 14:30
    expect(displayEndMinutes(765)).toBe(780) // 12:45 → 13:00
    expect(displayEndMinutes(870)).toBe(870) // 14:30 → 14:30
  })
})

describe('durationTag(竖屏四行档时间行,屏上与导出共用单一真源,02 §1f)', () => {
  it('恒 4 字符的档位边界:≤45m / ≤1hr / ≤2hr / 一律 3hr', () => {
    expect(durationTag(0, 45)).toBe('+45m')
    expect(durationTag(0, 46)).toBe('+1hr')
    expect(durationTag(0, 60)).toBe('+1hr')
    expect(durationTag(0, 61)).toBe('+2hr')
    expect(durationTag(0, 120)).toBe('+2hr')
    expect(durationTag(0, 121)).toBe('+3hr')
    expect(durationTag(0, 300)).toBe('+3hr')
  })
})

describe('DAY_SHORT', () => {
  it('七天,周一为首(dayIndex 1 基,取值用 [dayIndex-1])', () => {
    expect(DAY_SHORT).toHaveLength(7)
    expect(DAY_SHORT[0]).toBe('一')
    expect(DAY_SHORT[6]).toBe('日')
  })
})
