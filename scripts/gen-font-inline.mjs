// 把自托管的 Red Hat Mono 可变字体(latin 子集)编码成 data URI TS 模块——导出 HTML
// 要做到离线自包含且字体绝不兜底,唯一办法是把字体本体内嵌进导出的文件里。
// 用法:node scripts/gen-font-inline.mjs(换字体文件后重跑;产物提交进仓库)。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const woff2 = readFileSync(join(root, 'src/fonts/red-hat-mono-latin.woff2'))
const out = `// 由 scripts/gen-font-inline.mjs 生成,勿手改——Red Hat Mono 可变字体(300–700,
// latin 子集)的 data URI,供导出 HTML 内嵌(离线自包含、字体绝不兜底)与测试 harness
// 注入 FontFace 用。源文件:src/fonts/red-hat-mono-latin.woff2。
export const RED_HAT_MONO_WOFF2_DATA_URI =
  'data:font/woff2;base64,${woff2.toString('base64')}'
`
writeFileSync(join(root, 'src/fonts/redHatMonoInline.ts'), out)
console.log('written src/fonts/redHatMonoInline.ts,', woff2.length, 'bytes woff2')
