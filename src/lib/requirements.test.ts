import { describe, expect, it } from 'vitest'
import { checkRequirement, evaluate, evaluateRequirement } from './requirements.ts'
import type { ReqNode, Requirement } from './types.ts'

/**
 * 边界补充(04 §3.5):主 sweep 在 data:check(964 门零误报),这里只钉三值语义现状。
 * ⚠ 00 红线 3:本套测试是"钉住现状"不是"探索新语义"——红了先怀疑测试的理解。
 */

const req = (partial: Partial<Requirement>): Requirement => ({
  raw: '', prerequisite: null, corequisite: null, exclusions: [], prereqText: '', coreqText: '',
  ...partial,
})

const code = (c: string): ReqNode => ({ t: 'code', code: c })
const soft: ReqNode = { t: 'soft' }
const and = (...kids: ReqNode[]): ReqNode => ({ t: 'and', kids })
const or = (...kids: ReqNode[]): ReqNode => ({ t: 'or', kids })

describe('evaluate 三值真值表(and/or × yes/no/maybe 九宫格)', () => {
  const taken = new Set(['AAAA1000']) // code('AAAA1000')=yes、code('ZZZZ9999')=no、soft=maybe

  it('叶子:code 确定性 yes/no;soft/unknown 恒 maybe(宁漏勿误:无法核验≠不满足)', () => {
    expect(evaluate(code('AAAA1000'), taken)).toBe('yes')
    expect(evaluate(code('ZZZZ9999'), taken)).toBe('no')
    expect(evaluate(soft, taken)).toBe('maybe')
    expect(evaluate({ t: 'unknown' }, taken)).toBe('maybe')
  })

  it('and:no 支配 > maybe > yes', () => {
    expect(evaluate(and(code('AAAA1000'), code('ZZZZ9999')), taken)).toBe('no')
    expect(evaluate(and(code('ZZZZ9999'), soft), taken)).toBe('no')
    expect(evaluate(and(code('AAAA1000'), soft), taken)).toBe('maybe')
    expect(evaluate(and(code('AAAA1000'), code('AAAA1000')), taken)).toBe('yes')
  })

  it('or:yes 支配 > maybe > no(对抗:or(no, maybe) 必须是 maybe 不是 no——能不能满足未知)', () => {
    expect(evaluate(or(code('ZZZZ9999'), code('AAAA1000')), taken)).toBe('yes')
    expect(evaluate(or(soft, code('AAAA1000')), taken)).toBe('yes')
    expect(evaluate(or(code('ZZZZ9999'), soft), taken)).toBe('maybe')
    expect(evaluate(or(code('ZZZZ9999'), code('ZZZZ9999')), taken)).toBe('no')
  })
})

describe('evaluateRequirement', () => {
  it('prereq 三态映射:yes→met / no→missing / maybe→unverifiable;无先修→none', () => {
    const taken = new Set(['AAAA1000'])
    expect(evaluateRequirement(req({ prerequisite: code('AAAA1000') }), taken).prereqStatus).toBe('met')
    expect(evaluateRequirement(req({ prerequisite: code('ZZZZ9999') }), taken).prereqStatus).toBe('missing')
    expect(evaluateRequirement(req({ prerequisite: soft }), taken).prereqStatus).toBe('unverifiable')
    expect(evaluateRequirement(req({}), taken).prereqStatus).toBe('none')
  })

  it('taken 按 8 字符 key 归一:修过 AAAA1000A 满足写作 AAAA1000 的先修', () => {
    const result = evaluateRequirement(req({ prerequisite: code('AAAA1000') }), new Set(['AAAA1000A']))
    expect(result.prereqStatus).toBe('met')
  })

  it('coreq 认 committed(可同期修读);prereq 不认(必须已修完)——两者的本质区别', () => {
    const requirement = req({ prerequisite: code('AAAA1000'), corequisite: code('AAAA1000') })
    const result = evaluateRequirement(requirement, new Set(), new Set(['AAAA1000']))
    expect(result.coreqStatus).toBe('met')
    expect(result.prereqStatus).toBe('missing')
  })

  it('exclusions 命中即 ruledOut(互斥比先修先裁决,candidates 靠它划走整门课)', () => {
    const result = evaluateRequirement(req({ exclusions: ['AAAA1000'] }), new Set(['AAAA1000A']))
    expect(result.ruledOut).toEqual(['AAAA1000'])
  })
})

describe('checkRequirement(一次性解析+求值便捷通道,冒烟)', () => {
  it('简单 or 先修:修过其一即 met', () => {
    const result = checkRequirement('Pre-requisite: CSCI1110 or CSCI1130', new Set(['CSCI1130']))
    expect(result.prereqStatus).toBe('met')
  })
})
