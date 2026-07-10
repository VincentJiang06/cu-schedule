/**
 * The one place that decides what makes two course codes "the same course".
 *
 * A CUHK code is four subject letters + a four-digit number (CSCI2100). Those
 * eight characters are the canonical identity — the key. Occasionally a course is
 * published as variants that share the number but carry a trailing letter
 * (ENGG1000A vs ENGG1000B); they are genuinely different offerings, yet a
 * prerequisite, a pasted transcript, or a search that says "ENGG1000" means all
 * of them. So matching is deliberately loose: compare on the eight-character key,
 * and let the suffix ride along for display and, when present on both sides,
 * exact disambiguation.
 *
 * (No suffixed codes exist in the current dataset — this keeps the model correct
 * if CUHK ever publishes them, at zero cost today since key === full for 8-char
 * codes.)
 */

export type ParsedCode = {
  /** Normalized full code, suffix included: "ENGG1000A". */
  full: string
  /** Canonical eight-character identity: "ENGG1000". */
  key: string
  /** Four subject letters: "ENGG". */
  subject: string
  /** Four-digit catalog number: "1000". */
  number: string
  /** Trailing variant letters, usually empty: "A". */
  suffix: string
  /** Leading digit of the number, the course level (1-9). */
  level: number
}

const CODE_SHAPE = /^([A-Z]{4})(\d{4})([A-Z0-9]*)$/

function clean(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** The eight-character identity used for every equality test and lookup. */
export function courseKey(code: string): string {
  return clean(code).slice(0, 8)
}

export function parseCode(code: string): ParsedCode {
  const full = clean(code)
  const match = full.match(CODE_SHAPE)
  const subject = match?.[1] ?? full.slice(0, 4)
  const number = match?.[2] ?? full.slice(4, 8)
  const suffix = match?.[3] ?? full.slice(8)
  return { full, key: `${subject}${number}`, subject, number, suffix, level: Number(number[0]) || 0 }
}

/** True when two codes name the same course (same eight-character key). */
export function codesMatch(a: string, b: string): boolean {
  return courseKey(a) === courseKey(b)
}

/** A well-formed course code, with or without a variant suffix. */
export function isCourseCode(code: string): boolean {
  return CODE_SHAPE.test(clean(code))
}

/** Normalize any collection of codes to a set of canonical keys, for fast matching. */
export function keySet(codes: Iterable<string>): Set<string> {
  const set = new Set<string>()
  for (const code of codes) set.add(courseKey(code))
  return set
}
