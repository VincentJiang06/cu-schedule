import { useMemo, useRef, useState } from 'react'
import { courseColor } from '../lib/color.ts'
import type { SubjectInfo } from '../lib/data.ts'
import { subjectBlurb } from '../lib/subjectNames.ts'

export function SubjectPicker({
  subjects,
  selected,
  onChange,
  variant = 'include',
  placeholder,
  single = false,
}: {
  subjects: SubjectInfo[]
  selected: string[]
  onChange: (codes: string[]) => void
  variant?: 'include' | 'exclude'
  placeholder?: string
  /** Single-select mode (主修): holds one code, collapses to a chip once chosen. */
  single?: boolean
}) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const titleByCode = useMemo(
    () => new Map(subjects.map((subject) => [subject.code, subject.title])),
    [subjects],
  )

  const matches = useMemo(() => {
    const needle = draft.trim().toUpperCase()
    if (!needle) return []
    return subjects
      .filter((subject) => !selected.includes(subject.code))
      .filter(
        (subject) =>
          subject.code.startsWith(needle) || subjectBlurb(subject.code, subject.title).includes(draft.trim()),
      )
      .sort((a, b) => {
        // exact prefix matches first, then alphabetical
        const ap = a.code.startsWith(needle) ? 0 : 1
        const bp = b.code.startsWith(needle) ? 0 : 1
        return ap - bp || a.code.localeCompare(b.code)
      })
      .slice(0, 8)
  }, [draft, selected, subjects])

  function add(code: string): void {
    onChange(single ? [code] : [...new Set([...selected, code])])
    setDraft('')
    setActive(0)
    if (single) setOpen(false)
    else inputRef.current?.focus()
  }

  // Single-select: once a subject is chosen, collapse to a single clearable chip that
  // shows only the four-letter code (with the subject name as a small caption).
  if (single && selected.length > 0) {
    const code = selected[0]
    return (
      <div className="sp sp--single">
        <div className="sp__chips">
          <button
            className="sp__chip"
            style={courseColor(code)}
            title="点击清除主修"
            type="button"
            onClick={() => onChange([])}
          >
            {code}
            <em>{subjectBlurb(code, titleByCode.get(code))}</em>
            <i aria-hidden>×</i>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`sp sp--${variant}`}>
      {selected.length > 0 && (
        <div className="sp__chips">
          {selected.map((code) => (
            <button
              className={variant === 'exclude' ? 'sp__chip sp__chip--exclude' : 'sp__chip'}
              key={code}
              style={variant === 'exclude' ? undefined : courseColor(code)}
              title="点击移除"
              type="button"
              onClick={() => onChange(selected.filter((item) => item !== code))}
            >
              {variant === 'exclude' && <i aria-hidden>−</i>}
              {code}
              <em>{subjectBlurb(code, titleByCode.get(code))}</em>
              <i aria-hidden>×</i>
            </button>
          ))}
        </div>
      )}
      <div className="sp__box">
        <input
          ref={inputRef}
          className="sp__field"
          placeholder={placeholder ?? '输入学科字母，如 C…'}
          value={draft}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setDraft(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && matches.length > 0) {
              event.preventDefault()
              add(matches[active]?.code ?? matches[0].code)
            } else if (event.key === 'ArrowDown' && matches.length > 0) {
              event.preventDefault()
              setActive((index) => (index + 1) % matches.length)
            } else if (event.key === 'ArrowUp' && matches.length > 0) {
              event.preventDefault()
              setActive((index) => (index - 1 + matches.length) % matches.length)
            } else if (event.key === 'Escape') {
              setOpen(false)
            }
          }}
        />
      </div>
      {open && matches.length > 0 && (
        <ul className="sp__menu">
          {matches.map((subject, index) => (
            <li key={subject.code}>
              <button
                className={index === active ? 'sp__option sp__option--active' : 'sp__option'}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault()
                  add(subject.code)
                }}
                onMouseEnter={() => setActive(index)}
              >
                <b style={courseColor(subject.code)}>{subject.code}</b>
                <span>{subjectBlurb(subject.code, subject.title)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
