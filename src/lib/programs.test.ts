import { describe, expect, it } from 'vitest'
import { nearestDataYear, searchPrograms, type Program } from './programs.ts'

/**
 * 入学年份的取值口径(04 §4 纪律 2:手写最小夹具)。钉住的现状是:
 * 界面上的入学年份下拉是**固定**的 2022…2026,而 programs.json 只覆盖被抓过的那几年,
 * 两者必然会错开(新一届方案还没公布 / 老一届早于抓取范围)。错开时**不能**把候选列表
 * 过滤成空 —— 那会让该届学生填不进主修,整张「我的情况」卡永远填不完。
 */

function prog(year: string, name_en: string): Program {
  return {
    id: `${year}:${name_en}`,
    year,
    name_en,
    name_chi: '',
    faculty: 'Faculty of Science',
    faculties: ['Faculty of Science'],
    degree: 'B.Sc',
    total_units: null,
    parse_status: 'full',
    required: [],
    elective: [],
    streams: [],
    all: [],
    structure: [],
  }
}

const PROGRAMS = [
  prog('2023', 'B.Sc. in Computer Science'),
  prog('2024', 'B.Sc. in Computer Science'),
  prog('2025', 'B.Sc. in Computer Science'),
  prog('2023', 'B.Eng. in Computer Engineering'),
]

describe('nearestDataYear', () => {
  it('数据覆盖该年份就原样返回', () => {
    expect(nearestDataYear(PROGRAMS, '2024')).toBe('2024')
  })

  it('晚于抓取范围(如新一届)回退到最近的一年', () => {
    expect(nearestDataYear(PROGRAMS, '2026')).toBe('2025')
  })

  it('早于抓取范围回退到最近的一年', () => {
    expect(nearestDataYear(PROGRAMS, '2021')).toBe('2023')
  })

  it('没给年份 / 年份不是数字 / 数据为空,都返回 undefined(即不按年份收窄)', () => {
    expect(nearestDataYear(PROGRAMS, undefined)).toBeUndefined()
    expect(nearestDataYear(PROGRAMS, '')).toBeUndefined()
    expect(nearestDataYear(PROGRAMS, '不是年份')).toBeUndefined()
    expect(nearestDataYear([], '2026')).toBeUndefined()
  })
})

describe('searchPrograms 的年份收窄', () => {
  it('命中的年份只出该年的那一版', () => {
    const hit = searchPrograms(PROGRAMS, 'Computer Science', { year: '2024' })
    expect(hit.map((p) => p.id)).toEqual(['2024:B.Sc. in Computer Science'])
  })

  it('数据没覆盖的年份不会搜空,落到最近的一年', () => {
    const hit = searchPrograms(PROGRAMS, 'Computer Science', { year: '2026' })
    expect(hit.map((p) => p.id)).toEqual(['2025:B.Sc. in Computer Science'])
  })

  it('空查询(刚点开下拉)同样按最近年份出候选,而不是一片空白', () => {
    const hit = searchPrograms(PROGRAMS, '', { year: '2026' })
    expect(hit.length).toBeGreaterThan(0)
    expect(hit.every((p) => p.year === '2025')).toBe(true)
  })
})
