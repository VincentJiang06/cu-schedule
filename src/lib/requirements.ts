/**
 * Parses CUHK's free-text `enrollment_requirement` into something we can check
 * against a student's completed-course list.
 *
 * The field is not structured, but across the whole catalog it follows a small
 * grammar. A requirement is a set of clauses separated by `;` / newlines, each
 * clause typed by a leading keyword:
 *
 *   - "Not for students who have taken A or B"  → exclusion (any A/B taken ⇒ barred)
 *   - "Pre-requisite: (A or B) and C"           → prerequisite boolean expression
 *   - "Co-requisite: A"                          → corequisite (take before/with)
 *   - "For students in <programme>", grade/year/consent notes → we do not check
 *
 * Prerequisite bodies are real boolean expressions with `and`, `or`, `/` (equiv),
 * commas, and `()`/`[]` nesting. We parse them into an AST and evaluate with
 * THREE-valued logic (yes / no / maybe). The guiding rule, because a wrong
 * "you can't take this" is the worst possible failure:
 *
 *   Only report a prerequisite as missing when the expression evaluates to a
 *   DEFINITE no. Anything we cannot verify — a grade condition, instructor
 *   consent, an exemption, an ambiguous comma list — collapses to `maybe` and is
 *   reported as met (silent), never as missing.
 *
 * Course codes are validated against the real catalog (passed in as `knownCodes`)
 * so year fragments like "taken X in 2008-09" never become phantom course codes.
 */

import { courseKey, keySet } from './courseKey.ts'
import type { Requirement, ReqNode, RequirementStatus } from './types.ts'

export type Tri = 'yes' | 'no' | 'maybe'

// The AST type lives in the schema (types.ts); alias it locally so the parser body
// reads naturally.
type Node = ReqNode

const CLAUSE_SPLIT = /[;\n]/
const EXCLUSION_RE = /\bnot\s+for\b.*\b(?:taken|passed|completed|studied|enrol|register)/i
// The verb after which the barring course list appears.
const EXCLUSION_TRIGGER = /\b(?:taken|passed|completed|studied|enrol\w*|register\w*)\b/i
const PREREQ_RE = /pre-?requisite/i
const COREQ_RE = /co-?requisite/i
// Whole label forms, including the plural and "(s)" and the trailing colon, so
// stripping "Pre-requisites:" leaves no dangling "s:".
const PREREQ_LABEL = /pre-?requisite(?:\(s\)|s)?\s*:?/i
const COREQ_LABEL = /co-?requisite(?:\(s\)|s)?\s*:?/i
const SOFT_RE = /\b(?:exempt|exemption|consent|permission|approval|instructor|departmental|waiv)/i
const GRADE_RE = /\bgrade\b/i

const CODE_TOKEN = /[A-Z]{4}\d{4}/g
const YEAR_RANGE = /\b(?:19|20)\d{2}\s*-\s*\d{2}\b/g

/** Course numbers live in 1000-8999; anything outside is not a catalog number. */
function inCourseRange(n: number): boolean {
  return n >= 1000 && n <= 8999
}

/**
 * Turns a clause body into a token stream. Course codes carry an inherited
 * subject ("CSCI1120 or 1130" → CSCI1130); bare numbers are only accepted when
 * they land on a real catalog code, which is what keeps year fragments out.
 */
type Token = { k: 'code'; v: string } | { k: 'and' } | { k: 'or' } | { k: 'lp' } | { k: 'rp' } | { k: 'soft' }

