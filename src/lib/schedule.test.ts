import { describe, expect, it } from 'vitest'
import {
  NO_PREFS,
  blockedByPrefs,
  comboMeetings,
  courseCombos,
  courseFitsWindow,
  findClashes,
  generatePlans,
  meetingsFitWindow,
  overlaps,
  planMatchesPins,
  planSectionMap,
  type Prefs,
} from './schedule.ts'
import { mkCourse, mkMeeting, mkSection, planIsConflictFree } from './testFixtures.ts'

// 排课引擎(04 §3 第一优先)。夹具全部手写最小对象(04 §4.2)。

describe('overlaps', () => {
  it('同日区间相交 → 撞', () => {
    expect(overlaps(mkMeeting(1, 540, 600), mkMeeting(1, 570, 630))).toBe(true)
  })

  it('同刻相接不算撞(end==start,04 §3.1 边界:10:00 下课接 10:00 上课合法)', () => {
    expect(overlaps(mkMeeting(1, 540, 600), mkMeeting(1, 600, 660))).toBe(false)
  })

  it('异日同时段不算撞', () => {
    expect(overlaps(mkMeeting(1, 540, 600), mkMeeting(2, 540, 600))).toBe(false)
  })
})

describe('meetingsFitWindow', () => {
  it('两侧都 null = 不限,恒 true', () => {
    expect(meetingsFitWindow([mkMeeting(1, 0, 1440)], { start: null, end: null })).toBe(true)
  })

  it('边界含等号:9:00–10:00 的课恰好塞进 [9:00,10:00] 窗口', () => {
    expect(meetingsFitWindow([mkMeeting(1, 540, 600)], { start: 540, end: 600 })).toBe(true)
  })

  it('早于窗口起点 / 晚于窗口终点 → 不符合(null 一侧不限)', () => {
    expect(meetingsFitWindow([mkMeeting(1, 539, 600)], { start: 540, end: null })).toBe(false)
    expect(meetingsFitWindow([mkMeeting(1, 540, 601)], { start: null, end: 600 })).toBe(false)
  })

  it('TBA(空 meeting 列表)天然符合——没东西可判', () => {
    expect(meetingsFitWindow([], { start: 540, end: 600 })).toBe(true)
  })
})

// cohort 配对课:A/B 两个 cohort 各一对 LEC+TUT。
function cohortCourse() {
  return mkCourse('CSCI2100', [
    mkSection('A-LEC', { cohort: 'A', component: 'LEC', meetings: [mkMeeting(1, 540, 600)] }),
    mkSection('B-LEC', { cohort: 'B', component: 'LEC', meetings: [mkMeeting(2, 540, 600)] }),
    mkSection('AT01-TUT', { cohort: 'A', component: 'TUT', meetings: [mkMeeting(3, 540, 600)] }),
    mkSection('BT01-TUT', { cohort: 'B', component: 'TUT', meetings: [mkMeeting(4, 540, 600)] }),
  ])
}

