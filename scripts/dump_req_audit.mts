// 一次性审计工具:把 raw 里所有 distinct enrollment_requirement 跑一遍解析器,
// 输出 JSONL(text/count/解析出的 exclusions/prereq AST/coreq AST),供全量人审/机审。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { parseRequirement } from '../src/lib/requirements.ts'

const YEAR = '2026-27'
const dir = `data/raw/courses/${YEAR}`
const known = new Set<string>()
const texts = new Map<string, { count: number; sample: string }>()

for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))
  for (const c of d.courses) {
    known.add(String(c.code || c.course_code || '').replace(/\s+/g, ''))
    const r = String(c.enrollment_requirement || '').trim()
    if (!r) continue
    const e = texts.get(r)
    if (e) e.count += 1
    else texts.set(r, { count: 1, sample: String(c.code || c.course_code || '') })
  }
}

const lines: string[] = []
for (const [text, { count, sample }] of texts) {
  const req = parseRequirement(text, known)
  lines.push(
    JSON.stringify({
      text,
      count,
      sample,
      exclusions: req.exclusions,
      prereq: req.prerequisite,
      coreq: req.corequisite,
      prereqText: req.prereqText,
    }),
  )
}
writeFileSync('req-audit.jsonl', lines.join('\n') + '\n')
console.log(`known codes: ${known.size}, distinct requirement texts: ${lines.length} → req-audit.jsonl`)
