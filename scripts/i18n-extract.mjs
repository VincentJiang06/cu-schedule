// 从 src 里所有 t('…') / t("…") 字面量实参提取【含中文的简体源串】→ src/i18n/ui-zh.json(排序去重)。
// t(变量) 这类动态源串不在此(由 wrap workflow 的 wrapped 报告补入,见 i18n-merge 步骤)。
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

const list = [...set].sort()
writeFileSync(join(SRC, 'i18n', 'ui-zh.json'), JSON.stringify(list, null, 2) + '\n')
console.log(`ui-zh.json: ${list.length} 条简体源串(从代码 t() 字面量提取)`)