describe('courseCombos', () => {
  it('cohort 铁律(00 §1/04 §3 对抗用例):A-LEC 只配 AT01,绝不配 BT01', () => {
    const combos = courseCombos(cohortCourse(), NO_PREFS)
    expect(combos).toHaveLength(2)
    for (const combo of combos) {
      const cohorts = new Set(combo.map((s) => s.cohort))
      expect(cohorts.size).toBe(1) // 一个组合内只有一个 cohort 字母
    }
  })

  it('空 cohort 是通配:无字母 LEC 可以配任何 cohort 的 TUT', () => {
    const course = mkCourse('CSCI1130', [
      mkSection('L1', { component: 'LEC', meetings: [mkMeeting(1, 540, 600)] }),
      mkSection('AT01', { cohort: 'A', component: 'TUT', meetings: [mkMeeting(2, 540, 600)] }),
      mkSection('BT01', { cohort: 'B', component: 'TUT', meetings: [mkMeeting(3, 540, 600)] }),
    ])
    expect(courseCombos(course, NO_PREFS)).toHaveLength(2)
  })

  it('单 component 课:每个 section 自成一个组合', () => {
    const course = mkCourse('MATH1010', [
      mkSection('L1', { meetings: [mkMeeting(1, 540, 600)] }),
      mkSection('L2', { meetings: [mkMeeting(2, 540, 600)] }),
    ])
    expect(courseCombos(course, NO_PREFS)).toHaveLength(2)
  })

  it('课自身组件互撞的组合被剔除(comboSelfConsistent)', () => {
    const course = mkCourse('PHYS1110', [
      mkSection('L1', { component: 'LEC', meetings: [mkMeeting(1, 540, 660)] }),
      mkSection('T1', { component: 'TUT', meetings: [mkMeeting(1, 600, 660)] }),
    ])
    expect(courseCombos(course, NO_PREFS)).toHaveLength(0)
  })

  it('钉选生效:pin TUT=BT01 后只剩 B cohort 的组合', () => {
    const combos = courseCombos(cohortCourse(), NO_PREFS, { TUT: 'BT01-TUT' })
    expect(combos).toHaveLength(1)
    expect(combos[0].map((s) => s.id).sort()).toEqual(['B-LEC', 'BT01-TUT'])
  })

  it('钉到不存在的 section id → 回落全集(不产生空结果,现状语义钉死)', () => {
    expect(courseCombos(cohortCourse(), NO_PREFS, { TUT: 'ZT99' })).toHaveLength(2)
  })

  it('prefs.dayOff 剔除该日组合;TBA-only 课不受 prefs 影响(没 meeting 可违反)', () => {
    const prefs: Prefs = { ...NO_PREFS, dayOff: [1] }
    const monOnly = mkCourse('AIST1000', [mkSection('L1', { meetings: [mkMeeting(1, 540, 600)] })])
    const tba = mkCourse('AIST2000', [mkSection('L1')])
    expect(courseCombos(monOnly, prefs)).toHaveLength(0)
    expect(courseCombos(tba, prefs)).toHaveLength(1)
  })
})

describe('generatePlans', () => {
  it('空课程列表 → 空排法', () => {
    expect(generatePlans([], NO_PREFS)).toHaveLength(0)
  })

  it('无冲突保证(对抗用例):部分组合互撞时,产出的每个排法内部两两不重叠', () => {
    // X1 只撞 Y1、X2 只撞 Y2 → 恰好两个可行排法 X1+Y2 / X2+Y1。
    const x = mkCourse('XXXX1000', [
      mkSection('X1', { meetings: [mkMeeting(1, 540, 600)] }),
      mkSection('X2', { meetings: [mkMeeting(1, 660, 720)] }),
    ])
    const y = mkCourse('YYYY1000', [
      mkSection('Y1', { meetings: [mkMeeting(1, 570, 630)] }),
      mkSection('Y2', { meetings: [mkMeeting(1, 690, 750)] }),
    ])
    const plans = generatePlans([x, y], NO_PREFS)
    expect(plans).toHaveLength(2)
    for (const plan of plans) {
      expect(planIsConflictFree(plan.entries.flatMap((e) => e.section.meetings))).toBe(true)
    }
  })

  it('按上课天数升序(00 哲学:最省跑校日的排法排最前)', () => {
    const course = mkCourse('ENGG1110', [
      mkSection('S1', { meetings: [mkMeeting(1, 540, 600), mkMeeting(3, 540, 600)] }), // 2 天
      mkSection('S2', { meetings: [mkMeeting(1, 540, 600)] }), // 1 天
    ])
    const plans = generatePlans([course], NO_PREFS)
    expect(plans.map((p) => p.teachingDays.length)).toEqual([1, 2])
  })

  it('上限 MAX_PLANS=48(里程碑5 从 12 提高,04 §3 旧文案已更正):60 个组合只出 48 个排法', () => {
    const sections = Array.from({ length: 60 }, (_, i) =>
      mkSection(`L${String(i).padStart(2, '0')}`, { meetings: [mkMeeting(1, 540, 600)] }),
    )
    const plans = generatePlans([mkCourse('BULK1000', sections)], NO_PREFS)
    expect(plans).toHaveLength(48)
  })

  it('pins 约束贯穿:钉选后所有排法该课该 component 固定', () => {
    const plans = generatePlans([cohortCourse()], NO_PREFS, { CSCI2100: { TUT: 'AT01-TUT' } })
    expect(plans.length).toBeGreaterThan(0)
    for (const plan of plans) {
      const tut = plan.entries.find((e) => e.section.component === 'TUT')
      expect(tut?.section.id).toBe('AT01-TUT')
    }
  })

  it('units 按课去重求和(一门课两个 section 不重复计学分)', () => {
    const plans = generatePlans([cohortCourse()], NO_PREFS)
    expect(plans[0].units).toBe(3)
  })
})

