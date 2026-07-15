import { beforeAll, describe, expect, it } from 'vitest'
import {
  base64ToUtf8,
  decodeLiveState,
  decodeShare,
  encodeLiveState,
  encodeShare,
  utf8ToBase64,
  type LiveState,
  type SharePayload,
} from './shareLink.ts'

// 编解码 round-trip(04 §3.4)。encodeShare 读 location——node 环境手工桩上,不拉 jsdom。
beforeAll(() => {
  ;(globalThis as Record<string, unknown>).location = {
    origin: 'https://cus.example.com',
    pathname: '/',
  }
})

const payload: SharePayload = {
  termSlug: '2026-27-term-1',
  committed: ['CSCI2100', 'ENGG1000A'],
  taken: ['MATH1010'],
  pins: { CSCI2100: { LEC: 'A-LEC', TUT: 'AT01-TUT' } },
}

describe('utf8 base64 信封', () => {
  it('多字节安全 round-trip(btoa 裸用会炸中文——信封的存在理由)', () => {
    const text = '选课 · Schedule ✓ 2026'
    expect(base64ToUtf8(utf8ToBase64(text))).toBe(text)
  })
})

describe('encodeShare → decodeShare(#s=)', () => {
  it('全字段恒等 round-trip', () => {
    const url = encodeShare(payload)
    expect(url.startsWith('https://cus.example.com/#s=')).toBe(true)
    expect(decodeShare(url.slice(url.indexOf('#')))).toEqual(payload)
  })

  it('恶意/畸形输入一律 null 不抛(04 §6 对抗清单:截断、坏 base64、非对象、缺字段、空)', () => {
    const good = encodeShare(payload)
    const hash = good.slice(good.indexOf('#'))
    expect(decodeShare(hash.slice(0, 20))).toBeNull() // 截断
    expect(decodeShare('#s=!!!not-base64!!!')).toBeNull()
    expect(decodeShare(`#s=${encodeURIComponent(utf8ToBase64('"just a string"'))}`)).toBeNull()
    expect(decodeShare(`#s=${encodeURIComponent(utf8ToBase64('{"committed":"nope","taken":[]}'))}`)).toBeNull()
    expect(decodeShare('#s=')).toBeNull()
    expect(decodeShare('#nothing')).toBeNull()
  })

  it('pins 非对象时回落 {},不连坐整个 payload', () => {
    const json = JSON.stringify({ termSlug: null, committed: [], taken: [], pins: 7 })
    const decoded = decodeShare(`#s=${encodeURIComponent(utf8ToBase64(json))}`)
    expect(decoded).toEqual({ termSlug: null, committed: [], taken: [], pins: {} })
  })
})

const liveState: LiveState = {
  ...payload,
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

describe('encodeLiveState → decodeLiveState(#st=)', () => {
  it('全字段恒等 round-trip(每个开关都取非默认值,防"默认值掩盖丢字段")', () => {
    expect(decodeLiveState(encodeLiveState(liveState))).toEqual(liveState)
  })

  it('缺省字段按文档默认回填(hideConflicts/hideCompleted/currentTermOnly/hideSuperseded=true 其余 false/all/null)', () => {
    const minimal = JSON.stringify({ committed: [], taken: [] })
    const decoded = decodeLiveState(`#st=${encodeURIComponent(utf8ToBase64(minimal))}`)
    expect(decoded).toMatchObject({
      hideConflicts: true,
      hideOutOfHours: false,
      hideCompleted: true,
      currentTermOnly: true,
      hideSuperseded: true,
      programScope: 'all',
      workStart: null,
      workEnd: null,
    })
  })

  it('异族 hash(#s=)与畸形输入 → null', () => {
    expect(decodeLiveState(encodeShare(payload).slice(encodeShare(payload).indexOf('#')))).toBeNull()
    expect(decodeLiveState('#st=broken')).toBeNull()
  })

  it('旧链接的合法 page 带出、非法 page 丢弃(里程碑4:page 已让位给真路由,仅向后兼容)', () => {
    const withPage = JSON.stringify({ committed: [], taken: [], page: 'export' })
    expect(decodeLiveState(`#st=${encodeURIComponent(utf8ToBase64(withPage))}`)?.page).toBe('export')
    const bogus = JSON.stringify({ committed: [], taken: [], page: 'bogus' })
    expect(decodeLiveState(`#st=${encodeURIComponent(utf8ToBase64(bogus))}`)?.page).toBeUndefined()
  })

  it('Page/PageSlug 同步钉死(04 §3.4 踩过的坑):五个 slug 恰好全被认可', () => {
    // App.tsx 的 Page union 与 shareLink 的 PAGE_SLUGS 结构同构由 tsc 保证;这里钉住
    // 值集合本身——改 Page 枚举没同步这里,本测试红。
    const slugs = ['info', 'select', 'timetable', 'export', 'appendix']
    for (const slug of slugs) {
      const json = JSON.stringify({ committed: [], taken: [], page: slug })
      expect(decodeLiveState(`#st=${encodeURIComponent(utf8ToBase64(json))}`)?.page).toBe(slug)
    }
  })
})
