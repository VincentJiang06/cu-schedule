/**
 * 附录页：与选课本身无关、但选课季常用得上的三块参考信息——校历下载、本学期选课
 * 时间表（从 RES 邮件提炼）、以及作者其它站点的邀请卡片（复用页脚 SIBLINGS 数据源，
 * 这里做成更大、带简介的展示卡）。纯静态内容，无状态。
 */

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

const ENROL_TIMELINE = [
  {
    date: '8月14日（五）10:00–22:00',
    desc: 'Year 4+ / 最后一年学生、以 Advanced Standing 入学的 Year 3+、以 senior-year places 入学的 Year 2+',
  },
  {
    date: '8月18日（二）10:00–22:00',
    desc: 'Year 3、以 Advanced Standing 入学的 Year 2',
  },
  {
    date: '8月19日（三）10:00–22:00',
    desc: 'Year 2',
  },
]

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
        <p className="appendix-body">
          适用对象：Year 2 及以上全日制本科生（不含应届毕业生及副学士生）。以下选课日程均为
          10:00–22:00：
        </p>
        <ol className="appendix-timeline">
          {ENROL_TIMELINE.map((item) => (
            <li key={item.date}>
              <span className="appendix-timeline__date">{item.date}</span>
              <span className="appendix-timeline__desc">{item.desc}</span>
            </li>
          ))}
        </ol>
        <p className="appendix-body">
          登入时间：10:00am 起 = Year 5+ / 以 Advanced Standing 入学的 Year 4+ / 以
          senior-year places 入学的 Year 3+；11:00am 起 = 其他学生。CUSIS「Enrolment
          Dates」自 8 月 4 日起可查个人登入时间。
        </p>
        <p className="appendix-body">
          超修申请（Exceeding Term Course Load）：7 月 24 日 – 8 月 3 日（对应 8 月 14 日起
          选课期）、9 月 2 日 – 9 月 6 日（对应 9 月 14 日起加退选期）；逾期不受理。
        </p>
        <p className="appendix-body">
          加退选自 9 月 14 日起；需持有效已启用学习签证/许可。查询 RES 电话 3943 9888、
          ugadmin@cuhk.edu.hk。
        </p>
        <p className="card__sub">
          来源：CUHK 教务处注册及考试组（RES）2026-07-10 邮件通知，以 CUSIS / RES
          官方公布为准。
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
