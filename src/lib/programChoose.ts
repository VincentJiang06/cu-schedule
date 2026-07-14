/**
 * "Selection semantics" for a培养方案 requirement node — the missing signal on the
 * 信息 page's big study-scheme table (ProgramTable). Many `SectionNode`s don't mean
 * "take everything below": their prose says "choose any ONE course", "any two courses
 * chosen from the following", or "at least 6 units chosen from…". Without a cue the
 * student reads the whole list as mandatory. `detectChooseRule` classifies that intent
 * from the node's own English wording so the UI can flag it.
 *
 * PHILOSOPHY — 宁漏勿误 (00-constitution §1.3, applied to a UI hint rather than the
 * prereq engine): a wrong "just pick one" is worse than a missing hint. Every matcher
 * is anchored so it fires ONLY on unambiguous phrasing; anything blurry — a truncated
 * half-note ("At least 12"), "choose one concentration", a study-abroad mandate that
 * merely mentions units — returns `null`. The patterns below were fitted to the real
 * corpus (data/programs.json), not imagined; see the header comment on each group.
 *
 * Pure logic, no React (00 §1.7). Scope: the rule describes only the courses attached
 * DIRECTLY to this node (`node.courses`); children carry their own rules.
 */
import type { SectionNode } from './programs.ts'

export type ChooseRule =
  | { kind: 'pick-one' }
  | { kind: 'pick-n'; n: number }
  | { kind: 'pick-units' }

// Number words the corpus actually uses for a "pick exactly N courses" rule. One is
// handled by pick-one; six-plus ("any six courses", "eight courses from…") is left
// unclassified on purpose — those pools read as broad electives, not a tidy N-choice.
const NUM_WORD: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 }
const NUMS = 'two|three|four|five'

// ---- pick-one: choose a single COURSE from a list ----------------------------
// Every matcher keeps the word "course" adjacent (or is the fixed "choose any one"),
// so "choose one concentration", "choose one of the following streams" and "required
// to choose one [major]" — all of which pick a *track*, not a course — never match.
const PICK_ONE: RegExp[] = [
  /\bany one course\b/,
  /\bany one of the following\b/,
  /\bone of the following courses\b/,
  /\bchoose any one\b/,
  /\bone course (?:selected|chosen) from\b/,
  /\bone course from the following\b/,
]

// ---- pick-n (n = 2..5): choose exactly N courses -----------------------------
// The number word must sit right after "any"/"choose", or the phrase must be
// "<num> courses (selected|chosen) from" / "<num> courses from the following", with a
// "course" anchor nearby. The `(?<!at least )` guard on the bare forms rejects "at least
// five courses chosen from…" (a MINIMUM, where "任选五门即可" would understate); "take five
// or six courses" (no any/choose lead) and "at least four courses" also stay unclassified.
const PICK_N: RegExp[] = [
  new RegExp(`\\bany (${NUMS})\\b[^.]{0,40}?\\bcourses?\\b`),
  new RegExp(`\\bchoose (${NUMS})\\b[^.]{0,40}?\\bcourses?\\b`),
  new RegExp(`(?<!at least )\\b(${NUMS}) courses? (?:selected|chosen) from\\b`),
  new RegExp(`(?<!at least )\\b(${NUMS}) courses? from the following\\b`),
]

// ---- pick-units: choose N units from a list ----------------------------------
// "N units" here always means a UNITS budget the student fills from the courses below.
// Bare "at least/choose/minimum N units" is a strong signal in a short section note;
// the "<num> units … chosen/selected from" form carries its own list anchor. A range
// ("6-15 units", "17-18 units") is allowed. Long narrative mandates that merely mention
// units (study-abroad blurbs) are filtered by the length guard in `detectChooseRule`.
const UNITS_NUM = String.raw`\d+(?:\s*[-–]\s*\d+)?`
const PICK_UNITS: RegExp[] = [
  new RegExp(`\\bat least ${UNITS_NUM} units\\b`),
  new RegExp(`\\bchoose ${UNITS_NUM} units\\b`),
  new RegExp(`\\bminimum (?:of )?${UNITS_NUM} units\\b`),
  new RegExp(`${UNITS_NUM} units\\b[^.]{0,40}?\\b(?:chosen|selected) from\\b`),
]

