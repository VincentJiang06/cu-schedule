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
  // 中文输入法拼字(composition)期间为 true——拼音中间态只更新草稿文本，不解析/不提交，
  // 避免按 Enter 选字被误当成"回车录入"提前触发 parseCourseCodes。
  const [composing, setComposing] = useState(false)
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

  // 遇到显式分隔符(空格/逗号/顿号)且不在合成态时，把草稿里已经完整的课号立即解析录入，
  // 不必等用户再按回车。解析不出课号(分隔符前只是打了一半)就原样保留草稿，不清空、
  // 不误吞用户还在输入的内容。
  function maybeAutoCommit(value: string): void {
    if (!/[\s,，、]$/.test(value)) return
    const parsed = parseCourseCodes(value)
    if (parsed.length > 0) add(parsed)
  }

  return (
    <div className={`ci ci--${variant}`}>
      <div className="ci__box" onPointerDown={() => inputRef.current?.focus()}>
        {codes.map((code) => (
          <button
            className={known.has(code) ? 'ci__chip' : 'ci__chip ci__chip--unknown'}
            key={code}
            style={courseColor(code)}
            title={
              known.has(code)
                ? '点击移除'
                : variant === 'taken'
                  ? '未在本学年课程目录中找到，仅供留档'
                  : '本学期没有开设这门课'
            }
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
            const value = event.target.value
            setDraft(value)
            setActive(0)
            setOpen(true)
            // 合成态(拼音中间态)只更新上面的草稿，不解析，交给 compositionEnd 之后再判断。
            if (composing) return
            maybeAutoCommit(value)
          }}
          onCompositionEnd={(event) => {
            setComposing(false)
            maybeAutoCommit(event.currentTarget.value)
          }}
          onCompositionStart={() => setComposing(true)}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            // IME 拼字中按 Enter 通常是在选字/确认候选词，不是"回车录入"——原生
            // isComposing 在这种 Enter 上仍为 true；composing 状态兜底极少数不设它的实现。
            if (event.nativeEvent.isComposing || composing) return
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
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
