import { useMemo, useRef, useState } from 'react'
import { getProgram, searchPrograms, type Program, type SubjectTitle } from '../lib/programs.ts'

// Programme names in the data are Traditional Chinese (計算機), so a Simplified query
// (计算机) would miss. This is a small char-level 简→繁 map covering characters common in
// CUHK major names; the query is mapped char-by-char and searched alongside the raw
// string, so both Simplified and Traditional (and English) input hit.
const S2T: Record<string, string> = {
  计: '計', 机: '機', 学: '學', 数: '數', 医: '醫', 药: '藥', 护: '護', 经: '經',
  济: '濟', 统: '統', 华: '華', 语: '語', 传: '傳', 闻: '聞', 环: '環', 织: '織',
  会: '會', 营: '營', 银: '銀', 融: '融', 电: '電', 综: '綜', 类: '類', 术: '術',
  国: '國', 际: '際', 应: '應', 产: '產', 业: '業', 师: '師', 处: '處', 关: '關',
  区: '區', 双: '雙', 单: '單', 亚: '亞', 欧: '歐', 汉: '漢', 历: '歷', 险: '險',
  优: '優', 广: '廣', 体: '體', 剂: '劑', 认: '認', 识: '識', 视: '視', 觉: '覺',
  声: '聲', 战: '戰', 图: '圖', 书: '書', 馆: '館', 质: '質', 检: '檢', 验: '驗',
  报: '報', 导: '導', 论: '論', 与: '與', 结: '結', 构: '構', 义: '義', 财: '財',
  务: '務', 贸: '貿', 农: '農', 剧: '劇',
}

/** Map a Simplified query to Traditional char-by-char; unmapped chars pass through. */
function toTraditional(query: string): string {
  let out = ''
  for (const ch of query) out += S2T[ch] ?? ch
  return out
}

/**
 * Type-ahead picker for the student's major (培养方案). Mirrors SubjectPicker's
 * dropdown interaction, but holds a single selection: once a programme is chosen it
 * collapses to a chip showing the Chinese/English name, clearable with ×. Stores the
 * stable `program.id` upstream. `year` narrows the candidate list when the admission
 * year matches a year the programme data covers (loose: unmatched years are ignored).
 */
export function ProgramPicker({
  programs,
  subjects,
  selectedId,
  year,
  onChange,
}: {
  programs: Program[]
  /** Subject code→title list, so a code query (CSCI) resolves via the subject's title. */
  subjects: SubjectTitle[]
  selectedId: string
  /** Admission year; passed to searchPrograms only when the data actually has it. */
  year?: string
  onChange: (id: string | null) => void
}) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = useMemo(
    () => (selectedId ? getProgram(programs, selectedId) : undefined),
    [programs, selectedId],
  )

  // Search the raw query and its 简→繁 mapping, then merge (raw first) and dedupe by id,
  // so Simplified input still matches the Traditional programme names without touching
  // programs.ts's matcher.
  const matches = useMemo(() => {
    if (programs.length === 0) return []
    const raw = searchPrograms(programs, draft, { year, limit: 7, subjects })
    const trad = toTraditional(draft)
    if (trad === draft) return raw
    const merged = [...raw]
    const seen = new Set(raw.map((p) => p.id))
    for (const p of searchPrograms(programs, trad, { year, limit: 7, subjects })) {
      if (!seen.has(p.id)) {
        seen.add(p.id)
        merged.push(p)
      }
    }
    return merged.slice(0, 7)
  }, [draft, programs, subjects, year])

  function choose(program: Program): void {
    onChange(program.id)
    setDraft('')
    setActive(0)
    setOpen(false)
  }

  if (selected) {
    return (
      <div className="pp">
        <button
          className="pp__chip"
          title="点击清除主修"
          type="button"
          onClick={() => onChange(null)}
        >
          <b>{selected.name_chi || selected.name_en}</b>
          <em>{selected.name_en}</em>
          <i aria-hidden>×</i>
        </button>
      </div>
    )
  }

  return (
    <div className="pp">
      <input
        ref={inputRef}
        className="search-box"
        placeholder="中英文名，如 Computer / 計算機"
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
            choose(matches[active] ?? matches[0])
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
      {open && matches.length > 0 && (
        <ul className="sp__menu pp__menu">
          {matches.map((program, index) => (
            <li key={program.id}>
              <button
                className={index === active ? 'pp__option pp__option--active' : 'pp__option'}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault()
                  choose(program)
                }}
                onMouseEnter={() => setActive(index)}
              >
                <b>{program.name_chi || program.name_en}</b>
                <span>
                  {program.name_en} · {program.year}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
