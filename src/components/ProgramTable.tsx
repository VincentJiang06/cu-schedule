import { courseColor } from '../lib/color.ts'
import { courseKey } from '../lib/courseKey.ts'
import { detectChooseRule, type ChooseRule } from '../lib/programChoose.ts'
import type { ProgramCourse, Program, SectionNode } from '../lib/programs.ts'
import type { Course } from '../lib/types.ts'

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
  if (rule.kind === 'pick-one') return '任选一门即可'
  if (rule.kind === 'pick-n') return `任选 ${rule.n} 门即可`
  return null
}

// Every course under a node (itself + descendants), for the 整区一键 button.
function collectCourses(node: SectionNode): ProgramCourse[] {
  const out: ProgramCourse[] = [...node.courses]
  for (const child of node.children) out.push(...collectCourses(child))
  return out
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

// Title label: gloss通用词 (中文 + 原文小字), 前缀「任选其一」for the "Choose any ONE…"
// 顶层项, otherwise专名 (General …/Stream N: …) 原样.
function TitleLabel({ title }: { title: string }) {
  if (!title) return null
  const zh = GLOSS[title]
  if (zh) {
    return (
      <span className="pg-section__title">
        {zh}
        <em className="pg-section__en">{title}</em>
      </span>
    )
  }
  if (title.includes('Choose any ONE from the following')) {
    return (
      <span className="pg-section__title">
        任选其一
        <em className="pg-section__en">· {title}</em>
      </span>
    )
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
      {zh}
      <em className="pg-note__en">{note}</em>
    </>
  )
}

// Prose rule row (muted). Glossed when it matches a known要求词.
function NoteLine({ note }: { note: string }) {
  return (
    <p className="pg-note">
      <NoteContent note={note} />
    </p>
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
  onShowDetail,
  pickHint,
}: {
  courses: ProgramCourse[]
  catalogByKey: Map<string, Course>
  takenSet: Set<string>
  onToggleTaken: (code: string) => void
  /** Opens the shared CourseModal for a resolved course (⋯ 详情 button). */
  onShowDetail?: (course: Course) => void
  /** 「任选一门/N 门即可」line added to every card when this node is a pick-one/pick-n. */
  pickHint?: string | null
}) {
  return (
    <div className="pg-grid">
      {courses.map((course, index) => {
        // Resolve title/units from the primary key, falling back to any alternative.
        const resolved =
          catalogByKey.get(courseKey(course.code)) ??
          course.alts.map((alt) => catalogByKey.get(courseKey(alt))).find(Boolean)
        const done = courseDone(course, takenSet)
        // The tile itself is a <button> (click = toggle 已完成); the ⋯ 详情 button can't
        // nest inside it (invalid HTML), so both live as siblings in a relative wrapper and
        // the ⋯ absolutely positions to the top-right corner. Only resolved courses (with a
        // real Course to hand the modal) get one — Unknown courses have nothing to show.
        return (
          <div className="pg-course-wrap" key={`${course.code}-${index}`}>
            <button
              className={`pg-course${done ? ' pg-course--done' : ''}${pickHint ? ' pg-course--pick' : ''}`}
              style={courseColor(course.code)}
              title={resolved?.title ?? course.code}
              type="button"
              onClick={() => onToggleTaken(course.code)}
            >
              <span className="pg-course__code">
                {course.code}
                {course.alts.length > 0 && <em className="pg-course__alt">/{course.alts.join('/')}</em>}
              </span>
              {resolved && <span className="pg-course__units">{resolved.units}学分</span>}
              {resolved ? (
                <span className="pg-course__title">{resolved.title}</span>
              ) : (
                <span className="pg-course__title pg-course__title--unknown">Unknown course</span>
              )}
              {pickHint && <span className="pg-course__pick">{pickHint}</span>}
            </button>
            {resolved && onShowDetail && (
              <button
                aria-label={`${course.code} 详情`}
                className="pg-course__detail"
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onShowDetail(resolved)
                }}
              >
                ⋯
              </button>
            )}
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
  onShowDetail,
}: {
  node: SectionNode
  depth: number
  catalogByKey: Map<string, Course>
  takenSet: Set<string>
  onToggleTaken: (code: string) => void
  onBulkTaken: (codes: string[], add: boolean) => void
  onShowDetail?: (course: Course) => void
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
  // Drives the units-chip emphasis (these N 学分 are to be *filled* from below) and the
  // per-card 「任选…即可」hint on this node's DIRECT courses (children carry their own rule).
  const chooseRule = detectChooseRule(node)
  const pickHint = pickHintText(chooseRule, node.courses.length)

  return (
    <div
      className={`pg-section${depth > 0 ? ' pg-section--sub' : ''}${
        isOptionalTrack ? ' pg-section--concentration' : ''
      }${isStream ? ' pg-section--stream' : ''}`}
    >
      <div className="pg-section__head">
        {node.marker && <span className="pg-section__marker">{node.marker}</span>}
        <TitleLabel title={headLabel} />
        {isConcentration && <span className="pg-badge">可选方向</span>}
        {isStream && <span className="pg-badge pg-badge--stream">选修方向</span>}
        {node.units != null && (
          <span className={`pg-section__units${chooseRule ? ' pg-section__units--choose' : ''}`}>
            {node.units} 学分
          </span>
        )}
        {hasCourses && (
          <button
            className="pg-bulk"
            type="button"
            onClick={() => onBulkTaken(subCodes, !allDone)}
          >
            {allDone ? '取消全部' : '全部标记为已完成'}
          </button>
        )}
      </div>
      {node.note && !promoteNote && <NoteLine note={node.note} />}
      {node.courses.length > 0 && (
        <CourseGrid
          catalogByKey={catalogByKey}
          courses={node.courses}
          pickHint={pickHint}
          takenSet={takenSet}
          onShowDetail={onShowDetail}
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
                onShowDetail={onShowDetail}
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
  onShowDetail,
}: {
  program: Program | null
  /** Every course offered this academic year, indexed by course.key (for units/title). */
  catalogByKey: Map<string, Course>
  /** Completed courses as a set of keys — the same set the rest of the app matches on. */
  takenSet: Set<string>
  onToggleTaken: (code: string) => void
  onBulkTaken: (codes: string[], add: boolean) => void
  /** Opens the shared CourseModal for a resolved course (⋯ 详情 button on each card). */
  onShowDetail?: (course: Course) => void
}) {
  if (!program) {
    return (
      <div className="pg pg--empty">
        在右侧选择主修培养方案，这里会列出该方案的必修 / 选修 / 分流课程
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
              onShowDetail={onShowDetail}
              onToggleTaken={onToggleTaken}
              takenSet={takenSet}
            />
          ))
        ) : fallbackCourses.length > 0 ? (
          <div className="pg-section">
            <div className="pg-section__head">
              <span className="pg-section__title pg-section__title--plain">全部课程</span>
              <span className="pg-section__units">{fallbackCourses.length} 门</span>
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
                  ? '取消全部'
                  : '全部标记为已完成'}
              </button>
            </div>
            <p className="pg-note">该方案暂无结构化清单</p>
            <CourseGrid
              catalogByKey={catalogByKey}
              courses={fallbackCourses}
              takenSet={takenSet}
              onShowDetail={onShowDetail}
              onToggleTaken={onToggleTaken}
            />
          </div>
        ) : (
          <p className="pg-note">该方案暂无课程清单</p>
        )}
      </div>
    </div>
  )
}
