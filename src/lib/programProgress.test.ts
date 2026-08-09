import { describe, expect, it } from 'vitest'
import { computeProgramProgress } from './programProgress.ts'
import type { Program, ProgramCourse, SectionNode } from './programs.ts'

/**
 * 学分进度的归并口径单测(04 §4 纪律 2:手写最小夹具,不从 bundle 捞真课)。
 * 覆盖:分节归类与跨节去重、等价课(ESTR 孪生 / 旧课号)命中与学分回退、
 * 预算推导与 reconciled 开关、无课单分节的 countable、方案外 vs 方案有列出但未归组。
 */

function node(partial: Partial<SectionNode> & { marker?: string }): SectionNode {
  return {
    marker: partial.marker ?? '',
    title: partial.title ?? '',
    units: partial.units ?? null,
    note: partial.note ?? null,
    courses: partial.courses ?? [],
    children: partial.children ?? [],
    ...(partial.kind ? { kind: partial.kind } : {}),
  }
}

const c = (code: string, ...alts: string[]): ProgramCourse => ({ code, alts })

function program(structure: SectionNode[], extra: Partial<Program> = {}): Program {
  const all = extra.all ?? []
  return {
    id: '2025:Test',
    year: '2025',
    name_en: 'Test',
    name_chi: '测试',
    faculty: 'Engineering',
    faculties: ['Engineering'],
    degree: 'B.Sc',
    total_units: extra.total_units ?? null,
    parse_status: 'full',
    required: [],
    elective: [],
    streams: [],
    all,
    structure,
  }
}

// 目录:CSCI1130=3、ENGG1110=3、DOTE1030=2、ENGG1111=0;ESTR/DSME/停开课一律查不到。
const CATALOG: Record<string, number> = { CSCI1130: 3, ENGG1110: 3, DOTE1030: 2, ENGG1111: 0 }
const unitsFor = (key: string): number | null => CATALOG[key] ?? null

describe('computeProgramProgress · 分节归类', () => {
  it('按顶层 section 归类,子树里的课都算进本节', () => {
    const p = program([
      node({ marker: '1.', title: 'Faculty Package', units: 6, courses: [c('ENGG1110')],
        children: [node({ marker: '(a)', courses: [c('CSCI1130')] })] }),
    ])
    const r = computeProgramProgress(p, new Set(['ENGG1110', 'CSCI1130']), unitsFor)
    expect(r.sections[0]).toMatchObject({ earned: 6, required: 6, count: 2, estimated: 0 })
  })

  it('同一门课在本节里出现多次只算一次,跨节则各节都算、方案累计只算一次', () => {
    const p = program(
      [
        node({ marker: '1.', units: 3, courses: [c('CSCI1130'), c('CSCI1130')] }),
        node({ marker: '2.', units: 3, courses: [c('CSCI1130')] }),
      ],
      { total_units: 6 },
    )
    const r = computeProgramProgress(p, new Set(['CSCI1130']), unitsFor)
    expect(r.sections.map((s) => s.earned)).toEqual([3, 3])
    expect(r.inProgram).toMatchObject({ earned: 3, count: 1 })
  })
})

describe('computeProgramProgress · 等价课与学分回退', () => {
  it('成绩单记的是孪生码时照样命中', () => {
    const p = program([node({ marker: '1.', units: 3, courses: [c('CSCI1130', 'ESTR1102')] })])
    const r = computeProgramProgress(p, new Set(['ESTR1102']), unitsFor)
    expect(r.sections[0].count).toBe(1)
    expect(r.outside.count).toBe(0)
  })

  it('命中的那一半查不到学分时,在等价组里回退到查得到的一半(不再误报「按 3 学分估算」)', () => {
    // 学生修的是旧课号 DSME1030,目录里只有改名后的 DOTE1030(2 学分)。
    const p = program([node({ marker: '1.', units: 2, courses: [c('DOTE1030', 'DSME1030')] })])
    const r = computeProgramProgress(p, new Set(['DSME1030']), unitsFor)
    expect(r.sections[0]).toMatchObject({ earned: 2, estimated: 0 })
  })

  it('整组都查不到才算学分未知,按 3 学分估并记门数', () => {
    const p = program([node({ marker: '1.', units: 3, courses: [c('XXXX9999', 'YYYY9999')] })])
    const r = computeProgramProgress(p, new Set(['XXXX9999']), unitsFor)
    expect(r.sections[0]).toMatchObject({ earned: 3, estimated: 1 })
  })

  it('0 学分的课如实计 0,不当成「查不到」去估 3 分', () => {
    const p = program([node({ marker: '1.', units: 3, courses: [c('ENGG1111')] })])
    const r = computeProgramProgress(p, new Set(['ENGG1111']), unitsFor)
    expect(r.sections[0]).toMatchObject({ earned: 0, count: 1, estimated: 0 })
  })
})

