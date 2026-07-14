// 从 src/i18n/ui-zh.json(简体源串数组)生成:
//   ui-zht.json = { 简体源: 繁體 }  —— OpenCC s2hk 确定性派生(参考 UniWild i18n 执行方式)
//   ui-en.json  = { 简体源: English } —— DeepSeek 整批译(占位符/HTML 原样)
// 用法:node scripts/i18n-gen.mjs [--lang zht|en|both]
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const I18N = join(ROOT, 'src', 'i18n')
const srcList = JSON.parse(readFileSync(join(I18N, 'ui-zh.json'), 'utf8'))

const args = process.argv.slice(2)
const i = args.indexOf('--lang')
const RUN = (i >= 0 ? args[i + 1] : 'both') === 'both' ? ['zht', 'en'] : [args[i + 1]]

// ---- 繁体:OpenCC s2hk,逐串确定性转换(占位符/ASCII 不动) ----
function genZht() {
  const py = [
    'import sys, json, opencc',
    "cc = opencc.OpenCC('s2hk')",
    'data = json.load(sys.stdin)',
    'json.dump({s: cc.convert(s) for s in data}, sys.stdout, ensure_ascii=False)',
  ].join('\n')
  const out = execFileSync('python3', ['-c', py], { input: JSON.stringify(srcList), maxBuffer: 64 * 1024 * 1024 }).toString()
  const dict = JSON.parse(out)
  writeFileSync(join(I18N, 'ui-zht.json'), JSON.stringify(dict, null, 2) + '\n')
  console.log(`ui-zht.json: ${Object.keys(dict).length} 条 (OpenCC s2hk)`)
}

// ---- 英文:DeepSeek 整批译。用【数字索引】做 key(避免模型复述中文 key 不一致),映射回源串。 ----
const SYS = `You are a senior web-app localisation editor. Input is a JSON object mapping numeric-string ids to Simplified-Chinese UI strings from a CUHK course-planning web app (CU Schedule). Return a JSON object with the SAME ids as keys, each mapped to a concise, idiomatic British-English UI translation of that string. Rules:
- Keep every id key unchanged; return exactly the same id set; translate the values only.
- Keep {n}/{name}/{lang}-style placeholders verbatim and sensibly placed.
- Keep HTML tags (<b>, <a href> …) intact, translate only inner text.
- Product micro-copy: natural, terse, native web-UI tone. Official terms use official English (CUHK, JUPAS, HKDSE, CUSIS, GE, add/drop).
- Keep course codes, URLs, numbers, and brand names as-is.
Output the complete JSON object only. No commentary, no code fence.`

async function genEn() {
  const env = readFileSync(join(ROOT, '..', 'platform', '.env'), 'utf8')
  const key = process.env.DEEPSEEK_API_KEY || env.match(/^DEEPSEEK_API_KEY=(.+)$/m)[1].trim()
  // 增量:保留仍在源里的既有译文,只译新增的串;顺带剪掉已从源里删除的旧 key。
  let existing = {}
  try {
    existing = JSON.parse(readFileSync(join(I18N, 'ui-en.json'), 'utf8'))
  } catch {
    existing = {}
  }
  const dict = {}
  for (const s of srcList) if (typeof existing[s] === 'string') dict[s] = existing[s]
  const todo = srcList.filter((s) => typeof existing[s] !== 'string')
  console.log(`en: 源 ${srcList.length} 条,已有 ${srcList.length - todo.length},待译 ${todo.length}`)
  const BATCH = 100
  for (let b = 0; b < todo.length; b += BATCH) {
    const chunk = todo.slice(b, b + BATCH)
    const payload = Object.fromEntries(chunk.map((s, k) => [String(k), s]))
    process.stdout.write(`en 批 ${b / BATCH + 1} (${chunk.length}) …`)
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(1800000),
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        thinking: { type: 'enabled' },
        reasoning_effort: 'high',
        max_tokens: 65536,
        messages: [{ role: 'system', content: SYS }, { role: 'user', content: JSON.stringify(payload) }],
      }),
    })
    const j = await res.json()
    if (j.error) throw new Error(j.error.message)
    const text = j.choices[0].message.content.trim().replace(/^```json?\s*|\s*```$/g, '')
    const part = JSON.parse(text)
    chunk.forEach((s, k) => {
      const v = part[String(k)]
      if (typeof v !== 'string') throw new Error(`en 缺 id ${k}: ${s}`)
      dict[s] = v
    })
    console.log(' ✓')
  }
  writeFileSync(join(I18N, 'ui-en.json'), JSON.stringify(dict, null, 2) + '\n')
  console.log(`ui-en.json: ${Object.keys(dict).length} 条 (DeepSeek)`)
}

if (RUN.includes('zht')) genZht()
if (RUN.includes('en')) await genEn()
