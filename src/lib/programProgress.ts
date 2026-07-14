/**
 * 学分进度:给定一个培养方案与「已完成课程」的 key 集合,逐个顶层 section(培养方案大课表
 * 上的编号项 1./2./3./4.)统计已修入的学分。纯逻辑,无 React、无 IO——App 从 catalogByKey
 * 取 units,本模块只做归并与求和,供信息页「已完成课程」下方的计算器展示。
 *
 * 口径:
 *  - 一门课「落入某 section」= 它的 key(或等价 alt 的 key,如 ESTR 孪生课)出现在该 section
 *    子树的任一课单里。同一门课在该 section 子树里出现多次(如「任选其一」的多个 stream 各列
 *    同一门选修)只计一次——按 key 去重。
 *  - 学分来源唯一是 catalogByKey(本学年目录),与大课表课卡显示的 units 同口径;已完成但今年
 *    不开课、目录里查不到的课记为「学分未知」,不臆造,只计门数(宁漏勿误)。
 *  - required = 该 section 自身声明的 units;未声明则取其子节点 required 之和(Foundation /
 *    Required 这类 units 挂在 (a)(b)(c) 子组上的情形)。仍无则 null。
 *  - 「任选其一」这类 section 的多组共享/超修:earned 可能超过 required,如实透出,进度条封顶
 *    100%,不替用户判断哪组算数(工具不是权威,CUSIS 才是)。
 */
import { courseKey } from './courseKey.ts'
import type { Program, ProgramCourse, SectionNode } from './programs.ts'

/** A course is 已完成 when its own key, or any equivalent alt key, is in the completed set. */
function matchedKey(course: ProgramCourse, takenKeys: Set<string>): string | null {
  const primary = courseKey(course.code)
  if (takenKeys.has(primary)) return primary
  for (const alt of course.alts) {
    const key = courseKey(alt)
    if (takenKeys.has(key)) return key
  }
  return null
}

/** Every course under a node (itself + all descendants). */
function collectCourses(node: SectionNode, out: ProgramCourse[]): void {
  for (const course of node.courses) out.push(course)
  for (const child of node.children) collectCourses(child, out)
}

/**
 * A section's required units: its own declared budget, else the sum of its children's
 * required units (so Foundation / Required, whose units live on the (a)(b)(c) sub-groups,
 * still report a total). null when nothing in the subtree states a unit budget.
 */
function requiredUnits(node: SectionNode): number | null {
  if (node.units != null) return node.units
  let sum = 0
  let any = false
  for (const child of node.children) {
    const childReq = requiredUnits(child)
    if (childReq != null) {
      sum += childReq
      any = true
    }
  }
  return any ? sum : null
}

export type SectionProgress = {
  marker: string
  title: string
  note: string | null
  /** Resolved units of the DISTINCT completed courses that fall inside this section. */
  earned: number
  /** Declared / aggregated unit budget for this section, or null when unstated. */
  required: number | null
  /** Distinct completed courses inside this section (incl. estimated-units ones). */
  count: number
  /** Of `count`, how many had no catalog units this year and were counted at the 3-unit estimate. */
  estimated: number
}

export type CreditBucket = { earned: number; count: number; estimated: number }

export type ProgramProgress = {
  sections: SectionProgress[]
  /** DISTINCT completed courses that belong to the programme (any section). */
  inProgram: CreditBucket
  /** Completed courses that belong to NO section — free electives / GE / out-of-scheme. */
  outside: CreditBucket
  /** program.total_units, the whole-degree budget (null when unknown). */
  totalRequired: number | null
}

// 已完成但本学年目录查不到 units 的课(如今年停开/未开):用户既已修就该算分,不因今年不开
// 而漏计。按 CUHK 绝大多数本科课的 3 学分估算计入 earned,门数另记 estimated 供如实标注。
const ESTIMATED_UNITS = 3

function tallyKeys(keys: Iterable<string>, unitsFor: (key: string) => number | null): CreditBucket {
  let earned = 0
  let count = 0
  let estimated = 0
  for (const key of keys) {
    count += 1
    const units = unitsFor(key)
    if (units == null) {
      earned += ESTIMATED_UNITS
      estimated += 1
    } else {
      earned += units
    }
  }
  return { earned, count, estimated }
}

/**
 * Compute per-section credit progress for a programme against a set of completed course
 * keys. `unitsFor` resolves a course key to its catalog units (null = not offered / unknown).
 */
export function computeProgramProgress(
  program: Program,
  takenKeys: Set<string>,
  unitsFor: (key: string) => number | null,
): ProgramProgress {
  // Keys of every completed course that lands somewhere in the programme (dedup across sections).
  const inProgramKeys = new Set<string>()

  const sections: SectionProgress[] = program.structure.map((node) => {
    const courses: ProgramCourse[] = []
    collectCourses(node, courses)
    // Dedup completed courses within this section (a course listed under several streams counts once).
    const seen = new Set<string>()
    for (const course of courses) {
      const key = matchedKey(course, takenKeys)
      if (key && !seen.has(key)) {
        seen.add(key)
        inProgramKeys.add(key)
      }
    }
    const bucket = tallyKeys(seen, unitsFor)
    return {
      marker: node.marker,
      title: node.title,
      note: node.note,
      earned: bucket.earned,
      required: requiredUnits(node),
      count: bucket.count,
      estimated: bucket.estimated,
    }
  })

  // prose-only programmes (no structured tree): fold the whole flat inventory into 本方案.
  if (program.structure.length === 0) {
    for (const code of program.all) {
      const key = courseKey(code)
      if (takenKeys.has(key)) inProgramKeys.add(key)
    }
  }

  const outsideKeys = [...takenKeys].filter((key) => !inProgramKeys.has(key))

  return {
    sections,
    inProgram: tallyKeys(inProgramKeys, unitsFor),
    outside: tallyKeys(outsideKeys, unitsFor),
    totalRequired: program.total_units,
  }
}
