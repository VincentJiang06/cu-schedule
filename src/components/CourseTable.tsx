import { useEffect, useMemo, useState } from 'react'
import type { Candidate, CandidateStatus, CandidateSummary } from '../lib/candidates.ts'
import { courseColor } from '../lib/color.ts'
import { scoreCourse } from '../lib/search.ts'
import { DAY_SHORT, hhmm } from '../lib/time.ts'

const PAGE = 50

const STATUS_TEXT: Record<CandidateStatus, string> = {
  open: '可选',
  rearrange: '换排法',
  conflict: '冲突',
  tba: '待定',
}

const STATUS_HELP: Record<CandidateStatus, string> = {
  open: '有一种上课组合能直接放进当前课表',
  rearrange: '和当前排法冲突，但换一种排法就能放下',
  conflict: '所有上课组合都和你确定要上的课冲突',
  tba: '这门课本学期还没有公布上课时间',
}

const STATUS_RANK: Record<CandidateStatus, number> = { open: 0, rearrange: 1, tba: 2, conflict: 3 }

type Sort = 'fit' | 'code' | 'units'

export function CourseTable({
  rows,
  summary,
  onAdd,
}: {
  rows: Candidate[]
  summary: CandidateSummary
  onAdd: (code: string) => void
}) {
  const [query, setQuery] = useState('')
  const [subject, setSubject] = useState('all')
  const [openOnly, setOpenOnly] = useState(true)
  const [ugOnly, setUgOnly] = useState(true)
  const [sort, setSort] = useState<Sort>('fit')
  const [limit, setLimit] = useState(PAGE)

  const subjects = useMemo(
    () => [...new Set(rows.map((row) => row.course.subject))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    let next = rows
    if (ugOnly) next = next.filter((row) => row.course.career === 'Undergraduate')
    if (subject !== 'all') next = next.filter((row) => row.course.subject === subject)
    if (openOnly) next = next.filter((row) => row.status === 'open')

    if (query.trim()) {
      return next
        .map((row) => ({ row, score: scoreCourse(row.course, query) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.row.course.code.localeCompare(b.row.course.code))
        .map((entry) => entry.row)
    }

    const sorted = [...next]
    if (sort === 'code') {
      sorted.sort((a, b) => a.course.code.localeCompare(b.course.code))
    } else if (sort === 'units') {
      sorted.sort((a, b) => b.course.units - a.course.units || a.course.code.localeCompare(b.course.code))
    } else {
      sorted.sort(
        (a, b) =>
          STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
          a.missingPrereq.length - b.missingPrereq.length ||
          a.course.code.localeCompare(b.course.code),
      )
    }
    return sorted
  }, [openOnly, query, rows, sort, subject, ugOnly])

  useEffect(() => setLimit(PAGE), [query, subject, openOnly, ugOnly, sort])

  return (
    <section className="ct">
      <header className="ct__bar">
        <input
          className="ct__search"
          placeholder="搜索课号、课名或教师…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select value={subject} onChange={(event) => setSubject(event.target.value)}>
          <option value="all">全部学科</option>
          {subjects.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <button
          className={openOnly ? 'chip chip--on' : 'chip'}
          type="button"
          onClick={() => setOpenOnly((value) => !value)}
        >
          只看可选
        </button>
        <button className={ugOnly ? 'chip chip--on' : 'chip'} type="button" onClick={() => setUgOnly((value) => !value)}>
          仅本科
        </button>
        <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
          <option value="fit">按契合度</option>
          <option value="code">按课号</option>
          <option value="units">按学分</option>
        </select>
      </header>

      <p className="ct__summary">
        <b>{summary.open}</b> 门可直接选 · <b>{summary.rearrange}</b> 门换排法可选 ·{' '}
        <b>{summary.conflict}</b> 门冲突 · <b>{summary.tba}</b> 门时间待定
        {summary.taken > 0 && <> · 已排除 {summary.taken} 门已修</>}
        {summary.ruledOut > 0 && <> · {summary.ruledOut} 门因已修被互斥</>}
      </p>

      <div className="ct__scroll">
        <table className="ct__table">
          <thead>
            <tr>
              <th className="ct__c-status">状态</th>
              <th>课程</th>
              <th className="ct__c-units">学分</th>
              <th className="ct__c-time">时间</th>
              <th className="ct__c-teacher">教师</th>
              <th className="ct__c-act" />
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((row) => (
              <tr className={`ct__row ct__row--${row.status}`} key={row.course.code}>
                <td>
                  <span className={`badge badge--${row.status}`} title={STATUS_HELP[row.status]}>
                    {STATUS_TEXT[row.status]}
                  </span>
                </td>
                <td>
                  <div className="ct__code" style={courseColor(row.course.subject)}>
                    {row.course.code}
                    {row.missingPrereq.length > 0 && (
                      <em className="ct__prereq" title={`先修要求：${row.missingPrereq.join(' 或 ')}`}>
                        缺先修
                      </em>
                    )}
                  </div>
                  <div className="ct__title">{row.course.title}</div>
                </td>
                <td className="ct__c-units">{row.course.units}</td>
                <td>
                  {row.slots.length === 0 ? (
                    <span className="ct__tba">待定</span>
                  ) : (
                    <div className="ct__slots">
                      {row.slots.slice(0, 2).map((slot, index) => (
                        <span className="slot" key={`${slot.dayIndex}-${slot.start}-${index}`}>
                          <i>{DAY_SHORT[slot.dayIndex - 1]}</i>
                          {hhmm(slot.start)}–{hhmm(slot.end)}
                        </span>
                      ))}
                      {row.slots.length > 2 && (
                        <span
                          className="slot slot--more"
                          title={row.slots
                            .slice(2)
                            .map((slot) => `周${DAY_SHORT[slot.dayIndex - 1]} ${hhmm(slot.start)}–${hhmm(slot.end)}`)
                            .join('\n')}
                        >
                          +{row.slots.length - 2}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="ct__c-teacher">
                  <span title={row.instructors.join('、')}>{row.instructors[0] ?? '—'}</span>
                </td>
                <td className="ct__c-act">
                  <button className="add" type="button" onClick={() => onAdd(row.course.code)}>
                    加入
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td className="ct__empty" colSpan={6}>
                  没有符合条件的课程
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {filtered.length > limit && (
          <button className="ct__more" type="button" onClick={() => setLimit((value) => value + PAGE)}>
            还有 {filtered.length - limit} 门，显示更多
          </button>
        )}
      </div>
    </section>
  )
}
