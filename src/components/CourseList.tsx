import { useMemo, useState } from 'react'
import { courseColor } from '../lib/color.ts'
import type { Offering } from '../lib/data.ts'
import { availableDigits, buildList, parseSubjects, type ListFilters } from '../lib/listing.ts'

const TERM_LABEL: Record<number, string> = { 1: '上学期', 2: '下学期' }

export function CourseList({
  offerings,
  committed,
  onAdd,
}: {
  offerings: Offering[]
  committed: string[]
  onAdd: (code: string) => void
}) {
  const [subjectDraft, setSubjectDraft] = useState('')
  const [digits, setDigits] = useState<number[]>([])
  const [name, setName] = useState('')

  const subjects = useMemo(() => parseSubjects(subjectDraft), [subjectDraft])
  const filters: ListFilters = useMemo(() => ({ subjects, digits, name: name.trim() }), [digits, name, subjects])

  const digitOptions = useMemo(() => availableDigits(offerings, subjects), [offerings, subjects])
  const rows = useMemo(() => buildList(offerings, filters), [filters, offerings])

  const committedSet = useMemo(() => new Set(committed), [committed])
  const courseCount = rows.reduce((sum, row) => sum + row.courses.length, 0)
  const active = subjects.length + digits.length + (name.trim() ? 1 : 0)

  function toggleDigit(digit: number): void {
    setDigits((current) =>
      current.includes(digit) ? current.filter((value) => value !== digit) : [...current, digit].sort(),
    )
  }

  return (
    <div className="cl">
      <div className="cl__filters">
        <input
          className="cl__subject"
          placeholder="科目四个字母，如 CSCI MATH"
          value={subjectDraft}
          onChange={(event) => setSubjectDraft(event.target.value)}
        />
        <input
          className="cl__name"
          placeholder="课名关键词"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {active > 0 && (
          <button
            className="cl__clear"
            type="button"
            onClick={() => {
              setSubjectDraft('')
              setDigits([])
              setName('')
            }}
          >
            清除
          </button>
        )}
      </div>

      <div className="cl__digits">
        <span className="cl__digits-label">首位数字</span>
        {digitOptions.map((digit) => (
          <button
            className={digits.includes(digit) ? 'digit digit--on' : 'digit'}
            key={digit}
            type="button"
            onClick={() => toggleDigit(digit)}
          >
            {digit}
          </button>
        ))}
        <span className="cl__count">{rows.length} 组 · {courseCount} 门</span>
      </div>

      <div className="cl__scroll">
        {rows.length === 0 ? (
          <div className="cl__empty">没有符合条件的课程</div>
        ) : (
          rows.map((row) => (
            <div className="cl-row" key={`${row.subject}-${row.digit}-${row.termOrder}`}>
              <div className="cl-row__label" style={courseColor(row.subject)}>
                <b>{row.subject}</b>
                <span>{row.digit}字头</span>
                <em className={row.termOrder === 1 ? 'term term--t1' : 'term term--t2'}>
                  {TERM_LABEL[row.termOrder]}
                </em>
              </div>
              <div className="cl-row__courses">
                {row.courses.map((course) => (
                  <button
                    className={committedSet.has(course.code) ? 'cl-chip cl-chip--on' : 'cl-chip'}
                    key={course.code}
                    style={courseColor(course.subject)}
                    title={`${course.code} ${course.title} · ${course.units} 学分${
                      committedSet.has(course.code) ? '（已在要上的课里）' : '（点击加入要上的课）'
                    }`}
                    type="button"
                    onClick={() => onAdd(course.code)}
                  >
                    {course.code.slice(4)}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
