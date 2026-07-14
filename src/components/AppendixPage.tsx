/**
 * 附录页：与选课本身无关、但选课季常用得上的几块参考信息——校历下载、本学期选课/加退选
 * 时间表（据 RES 官方页面整理）、新生官方链接、必备程序推荐、以及作者其它站点的邀请卡片
 * （复用页脚 SIBLINGS 数据源，这里做成更大、带简介的展示卡）。除「必备程序」的复制反馈
 * 外基本为静态内容。
 */

import type { CSSProperties } from 'react'

const CALENDAR_LINKS = [
  {
    label: '繁体中文版',
    href: 'https://www.res.cuhk.edu.hk/wp-content/uploads/general-information/Calendar-View-for-Academic-Year_2026-27_chi_final.pdf',
  },
  {
    label: 'English',
    href: 'https://www.res.cuhk.edu.hk/wp-content/uploads/general-information/Calendar-View-for-Academic-Year_2026-27_eng_final.pdf',
  },
]

const CALENDAR_SOURCE_URL = 'https://www.res.cuhk.edu.hk/general-information/almanac/university-almanac-2026-27/'

const NEWCOMER_LINKS = [
  {
    icon: '📘',
    name: '本科生手册 Undergraduate Student Handbook',
    desc: '大学核心课程（University Core）、通识教育（GE）、主修/副修（Majors & Minors）要求、学则（Regulations）与豁免规定，新生入学必读。',
    url: 'https://rgsntl.rgs.cuhk.edu.hk/aqs_prd_applx/Public/Handbook/Default.aspx?id=2&lang=en',
  },
  {
    icon: '📚',
    name: '公开课程目录 Course Catalogue',
    desc: '全校课程的官方目录，本站课程数据即来源于此。',
    url: 'https://rgsntl.rgs.cuhk.edu.hk/aqs_prd_applx/Public/tt_dsp_crse_catalog.aspx',
  },
  {
    icon: '🎓',
    name: 'CUSIS 学生资讯系统',
    desc: '选课、查看个人 Enrolment Dates 登入时间、成绩、个人资料，需登录使用。',
    url: 'https://cusis.cuhk.edu.hk/',
  },
  {
    icon: '🏛️',
    name: '教务处注册及考试组 RES',
    desc: '注册、考试、校历、加退选、超修申请等官方信息发布处。',
    url: 'https://www.res.cuhk.edu.hk/',
  },
  {
    icon: '🏫',
    name: '香港中文大学官网',
    desc: '大学总站。',
    url: 'https://www.cuhk.edu.hk/english/index.html',
  },
]

// 官方原文（RES）：First Term 2026-27 Course Registration and Add/Drop。放在选课时间卡片
// 最上方，方便用户一键看原文。
const COURSE_REG_SOURCE_URL =
  'https://www.res.cuhk.edu.hk/undergraduate-students/information-for-current-students/course-selection-and-add-drop/first-term-2026-27-course-registration-and-add-drop/'

// #里程碑6(选课时间三日期强化):每个日期各配一个独立 hue，做成醒目的彩色日期卡——复用
// 全站「课程按 --hue 上色」的同一套 hsl(var(--hue) var(--sat) …) 配方(见 color.ts/
// styles.css)，颜色互不相同，一眼就能分清"哪天是我"。when 一行放星期/时间或整段区间。
type EnrolCard = {
  dayNum: string
  month: string
  when: string
  hue: number
  desc: string
}

// 在校生选课（按年级分三天，均 10:00–22:00）。
const CURRENT_ENROL: EnrolCard[] = [
  {
    dayNum: '14',
    month: '8月',
    when: '周五 · 10:00–22:00',
    hue: 28,
    desc: 'Year 4+ 及最后一年学生、以 Advanced Standing 入学的 Year 3+、以 senior-year places 入学的 Year 2+',
  },
  {
    dayNum: '18',
    month: '8月',
    when: '周二 · 10:00–22:00',
    hue: 205,
    desc: 'Year 3、以 Advanced Standing 入学的 Year 2',
  },
  {
    dayNum: '19',
    month: '8月',
    when: '周三 · 10:00–22:00',
    hue: 280,
    desc: 'Year 2',
  },
]

// 新生选课（统一 9 月 1 日）。
const NEW_ENROL: EnrolCard[] = [
  {
    dayNum: '1',
    month: '9月',
    when: '周二 · 10:00–22:00',
    hue: 150,
    desc: '全体新生；以 Advanced Standing / senior-year 入学者及医学院 Year 2+ 自 10:00am 起，其余新生 11:00am 起',
  },
]

