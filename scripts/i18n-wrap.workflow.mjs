export const meta = {
  name: 'i18n-wrap-cus',
  description: 'Wrap every user-facing Chinese UI string in t() across cus source files (parallel, Sonnet)',
  phases: [{ title: 'Wrap', detail: 'one Sonnet agent per file wraps its UI strings in t()' }],
}

// 每个文件一个 agent。import 路径按目录给定;lib/ 与 components/ 都是 '../i18n/index.ts',App.tsx 是 './i18n/index.ts'(且已 import t)。
const FILES = [
  { path: 'src/App.tsx', imp: "import { t } from './i18n/index.ts'", note: 'App.tsx 已 import t,勿重复添加。文件很大——务必系统性逐段扫。跳过 header 里已 t() 过的语言/主题按钮。' },
  { path: 'src/components/AppendixPage.tsx', imp: "import { t } from '../i18n/index.ts'", note: '大量中文在 CALENDAR_LINKS/NEWCOMER_LINKS/EnrolCard 等模块级常量的 label/name/desc/desc 字段——在【渲染处】包裹(如 {item.name} → {t(item.name)}),常量定义不动;把这些常量里的中文源串都列进 wrapped。' },
  { path: 'src/components/CommittedList.tsx', imp: "import { t } from '../i18n/index.ts'", note: '' },
  { path: 'src/components/ProgramTable.tsx', imp: "import { t } from '../i18n/index.ts'", note: '「分流」「任选…」「全部标记为已完成」等;GLOSS 是中英对照映射(值是英文专名),不要翻。' },
  { path: 'src/components/SearchResults.tsx', imp: "import { t } from '../i18n/index.ts'", note: '' },
  { path: 'src/components/TimetableCompare.tsx', imp: "import { t } from '../i18n/index.ts'", note: '' },
  { path: 'src/components/ShareView.tsx', imp: "import { t } from '../i18n/index.ts'", note: '' },
  { path: 'src/components/CourseModal.tsx', imp: "import { t } from '../i18n/index.ts'", note: '' },
  { path: 'src/components/ProgramProgress.tsx', imp: "import { t } from '../i18n/index.ts'", note: '含数字插值的文案用 t 的第二参数传占位符,如把「已修 3 门」写成 t 源串带 {n} 占位。' },
  { path: 'src/components/ProgramPicker.tsx', imp: "import { t } from '../i18n/index.ts'", note: '' },
  { path: 'src/components/Timetable.tsx', imp: "import { t } from '../i18n/index.ts'", note: '星期/DAY OFF 等短词。' },
  { path: 'src/components/CodeInput.tsx', imp: "import { t } from '../i18n/index.ts'", note: '' },
  { path: 'src/components/SubjectPicker.tsx', imp: "import { t } from '../i18n/index.ts'", note: '' },
  { path: 'src/lib/configMd.ts', imp: "import { t } from '../i18n/index.ts'", note: '这是 .md 配置导出/导入。导出时【写出】的中文小标题(如「已修过的课」「当前必修」)要可翻;但【解析导入】时用于匹配 section 名的中文字面量属于协议 key,绝不能改/包裹——只包裹写出侧、保留读取侧。拿不准的一律 skip 并说明。' },
  { path: 'src/lib/ics.ts', imp: "import { t } from '../i18n/index.ts'", note: '日历事件标题/描述里的中文角标。' },
  { path: 'src/lib/exportPlan.ts', imp: "import { t } from '../i18n/index.ts'", note: '导出文件名/角标里的中文。文件名若含中文需保证仍是合法文件名。' },
  { path: 'src/lib/exportHtml.ts', imp: "import { t } from '../i18n/index.ts'", note: '生成的 HTML 里的中文标签/角标。保留 HTML 结构,只包裹文字。' },
  { path: 'src/lib/exportImage.ts', imp: "import { t } from '../i18n/index.ts'", note: 'canvas 绘制的中文文字标签。' },
  { path: 'src/lib/exportWallpaper.ts', imp: "import { t } from '../i18n/index.ts'", note: 'canvas 壁纸上的中文文字标签。' },
]

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file: { type: 'string' },
    wrapped: {
      type: 'array',
      items: { type: 'string' },
      description: '本文件里现在已可翻译的每一条不同的【简体中文源串】(含通过 t(变量) 途径的常量值)。带占位符的用 {n} 形式写出。',
    },
    skipped: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' }, reason: { type: 'string' } },
        required: ['text', 'reason'],
      },
      description: '未包裹的用户可见中文串 + 原因(如属协议 key、JSX 交织难拆、拿不准)。',
    },
    summary: { type: 'string' },
  },
  required: ['file', 'wrapped', 'skipped', 'summary'],
}

