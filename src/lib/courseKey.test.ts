import { describe, expect, it } from 'vitest'
import { codesMatch, courseKey, isCourseCode, keySet, parseCode } from './courseKey.ts'

// 小而神圣(00 红线 3):本套测试就是 key 规则的规格书——钉住现状,不探索新语义。

describe('courseKey', () => {
  it('大小写/标点/空格全部归一,取前 8 字符', () => {
    expect(courseKey('csci 2100')).toBe('CSCI2100')
    expect(courseKey('engg-1000a')).toBe('ENGG1000')
    expect(courseKey('ENGG1000A')).toBe('ENGG1000')
  })
})

describe('parseCode', () => {
  it('无后缀:full=key,suffix 空,level=首位数字', () => {
    expect(parseCode('CSCI2100')).toEqual({
      full: 'CSCI2100', key: 'CSCI2100', subject: 'CSCI', number: '2100', suffix: '', level: 2,
    })
  })

  it('带后缀:后缀单独承载,key 不含后缀', () => {
    expect(parseCode('ENGG1000A')).toMatchObject({ full: 'ENGG1000A', key: 'ENGG1000', suffix: 'A', level: 1 })
  })

  it('畸形短码按位切割兜底,level 落 0 不抛', () => {
    expect(parseCode('ABC')).toMatchObject({ full: 'ABC', subject: 'ABC', number: '', level: 0 })
  })
})

describe('codesMatch(宽松匹配全套)', () => {
  it('后缀差异视为同课:先修写 ENGG1000 → 修过 ENGG1000A 算数,反向同理', () => {
    expect(codesMatch('ENGG1000', 'ENGG1000A')).toBe(true)
    expect(codesMatch('ENGG1000B', 'ENGG1000')).toBe(true)
  })

  it('双后缀同 key 也互相匹配(8 字符裁决,后缀只做展示/双方都有时的精确消歧)', () => {
    expect(codesMatch('ENGG1000A', 'ENGG1000B')).toBe(true)
  })

  it('不同课号不匹配', () => {
    expect(codesMatch('CSCI2100', 'CSCI2110')).toBe(false)
  })
})

describe('isCourseCode', () => {
  it('4 字母 + 4 数字(可带后缀)合法;其余不合法', () => {
    expect(isCourseCode('CSCI2100')).toBe(true)
    expect(isCourseCode('engg1000a')).toBe(true)
    expect(isCourseCode('CS2100')).toBe(false)
    expect(isCourseCode('CSCI210')).toBe(false)
    expect(isCourseCode('')).toBe(false)
  })
})

describe('keySet', () => {
  it('归一 + 去重:同 key 异形只留一份', () => {
    const set = keySet(['csci2100', 'CSCI2100A', 'MATH1010'])
    expect(set).toEqual(new Set(['CSCI2100', 'MATH1010']))
  })
})