describe('computeProgramProgress · 预算推导', () => {
  it('节自身没声明学分时,取子节点之和', () => {
    const p = program(
      [node({ marker: '1.', children: [node({ units: 3 }), node({ units: 6 })] })],
      { total_units: 9 },
    )
    const r = computeProgramProgress(p, new Set(), unitsFor)
    expect(r.reconciled).toBe(true)
    expect(r.sections[0].required).toBe(9)
  })

  it('推导总和对不上 total_units 时不认推导值,只保留显式声明的节上限', () => {
    const p = program(
      [
        node({ marker: '1.', units: 9 }),
        node({ marker: '2.', children: [node({ units: 30 })] }), // 推导 30,与总数矛盾
      ],
      { total_units: 30 },
    )
    const r = computeProgramProgress(p, new Set(), unitsFor)
    expect(r.reconciled).toBe(false)
    expect(r.sections.map((s) => s.required)).toEqual([9, null])
  })
})

describe('computeProgramProgress · countable', () => {
  it('有学分预算却一门课都没列的节标 countable=false', () => {
    // Economics §3:「36 units of elective ECON courses at 3000 or above level」,无课单。
    const p = program([
      node({ marker: '3.', title: 'Elective Courses', units: 36,
        note: '36 units of elective ECON courses at 3000 or above level' }),
    ])
    const r = computeProgramProgress(p, new Set(['ECON3011']), unitsFor)
    expect(r.sections[0]).toMatchObject({ countable: false, required: 36, earned: 0 })
  })

  it('子节点里列了课就算 countable', () => {
    const p = program([node({ marker: '3.', units: 6, children: [node({ courses: [c('CSCI1130')] })] })])
    expect(computeProgramProgress(p, new Set(), unitsFor).sections[0].countable).toBe(true)
  })
})

describe('computeProgramProgress · 方案外 vs 未归组', () => {
  it('方案页列过但没归进任何一组的课单独一档,不混进「不在本方案内」', () => {
    const p = program([node({ marker: '1.', units: 3, courses: [c('CSCI1130')] })], {
      all: ['CSCI1130', 'DOTE1030'], // DOTE1030 只出现在 all(附录课表),没进 structure
    })
    const r = computeProgramProgress(p, new Set(['CSCI1130', 'DOTE1030', 'ENGG1110']), unitsFor)
    expect(r.inProgram).toMatchObject({ count: 1, earned: 3 })
    expect(r.unplaced).toMatchObject({ count: 1, earned: 2 })
    expect(r.outside).toMatchObject({ count: 1, earned: 3 })
  })

  it('未归组的课不计入本方案累计(那份课单未必属于本专业要求)', () => {
    const p = program([node({ marker: '1.', units: 3, courses: [c('CSCI1130')] })], {
      all: ['CSCI1130', 'DOTE1030'],
      total_units: 3,
    })
    const r = computeProgramProgress(p, new Set(['DOTE1030']), unitsFor)
    expect(r.inProgram.earned).toBe(0)
    expect(r.unplaced.earned).toBe(2)
  })
})

describe('computeProgramProgress · prose_only', () => {
  it('无结构化清单时按 all 清单统计方案累计', () => {
    const p = program([], { all: ['CSCI1130', 'ENGG1110'], total_units: 6 })
    const r = computeProgramProgress(p, new Set(['CSCI1130', 'ENGG1110', 'XXXX9999']), unitsFor)
    expect(r.sections).toEqual([])
    expect(r.inProgram).toMatchObject({ earned: 6, count: 2 })
    expect(r.outside).toMatchObject({ count: 1, earned: 3, estimated: 1 })
  })
})
