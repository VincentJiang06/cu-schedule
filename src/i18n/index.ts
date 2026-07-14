/**
 * 轻量 UI i18n(gettext 式):简体源文本即 key。t('简体…') 按当前语言返回繁体/英文,查不到回落原文。
 *
 * 口径(参考 UniWild i18n 执行方式):
 *  - 简体是唯一权威源(就是代码里 t() 的实参);繁体 = OpenCC s2hk 确定性派生、英文 = DeepSeek 译,
 *    两个词典由 scripts/i18n-gen.mjs 从提取出的源串生成,随包静态载入(无运行时 API,守「计算在端」)。
 *  - 语言切换 = 改模块级 currentLang(在 App 渲染顶层同步)+ 顶层 state 触发全树重渲染;项目无 memo,
 *    子组件随父重渲染即读到新语言。切 lang 不产生第二真源:词典缺失一律回落简体源。
 *  - 课程/专业名等 CUHK 数据本身英文/双语,不进本词典、不翻。
 */
import zhtDict from './ui-zht.json'
import enDict from './ui-en.json'

export type Lang = 'zh' | 'zht' | 'en'

export const LANGS: Lang[] = ['zh', 'zht', 'en']
export const LANG_LABEL: Record<Lang, string> = { zh: '简', zht: '繁', en: 'EN' }

const DICTS: Record<Exclude<Lang, 'zh'>, Record<string, string>> = {
  zht: zhtDict as Record<string, string>,
  en: enDict as Record<string, string>,
}

let currentLang: Lang = 'zh'

/** 设当前语言(App 在渲染顶层同步调用,使本轮 t() 立即用新语言)。 */
export function setLang(lang: Lang): void {
  currentLang = lang
}

export function getLang(): Lang {
  return currentLang
}

export function nextLang(lang: Lang): Lang {
  return LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]
}

/**
 * 翻译一段 UI 文本。zh 直接返回源;其余查词典(缺失回落源)。`vars` 做 {key} 插值,
 * 例:t('已录入 {n} 门', { n: 3 }) → 「已录入 3 门」/「Entered 3 courses」。
 */
export function t(src: string, vars?: Record<string, string | number>): string {
  let out = currentLang === 'zh' ? src : DICTS[currentLang][src] ?? src
  if (vars) {
    for (const key of Object.keys(vars)) {
      out = out.replaceAll(`{${key}}`, String(vars[key]))
    }
  }
  return out
}