function tokenize(body: string, knownCodes: Set<string> | null): Token[] {
  const cleaned = body
    // Academic-year ranges ("2008-09") would otherwise feed the bare-number rule.
    .replace(YEAR_RANGE, ' ')
    // "Grade B or above in X" / "Grade B- or better in X": the grade phrase is not
    // a boolean OR between courses. Strip it (the GRADE flag already downgraded the
    // clause) and keep the code that follows "in".
    .replace(/grade\s+[a-f][+-]?\s*(?:or\s+(?:above|better|higher))?\s*(?:in\b)?/gi, ' ')
    .replace(/\bor\s+(?:above|better|higher)\b/gi, ' ')
    // Missing spaces in the source ("2107or 2108", "and2108") glue a number to a
    // connective; separate them so the number is not lost.
    .replace(/(\d)(and|or)\b/gi, '$1 $2 ')
    .replace(/\b(and|or)(\d)/gi, ' $1 $2')

  const tokens: Token[] = []
  let subject: string | null = null

  // Split into atoms while keeping structural punctuation as its own atoms.
  // Sentence punctuation (".", ":", "。") becomes whitespace so a trailing period
  // never sticks to the last code ("ESTR2102." would otherwise be dropped whole).
  const atoms = cleaned
    .replace(/[[\]]/g, (m) => (m === '[' ? '(' : ')'))
    .replace(/[.:。]/g, ' ')
    .replace(/([()/,])/g, ' $1 ')
    .split(/\s+/)
    .filter(Boolean)

  for (const atom of atoms) {
    // Explicit code, with or without a variant suffix (ENGG1000A) — keyed to 8 chars.
    const explicit = atom.match(/^([A-Z]{4})(\d{4})[A-Z0-9]*$/)
    if (explicit) {
      subject = explicit[1]
      tokens.push({ k: 'code', v: courseKey(`${explicit[1]}${explicit[2]}`) })
      continue
    }
    const bare = atom.match(/^(\d{4})$/)
    if (bare && subject && inCourseRange(Number(bare[1]))) {
      const code = `${subject}${bare[1]}`
      // Only trust a bare-inherited code if the catalog actually has it (by key).
      if (!knownCodes || knownCodes.has(courseKey(code))) tokens.push({ k: 'code', v: courseKey(code) })
      continue
    }
    const low = atom.toLowerCase()
    if (low === 'and' || low === '&' || low === '+') tokens.push({ k: 'and' })
    else if (low === 'or' || low === '/' || low === ',') tokens.push({ k: 'or' })
    else if (atom === '(') tokens.push({ k: 'lp' })
    else if (atom === ')') tokens.push({ k: 'rp' })
    else if (SOFT_RE.test(atom)) tokens.push({ k: 'soft' })
    // everything else (prose words, grades, programme names) is dropped
  }
  // A leading/trailing connective left dangling by a dropped word ("… or ESTR2102"
  // where the code was punctuation-glued) would otherwise parse to an `unknown`
  // and soften a definite verdict — trim them.
  while (tokens.length > 0 && (tokens[0].k === 'and' || tokens[0].k === 'or')) tokens.shift()
  while (tokens.length > 0 && (tokens[tokens.length - 1].k === 'and' || tokens[tokens.length - 1].k === 'or')) {
    tokens.pop()
  }
  return tokens
}

/**
 * Recursive-descent parse of the token stream into a boolean AST.
 * Grammar (standard precedence, AND binds tighter than OR):
 *   or  := and ( OR and )*
 *   and := atom ( AND atom )*
 *   atom := '(' or ')' | code | soft
 */
function parseTokens(tokens: Token[]): Node | null {
  let pos = 0

  function peek(): Token | undefined {
    return tokens[pos]
  }

  function parseOr(): Node {
    const kids = [parseAnd()]
    while (peek()?.k === 'or') {
      pos += 1
      kids.push(parseAnd())
    }
    return kids.length === 1 ? kids[0] : { t: 'or', kids }
  }

  function parseAnd(): Node {
    const kids = [parseAtom()]
    while (peek()?.k === 'and') {
      pos += 1
      kids.push(parseAtom())
    }
    return kids.length === 1 ? kids[0] : { t: 'and', kids }
  }

  function parseAtom(): Node {
    const token = peek()
    if (!token) return { t: 'unknown' }
    if (token.k === 'lp') {
      pos += 1
      const inner = parseOr()
      if (peek()?.k === 'rp') pos += 1
      return inner
    }
    if (token.k === 'code') {
      pos += 1
      return { t: 'code', code: token.v }
    }
    if (token.k === 'soft') {
      pos += 1
      return { t: 'soft' }
    }
    // stray operator / rp — consume so we never loop forever
    pos += 1
    return { t: 'unknown' }
  }

  const node = parseOr()
  // A parse that found no course code at all carries no checkable content.
  return hasCode(node) ? node : null
}

function hasCode(node: Node): boolean {
  if (node.t === 'code') return true
  if (node.t === 'and' || node.t === 'or') return node.kids.some(hasCode)
  return false
}

function stripLabel(clause: string, labelRe: RegExp): string {
  const match = clause.match(labelRe)
  if (!match) return clause
  return clause
    .slice((match.index ?? 0) + match[0].length)
    .replace(/^[:\s.]+/, '')
    .trim()
}

function parseExpression(body: string, knownCodes: Set<string> | null, gradeSensitive: boolean): Node | null {
  const node = parseTokens(tokenize(body, knownCodes))
  if (!node) return null
  // A grade condition ("Grade B or above in X") means "took X" is not enough on
  // its own — downgrade satisfied leaves to maybe so we never claim a hard pass
  // or a hard fail we cannot actually see.
  return gradeSensitive ? markGradeSensitive(node) : node
}

function markGradeSensitive(node: Node): Node {
  // Having taken the course does not prove the grade, so a satisfied leaf becomes
  // maybe, never a hard yes: AND(code, soft) is `no` if untaken, `maybe` if taken.
  if (node.t === 'code') return { t: 'and', kids: [node, { t: 'soft' }] }
  if (node.t === 'and' || node.t === 'or') return { ...node, kids: node.kids.map(markGradeSensitive) }
  return node
}

