// 从 src 里所有 t('…') / t("…") 字面量实参提取【含中文的简体源串】→ src/i18n/ui-zh.json(排序去重)。
//
// 经由变量到达 t() 的源串(t(zh),如 ProgramTable 的 GLOSS / programs.ts 的 SECTION_GLOSS 那两张
// 「英文分区名 → 中文标签」表,以及解析器写进数据里的固定中文标题)扫不出来。它们曾因此整批缺席
// 词典——繁/英界面下大课表与学分进度的分区名一直回落简体。手册在 src/i18n/dynamic-zh.json,
// 本脚本合并它,所以新增一个动态源串只需往那个文件里加一行。
// 用法:node scripts/i18n-extract.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src')

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

// t( 前不接 word 字符/点(排除 format(、obj.t( 之类);抓单/双引号字面量,处理转义。
const RE = /(?<![\w.])t\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g
const set = new Set()
for (const f of walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('i18n/index.ts'))) {
  const code = readFileSync(f, 'utf8')
  let m
  while ((m = RE.exec(code))) {
    const raw = m[2]
    if (!/[一-鿿]/.test(raw)) continue // 只要含中文的
    set.add(raw.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n'))
  }
}

const literals = set.size
for (const s of JSON.parse(readFileSync(join(SRC, 'i18n', 'dynamic-zh.json'), 'utf8'))) set.add(s)

const list = [...set].sort()
writeFileSync(join(SRC, 'i18n', 'ui-zh.json'), JSON.stringify(list, null, 2) + '\n')
console.log(`ui-zh.json: ${list.length} 条简体源串(t() 字面量 ${literals} + dynamic-zh.json ${list.length - literals})`)
