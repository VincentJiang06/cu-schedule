/** 地点缩写:把课程块地点里的楼名换成 CUHK 官方缩写,房间号/LT 号原样保留——
 * 例:"Ho Sin-Hang Engg Bldg Rm123" → "SHB Rm123"。
 *
 * 缩写表**只收官方条目,不自造**(用户拍板 2026-07-15):
 *  - 主来源:Registration and Examinations Section「Buildings/Halls」
 *    https://www.res.cuhk.edu.hk/teaching-timetable-classroom-booking/teaching-timetable/buildings-halls/
 *  - 补充:Graduate School「Building Abbreviations」(AB/BATC/HKSP/KSB SQ/USC 等
 *    RES 表未列的条目)
 *    https://www.gs.cuhk.edu.hk/academics/teaching-timetable/building-abbreviation
 * 两表都没有的场馆(如 Fok Ying Tung RS Sci Bldg、Graduate Law Centre)**保持原样
 * 返回,不做首字母拼凑**。
 *
 * 数据源(scraped course locations)里楼名常写成缩略形式(Bldg=Building、
 * Engg/Eng=Engineering 等),匹配时把这些缩略词展开成官方全称用词再比较;展开覆盖
 * 不了的数据侧变体(截断/逗号/连字符/词序不同)在 DATA_ALIASES 里逐条收录**数据里
 * 的原样拼写**——2026-27 全年数据 419 个地点已逐一核对(见 WORKLOG 2026-07-15)。 */

/** [官方全称, 官方缩写]。名称里的逗号已去掉(归一化本来就会剥掉,写表时省去)。 */
const OFFICIAL_BUILDINGS: [name: string, abbr: string][] = [
  // ── RES Buildings/Halls(主来源)──
  ['Academic Building No.1', 'AB1'],
  ['Art Museum East Wing', 'AMEW'],
  ['Lee Shau Kee Architecture Building', 'ARC'],
  ['Basic Medical Sciences Building', 'BMS'],
  ['Chung Chi College Chapel', 'CCCC'],
  ['Chung Chi College Theology Building', 'CCT'],
  ["C.K. Tse Room", 'CK TSE'],
  ['Chen Kou Bun Building', 'CKB'],
  ["Ch'ien Mu Library", 'CML'],
  ['C.W. Chu College', 'CWC'],
  ['Cheng Yu Tung Building', 'CYT'],
  ['Esther Lee Building', 'ELB'],
  ['William M.W. Mong Engineering Building', 'ERB'],
  ['Wong Foo Yuan Building', 'FYB'],
  ['Pi Chiu Building', 'HCA'],
  ['Sir Philip Haddon-Cave Sports Field', 'HCF'],
  ['Ho Tim Building', 'HTB'],
  ['Haddon-Cave Tennis Court', 'HTC'],
  ['Hui Yeung Shing Building', 'HYS'],
  ['Lo Kwee-Seong Integrated Biomedical Sciences Building', 'IBSB'],
  ['Institute of Chinese Studies', 'ICS'],
  ['Fung King Hey Building', 'KHB'],
  ['Leung Kau Kui Building', 'KKB'],
  ['Kwok Sports Building', 'KSB'],
  ['Li Dak Sum Building', 'LDS'],
  ['Y.C. Liang Hall', 'LHC'],
  ['Lee Hysan Concert Hall', 'LHCH'],
  ['Li Koon Chun Hall', 'LKC'],
  ['Lingnan Stadium Chung Chi College', 'LN'],
  ['Lai Chan Pui Ngong Lecture Theatre', 'LPN LT'],
  ['Lady Shaw Building', 'LSB'],
  ['Lee Shau Kee Building', 'LSK'],
  ['Li Wai Chun Building', 'LWC'],
  ['Morningside College Seminar Room', 'MCO'],
  ['Mong Man Wai Building', 'MMW'],
  ['Cheng Ming Building New Asia College', 'NAA'],
  ['New Asia College Gymnasium', 'NAG'],
  ['Humanities Building New Asia College', 'NAH'],
  ['New Asia College Table Tennis Room', 'NATT'],
  ['Multi-purpose Hall Jockey Club Postgraduate Hall 3', 'PGH3 MPH'],
  ['Multi-purpose Hall Pommerenke Student Centre', 'PSC MPH'],
  ['Prince of Wales Hospital', 'PWH'],
  ['Sir Run Run Shaw Hall', 'RRS'],
  ['Sino Building', 'SB'],
  ['Science Centre', 'SC'],
  ['Science Centre East Block', 'SCE'],
  ['Multi-purpose Sports Hall Shaw College', 'SCSH'],
  ['Table Tennis Room Shaw College', 'SCTT'],
  ['Ho Sin-Hang Engineering Building', 'SHB'],
  ['Swimming Pool', 'SP'],
  ['Lecture Theatre Shaw College', 'SWC LT'],
  ['Swire Hall Fung King Hey Building', 'SWH'],
  ['Tennis Court', 'TC'],
  ['T.Y. Wong Hall Ho Sin-Hang Engineering Building', 'TYW LT'],
  ['Table Tennis Room United College', 'UC TT'],
  ['Tsang Shiu Tim Building United College', 'UCA'],
  ['T.C. Cheng Building United College', 'UCC'],
  ['The Thomas H.C. Cheung Gymnasium of United College', 'UCG'],
  ['University Gymnasium', 'UG'],
  ['University Sports Centre Table Tennis Room', 'USC TT'],
  ['Wen Lan Tang Shaw College', 'WLS'],
  ['Wu Ho Man Yuen Building', 'WMY'],
  ['Lee W.S. College South Block', 'WS1'],
  ['Wu Yee Sun College Theatre', 'WYST'],
  ['President Chi-tung Yung Memorial Building', 'YCT'],
  ['Yasumoto International Academic Park', 'YIA'],
  // ── Graduate School 补充(RES 表未列)──
  ['Academic Building', 'AB'],
  ['MBA Town Centre', 'BATC'],
  ['Hong Kong Science And Technology Parks Corporation', 'HKSP'],
  ['Squash Court Kwok Sports Building', 'KSB SQ'],
  ['University Sports Centre', 'USC'],
]

