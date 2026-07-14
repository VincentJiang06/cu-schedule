import type { CSSProperties } from 'react'
import { colorKey, courseColor } from '../lib/color.ts'
import { courseKey } from '../lib/courseKey.ts'
import { detectChooseRule, type ChooseRule } from '../lib/programChoose.ts'
import type { ProgramCourse, Program, SectionNode } from '../lib/programs.ts'
import type { Course } from '../lib/types.ts'
import { t } from '../i18n/index.ts'

/**
 * The big study-scheme table on the 信息 page. Renders a programme's faithful
 * requirement tree (`program.structure`) as nested, colored blocks — every 编号项
 * (1./2./…), its streams and Required/Elective/Remaining sub-groups — and lets the
 * student mark a single course, or a whole subtree, as 已完成.
 *
 * Identity is always the course key (courseKey.ts): the programme data ships 8-char
 * keys, so a tile's `code`/`alts` ARE keys, and `catalogByKey` resolves units / title
 * from the catalog when the course is offered this year (unresolved codes render code-only).
 *
 * When a programme has no structured tree (prose_only), it falls back to a single
 * 「全部课程」group over `program.all`.
 */

// Common English requirement words → light Chinese gloss. Exact match only; the
// original English rides along as small text so专名/上下文 never gets lost.
const GLOSS: Record<string, string> = {
  'Faculty Package': '学院基础包',
  'Foundation Courses': '基础课程',
  'Required Courses': '必修课程',
  'Research Component Courses': '研究/毕业项目',
  'Elective Courses': '选修课程',
  'Elective Course 1': '选修组一',
  'Elective Course 2': '选修组二',
  'Any one course from the following': '以下任选一门',
  'Remaining units can be chosen from the following': '其余学分可从以下选取',
}

// A course is done when its own key, or any of its alternatives, is in 已完成.
function courseDone(course: ProgramCourse, takenSet: Set<string>): boolean {
  if (takenSet.has(courseKey(course.code))) return true
  return course.alts.some((alt) => takenSet.has(courseKey(alt)))
}

// 「任选」提示文案 for a node's DIRECT course cards, derived from its selection rule.
// Only a "pick one / pick N course(s)" rule with ≥2 cards to choose among earns a hint
// (a units budget or a single-card list gets none — nothing to disambiguate on the card).
function pickHintText(rule: ChooseRule | null, courseCount: number): string | null {
  if (!rule || courseCount < 2) return null
  if (rule.kind === 'pick-one') return t('任选一门即可')
  if (rule.kind === 'pick-n') return t('任选 {n} 门即可', { n: rule.n })
  return null
}

// Every course under a node (itself + descendants), for the 整区一键 button.
function collectCourses(node: SectionNode): ProgramCourse[] {
  const out: ProgramCourse[] = [...node.courses]
  for (const child of node.children) out.push(...collectCourses(child))
  return out
}

// The color vars (--hue/--shade) of a course list's DOMINANT subject — the most common
// colorKey among the cards, ties → first course. Lets the pick-rule card tint to the same
// hue as the courses beside it. undefined for an empty list (caller then leaves it neutral).
function dominantCourseColor(courses: ProgramCourse[]): CSSProperties | undefined {
  if (courses.length === 0) return undefined
  const byKey = new Map<string, { count: number; code: string }>()
  for (const course of courses) {
    const key = colorKey(course.code)
    const seen = byKey.get(key)
    if (seen) seen.count += 1
    else byKey.set(key, { count: 1, code: course.code })
  }
  let best: { count: number; code: string } | undefined
  for (const entry of byKey.values()) if (!best || entry.count > best.count) best = entry
  return best ? courseColor(best.code) : undefined
}

// Partitions a children list into runs of consecutive leaf requirements (→ one
// .pg-leaf-grid card row each) and everything else (→ a normal recursive SectionBlock),
// preserving original order. Only adjacent leaves group together, so a leaf run
// interrupted by a titled/course-bearing section starts a fresh card row after it.
type ChildGroup = { kind: 'leaves'; nodes: SectionNode[] } | { kind: 'block'; node: SectionNode }
function groupLeafRuns(children: SectionNode[]): ChildGroup[] {
  const groups: ChildGroup[] = []
  let run: SectionNode[] = []
  const flush = (): void => {
    if (run.length > 0) {
      groups.push({ kind: 'leaves', nodes: run })
      run = []
    }
  }
  for (const child of children) {
    if (isLeafRequirement(child)) {
      run.push(child)
    } else {
      flush()
      groups.push({ kind: 'block', node: child })
    }
  }
  flush()
  return groups
}

