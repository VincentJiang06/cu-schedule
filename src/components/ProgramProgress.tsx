import { glossSection } from '../lib/programs.ts'
import type { CreditBucket, ProgramProgress as Progress, SectionProgress } from '../lib/programProgress.ts'
import { getLang, t } from '../i18n/index.ts'

/**
 * 信息页「已完成课程」下方的学分进度计算器。把已完成课程按当前培养方案的顶层 section
 * (大课表编号项 1./2./3./4.)归类,逐组显示「已修 / 需修」学分与进度条,末尾给本方案累计
 * 与方案外(自由选修)统计。纯展示:所有归并/求和在 lib/programProgress.ts,单一来源同口径。
 *
 * 不画进度条的两种组:required 为 null(方案未声明该组学分要求),以及 countable=false
 * (日历只用一句话描述该组范围、没有课单可比对——画条就是谎报,明说无法自动统计)。
 */

// 进度条百分比:封顶 100%(超修/多组共享时 earned 可能大于 required,如实透出数字但条封顶)。
function pct(earned: number, required: number | null): number {
  if (required == null || required <= 0) return 0
  return Math.min(100, Math.round((earned / required) * 100))
}

function SectionName({ title }: { title: string }) {
  const label = glossSection(title)
  // 中文标签(「学院基础包」)是给中文读者的辅助,日历原文才是分区的权威名字:所以中文/繁体
  // 界面显示「标签 + 原文小字」,英文界面直接用原文——再翻一次只会得到一个二手英文名,
  // 与它旁边的原文打架。
  if (label.zh && getLang() !== 'en') {
    return (
      <>
        {t(label.zh)}
        <em className="prog-progress__en">{label.en}</em>
      </>
    )
  }
  // 专名原样;解析器写进数据的固定中文标题(兜底节「其他相关课程」)有词典条目,t() 会译。
  if (label.en) return <>{t(label.en)}</>
  return <>{t('课程要求')}</>
}

// 已修学分 / 需修学分 数字块。required 缺省时只显示已修;unknown 时已修位置给「—」——
// 这一组算不出来,写个 0 会被读成「你一门都没修」。
function Nums({
  earned,
  required,
  unknown,
}: {
  earned: number
  required: number | null
  unknown?: boolean
}) {
  return (
    <span className="prog-progress__nums">
      <b>{unknown ? '—' : earned}</b>
      {required != null && <> / {required}</>} {t('学分')}
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

// 「其中 N 门今年未开课,按 3 学分估算」——按 3 学分估的门数一旦进了某个总数,就得在那个
// 总数旁边说清楚,不能只在分节说。
function EstimateHint({ bucket }: { bucket: CreditBucket }) {
  if (bucket.estimated <= 0) return null
  return (
    <span className="prog-progress__hint">
      {t('其中 {n} 门今年未开课，按 3 学分估算', { n: bucket.estimated })}
    </span>
  )
}

function SectionRow({ section }: { section: SectionProgress }) {
  // 有学分预算却没有课单可比对:画条=谎报进度(它永远停在 0)。给出预算、说明原因。
  const uncountable = section.required != null && !section.countable
  return (
    <li className="prog-progress__row">
      <div className="prog-progress__line">
        <span className="prog-progress__label">
          {section.marker && <span className="prog-progress__marker">{section.marker}</span>}
          <SectionName title={section.title} />
        </span>
        <Nums earned={section.earned} required={section.required} unknown={uncountable} />
      </div>
      {!uncountable && <Bar earned={section.earned} required={section.required} />}
      {uncountable ? (
        <span className="prog-progress__hint">{t('本组只给了文字范围、没有课程清单，无法自动统计')}</span>
      ) : (
        <EstimateHint
          bucket={{ earned: section.earned, count: section.count, estimated: section.estimated }}
        />
      )}
    </li>
  )
}

export function ProgramProgress({ data, takenTotal }: { data: Progress; takenTotal: number }) {
  const proseOnly = data.sections.length === 0

  return (
    <section className="card prog-progress">
      <h2 className="card__title">
        {t('学分进度')}
        <span className="card__note">{t('已完成课程按培养方案归类')}</span>
      </h2>

      {takenTotal === 0 && (
        <p className="card__sub">{t('还没有已完成课程——在上方录入成绩单课号，这里会算出各组已修学分。')}</p>
      )}

      {proseOnly ? (
        <p className="card__sub">{t('该方案暂无结构化清单，无法按组拆分，仅统计本方案累计。')}</p>
      ) : (
        <ul className="prog-progress__list">
          {data.sections.map((section, index) => (
            <SectionRow key={`${section.marker}-${section.title}-${index}`} section={section} />
          ))}
        </ul>
      )}

      <div className="prog-progress__total">
        <span className="prog-progress__total-label">{t('本方案已修')}</span>
        <Nums earned={data.inProgram.earned} required={data.totalRequired} />
      </div>
      <Bar earned={data.inProgram.earned} required={data.totalRequired} />
      <EstimateHint bucket={data.inProgram} />

      {data.unplaced.count > 0 && (
        <p className="prog-progress__outside">
          {t('另有 {n} 门 · {u} 学分：方案页有列出，但不属于上面任何一组，未计入累计', {
            n: data.unplaced.count,
            u: data.unplaced.earned,
          })}
        </p>
      )}

      {data.outside.count > 0 && (
        <p className="prog-progress__outside">
          {t('另有 {n} 门 · {u} 学分不在本方案内（自由选修 / 通识等）', {
            n: data.outside.count,
            u: data.outside.earned,
          })}
        </p>
      )}

      <p className="card__sub">
        {t('学分以本学年目录为准；「任选其一」等多组共享、超修情况以 CUSIS 与培养方案为准。')}
      </p>
    </section>
  )
}
