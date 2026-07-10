/**
 * Exercises the requirement parser against the real catalog:
 *   1. asserts hand-picked cases (the tricky grammar we found by mining the data)
 *   2. sweeps every course to measure coverage and, above all, flag false positives
 *      — a course reported "missing prerequisite" against a student who took exactly
 *      what the text asks for.
 *
 * Run: npx tsx scripts/check_requirements.mts
 */
import assert from 'node:assert'
import fs from 'node:fs'
import { checkRequirement, collectCodes, parseRequirement } from '../src/lib/requirements.ts'

type Raw = { c: string; rq: string }
function load(slug: string): Raw[] {
  return JSON.parse(fs.readFileSync(`data/courses/2026-27/${slug}.json`, 'utf8')).courses
}
const term1 = load('2026-27-term-1')
const term2 = load('2026-27-term-2')
const known = new Set<string>([...term1, ...term2].map((c) => c.c))

let failures = 0
function check(label: string, got: unknown, want: unknown): void {
  try {
    assert.deepStrictEqual(got, want)
    console.log(`  ✓ ${label}`)
  } catch {
    failures += 1
    console.log(`  ✗ ${label}\n      got : ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`)
  }
}
const status = (rq: string, taken: string[]) =>
  checkRequirement(rq, new Set(taken), { knownCodes: known }).prereqStatus
const ruled = (rq: string, taken: string[]) =>
  checkRequirement(rq, new Set(taken), { knownCodes: known }).ruledOut

console.log('=== hand-picked cases ===')

// pure OR
check('OR met', status('Pre-requisite: CSCI1120 or 1130 or ESTR1100', ['CSCI1130']), 'met')
check('OR missing', status('Pre-requisite: CSCI1120 or 1130', ['MATH1010']), 'missing')

// pure AND (previously skipped entirely → now checked)
check('AND both met', status('Pre-requisite: MATH2230 and MATH3060', ['MATH2230', 'MATH3060']), 'met')
check('AND one missing', status('Pre-requisite: MATH2230 and MATH3060', ['MATH2230']), 'missing')

// nested AND-of-ORs with brackets
check(
  'nested met',
  status('Pre-requisite: (ELTU1001 or ELTU1002) and (ELTU2004 or ELTU2005)', ['ELTU1002', 'ELTU2005']),
  'met',
)
check(
  'nested missing second group',
  status('Pre-requisite: (ELTU1001 or ELTU1002) and (ELTU2004 or ELTU2005)', ['ELTU1002']),
  'missing',
)

// slash equivalents
check('slash equiv met', status('Pre-requisite: MAEG2030/ESTR2402 and MAEG3030', ['ESTR2402', 'MAEG3030']), 'met')

// grade condition ⇒ never a hard verdict either way
check('grade condition unverifiable', status('Pre-requisite: Grade B or above in MUSC3212 or MUSC2262', ['MUSC3212']), 'unverifiable')

// instructor consent / exemption escape hatch ⇒ never missing
check('consent escape', status('Pre-requisite: EEEN3030 or with the consent of the course instructor', ['NONE0000']), 'unverifiable')
check('exemption escape', status('Pre-requisite: ELTU1001 or ELTU1002 or exemption from these courses', ['NONE0000']), 'unverifiable')

// waiver over-warn we must NOT commit: text has a waiver, but the boolean itself is
// unmet; we still return missing (the waiver is a program note we can't verify).
// The point of this case is only that it must not CRASH and must be deterministic.
check('waiver clause parses', status('Prerequisite: CENG2400 or ESTR2100.\nFor 2nd-year entrants, the prerequisite will be waived.', ['CENG2400']), 'met')

// year fragment must NOT become a phantom code
check(
  'year fragment not a code (exclusion)',
  ruled('Not for students who have taken CENG3480 in 2008-09 and before', ['CENG2008']),
  [],
)
check(
  'exclusion real hit',
  ruled('Not for students who have taken ENGG3820 or ESTR3308', ['ESTR3308']),
  ['ESTR3308'],
)

// bare-number-year inside a prereq must not fabricate a code
{
  const parsed = parseRequirement('Pre-requisite: MATH1010 for cohort 2024', known)
  const codes = JSON.stringify(parsed.prerequisite)
  check('no phantom MATH2024', codes.includes('MATH2024'), false)
}

console.log('\n=== loose key matching (ENGG1000 / ENGG1000A / ENGG1000B) ===')
const knownAB = new Set([...known, 'ENGG1000A', 'ENGG1000B'])
// A prereq written as the bare key is satisfied by either variant.
check('key prereq met by A variant', status('Pre-requisite: ENGG1000', ['ENGG1000A']), 'met')
// A prereq written for a specific variant is satisfied by the plain key too.
check(
  'variant prereq met by plain code',
  checkRequirement('Pre-requisite: ENGG1000A', new Set(['ENGG1000']), { knownCodes: knownAB }).prereqStatus,
  'met',
)
// Exclusion keyed loosely: taking any variant bars the course.
check('exclusion hits across variant', ruled('Not for students who have taken ENGG1000', ['ENGG1000B']), ['ENGG1000'])

console.log('\n=== full-catalog sweep ===')

// For each course that states a prerequisite, feed EXACTLY the codes the parser
// believes are referenced and assert we never come back with "missing". A student
// holding everything the requirement names must satisfy it — otherwise the
// expression is self-contradictory, the false positive we cannot ship.
let stated = 0
let falsePositives = 0
const fpSamples: string[] = []
for (const course of [...term1, ...term2]) {
  if (!/pre-?requisite/i.test(course.rq)) continue
  stated += 1
  const parsed = parseRequirement(course.rq, known)
  const taken = new Set(collectCodes(parsed.prerequisite))
  if (taken.size === 0) continue // grade/consent-only clause, nothing to hold
  const result = checkRequirement(course.rq, taken, { knownCodes: known })
  if (result.prereqStatus === 'missing') {
    falsePositives += 1
    if (fpSamples.length < 12) fpSamples.push(`${course.c}: ${course.rq.replace(/\s+/g, ' ').slice(0, 130)}`)
  }
}
console.log(`courses stating a prerequisite: ${stated}`)
console.log(`false positives (holds every referenced code, still "missing"): ${falsePositives}`)
for (const s of fpSamples) console.log('   •', s)

// Coverage: with an empty history, how many stated prereqs resolve to a hard
// "missing" (i.e. we can actually help) vs unverifiable vs met.
let missing = 0
let unverifiable = 0
let met = 0
let none = 0
for (const course of [...term1, ...term2]) {
  const s = checkRequirement(course.rq, new Set(), { knownCodes: known }).prereqStatus
  if (s === 'missing') missing += 1
  else if (s === 'unverifiable') unverifiable += 1
  else if (s === 'met') met += 1
  else none += 1
}
console.log(`\nempty-history verdicts over ${term1.length + term2.length} offerings:`)
console.log(`  missing ${missing} · unverifiable ${unverifiable} · met ${met} · none ${none}`)

console.log(`\n${failures === 0 ? '✅ all assertions passed' : `❌ ${failures} assertion(s) failed`}`)
console.log(`${falsePositives === 0 ? '✅ zero false positives in sweep' : `❌ ${falsePositives} false positives`}`)
process.exit(failures === 0 && falsePositives === 0 ? 0 : 1)