// A pick-one/pick-n hint is stamped on EVERY direct course card, so it must only fire when
// the node's whole rule really is "pick this many of these cards". Two wordings break that
// and produced the bulk of the false positives on the real corpus (宁漏勿误):
//   • ADDITIVE compound — "CURE1400 and any two courses" (a REQUIRED course + a choice):
//     "任选两门" would wrongly mark the mandatory course optional and miscount the pool.
//   • UNITS BUDGET — "At least 9 units from…", "A maximum of 3 units…", "any 6-9 units":
//     the pool is governed by a units figure, not a course count (these are the cluster /
//     concentration nodes that slipped in via an incidental "any one of the …").
//   • GROUP DISTRIBUTION — "Group C: … Group E: … one course from the following Group…":
//     the pick is spread across named groups, so a flat "任选一门/两门" on every card
//     understates the rule. Any \bgroup\b mention disqualifies the count hint (a plain
//     list that happens to say "from Group A" loses its hint too — the 宁漏勿误 trade).
// When any of these show, skip pick-one/pick-n entirely (the node may still resolve to
// pick-units below, which shows NO per-card hint).
const BUDGET_OR_COMPOUND = /\band any\b|\bat least\b|\bmaximum\b|\bgroup\b|\d+\s*(?:[-–]\s*\d+)?\s*units\b/

// An explicit "pick from this list" anchor. Used to rescue a units rule out of a long
// narrative note (where a bare "at least N units" alone would be too loose to trust).
const LIST_ANCHOR = /\b(?:chosen|selected) from\b|\bfrom the following\b|\bfrom the (?:courses )?below\b/
// Above this length a note reads as a prose paragraph (study-abroad / make-up-shortfall
// mandates), not a compact section rule — demand a real list anchor before trusting it.
const NARRATIVE_LEN = 160

// The GLOSS title (ProgramTable) that names a plain elective pool. With a stated units
// figure it *is* a "choose N units from here" section even when the note omits the verb.
const ELECTIVE_TITLE = 'elective courses'

function matchPickN(text: string): ChooseRule | null {
  for (const re of PICK_N) {
    const m = re.exec(text)
    if (m) {
      const n = NUM_WORD[m[1]]
      if (n) return { kind: 'pick-n', n }
    }
  }
  return null
}

/**
 * Classify a node's selection intent from its own English wording (`title` + `note`,
 * case-insensitive), or `null` when the phrasing is anything less than unambiguous.
 * Order: a "pick one/N course(s)" count wins over a units budget when both read.
 */
export function detectChooseRule(node: SectionNode): ChooseRule | null {
  const title = (node.title ?? '').trim()
  const note = (node.note ?? '').trim()
  const text = `${title} ${note}`.toLowerCase()

  // A units budget or an additive compound is NOT a clean "pick N of these cards" rule —
  // skip the course-count hints and let it fall through to the units logic below.
  if (!BUDGET_OR_COMPOUND.test(text)) {
    // pick-one before pick-n: "Choose any ONE from the following five options" says ONE.
    for (const re of PICK_ONE) if (re.test(text)) return { kind: 'pick-one' }

    const pickN = matchPickN(text)
    if (pickN) return pickN
  }

  // pick-units. In a long narrative note, only trust it with an explicit list anchor.
  const longNarrative = text.length > NARRATIVE_LEN && !LIST_ANCHOR.test(text)
  if (!longNarrative) {
    for (const re of PICK_UNITS) if (re.test(text)) return { kind: 'pick-units' }
  }

  // A bare "Elective Courses" pool with a stated units figure is a units budget too.
  if (title.toLowerCase() === ELECTIVE_TITLE && node.units != null) return { kind: 'pick-units' }

  return null
}
