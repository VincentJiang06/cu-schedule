/**
 * 学分进度:给定一个培养方案与「已完成课程」的 key 集合,逐个顶层 section(培养方案大课表
 * 上的编号项 1./2./3./4.)统计已修入的学分。纯逻辑,无 React、无 IO——App 从 catalogByKey
 * 取 units,本模块只做归并与求和,供信息页「已完成课程」下方的计算器展示。
 *
 * 口径:
 *  - 一门课「落入某 section」= 它的 key(或等价 alt 的 key,如 ESTR 孪生课)出现在该 section
 *    子树的任一课单里。同一门课在该 section 子树里出现多次(如「任选其一」的多个 stream 各列
 *    同一门选修)只计一次——按 key 去重。
 *  - 学分来源唯一是 catalogByKey(本学年目录),与大课表课卡显示的 units 同口径,并在整个等价组
 *    (主码 + 各 alt)里回退解析:学生成绩单上可能记的是旧课号(DSME1030)或孪生码(ESTR2102),
 *    只要组里任一码今年开着就用它的学分,不因录的是哪一半而误判「学分未知」。
 *  - 组里一个码都查不到(如整门课今年停开)才记「学分未知」,按 3 学分估算并如实标注门数。
 *  - required = 该 section 自身声明的 units;未声明则取其子节点 required 之和(Foundation /
 *    Required 这类 units 挂在 (a)(b)(c) 子组上的情形)。仍无则 null。
 *  - 「任选其一」这类 section 的多组共享/超修:earned 可能超过 required,如实透出,进度条封顶
 *    100%,不替用户判断哪组算数(工具不是权威,CUSIS 才是)。
 *  - 有学分预算却一门课都没列的 section(如 Economics §3「36 units of elective ECON courses
 *    at 3000 or above level」)标 countable=false:它的进度不可能靠课单算出来,画一条永远 0/N
 *    的进度条是谎报,交给 UI 明说「无法自动统计」。
 */
import { courseKey } from './courseKey.ts'
import type { Program, ProgramCourse, SectionNode } from './programs.ts'

/** 一门课的等价 key 组:主码在前,alt 依次在后(ESTR 孪生、旧课号、交叉挂号)。 */
function courseGroup(course: ProgramCourse): string[] {
  return [courseKey(course.code), ...course.alts.map(courseKey)]
}

/**
 * A course is 已完成 when its own key, or any equivalent alt key, is in the completed set.
 * 返回命中的 key 与它所属的等价组——学分要在整组里回退解析,不能只认命中的那一个码。
 */
function matchCourse(
  course: ProgramCourse,
  takenKeys: Set<string>,
): { key: string; group: string[] } | null {
  const group = courseGroup(course)
  for (const key of group) if (takenKeys.has(key)) return { key, group }
  return null
}

/** Every course under a node (itself + all descendants). */
function collectCourses(node: SectionNode, out: ProgramCourse[]): void {
  for (const course of node.courses) out.push(course)
  for (const child of node.children) collectCourses(child, out)
}

/** 该 section 子树里到底列没列出课程——没有就没法按课单统计进度(见文件头 countable)。 */
function listsAnyCourse(node: SectionNode): boolean {
  return node.courses.length > 0 || node.children.some(listsAnyCourse)
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
  /**
   * 本组是否列出了可据以统计的课单。false = 日历只用一句话描述这一组的范围(「36 units of
   * elective ECON courses at 3000 or above level」),没有课号可比对,进度不可能算准——UI 据此
   * 不画进度条,明说无法自动统计,而不是画一条永远停在 0 的假条。
   */
  countable: boolean
}

export type CreditBucket = { earned: number; count: number; estimated: number }

export type ProgramProgress = {
  sections: SectionProgress[]
  /** DISTINCT completed courses that belong to the programme (any section). */
  inProgram: CreditBucket
  /**
   * 方案页里列到、但没能归进任何一组的已完成课程。日历常把选修池印在主修块之外(附录课表、
   * 副修课单、建议修读次序),解析树只覆盖主修块,所以这些课号进不了任何 section。它们既不该
   * 被当成「不在本方案内」误导用户,也不该凭空计入方案累计(那份课单未必属于本专业要求),
   * 因此单独一档如实呈现。
   */
  unplaced: CreditBucket
  /** Completed courses the programme's page never mentions — free electives / GE / out-of-scheme. */
  outside: CreditBucket
  /** program.total_units, the whole-degree budget (null when unknown). */
  totalRequired: number | null
  /**
   * 每节的必修学分是否可信。true = 各节推导学分自洽(全部非空且加总==total_units),按节显示上限;
   * false = 该方案结构无法可靠拆分(合并/重叠/无预算节,如「二选一」分流会被各算一遍),此时只对
   * 数据【显式声明 units】的节给上限,其余不显示上限,毕业进度以整方案累计(inProgram/totalRequired)为准。
   */
  reconciled: boolean
}

