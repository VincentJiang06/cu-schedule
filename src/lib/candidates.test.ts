import { describe, expect, it } from 'vitest'
import { evaluateCandidates } from './candidates.ts'
import { NO_PREFS, generatePlans } from './schedule.ts'
import { mkCourse, mkMeeting, mkSection } from './testFixtures.ts'
import type { Requirement } from './types.ts'

/**
 * 四态判定(04 §3 第二优先)。语义(candidates.ts 头注):
 *   open      = 塞进当前选中排法
 *   rearrange = 当前塞不进,但某个可行排法塞得进
 *   conflict  = 对全部排法都塞不进
 *   tba       = 无带时间组合
 * 构造最小课程夹具逐态命中;每态一个对抗性边界。
 */

const req = (partial: Partial<Requirement>): Requirement => ({
  raw: '',
  prerequisite: null,
  corequisite: null,
  exclusions: [],
  prereqText: '',
  coreqText: '',
  ...partial,
})

// 已选课:两个 section(周一/周二),产出两个排法——rearrange/conflict 的判定基底。
function committedFixture() {
  const committed = mkCourse('AAAA1000', [
    mkSection('S-MON', { meetings: [mkMeeting(1, 540, 600)] }),
    mkSection('S-TUE', { meetings: [mkMeeting(2, 540, 600)] }),
  ])
  const plans = generatePlans([committed], NO_PREFS)
  return { committed, plans }
}

function run(candidates: ReturnType<typeof mkCourse>[], overrides: Partial<Parameters<typeof evaluateCandidates>[0]> = {}) {
  const { committed, plans } = committedFixture()
  return evaluateCandidates({
    courses: [committed, ...candidates],
    taken: [],
    committed: [committed.code],
    plans,
    selectedPlanIndex: 0,
    prefs: NO_PREFS,
    ...overrides,
  })
}

describe('evaluateCandidates 四态', () => {
  it('open:与当前排法无冲突', () => {
    const free = mkCourse('BBBB1000', [mkSection('L1', { meetings: [mkMeeting(3, 540, 600)] })])
    const { rows, summary } = run([free])
    expect(rows.map((r) => [r.course.code, r.status])).toEqual([['BBBB1000', 'open']])
    expect(summary.open).toBe(1)
  })

  it('rearrange:撞当前排法、但能进另一个可行排法', () => {
    const { committed, plans } = committedFixture()
    // 与排法0(按 id 排序后的第一个)的 meeting 撞、与另一个排法不撞——按数据推,不猜排序。
    const p0Day = plans[0].entries[0].section.meetings[0].dayIndex
    const clashP0 = mkCourse('CCCC1000', [
      mkSection('L1', { meetings: [mkMeeting(p0Day, 540, 600)] }),
    ])
    const { rows, summary } = evaluateCandidates({
      courses: [committed, clashP0],
      taken: [],
      committed: [committed.code],
      plans,
      selectedPlanIndex: 0,
      prefs: NO_PREFS,
    })
    expect(rows[0].status).toBe('rearrange')
    expect(summary.rearrange).toBe(1)
  })

  it('conflict(对抗:必须对**全部**排法都塞不进才判死,00 红线级保守语义)', () => {
    // 周一+周二各一段,恰好把两个排法都撞死。
    const both = mkCourse('DDDD1000', [
      mkSection('L1', { meetings: [mkMeeting(1, 540, 600), mkMeeting(2, 540, 600)] }),
    ])
    const { rows, summary } = run([both])
    expect(rows[0].status).toBe('conflict')
    expect(summary.conflict).toBe(1)
  })

  it('tba:只有无时间组合;slots 空、仍给 instructors', () => {
    const tba = mkCourse('EEEE1000', [mkSection('L1', { instructors: ['Prof. X'] })])
    const { rows, summary } = run([tba])
    expect(rows[0].status).toBe('tba')
    expect(rows[0].slots).toEqual([])
    expect(rows[0].instructors).toEqual(['Prof. X'])
    expect(summary.tba).toBe(1)
  })
})

describe('evaluateCandidates 归类与计数', () => {
  it('committed 的课不进 rows;taken 的课只进 summary.taken', () => {
    const takenCourse = mkCourse('FFFF1000', [mkSection('L1', { meetings: [mkMeeting(3, 540, 600)] })])
    const { rows, summary } = run([takenCourse], { taken: ['FFFF1000'] })
    expect(rows.find((r) => r.course.code === 'AAAA1000')).toBeUndefined()
    expect(rows.find((r) => r.course.code === 'FFFF1000')).toBeUndefined()
    expect(summary.taken).toBe(1)
  })

  it('互斥(exclusions)按 8 字符 key 宽松匹配:修过 GGGG1000A 也把要求 GGGG1000 的课划走', () => {
    const barred = mkCourse('HHHH1000', [mkSection('L1', { meetings: [mkMeeting(3, 540, 600)] })], {
      requirement: req({ exclusions: ['GGGG1000'] }),
    })
    const { rows, summary } = run([barred], { taken: ['GGGG1000A'] })
    expect(rows.find((r) => r.course.code === 'HHHH1000')).toBeUndefined()
    expect(summary.ruledOut).toBe(1)
  })

  it('summary 各态计数与 rows 一致', () => {
    const free = mkCourse('BBBB1000', [mkSection('L1', { meetings: [mkMeeting(3, 540, 600)] })])
    const tba = mkCourse('EEEE1000', [mkSection('L1')])
    const { rows, summary } = run([free, tba])
    expect(rows).toHaveLength(2)
    expect(summary.open + summary.rearrange + summary.conflict + summary.tba).toBe(rows.length)
  })
})

describe('先修状态透传(宁漏勿误,00 红线 2)', () => {
  it('met / missing / unverifiable 三态各自透出;unverifiable 永远不是 missing', () => {
    const met = mkCourse('IIII1000', [mkSection('L1', { meetings: [mkMeeting(3, 540, 600)] })], {
      requirement: req({ prerequisite: { t: 'code', code: 'GGGG1000' } }),
    })
    const missing = mkCourse('JJJJ1000', [mkSection('L1', { meetings: [mkMeeting(3, 600, 660)] })], {
      requirement: req({ prerequisite: { t: 'code', code: 'ZZZZ9999' } }),
    })
    const soft = mkCourse('KKKK1000', [mkSection('L1', { meetings: [mkMeeting(3, 660, 720)] })], {
      requirement: req({ prerequisite: { t: 'soft' } }),
    })
    const { rows } = run([met, missing, soft], { taken: ['GGGG1000'] })
    const byCode = new Map(rows.map((r) => [r.course.code, r.prereqStatus]))
    expect(byCode.get('IIII1000')).toBe('met')
    expect(byCode.get('JJJJ1000')).toBe('missing')
    expect(byCode.get('KKKK1000')).toBe('unverifiable')
  })
})
