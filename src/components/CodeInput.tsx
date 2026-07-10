import { useMemo, useRef, useState } from 'react'
import { courseColor } from '../lib/color.ts'
import { parseCourseCodes, searchCourses } from '../lib/search.ts'
import type { Course } from '../lib/types.ts'

export function CodeInput({
  codes,
  onChange,
  courses,
  placeholder,
  variant,
}: {
  codes: string[]
  onChange: (codes: string[]) => void
  courses: Course[]
  placeholder: string
  variant: 'commit' | 'taken'
}) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const known = useMemo(() => new Set(courses.map((course) => course.code)), [courses])
  const suggestions = useMemo(() => {
    if (!draft.trim()) return []
    return searchCourses(courses, draft, 7).filter((course) => !codes.includes(course.code))
  }, [codes, courses, draft])

  function add(next: string[]): void {
    if (next.length === 0) return
    onChange([...new Set([...codes, ...next])])
    setDraft('')
    setActive(0)
  }

  function commitDraft(): void {
    const parsed = parseCourseCodes(draft)
    if (parsed.length > 0) {
      add(parsed)
      return
    }
    if (suggestions.length > 0) add([suggestions[active]?.code ?? suggestions[0].code])
  }

  return (
    <div className={`ci ci--${variant}`}>
      <div className="ci__box" onPointerDown={() => inputRef.current?.focus()}>
        {codes.map((code) => (
          <button
            className={known.has(code) ? 'ci__chip' : 'ci__chip ci__chip--unknown'}
            key={code}
            style={courseColor(code)}
            title={known.has(code) ? '点击移除' : '本学期没有开设这门课'}
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onChange(codes.filter((item) => item !== code))
            }}
          >
            {code}
            <i aria-hidden>×</i>
          </button>
        ))}
        <input
          ref={inputRef}
          className="ci__field"
          placeholder={codes.length === 0 ? placeholder : ''}
          value={draft}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setDraft(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitDraft()
            } else if (event.key === 'ArrowDown' && suggestions.length > 0) {
              event.preventDefault()
              setActive((index) => (index + 1) % suggestions.length)
            } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
              event.preventDefault()
              setActive((index) => (index - 1 + suggestions.length) % suggestions.length)
            } else if (event.key === 'Backspace' && draft === '' && codes.length > 0) {
              onChange(codes.slice(0, -1))
            } else if (event.key === 'Escape') {
              setOpen(false)
            }
          }}
          onPaste={(event) => {
            const parsed = parseCourseCodes(event.clipboardData.getData('text'))
            if (parsed.length > 1) {
              event.preventDefault()
              add(parsed)
            }
          }}
        />
      </div>

      {open && suggestions.length > 0 && (
        <ul className="ci__menu">
          {suggestions.map((course, index) => (
            <li key={course.code}>
              <button
                className={index === active ? 'ci__option ci__option--active' : 'ci__option'}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault()
                  add([course.code])
                }}
                onMouseEnter={() => setActive(index)}
              >
                <b style={courseColor(course.subject)}>{course.code}</b>
                <span>{course.title}</span>
                <i>{course.units}</i>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
