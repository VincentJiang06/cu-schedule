import { describe, expect, it } from 'vitest'
import { configMdFilename, decodeConfigMd, encodeConfigMd, sanitizeConfigState, todayLabel, type ConfigMdState } from './configMd.ts'

// .md 配置是唯一的双向可携带格式(00 哲学 9);round-trip 恒等是它的存在意义(04 §3.4)。

const state: ConfigMdState = {
  termSlug: '2026-27-term-1',
  committed: ['CSCI2100', 'ENGG1000A'],
  taken: ['MATH1010', 'PHYS1110'],
  cart: ['AIST1000'],
  pins: { CSCI2100: { LEC: 'A-LEC' } },
  hideConflicts: false,
  hideOutOfHours: true,
  meetsOfficeHours: true,
  meetsPrereq: true,
  lecFits: true,
  hideCompleted: false,
  currentTermOnly: false,
  excludeTba: true,
  hideSuperseded: false,
  programScope: 'program',
  workStart: 570,
  workEnd: 1110,
}

describe('encodeConfigMd → decodeConfigMd', () => {
  it('机读块在场:精确 round-trip(含 cart/pins/全开关,均取非默认值)', () => {
    expect(decodeConfigMd(encodeConfigMd(state, { termName: '2026-27 Term 1' }))).toEqual(state)
  })

  it('机读块被人手删掉:按标题刮课号的降级恢复(课号在、pins/开关丢、termSlug 丢;后缀也丢——CODE_RE 只刮 8 字符核心,key 等价故语义无损,lossy 现状钉死)', () => {
    const md = encodeConfigMd(state)
    const stripped = md.slice(0, md.indexOf('<!-- cuhk-schedule-config:v1'))
    const decoded = decodeConfigMd(stripped)
    expect(decoded).not.toBeNull()
    expect(decoded).toMatchObject({
      committed: ['CSCI2100', 'ENGG1000'],
      taken: ['MATH1010', 'PHYS1110'],
      cart: ['AIST1000'],
      pins: {},
      termSlug: null,
    })
  })

  it('机读块损坏 → 降级刮 prose,而不是整体失败(分层导入承诺)', () => {
    const md = encodeConfigMd(state).replace(/cuhk-schedule-config:v1\n[^ ]+/, 'cuhk-schedule-config:v1\n!!corrupt!!')
    const decoded = decodeConfigMd(md)
    expect(decoded?.committed).toEqual(['CSCI2100', 'ENGG1000'])
  })

  it('外来文件/空串 → null 不抛', () => {
    expect(decodeConfigMd('')).toBeNull()
    expect(decodeConfigMd('# 无关的 markdown\n\n随便写点啥')).toBeNull()
  })

  it('节标题是解析协议 key(02 §4 坑):标题必须恒为简体原文,换语言导出也不许变', () => {
    const md = encodeConfigMd(state)
    for (const heading of ['## 要上的课', '## 已修过的课', '## 备选课（可能学）', '## 锁定时段']) {
      expect(md).toContain(heading)
    }
  })
})

describe('sanitizeConfigState(cloud.ts 与 .md 共用的唯一 schema 裁决处)', () => {
  it('合法最小对象 → 缺省字段回填文档默认', () => {
    const sane = sanitizeConfigState({ committed: [], taken: [] })
    expect(sane).toMatchObject({
      cart: [],
      pins: {},
      hideConflicts: true,
      hideCompleted: true,
      currentTermOnly: true,
      hideSuperseded: true,
      programScope: 'all',
      workStart: null,
      workEnd: null,
    })
  })

  it('必填字段缺失/类型不对 → null(云端整包与 .md 同一严格度)', () => {
    expect(sanitizeConfigState(null)).toBeNull()
    expect(sanitizeConfigState('x')).toBeNull()
    expect(sanitizeConfigState({ committed: 'no', taken: [] })).toBeNull()
    expect(sanitizeConfigState({ committed: [], taken: [1, 2] })).toBeNull()
  })

  it('pins 形状不合法时回落 {} 而非整体拒收', () => {
    expect(sanitizeConfigState({ committed: [], taken: [], pins: { A: { L: 3 } } })?.pins).toEqual({})
  })
})

describe('文件名/日期', () => {
  it('todayLabel 固定 YYYY-MM-DD;文件名规格 `${date} CUHK Schedule.md`', () => {
    const date = new Date(2026, 6, 15)
    expect(todayLabel(date)).toBe('2026-07-15')
    expect(configMdFilename(date)).toBe('2026-07-15 CUHK Schedule.md')
  })
})