function prompt(f) {
  return `你在改一个 React + TS 单页应用(CU Schedule 选课助手)的 i18n。目标:把文件 \`${f.path}\` 里**所有面向用户的简体中文 UI 文本**改成可翻译——用 \`t('原中文')\` 包起来。已建好的机制:模块函数 \`t(src, vars?)\`(简体源即 key,按当前语言返回译文,查不到回落原文)。

规则(务必逐条遵守):
1) **import**:确保文件顶部有 \`${f.imp}\`(缺则加;已有勿重复;注意本项目 import 带 .ts 后缀)。
2) **包裹什么**(仅【用户在界面/导出物上看得到】的中文):
   - JSX 文本:「<span>已完成课程</span>」改成「<span>{t('已完成课程')}</span>」
   - 字符串属性(用户可见):placeholder / title / aria-label / alt / label / option 文本等,改成 placeholder={t('课号或课名…')}
   - 含插值的模板串:把用反引号写的「已录入 \${n} 门」改成 t('已录入 {n} 门', { n })(即 \${x} 改成 {x} 占位符)
   - 渲染【模块级常量】里的中文(label/name/desc 等):在**渲染处**包裹(把 {item.desc} 改成 {t(item.desc)}),常量定义**不动**;并把这些常量里的中文源串都收进 wrapped。
3) **不要动**:
   - 任何 \`//\` 或 \`/* */\` **注释**里的中文——一律保留原样。
   - 非用户可见的中文(逻辑标识、协议 key、数据码)。
   - 已经被 t() 包过的串。
   - 中英对照映射表里的**英文专名值**、course code、URL、品牌名。
4) **保持文件可编译**:JSX/TS 语法正确、引号大括号平衡、不改任何逻辑与行为,只做包裹。HTML 标签(<b> 等)留在串内、只是让整串可翻译。
5) 实在难以干净包裹的(JSX 深度交织、拿不准是否协议 key)——**别硬改**,留原样并写进 skipped。
${f.note ? '本文件要点:' + f.note : ''}

做完后:用 Edit/Write 把改动落到 \`${f.path}\`,然后返回结构化结果:wrapped(所有现在可翻译的简体源串,逐条、去重)、skipped(未包裹的可见中文+原因)、summary(一句话)。只返回结构化对象。`
}

phase('Wrap')
const results = await parallel(
  FILES.map((f) => () =>
    agent(prompt(f), { label: `wrap:${f.path.split('/').pop()}`, schema: SCHEMA, model: 'sonnet', effort: 'high' }),
  ),
)

const ok = results.filter(Boolean)
const allWrapped = [...new Set(ok.flatMap((r) => r.wrapped || []))].sort()
const allSkipped = ok.flatMap((r) => (r.skipped || []).map((s) => ({ file: r.file, ...s })))
log(`wrapped ${allWrapped.length} distinct strings across ${ok.length}/${FILES.length} files; ${allSkipped.length} skipped`)
return { wrappedCount: allWrapped.length, wrapped: allWrapped, skipped: allSkipped, perFile: ok.map((r) => ({ file: r.file, n: (r.wrapped || []).length, summary: r.summary })) }
