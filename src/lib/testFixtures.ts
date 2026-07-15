import { parseCode } from './courseKey.ts'
import { EMPTY_REQUIREMENT } from './types.ts'
import type { Course, Meeting, Requirement, Section } from './types.ts'

/**
 * 手工最小夹具构造器(04 §4 纪律 2:单测不从 bundle 捞真课,真数据随学年漂移,
 * 手写对象十年不坏)。只给 schedule/candidates 等 lib 单测用,不进产品包
 * (无任何产品模块 import 它,vite tree 上不可达)。
 */

export function mkMeeting(dayIndex: number, start: number, end: number, location = ''): Meeting {
  return { dayIndex, start, end, location }
}

export function mkSection(
  id: string,
  partial: Partial<Omit<Section, 'id' | 'isTba'>> = {},
): Section {
  const meetings = partial.meetings ?? []
  return {
    id,
    cohort: partial.cohort ?? '',
    group: partial.group ?? '',
    component: partial.component ?? 'LEC',
    meetings,
    instructors: partial.instructors ?? [],
    status: partial.status ?? 'Open',
    isTba: meetings.length === 0,
  }
}

export function mkCourse(
  code: string,
  sections: Section[],
  extra: { units?: number; requirement?: Requirement; title?: string } = {},
): Course {
  const identity = parseCode(code)
  const components: string[] = []
  for (const section of sections) {
    if (!components.includes(section.component)) components.push(section.component)
  }
  return {
    code,
    key: identity.key,
    subject: identity.subject,
    number: identity.number,
    suffix: identity.suffix,
    level: identity.level,
    title: extra.title ?? `Test course ${code}`,
    units: extra.units ?? 3,
    career: 'Undergraduate',
    department: 'TEST',
    requirement: extra.requirement ?? EMPTY_REQUIREMENT,
    sections,
    components,
    searchText: code.toLowerCase(),
  }
}

/** 一个排法内任意两个 meeting 都不得重叠——generatePlans 的无冲突保证(00 哲学 2 的
 * 引擎底座),多个测试要复用这条断言。 */
export function planIsConflictFree(meetings: Meeting[]): boolean {
  for (let i = 0; i < meetings.length; i += 1) {
    for (let j = i + 1; j < meetings.length; j += 1) {
      const a = meetings[i]
      const b = meetings[j]
      if (a.dayIndex === b.dayIndex && a.start < b.end && b.start < a.end) return false
    }
  }
  return true
}