// 已完成但本学年目录查不到 units 的课(如今年停开/未开):用户既已修就该算分,不因今年不开
// 而漏计。按 CUHK 绝大多数本科课的 3 学分估算计入 earned,门数另记 estimated 供如实标注。
const ESTIMATED_UNITS = 3

/** 在等价组里回退解析学分:任一码今年开着就用它的学分;整组都查不到才算「未知」。 */
function unitsOfGroup(group: string[], unitsFor: (key: string) => number | null): number | null {
  for (const key of group) {
    const units = unitsFor(key)
    if (units != null) return units
  }
  return null
}

/** groups: 命中 key -> 该课的等价组(方案外的课没有组,组就是它自己)。 */
function tally(
  groups: Map<string, string[]>,
  unitsFor: (key: string) => number | null,
): CreditBucket {
  let earned = 0
  let count = 0
  let estimated = 0
  for (const group of groups.values()) {
    count += 1
    const units = unitsOfGroup(group, unitsFor)
    if (units == null) {
      earned += ESTIMATED_UNITS
      estimated += 1
    } else {
      earned += units
    }
  }
  return { earned, count, estimated }
}

function bucketOf(keys: Iterable<string>, unitsFor: (key: string) => number | null): CreditBucket {
  return tally(new Map([...keys].map((key) => [key, [key]])), unitsFor)
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
  // 命中 key -> 等价组,覆盖全方案(跨 section 去重;同一门课在多个 stream 下列出只算一次)。
  const inProgramGroups = new Map<string, string[]>()

  // 第一遍:每节的已修学分 + 推导必修学分(node.units,缺则加总子节点)。
  const raw = program.structure.map((node) => {
    const courses: ProgramCourse[] = []
    collectCourses(node, courses)
    // Dedup completed courses within this section (a course listed under several streams counts once).
    const seen = new Map<string, string[]>()
    for (const course of courses) {
      const hit = matchCourse(course, takenKeys)
      if (hit && !seen.has(hit.key)) {
        seen.set(hit.key, hit.group)
        if (!inProgramGroups.has(hit.key)) inProgramGroups.set(hit.key, hit.group)
      }
    }
    return {
      node,
      bucket: tally(seen, unitsFor),
      derived: requiredUnits(node),
      countable: listsAnyCourse(node),
    }
  })

  // 结构是否自洽:每节都推导出非空必修学分、且加总恰等于 total_units → 这个方案的分节拆分可信,
  // 按节显示上限;否则(近半数方案:节间重叠/合并/含无预算节,推导会把「二选一」分流各算一遍等)
  // 只认数据【显式声明 units】的节,其余不给上限——按 program info 灵活切换,不臆造错误的分节学分。
  const totalRequired = program.total_units
  const reconciled =
    totalRequired != null &&
    raw.length > 0 &&
    raw.every((r) => r.derived != null) &&
    raw.reduce((sum, r) => sum + (r.derived ?? 0), 0) === totalRequired

  const sections: SectionProgress[] = raw.map((r) => ({
    marker: r.node.marker,
    title: r.node.title,
    note: r.node.note,
    earned: r.bucket.earned,
    required: reconciled ? r.derived : r.node.units,
    count: r.bucket.count,
    estimated: r.bucket.estimated,
    countable: r.countable,
  }))

  // prose-only programmes (no structured tree): fold the whole flat inventory into 本方案.
  if (program.structure.length === 0) {
    for (const code of program.all) {
      const key = courseKey(code)
      if (takenKeys.has(key) && !inProgramGroups.has(key)) inProgramGroups.set(key, [key])
    }
  }

  // 方案页提到过、但没归进任何一组的课(附录课表 / 副修课单 / 建议修读次序里的课号)。
  const mentioned = new Set(program.all.map(courseKey))
  const unplacedKeys: string[] = []
  const outsideKeys: string[] = []
  for (const key of takenKeys) {
    if (inProgramGroups.has(key)) continue
    ;(mentioned.has(key) ? unplacedKeys : outsideKeys).push(key)
  }

  return {
    sections,
    inProgram: tally(inProgramGroups, unitsFor),
    unplaced: bucketOf(unplacedKeys, unitsFor),
    outside: bucketOf(outsideKeys, unitsFor),
    totalRequired,
    reconciled,
  }
}
