/** 里程碑2「横向空间不足时的三级降级」：同一天并排的课程块越多(block.lanes 越大)，
 * 每列越窄——lane 数是最直接的变窄信号，不用额外测量容器宽度。三级压缩由 JS 按
 * lanes 算出等级，交给渲染方决定地点是否缩写、时间是否折两行、component 是否缩成
 * 单字母；CSS 只负责把这几种状态摆出来看起来别重叠。 */

export type SqueezeLevel = 0 | 1 | 2 | 3

/** lanes=1(独占一列)不压缩；往上每加一道并排就升一级，四道及以上封顶到最狠的一级。 */
export function squeezeLevel(lanes: number): SqueezeLevel {
  if (lanes <= 1) return 0
  if (lanes === 2) return 1
  if (lanes === 3) return 2
  return 3
}

/** component 缩成单字母(最狭窄时用)：LEC→L、TUT→T、LAB→A(用 A 是为了不撞 LEC 的 L)，
 * 其余类型没有强约定，取首字母，遇到过表里未列出的新 component 就退回首字母兜底。 */
const COMPONENT_LETTER: Record<string, string> = {
  LEC: 'L',
  TUT: 'T',
  LAB: 'A',
  SEM: 'S',
  EXR: 'E',
  PRJ: 'P',
  FLD: 'F',
  IND: 'I',
  PRA: 'R',
}

export function shortComponent(component: string): string {
  const known = COMPONENT_LETTER[component]
  if (known) return known
  const letter = component.trim().charAt(0).toUpperCase()
  return letter || component
}