export function parseRequirement(raw: string, knownCodes: Set<string> | null = null): Requirement {
  // Everything is compared on the eight-character key, so normalize the catalog once.
  const knownKeys = knownCodes ? keySet(knownCodes) : null
  const exclusions = new Set<string>()
  const prereqBodies: string[] = []
  const coreqBodies: string[] = []
  let prereqGrade = false
  let coreqGrade = false

  for (const clause of (raw || '').split(CLAUSE_SPLIT)) {
    const text = clause.trim()
    if (!text) continue

    if (EXCLUSION_RE.test(text)) {
      // Take codes only from the part AFTER "…have taken", so a leading
      // informational sentence ("X is double-coded with Y. Not for … taken Z")
      // doesn't fold X into the exclusion list. Codes are explicit 4+4 tokens
      // (trusted as-is, since exclusions often name courses no longer offered).
      const trigger = text.match(EXCLUSION_TRIGGER)
      const region = trigger ? text.slice((trigger.index ?? 0) + trigger[0].length) : text
      for (const code of region.replace(YEAR_RANGE, ' ').match(CODE_TOKEN) ?? []) {
        exclusions.add(courseKey(code))
      }
    } else if (COREQ_RE.test(text)) {
      coreqBodies.push(stripLabel(text, COREQ_LABEL))
      coreqGrade = coreqGrade || GRADE_RE.test(text)
    } else if (PREREQ_RE.test(text)) {
      prereqBodies.push(stripLabel(text, PREREQ_LABEL))
      prereqGrade = prereqGrade || GRADE_RE.test(text)
    }
    // "For students in <programme>", year standing, and other prose are not
    // course-checkable and are intentionally ignored.
  }

  const prereqNodes = prereqBodies
    .map((body) => parseExpression(body, knownKeys, prereqGrade))
    .filter((node): node is Node => node !== null)
  const coreqNodes = coreqBodies
    .map((body) => parseExpression(body, knownKeys, coreqGrade))
    .filter((node): node is Node => node !== null)

  return {
    raw: raw || '',
    exclusions: [...exclusions],
    prerequisite: combineAnd(prereqNodes),
    corequisite: combineAnd(coreqNodes),
    prereqText: prereqBodies.join('；').trim(),
    coreqText: coreqBodies.join('；').trim(),
  }
}

function combineAnd(nodes: Node[]): Node | null {
  if (nodes.length === 0) return null
  if (nodes.length === 1) return nodes[0]
  return { t: 'and', kids: nodes }
}

export function evaluate(node: Node, taken: Set<string>): Tri {
  switch (node.t) {
    case 'code':
      return taken.has(node.code) ? 'yes' : 'no'
    case 'soft':
    case 'unknown':
      return 'maybe'
    case 'and': {
      const kids = node.kids.map((kid) => evaluate(kid, taken))
      if (kids.includes('no')) return 'no'
      return kids.includes('maybe') ? 'maybe' : 'yes'
    }
    case 'or': {
      const kids = node.kids.map((kid) => evaluate(kid, taken))
      if (kids.includes('yes')) return 'yes'
      return kids.includes('maybe') ? 'maybe' : 'no'
    }
  }
}

export type { RequirementStatus } from './types.ts'

export type RequirementCheck = {
  /** Excluded because the student already took a barring course. */
  ruledOut: string[]
  prereqStatus: RequirementStatus
  coreqStatus: RequirementStatus
  prereqText: string
  coreqText: string
}

function statusOf(node: Node | null, satisfiers: Set<string>): RequirementStatus {
  if (!node) return 'none'
  const result = evaluate(node, satisfiers)
  if (result === 'yes') return 'met'
  if (result === 'no') return 'missing'
  return 'unverifiable'
}

/**
 * Evaluates an already-parsed requirement against a student's history. This is the
 * hot path — candidate filtering runs it for every course on every keystroke — so
 * requirements are parsed once at load time (data.ts) and only evaluated here.
 */
export function evaluateRequirement(
  requirement: Requirement,
  taken: Set<string>,
  committed: Set<string> = new Set(),
): RequirementCheck {
  // Match on the eight-character key so "took ENGG1000" satisfies a requirement
  // written as ENGG1000A, and vice versa.
  const takenKeys = keySet(taken)
  const ruledOut = requirement.exclusions.filter((code) => takenKeys.has(code))
  // A corequisite may be taken concurrently, so a committed course counts too.
  const coreqKeys = keySet([...taken, ...committed])

  return {
    ruledOut,
    prereqStatus: statusOf(requirement.prerequisite, takenKeys),
    coreqStatus: statusOf(requirement.corequisite, coreqKeys),
    prereqText: requirement.prereqText,
    coreqText: requirement.coreqText,
  }
}

/** Convenience for one-off parsing + evaluation (tests, ad-hoc checks). */
export function checkRequirement(
  raw: string,
  taken: Set<string>,
  options: { knownCodes?: Set<string> | null; committed?: Set<string> } = {},
): RequirementCheck {
  return evaluateRequirement(
    parseRequirement(raw, options.knownCodes ?? null),
    taken,
    options.committed ?? new Set(),
  )
}

/** Every course code referenced anywhere in a boolean expression. */
export function collectCodes(node: Node | null): string[] {
  if (!node) return []
  if (node.t === 'code') return [node.code]
  if (node.t === 'and' || node.t === 'or') return node.kids.flatMap(collectCodes)
  return []
}