/** 数据侧变体 → 官方缩写:词展开覆盖不了的截断/逗号/连字符/词序差异,按数据里的
 * **原样拼写**逐条收录(两边走同一套 tokenize 归一化,所以逗号/点号差异无所谓,
 * 但词序和截断必须原样)。 */
const DATA_ALIASES: [name: string, abbr: string][] = [
  ['Academic Building I', 'AB1'],
  ['ARC Bldg', 'ARC'],
  ['CC College Theology Bldg', 'CCT'],
  ['Chung Chi College Lib CK TSE', 'CK TSE'],
  ['Covered Playgrd, U Sport Centr', 'USC'],
  ['Fung King Hey Bldg Swire Hall', 'SWH'],
  ['Kwok Sports Bldg Squash Court', 'KSB SQ'],
  ['LKS Intg Biomed Sci Bldg', 'IBSB'],
  ['Lai Chan Pui Ngong LT', 'LPN LT'],
  ['Lee W.S Col', 'WS1'],
  ['Li Wai Chun', 'LWC'],
  ['Lingnan Stadium, CC College', 'LN'],
  ['Morningside College', 'MCO'],
  ['Multi-purpose Halls,JCPG', 'PGH3 MPH'],
  ['Multi-purpose Sports Hall, SC', 'SCSH'],
  ["Pi-Ch'iu Building", 'HCA'],
  ['Pres Chi-tung Yung MBldg', 'YCT'],
  ['President Chi-tung Yung MBldg', 'YCT'],
  ['Shaw College LT', 'SWC LT'],
  ['Sir Philip Haddon-Cave Sport F', 'HCF'],
  ['T.Y.Wong Hall LT', 'TYW LT'],
  ['T.Y.Wong Hall', 'TYW LT'],
  ['Table Tennis Rm, U Sport Centr', 'USC TT'],
  ['Table Tennis Room, UC', 'UC TT'],
  ['The Thomas H.C. Cheung Gym, UC', 'UCG'],
  ['Town Centre', 'BATC'],
  ['Tsang Shiu Tim Bldg', 'UCA'],
]

/** 数据源里常见的楼名缩略词 → 展开成官方全称用词，比较时双方都走这一份归一化。
 * 键必须是归一化后（小写、去标点）的整词，避免误伤别的词（比如 "eng" 只在独立成词
 * 时才展开，不会拿掉 "engineering" 里的 "eng" 子串）。 */
