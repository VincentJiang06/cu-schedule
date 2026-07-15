import { describe, expect, it } from 'vitest'
import { TIMETABLE_PALETTE, colorKey, courseColorPalette, subjectHue, subjectPaint, subjectShade } from './color.ts'

describe('colorKey / subjectHue / subjectShade', () => {
  it('UGE 四面一体:UGEA/UGEB/UGEC/UGED 折叠成同一个色(同一门大学通识要求)', () => {
    for (const s of ['UGEA', 'UGEB', 'UGEC', 'UGED']) expect(colorKey(s)).toBe('UGE')
    expect(new Set(['UGEA', 'UGEB', 'UGEC', 'UGED'].map(subjectHue)).size).toBe(1)
  })

  it('确定性:同学科恒同色;hue 落 [0,360);shade 落 [-2,2]', () => {
    expect(subjectHue('CSCI3130')).toBe(subjectHue('CSCI'))
    for (const s of ['CSCI', 'MATH', 'ENGG', 'PHYS']) {
      const hue = subjectHue(s)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
      const shade = subjectShade(s)
      expect(shade).toBeGreaterThanOrEqual(-2)
      expect(shade).toBeLessThanOrEqual(2)
    }
  })
})

describe('courseColorPalette(append-only,02 §1a:用户的空间记忆是资产)', () => {
  it('槽位按首次出现序分配;追加新课不重排既有课的颜色(核心不变量)', () => {
    const before = courseColorPalette(['CSCI2100', 'MATH1010'])
    const after = courseColorPalette(['CSCI2100', 'MATH1010', 'ENGG1110'])
    for (const key of ['CSCI2100', 'MATH1010']) {
      expect(after(key)).toEqual(before(key))
    }
  })

  it('重复 key 不占新槽;超过调色盘长度后取模回绕', () => {
    const dup = courseColorPalette(['AAAA1000', 'AAAA1000', 'BBBB1000'])
    expect(dup('BBBB1000')).toEqual(courseColorPalette(['AAAA1000', 'BBBB1000'])('BBBB1000'))
    const many = Array.from({ length: TIMETABLE_PALETTE.length + 1 }, (_, i) => `SUBJ${1000 + i}`)
    const palette = courseColorPalette(many)
    expect(palette(many[TIMETABLE_PALETTE.length])).toEqual(palette(many[0])) // 第 13 门回到槽 0 的 hue
  })

  it('未注册的 key 回落槽 0(防御性,不抛)', () => {
    expect(courseColorPalette([])('ZZZZ9999')).toEqual(
      expect.objectContaining({ '--hue': TIMETABLE_PALETTE[0] }),
    )
  })
})

describe('subjectPaint(node 环境走 FALLBACK_THEME_VARS 兜底路径)', () => {
  it('输出三个合法 hsl() 串;同主题同学科幂等', () => {
    const paint = subjectPaint('CSCI', 'light')
    for (const value of [paint.fill, paint.edge, paint.text]) {
      expect(value).toMatch(/^hsl\(\d+ \d+(\.\d+)?% -?\d+(\.\d+)?%\)$/)
    }
    expect(subjectPaint('CSCI', 'light')).toEqual(paint)
  })
})