describe('planMatchesPins / planSectionMap', () => {
  it('planSectionMap 的形状即 Pins,拿回去过滤恒真;改钉别的 section 则假', () => {
    const plans = generatePlans([cohortCourse()], NO_PREFS)
    const plan = plans[0]
    const map = planSectionMap(plan)
    expect(planMatchesPins(plan, map)).toBe(true)
    const other = plan.entries[0].section.id === 'A-LEC' ? 'B-LEC' : 'A-LEC'
    expect(planMatchesPins(plan, { CSCI2100: { LEC: other } })).toBe(false)
  })

  it('pins 里没提到的 component 不做限制', () => {
    const plans = generatePlans([cohortCourse()], NO_PREFS)
    expect(planMatchesPins(plans[0], { CSCI2100: {} })).toBe(true)
    expect(planMatchesPins(plans[0], {})).toBe(true)
  })
})

describe('findClashes', () => {
  it('排不出时报出互撞课对与重叠区间', () => {
    const x = mkCourse('XXXX1000', [mkSection('X1', { meetings: [mkMeeting(1, 540, 600)] })])
    const y = mkCourse('YYYY1000', [mkSection('Y1', { meetings: [mkMeeting(1, 570, 630)] })])
    expect(generatePlans([x, y], NO_PREFS)).toHaveLength(0)
    const clashes = findClashes([x, y], NO_PREFS)
    expect(clashes).toHaveLength(1)
    expect(clashes[0]).toMatchObject({ codes: ['XXXX1000', 'YYYY1000'], dayIndex: 1, start: 570, end: 600 })
  })

  it('存在任一互不撞的组合对 → 不报', () => {
    const x = mkCourse('XXXX1000', [
      mkSection('X1', { meetings: [mkMeeting(1, 540, 600)] }),
      mkSection('X2', { meetings: [mkMeeting(2, 540, 600)] }),
    ])
    const y = mkCourse('YYYY1000', [mkSection('Y1', { meetings: [mkMeeting(1, 570, 630)] })])
    expect(findClashes([x, y], NO_PREFS)).toHaveLength(0)
  })
})

describe('blockedByPrefs / courseFitsWindow', () => {
  it('仅因偏好而无组合的课被点名;本来就排不出的课不算', () => {
    const monOnly = mkCourse('AIST1000', [mkSection('L1', { meetings: [mkMeeting(1, 540, 600)] })])
    const selfClash = mkCourse('AIST3000', [
      mkSection('L1', { component: 'LEC', meetings: [mkMeeting(2, 540, 660)] }),
      mkSection('T1', { component: 'TUT', meetings: [mkMeeting(2, 600, 660)] }),
    ])
    const prefs: Prefs = { ...NO_PREFS, dayOff: [1] }
    expect(blockedByPrefs([monOnly, selfClash], prefs)).toEqual(['AIST1000'])
  })

  it('courseFitsWindow:不看已选课,只问这门课自己有没有全落窗内的组合', () => {
    const course = mkCourse('MGNT1020', [
      mkSection('L1', { meetings: [mkMeeting(1, 480, 540)] }), // 8:00–9:00,窗外
      mkSection('L2', { meetings: [mkMeeting(1, 600, 660)] }), // 10:00–11:00,窗内
    ])
    expect(courseFitsWindow(course, { start: 570, end: 1110 })).toBe(true)
    expect(courseFitsWindow(course, { start: 700, end: 1110 })).toBe(false)
    expect(courseFitsWindow(course, { start: null, end: null })).toBe(true)
  })
})

describe('comboMeetings', () => {
  it('拍平组合内全部 meeting(排序不承诺,数量与内容为准)', () => {
    const combos = courseCombos(cohortCourse(), NO_PREFS)
    expect(comboMeetings(combos[0])).toHaveLength(2)
  })
})