const WORD_EXPAND: Record<string, string> = {
  bldg: 'building',
  engg: 'engineering',
  eng: 'engineering',
  ctr: 'centre',
  center: 'centre',
  archi: 'architecture',
  med: 'medical',
  sci: 'sciences',
  intl: 'international',
  acad: 'academic',
  chin: 'chinese',
}

/** 楼名/书院限定后缀——数据里楼名常常不带这个后缀（比如 "T.C. Cheng Bldg"，没有
 * "United College"），所以官方全称里带这类后缀的条目，额外收录一份去掉后缀的别名。 */
const COLLEGE_SUFFIXES = [' New Asia College', ' United College', ' Shaw College', ' Chung Chi College']

type Tok = { norm: string; raw: string[] }

function normalizeWord(word: string): string {
  const stripped = word.toLowerCase().replace(/[.,'’]/g, '')
  return WORD_EXPAND[stripped] ?? stripped
}

/** 按空格分词、逐词归一化，并把相邻的单字母缩写粘成一个词——数据里 "William M W Mong"
 * 与官方全称 "William M.W. Mong" 拼写间距不同（前者两个独立字母，后者一个不带空格的
 * "M.W."），去标点后仍是两个词 vs 一个词，不粘起来就永远对不上。粘完以后 raw 记录
 * 这个归一化词吃掉了原文里的哪几个词，用来在匹配后把"剩余部分"从原文（而不是归一化
 * 后的文本）里原样切出来，房间号的大小写/写法才不会被我们的归一化步骤污染。 */
function tokenize(text: string): Tok[] {
  const rawWords = text.trim().split(/\s+/).filter(Boolean)
  const out: Tok[] = []
  for (const raw of rawWords) {
    const norm = normalizeWord(raw)
    const prev = out[out.length - 1]
    if (prev && prev.norm.length === 1 && norm.length === 1 && /^[a-z]$/.test(prev.norm) && /^[a-z]$/.test(norm)) {
      prev.norm += norm
      prev.raw.push(raw)
    } else {
      out.push({ norm, raw: [raw] })
    }
  }
  return out
}

type Alias = { tokens: Tok[]; abbr: string }

function buildAliases(): Alias[] {
  const aliases: Alias[] = []
  for (const [name, abbr] of [...OFFICIAL_BUILDINGS, ...DATA_ALIASES]) {
    aliases.push({ tokens: tokenize(name), abbr })
    for (const suffix of COLLEGE_SUFFIXES) {
      if (name.endsWith(suffix)) aliases.push({ tokens: tokenize(name.slice(0, -suffix.length)), abbr })
    }
  }
  // 长别名（词数多、更具体）优先匹配，比如 "Science Centre East Block" 必须先于
  // "Science Centre" 试，否则后者的短前缀会抢先命中、把 East Block 误吞进"房间号"里。
  return aliases.sort((a, b) => b.tokens.length - a.tokens.length)
}

const SORTED_ALIASES = buildAliases()

/** 把地点里的楼名换成官方缩写，房间号/LT 号原样保留。表里没有的楼名**原样返回**——
 * 官方两表都没收录的场馆不做任何自造缩写(用户拍板 2026-07-15,撤掉了旧的首字母
 * 拼凑兜底)；已经很短（单个词）的地点同样原样返回。 */
export function abbreviateLocation(raw: string): string {
  const loc = (raw ?? '').trim()
  if (!loc) return raw
  const locTokens = tokenize(loc)
  if (locTokens.length < 2) return loc

  for (const alias of SORTED_ALIASES) {
    if (alias.tokens.length > locTokens.length) continue
    if (alias.tokens.every((tok, i) => locTokens[i].norm === tok.norm)) {
      let remainder = locTokens.slice(alias.tokens.length).flatMap((tok) => tok.raw)
      // 匹配到的楼名后面偶尔还跟着一个冗余的 "Bldg"/"Building"（楼名本身以 Library/
      // Hall 收尾，但数据源仍多写了一个 Bldg）——顺手吞掉，缩写后不留半个空词。
      if (remainder.length && normalizeWord(remainder[0]) === 'building') remainder = remainder.slice(1)
      return remainder.length ? `${alias.abbr} ${remainder.join(' ')}` : alias.abbr
    }
  }

  return loc
}
