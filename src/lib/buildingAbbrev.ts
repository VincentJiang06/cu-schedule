/** 里程碑2「地点缩写」：横向空间不足时，把课程块地点里的楼名换成官方缩写，
 * 房间号/LT 号原样保留——例："Ho Sin-Hang Engg Bldg Rm123" → "SHB Rm123"。
 *
 * 官方缩写表来自 CUHK Graduate School。数据源(scraped course locations)里楼名常写
 * 成缩略形式（Bldg=Building、Engg/Eng=Engineering、Archi=Architecture、
 * Med Sci=Medical Sciences 等——后两个是从实际抓到的地点字符串里核对出来的，不是
 * 官方缩略惯例，但同一楼名在数据里就是这么写的，不认它就永远匹配不上表里那一行），
 * 匹配时把这些缩略词都展开成官方全称的写法再比较，就不用为每种缩写单独收录一条表项。
 *
 * 表里没有的楼名（或匹配失败）走兜底规则：取楼名各词首字母拼成缩写。 */

/** [官方全称, 缩写]。 */
const OFFICIAL_BUILDINGS: [name: string, abbr: string][] = [
  ['Academic Building', 'AB'],
  ['Lee Shau Kee Architecture Building', 'ARC'],
  ['Basic Medical Sciences Building', 'BMS'],
  ['Chen Kou Bun Building', 'CKB'],
  ["Ch'ien Mu Library", 'CML'],
  ['C.W. Chu College', 'CWC'],
  ['Cheng Yu Tung Building', 'CYT'],
  ['Esther Lee Building', 'ELB'],
  ['William M.W. Mong Engineering Building', 'ERB'],
  ['Wong Foo Yuan Building', 'FYB'],
  ["Pi-Ch'iu Building", 'HCA'],
  ['Ho Tim Building', 'HTB'],
  ['Hui Yeung Shing Building', 'HYS'],
  ['Institute of Chinese Studies', 'ICS'],
  ['Fung King Hey Building', 'KHB'],
  ['Leung Kau Kui Building', 'KKB'],
  ['Kwok Sports Building', 'KSB'],
  ['Li Dak Sum Building', 'LDS'],
  ['Y.C. Liang Hall', 'LHC'],
  ['Li Koon Chun Hall', 'LKC'],
  ['Lady Shaw Building', 'LSB'],
  ['Lee Shau Kee Building', 'LSK'],
  ['Mong Man Wai Building', 'MMW'],
  ['Cheng Ming Building New Asia College', 'NAA'],
  ['Humanities Building New Asia College', 'NAH'],
  ['Sir Run Run Shaw Hall', 'RRS'],
  ['Sino Building', 'SB'],
  ['Science Centre', 'SC'],
  ['Science Centre East Block', 'SCE'],
  ['Ho Sin-Hang Engineering Building', 'SHB'],
  ['Swire Hall', 'SWH'],
  ['Tsang Shiu Tim Building United College', 'UCA'],
  ['T.C. Cheng Building United College', 'UCC'],
  ['University Gymnasium', 'UG'],
  ['University Sports Centre', 'USC'],
  ['Wu Ho Man Yuen Building', 'WMY'],
  ['Yasumoto International Academic Park', 'YIA'],
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
}

/** 楼名/学院限定后缀——数据里楼名常常不带这个后缀（比如 "T.C. Cheng Bldg"，没有
 * "United College"），所以官方全称里带这类后缀的条目，额外收录一份去掉后缀的别名。 */
const COLLEGE_SUFFIXES = [' New Asia College', ' United College']

type Tok = { norm: string; raw: string[] }

function normalizeWord(word: string): string {
  const stripped = word.toLowerCase().replace(/[.'’]/g, '')
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
  for (const [name, abbr] of OFFICIAL_BUILDINGS) {
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

/** 表里没匹配到的楼名兜底：从右往左找第一个带数字的词，认定它（以及紧邻它左边、
 * 纯字母且很短的一个标签词，比如 "Rm"）是房间号的起点，房间号左边的词各取首字母
 * 拼成缩写。找不到数字（没有明显的"房间号"边界）就原样返回，不瞎猜。 */
function fallbackAbbreviate(loc: string): string {
  const words = loc.split(/\s+/).filter(Boolean)
  if (words.length < 2) return loc

  let roomStart = -1
  for (let i = words.length - 1; i >= 0; i -= 1) {
    if (/\d/.test(words[i])) {
      roomStart = i
      break
    }
  }
  if (roomStart <= 0) return loc
  if (/^[A-Za-z]{1,3}$/.test(words[roomStart - 1])) roomStart -= 1
  if (roomStart < 1) return loc

  const buildingWords = words.slice(0, roomStart)
  const roomWords = words.slice(roomStart)
  const initials = buildingWords
    .map((word) => word.replace(/[^A-Za-z]/g, '')[0])
    .filter((ch): ch is string => Boolean(ch))
    .map((ch) => ch.toUpperCase())
    .join('')
  if (initials.length < 2) return loc
  return `${initials} ${roomWords.join(' ')}`
}

/** 把地点里的楼名换成官方缩写，房间号/LT 号原样保留；表里没有的楼名走首字母兜底；
 * 已经很短（单个词）的地点原样返回。 */
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

  return fallbackAbbreviate(loc)
}