// Title label: gloss通用词 (中文 + 原文小字), 「分流」for the "Choose any …" 分流选择项,
// otherwise专名 (General …/Stream N: …) 原样.
function TitleLabel({ title }: { title: string }) {
  if (!title) return null
  const zh = GLOSS[title]
  if (zh) {
    return (
      <span className="pg-section__title">
        {t(zh)}
        <em className="pg-section__en">{title}</em>
      </span>
    )
  }
  // 「Choose any ONE/…from the following」这类分流选择标注:统一标为「分流」,不带英文原文。
  if (/^choose/i.test(title)) {
    return <span className="pg-section__title">{t('分流')}</span>
  }
  return <span className="pg-section__title pg-section__title--plain">{title}</span>
}

// Prose rule text (glossed when it matches a known要求词), shared by the muted
// note paragraph (NoteLine) and the leaf requirement card's right-hand cell (LeafCard).
function NoteContent({ note }: { note: string }) {
  const zh = GLOSS[note]
  if (!zh) return <>{note}</>
  return (
    <>
      {t(zh)}
      <em className="pg-note__en">{note}</em>
    </>
  )
}

// Section-level prose rule (e.g. "Students must choose at least one concentration and take
// five or six courses…"). Rendered as a constraint bar in the same visual language as the
// leaf cards (light-gray bg + GRAY hazard stripes) but SLIMMER (更窄). Neutral on purpose —
// only the pick-rule cards carry the group's course color; generic constraints stay gray.
function NoteLine({ note }: { note: string }) {
  return (
    <div className="pg-noterule">
      <span className="pg-noterule__text">
        <NoteContent note={note} />
      </span>
    </div>
  )
}

// A pure-text requirement leaf: has its own marker ("(ii)" / "(a)" / …) but no title,
// no attached courses and no children — just a prose rule, e.g. "(ii) to 6 units MATH
// courses at 3000 or above level". These are the dense, hard-to-read lines the 1×2 card
// treatment targets; anything with a title, courses or children keeps rendering as a
// normal SectionBlock (its hierarchy is untouched).
function isLeafRequirement(node: SectionNode): boolean {
  return Boolean(node.marker) && !node.title && node.children.length === 0 && node.courses.length === 0 && Boolean(node.note)
}

// The numeric anchors a leaf rule hinges on — "3 units", "6 units", a "3000"-level gate —
// are the easiest things to skim past in a dense prose fragment. Bold them. `split` on a
// single-capture-group regex yields alternating [text, match, text, match, …], so odd
// indices are the captured number phrases.
const LEAF_NUM = /(\d+(?:\s*[-–]\s*\d+)?\s*units?|\b\d{4}\b)/gi
function emphasizeUnits(text: string) {
  return text.split(LEAF_NUM).map((part, i) =>
    i % 2 === 1 ? (
      <b className="pg-leaf__em" key={i}>
        {part}
      </b>
    ) : (
      part
    ),
  )
}

// Leaf prose: a known要求词 keeps its gloss; anything else (the real "At least 3 units" /
// "to 6 units MATH courses…" fragments) gets its numbers emphasized instead.
function LeafText({ note }: { note: string }) {
  if (GLOSS[note]) return <NoteContent note={note} />
  return <>{emphasizeUnits(note)}</>
}

// One leaf requirement, full-width: a rounded marker pill + the requirement prose inside a
// dashed frame (marking it a rule/constraint, distinct from the solid course cards). Stacks
// one-per-row in a .pg-leaf-grid so nothing gets truncated.
function LeafCard({ node }: { node: SectionNode }) {
  return (
    <div className="pg-leaf">
      <span className="pg-leaf__marker">{node.marker}</span>
      <span className="pg-leaf__text">
        <LeafText note={node.note ?? ''} />
      </span>
    </div>
  )
}

