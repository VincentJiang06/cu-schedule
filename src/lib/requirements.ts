/**
 * The catalog's `enrollment_requirement` is free text, but it follows a small set of
 * templates. We read only what we can read confidently, and stay silent otherwise —
 * a wrong "you're missing a prerequisite" is worse than no hint at all.
 *
 * Typical value:
 *   "Not for students who have taken ENGG3820 or ESTR3308;Pre-requisite: CSCI1120 or 1130 or ESTR1100."
 *
 * Note the bare `1130`: within a clause, a number without a subject inherits the
 * subject of the code before it.
 */
export type Requirement = {
  /** Courses that make this one un-takeable once completed ("not for students who have taken …"). */
  exclusions: string[]
  /** Alternatives, any one of which satisfies the prerequisite. Empty when we could not parse one. */
  prerequisites: string[]
}

const EXCLUSION_RE = /not for (?:those|students)\s+who\s+(?:have\s+)?(?:taken|passed)/i
const PREREQ_RE = /pre-?requisite/i
const CODE_RE = /\b([A-Z]{4})\s?(\d{4})\b|\b(\d{4})\b/g

function extractCodes(clause: string): string[] {
  const codes: string[] = []
  let subject: string | null = null
  for (const match of clause.matchAll(CODE_RE)) {
    if (match[1]) {
      subject = match[1]
      codes.push(`${match[1]}${match[2]}`)
    } else if (match[3] && subject) {
      // A bare number inherits the most recent subject: "CSCI1120 or 1130".
      codes.push(`${subject}${match[3]}`)
    }
  }
  return [...new Set(codes)]
}

export function parseRequirement(raw: string): Requirement {
  const exclusions: string[] = []
  const prerequisites: string[] = []

  for (const clause of (raw || '').split(/[;\n]/)) {
    const text = clause.trim()
    if (!text) continue
    if (EXCLUSION_RE.test(text)) {
      exclusions.push(...extractCodes(text))
    } else if (PREREQ_RE.test(text)) {
      // Only single-alternative-group clauses are safe to read as a flat OR list.
      // "A or B" -> [A, B]; anything with "and" mixes AND/OR, so we skip it.
      if (!/\band\b/i.test(text)) prerequisites.push(...extractCodes(text))
    }
  }

  return { exclusions: [...new Set(exclusions)], prerequisites: [...new Set(prerequisites)] }
}

export type RequirementCheck = {
  /** The student already took a course that rules this one out. */
  ruledOut: string[]
  /** We parsed a prerequisite list and none of it is in the student's history. */
  missingPrereq: string[]
}

export function checkRequirement(raw: string, taken: Set<string>): RequirementCheck {
  const { exclusions, prerequisites } = parseRequirement(raw)
  const ruledOut = exclusions.filter((code) => taken.has(code))
  const satisfied = prerequisites.length === 0 || prerequisites.some((code) => taken.has(code))
  return { ruledOut, missingPrereq: satisfied ? [] : prerequisites }
}
