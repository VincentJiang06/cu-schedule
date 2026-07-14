import { glossSection } from '../lib/programs.ts'
import type { ProgramProgress as Progress, SectionProgress } from '../lib/programProgress.ts'

/**
 * 信息页「已完成课程」下方的学分进度计算器。把已完成课程按当前培养方案的顶层 section
 * (大课表编号项 1./2./3./4.)归类,逐组显示「已修 / 需修」学分与进度条,末尾给本方案累计
 * 与方案外(自由选修)统计。纯展示:所有归并/求和在 lib/programProgress.ts,单一来源同口径。
 *
 * required 为 null 的组(极少数方案未声明学分要求)不画进度条,只报已修学分。
 */

// 进度条百分比:封顶 100%(超修/多组共享时 earned 可能大于 required,如实透出数字但条封顶)。
function pct(earned: number, required: number | null): number {
  if (required == null || required <= 0) return 0
  return Math.min(100, Math.round((earned / required) * 100))
}

function SectionName({ title }: { title: string }) {
  const label = glossSection(title)
  if (label.zh) {
    return (
      <>
        {label.zh}
        <em className="prog-progress__en">{label.en}</em>
      </>
    )
  }
  if (label.en) return <>{label.en}</>
  return <>课程要求</>
}

// 已修学分 / 需修学分 数字块。required 缺省时只显示已修。
function Nums({ earned, required }: { earned: number; required: number | null }) {
  return (
    <span className="prog-progress__nums">
      <b>{earned}</b>
      {required != null && <> / {required}</>} 学分
    </span>
  )
}

function Bar({ earned, required }: { earned: number; required: number | null }) {
  if (required == null || required <= 0) return null
  const value = pct(earned, required)
  const done = earned >= required
  return (
    <div
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={value}
      className="prog-progress__bar"
      role="progressbar"
    >
      <span
        className={`prog-progress__fill${done ? ' prog-progress__fill--done' : ''}`}
        style={{ width: `${value}%` }}
      />
    </div>
  )
}

function SectionRow({ section }: { section: SectionProgress }) {
  return (
    <li className="prog-progress__row">
      <div className="prog-progress__line">
        <span className="prog-progress__label">
          {section.marker && <span className="prog-progress__marker">{section.marker}</span>}
          <SectionName title={section.title} />
        </span>
        <Nums earned={section.earned} required={section.required} />
      </div>
      <Bar earned={section.earned} required={section.required} />
      {section.unknownUnits > 0 && (
        <span className="prog-progress__hint">其中 {section.unknownUnits} 门今年未开课，学分未计</span>
      )}
    </li>
  )
}

export function ProgramProgress({ data, takenTotal }: { data: Progress; takenTotal: number }) {
  const proseOnly = data.sections.length === 0

  return (
    <section className="card prog-progress">
      <h2 className="card__title">
        学分进度
        <span className="card__note">已完成课程按培养方案归类</span>
      </h2>

      {takenTotal === 0 && (
        <p className="card__sub">还没有已完成课程——在上方录入成绩单课号，这里会算出各组已修学分。</p>
      )}

      {proseOnly ? (
        <p className="card__sub">该方案暂无结构化清单，无法按组拆分，仅统计本方案累计。</p>
      ) : (
        <ul className="prog-progress__list">
          {data.sections.map((section, index) => (
            <SectionRow key={`${section.marker}-${section.title}-${index}`} section={section} />
          ))}
        </ul>
      )}

      <div className="prog-progress__total">
        <span className="prog-progress__total-label">本方案已修</span>
        <Nums earned={data.inProgram.earned} required={data.totalRequired} />
      </div>
      <Bar earned={data.inProgram.earned} required={data.totalRequired} />

      {data.outside.count > 0 && (
        <p className="prog-progress__outside">
          另有 {data.outside.count} 门
          {data.outside.earned > 0 && ` · ${data.outside.earned} 学分`}
          不在本方案内（自由选修 / 通识等）
        </p>
      )}

      <p className="card__sub">
        学分以本学年目录为准；「任选其一」等多组共享、超修情况以 CUSIS 与培养方案为准。
      </p>
    </section>
  )
}