// 加退选（e-add/drop 与系方特别加退选各一档，颜色与选课日区分开）。
const ADD_DROP: EnrolCard[] = [
  {
    dayNum: '14',
    month: '9月',
    when: '周一 20:30 → 9/20 周日 20:30',
    hue: 340,
    desc: 'CUSIS 线上电子加退选（e-add/drop）；须系方同意（add/drop consent）的课程改交纸本表格到开课学系',
  },
  {
    dayNum: '21',
    month: '9月',
    when: '周一 – 9/25 周五 · 办公时间',
    hue: 190,
    desc: '各学系办公时间内办理特别加退选',
  },
]

function EnrolCards({ items }: { items: EnrolCard[] }) {
  return (
    <div className="appendix-enrol-grid">
      {items.map((item) => (
        <div
          className="appendix-enrol-card"
          key={`${item.month}${item.dayNum}${item.when}`}
          style={{ '--hue': item.hue } as CSSProperties}
        >
          <div className="appendix-enrol-card__badge">
            <span className="appendix-enrol-card__day">{item.dayNum}</span>
            <span className="appendix-enrol-card__month">{item.month}</span>
          </div>
          <div className="appendix-enrol-card__body">
            <span className="appendix-enrol-card__when">{item.when}</span>
            <span className="appendix-enrol-card__desc">{item.desc}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function DocIcon() {
  return (
    <svg aria-hidden fill="none" height="20" viewBox="0 0 24 24" width="20">
      <path
        d="M6 2.5h8l4 4V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M14 2.5V7h4" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  )
}

// 「必备程序」推荐:安利独立作者「坏坏大饼干儿」做的选餐小工具,只给网页版直达。
const UEATWHAT_AUTHOR = '坏坏大饼干儿'
const UEATWHAT_URL = 'https://ueatwhat.com/'

function EssentialAppCard() {
  return (
    <div className="rec-card">
      <div className="rec-card__author">
        <span aria-hidden className="rec-card__avatar">
          🍪
        </span>
        <span className="rec-card__by">by</span>
        <span className="rec-card__name">{UEATWHAT_AUTHOR}</span>
      </div>

      <div className="rec-card__body">
        <div className="rec-card__title-row">
          <span className="rec-card__product">可以吃点什么捏</span>
          <span className="rec-card__product-en">ueatwhat</span>
        </div>
        <p className="rec-card__desc">
          专治「今天吃什么」的选择困难——随机推荐、按口味与距离筛选，做得很顺手。作者手艺很
          好，单独开一列推荐给你。
        </p>
      </div>

      <div className="rec-card__actions">
        <a
          className="rec-btn rec-btn--primary"
          href={UEATWHAT_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          <span>进入网页</span>
          <span aria-hidden>→</span>
        </a>
      </div>
    </div>
  )
}

export function AppendixPage({
  siblings,
}: {
  siblings: Array<{ icon: string; url: string; name: string; desc: string }>
}) {
  return (
    <div className="page-center page-center--appendix">
      <section className="card">
        <h2 className="card__title">
          校历 2026-27
          <span className="card__note">CUHK Academic Calendar</span>
        </h2>
        <div className="appendix-cal-grid">
          {CALENDAR_LINKS.map((item) => (
            <a
              className="appendix-cal-card"
              href={item.href}
              key={item.href}
              rel="noopener noreferrer"
              target="_blank"
            >
              <DocIcon />
              <span>{item.label}</span>
            </a>
          ))}
        </div>
        <p className="card__sub">
          <a href={CALENDAR_SOURCE_URL} rel="noopener noreferrer" target="_blank">
            更多校历信息 →
          </a>
        </p>
        <ul className="appendix-dates">
          <li>上学期（全日制本科，MBChB 除外）：2026-09-07（一）– 2026-12-05（六）</li>
          <li>农历年假：2027-02-05 – 2027-02-11</li>
        </ul>
      </section>

      <section className="card">
        <h2 className="card__title">
          本学期选课时间
          <span className="card__note">1st Term 2026-27</span>
        </h2>

        <a
          className="appendix-source-link"
          href={COURSE_REG_SOURCE_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          <DocIcon />
          <span>官方原文 · RES：First Term 2026-27 Course Registration &amp; Add/Drop</span>
          <span aria-hidden className="appendix-source-link__arrow">
            →
          </span>
        </a>

        <p className="appendix-callout">
          <span aria-hidden className="appendix-callout__icon">
            ⚠️
          </span>
          <span>
            <b>无论天气如何</b>，CUSIS 选课与加退选一律照常，<b>不会暂停或延期</b>。请务必以
            CUSIS 个人「Enrolment Dates」显示的登入时间为准。
          </span>
        </p>

        <p className="appendix-subhead">在校生选课 · Current Students</p>
        <p className="appendix-body">全日制本科在校生按年级分三天，每日 10:00–22:00：</p>
        <EnrolCards items={CURRENT_ENROL} />
        <p className="appendix-body">
          登入时间：10:00am 起 = Year 5+ / 以 Advanced Standing 入学的 Year 4+ / 以
          senior-year places 入学的 Year 3+；11:00am 起 = 其他学生。CUSIS「Enrolment
          Dates」自 8 月 4 日起可查个人登入时间。
        </p>

        <p className="appendix-subhead">新生选课 · New Students</p>
        <EnrolCards items={NEW_ENROL} />

        <p className="appendix-subhead">加退选 · Add / Drop</p>
        <EnrolCards items={ADD_DROP} />

        <p className="appendix-subhead">准备与超修 · Preparation &amp; Study Load</p>
        <p className="appendix-body">
          选课准备：在校生 8 月 4 日起查登入时间、8 月 7 日起用 Shopping Cart 预选与
          Validate、8 月 12 日前上载预派课程；新生对应为 8 月 18 日 / 8 月 25 日 / 8 月 28 日。
        </p>
        <p className="appendix-body">
          超修申请（Exceeding Term Course Load，逾期不受理）：在校生 7 月 24 日 – 8 月 3 日
          （对应 8/14 选课）、9 月 2 日 – 9 月 6 日（对应 9/14 加退选）；新生 8 月 18 – 21 日
          （对应 9/1 选课）、9 月 2 日 – 9 月 6 日（对应加退选）。
        </p>
        <p className="appendix-body">
          加退选须持有效且已启用的学习签证/许可。查询：RES 电话 3943 9888、传真 2603 5129、
          ugadmin@cuhk.edu.hk。
        </p>
        <p className="card__sub">
          内容据 CUHK 教务处注册及考试组（RES）官方页面整理（原文见本栏顶部链接），以 CUSIS /
          RES 最新公布为准。
        </p>
      </section>

      <section className="card">
        <h2 className="card__title">
          新生资料
          <span className="card__note">Freshers&apos; Resources</span>
        </h2>
        <p className="appendix-body">常用官方链接，选课、注册、查校历、查手册都在这几个站里。</p>
        <div className="appendix-sib-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {NEWCOMER_LINKS.map((item) => (
            <a className="appendix-sib-card" href={item.url} key={item.url} rel="noopener noreferrer" target="_blank">
              <span
                aria-hidden
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 42,
                  height: 42,
                  borderRadius: 10,
                  background: 'var(--surface)',
                  fontSize: 20,
                  flex: 'none',
                }}
              >
                {item.icon}
              </span>
              <span className="appendix-sib-card__text">
                <span className="appendix-sib-card__name">{item.name}</span>
                <span
                  className="appendix-sib-card__desc"
                  style={{ whiteSpace: 'normal', overflow: 'visible', textOverflow: 'clip', lineHeight: 1.5 }}
                >
                  {item.desc}
                </span>
              </span>
            </a>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">
          必备程序
          <span className="card__note">Must-have Apps</span>
        </h2>
        <p className="appendix-body">
          选课之外，选课季也逃不过「今天吃什么」的世纪难题。这里安利一个独立作者做的小工具，
          做得很好用：
        </p>
        <EssentialAppCard />
      </section>

      <section className="card">
        <h2 className="card__title">友链邀请</h2>
        <p className="card__sub">欢迎逛逛我做的其他站点</p>
        <div className="appendix-sib-grid">
          {siblings.map((sib) => (
            <a className="appendix-sib-card" href={sib.url} key={sib.url} rel="noopener noreferrer" target="_blank">
              <img alt="" src={sib.icon} />
              <span className="appendix-sib-card__text">
                <span className="appendix-sib-card__name">{sib.name}</span>
                <span className="appendix-sib-card__desc">{sib.desc}</span>
              </span>
            </a>
          ))}
        </div>
      </section>
    </div>
  )
}