function CourseGrid({
  courses,
  catalogByKey,
  takenSet,
  onToggleTaken,
  rule,
}: {
  courses: ProgramCourse[]
  catalogByKey: Map<string, Course>
  takenSet: Set<string>
  onToggleTaken: (code: string) => void
  /**
   * 选择规则(任选一门 / N 门即可)独立成一张卡:置于课程网格首位,横跨两列(1×2),
   * 与课程卡同高。null = 不是 pick-one/pick-n 节点(不显示规则卡)。
   */
  rule?: { zh: string; en: string } | null
}) {
  // 规则卡宽度随文字长短:短(如「任选 2 门即可 / two courses selected from」)占一张课卡的
  // 位置(1×1);英文引子偏长时拓成 1×2,免得挤成瘦高多行。阈值卡在语料里的自然断点——干净的
  // 引子 ≤28 字符,再长的都带描述/内嵌课号(见 build 期语料统计,断在 44+)。
  const ruleWide = Boolean(rule && rule.en.length > 30)
  // 规则卡底色跟着本组课程的「常见配色」走(dominant subject hue),读起来就是这一组的选课规则;
  // CSS 里再取比课卡略淡的一档 lightness。无课程时(不会发生,rule 必伴 ≥2 门课)回落到中性底。
  const ruleColor = rule ? dominantCourseColor(courses) : undefined
  return (
    <div className="pg-grid">
      {rule && (
        <div className={`pg-rule${ruleWide ? ' pg-rule--wide' : ''}`} role="note" style={ruleColor}>
          <span className="pg-rule__zh">{rule.zh}</span>
          {rule.en && <span className="pg-rule__en">{rule.en}</span>}
        </div>
      )}
      {courses.map((course, index) => {
        // Resolve title/units from the primary key, falling back to any alternative.
        const resolved =
          catalogByKey.get(courseKey(course.code)) ??
          course.alts.map((alt) => catalogByKey.get(courseKey(alt))).find(Boolean)
        const done = courseDone(course, takenSet)
        // 整张卡点击 = 切换「已完成」。课卡外仍套一层 .pg-course-wrap(撑满网格格 + 最小宽 0)。
        return (
          <div className="pg-course-wrap" key={`${course.code}-${index}`}>
            <button
              className={`pg-course${done ? ' pg-course--done' : ''}`}
              style={courseColor(course.code)}
              title={resolved?.title ?? course.code}
              type="button"
              onClick={() => onToggleTaken(course.code)}
            >
              <span className="pg-course__code">
                {course.code}
                {course.alts.length > 0 && <em className="pg-course__alt">/{course.alts.join('/')}</em>}
              </span>
              {resolved && (
                <span className="pg-course__units">{t('{n} 学分', { n: resolved.units })}</span>
              )}
              {resolved ? (
                <span className="pg-course__title">{resolved.title}</span>
              ) : (
                <span className="pg-course__title pg-course__title--unknown">Unknown course</span>
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
}

function SectionBlock({
  node,
  depth,
  catalogByKey,
  takenSet,
  onToggleTaken,
  onBulkTaken,
}: {
  node: SectionNode
  depth: number
  catalogByKey: Map<string, Course>
  takenSet: Set<string>
  onToggleTaken: (code: string) => void
  onBulkTaken: (codes: string[], add: boolean) => void
}) {
  const subCourses = collectCourses(node)
  const hasCourses = subCourses.length > 0
  const allDone = hasCourses && subCourses.every((course) => courseDone(course, takenSet))
  const subCodes = subCourses.map((course) => course.code)
  // Optional专业方向/选修方向 segments printed after the Major-block total: a
  // Concentration Area (kind='concentration') or a Streams block (kind='stream').
  // Both render with the same optional-track framing; only the badge wording differs.
  const isConcentration = node.kind === 'concentration'
  const isStream = node.kind === 'stream'
  const isOptionalTrack = isConcentration || isStream
  // A group titled only by its prose rule (a stream's 必修课程 / 选修课程 组) has an empty
  // head, so its 「全部标记为已完成」button would otherwise float alone above a detached
  // note line and read as missing. Promote that note into the head as the section label,
  // so the button always sits beside a real name. (Marker/titled sections keep the note below.)
  const promoteNote = !node.marker && !node.title && Boolean(node.note)
  const headLabel = node.title || (promoteNote ? (node.note ?? '') : '')
  // 选择语义:this node's prose may say "choose one/N course(s)" or "choose N units".
  // Drives the units-chip emphasis (these N 学分 are to be *filled* from below) and, for a
  // pick-one/pick-n node, a standalone 1×2 「任选…即可」rule card at the head of its course
  // grid (children carry their own rule). The card carries the English lead-in (node.note)
  // as its subtitle, so that note isn't ALSO shown as a separate muted line below the head —
  // unless it was promoted into the head label (then the head already shows it).
  const chooseRule = detectChooseRule(node)
  const pickHint = pickHintText(chooseRule, node.courses.length)
  const ruleCard = pickHint ? { zh: pickHint, en: promoteNote ? '' : (node.note ?? '') } : null

  return (
    <div
      className={`pg-section${depth > 0 ? ' pg-section--sub' : ''}${
        isOptionalTrack ? ' pg-section--concentration' : ''
      }${isStream ? ' pg-section--stream' : ''}`}
    >
      <div className="pg-section__head">
        {node.marker && <span className="pg-section__marker">{node.marker}</span>}
        <TitleLabel title={headLabel} />
        {isConcentration && <span className="pg-badge">{t('可选方向')}</span>}
        {isStream && <span className="pg-badge pg-badge--stream">{t('选修方向')}</span>}
        {node.units != null && (
          <span className={`pg-section__units${chooseRule ? ' pg-section__units--choose' : ''}`}>
            {t('{n} 学分', { n: node.units })}
          </span>
        )}
        {hasCourses && (
          <button
            className="pg-bulk"
            type="button"
            onClick={() => onBulkTaken(subCodes, !allDone)}
          >
            {allDone ? t('取消全部') : t('全部标记为已完成')}
          </button>
        )}
      </div>
      {node.note && !promoteNote && !ruleCard && <NoteLine note={node.note} />}
      {node.courses.length > 0 && (
        <CourseGrid
          catalogByKey={catalogByKey}
          courses={node.courses}
          rule={ruleCard}
          takenSet={takenSet}
          onToggleTaken={onToggleTaken}
        />
      )}
      {node.children.length > 0 && (
        <div className="pg-section__children">
          {groupLeafRuns(node.children).map((group, groupIndex) =>
            group.kind === 'leaves' ? (
              <div className="pg-leaf-grid" key={`leaf-grid-${groupIndex}`}>
                {group.nodes.map((leaf, leafIndex) => (
                  <LeafCard key={`${leaf.marker}-${leafIndex}`} node={leaf} />
                ))}
              </div>
            ) : (
              <SectionBlock
                catalogByKey={catalogByKey}
                depth={depth + 1}
                key={`${group.node.marker}-${group.node.title}-${groupIndex}`}
                node={group.node}
                onBulkTaken={onBulkTaken}
                onToggleTaken={onToggleTaken}
                takenSet={takenSet}
              />
            ),
          )}
        </div>
      )}
    </div>
  )
}

export function ProgramTable({
  program,
  catalogByKey,
  takenSet,
  onToggleTaken,
  onBulkTaken,
}: {
  program: Program | null
  /** Every course offered this academic year, indexed by course.key (for units/title). */
  catalogByKey: Map<string, Course>
  /** Completed courses as a set of keys — the same set the rest of the app matches on. */
  takenSet: Set<string>
  onToggleTaken: (code: string) => void
  onBulkTaken: (codes: string[], add: boolean) => void
}) {
  if (!program) {
    return (
      <div className="pg pg--empty">
        {t('在右侧选择主修培养方案，这里会列出该方案的必修 / 选修 / 分流课程')}
      </div>
    )
  }

  const structure = program.structure ?? []
  // prose_only (no structured tree) → single 全部课程 group over the flat inventory.
  const fallbackCourses: ProgramCourse[] =
    structure.length === 0 ? program.all.map((code) => ({ code, alts: [] })) : []

  return (
    <div className="pg">
      <div className="pg__head">
        <b>{program.name_chi || program.name_en}</b>
        <span>
          {program.name_en} · {program.year}
        </span>
      </div>
      <div className="pg__scroll">
        {structure.length > 0 ? (
          structure.map((node, index) => (
            <SectionBlock
              catalogByKey={catalogByKey}
              depth={0}
              key={`${node.marker}-${node.title}-${index}`}
              node={node}
              onBulkTaken={onBulkTaken}
              onToggleTaken={onToggleTaken}
              takenSet={takenSet}
            />
          ))
        ) : fallbackCourses.length > 0 ? (
          <div className="pg-section">
            <div className="pg-section__head">
              <span className="pg-section__title pg-section__title--plain">{t('全部课程')}</span>
              <span className="pg-section__units">{t('{n} 门', { n: fallbackCourses.length })}</span>
              <button
                className="pg-bulk"
                type="button"
                onClick={() =>
                  onBulkTaken(
                    fallbackCourses.map((course) => course.code),
                    !fallbackCourses.every((course) => courseDone(course, takenSet)),
                  )
                }
              >
                {fallbackCourses.every((course) => courseDone(course, takenSet))
                  ? t('取消全部')
                  : t('全部标记为已完成')}
              </button>
            </div>
            <p className="pg-note">{t('该方案暂无结构化清单')}</p>
            <CourseGrid
              catalogByKey={catalogByKey}
              courses={fallbackCourses}
              takenSet={takenSet}
              onToggleTaken={onToggleTaken}
            />
          </div>
        ) : (
          <p className="pg-note">{t('该方案暂无课程清单')}</p>
        )}
      </div>
    </div>
  )
}
