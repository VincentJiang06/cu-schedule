# Interfaces — CU Schedule

> 从代码推导(2026-08-10),由 `verify_contracts.mjs` 逐行对着代码校验:每个 `Symbol` 必须在
> `Source` 指的那一行真实定义,代码里导出而这里没有的符号会 FAIL。**改了公开面就要改这张表**,
> 否则机器门不过。签名是给人读的,门不校验签名——校验签名真伪的是 fresh-reader 复核。
>
> 跑法(从技能目录调用,路径要与 node 解析的一致):
> `node ~/.claude/skills/reorganize-logic/scripts/verify_contracts.mjs ~/cu-schedule`

## Public interface

### `src/lib/types.ts` — wire 与运行时两层课程模型

| Symbol | Signature | Source |
|---|---|---|
| `RawMeeting` | `type RawMeeting = { d: number; s: number; e: number; l: string }` | `src/lib/types.ts:20` |
| `RawSection` | `type RawSection = { id, co, gp, cp, m: RawMeeting[], in: string[], st }` | `src/lib/types.ts:21` |
| `RawCourse` | `type RawCourse = { c, sj, t, u, cr, gr, rq, x: RawSection[], req?: Requirement }` | `src/lib/types.ts:30` |
| `TermBundle` | `type TermBundle = { term: string; termCode: string; courses: RawCourse[] }` | `src/lib/types.ts:43` |
| `YearIndex` | `type YearIndex = { year: string; terms: Array<{ name; slug; courseCount }> }` | `src/lib/types.ts:44` |
| `DataManifest` | `type DataManifest = { years: string[]; generatedAt: string }` | `src/lib/types.ts:51` |
| `Meeting` | `type Meeting = { dayIndex: number; start: number; end: number; location: string }` | `src/lib/types.ts:55` |
| `Section` | `type Section = { id, cohort, group, component, meetings, instructors, status, isTba }` | `src/lib/types.ts:57` |
| `ReqNode` | `type ReqNode = code \| soft \| and \| or \| unknown` | `src/lib/types.ts:74` |
| `Requirement` | `type Requirement = { raw, prerequisite, corequisite, exclusions, prereqText, coreqText }` | `src/lib/types.ts:81` |
| `EMPTY_REQUIREMENT` | `const EMPTY_REQUIREMENT: Requirement` | `src/lib/types.ts:95` |
| `RequirementStatus` | `type RequirementStatus = 'none' \| 'met' \| 'missing' \| 'unverifiable'` | `src/lib/types.ts:104` |
| `Course` | `type Course = { code, key, subject, number, suffix, level, title, units, career, department, requirement, sections, components, searchText }` | `src/lib/types.ts:108` |

### `src/lib/courseKey.ts` — 课程身份(8 字符 key 即「同一门课」)

| Symbol | Signature | Source |
|---|---|---|
| `ParsedCode` | `type ParsedCode = { full, key, subject, number, suffix, level }` | `src/lib/courseKey.ts:18` |
| `courseKey` | `courseKey(code: string): string` | `src/lib/courseKey.ts:40` |
| `parseCode` | `parseCode(code: string): ParsedCode` | `src/lib/courseKey.ts:44` |
| `codesMatch` | `codesMatch(a: string, b: string): boolean` | `src/lib/courseKey.ts:54` |
| `isCourseCode` | `isCourseCode(code: string): boolean` | `src/lib/courseKey.ts:59` |
| `keySet` | `keySet(codes: Iterable<string>): Set<string>` | `src/lib/courseKey.ts:64` |

### `src/lib/data.ts` — 取包与版本化缓存(唯一 fetch 通道)

| Symbol | Signature | Source |
|---|---|---|
| `dataVersion` | `dataVersion(): Promise<string>` | `src/lib/data.ts:42` |
| `SubjectInfo` | `type SubjectInfo = { code: string; title: string }` | `src/lib/data.ts:95` |
| `loadSubjects` | `loadSubjects(year: string): Promise<SubjectInfo[]>` | `src/lib/data.ts:97` |
| `TermRef` | `type TermRef = { year, slug, name, courseCount }` | `src/lib/data.ts:103` |
| `loadTermList` | `loadTermList(): Promise<TermRef[]>` | `src/lib/data.ts:123` |
| `loadTerm` | `loadTerm(term: TermRef): Promise<Course[]>` | `src/lib/data.ts:138` |
| `Offering` | `type Offering = { course: Course; termSlug: string; termName: string; termOrder: number }` | `src/lib/data.ts:145` |
| `loadYearOfferings` | `loadYearOfferings(year: string): Promise<Offering[]>` | `src/lib/data.ts:160` |

### `src/lib/requirements.ts` — 先修/并修/互斥的解析与三值求值

| Symbol | Signature | Source |
|---|---|---|
| `Tri` | `type Tri = 'yes' \| 'no' \| 'maybe'` | `src/lib/requirements.ts:40` |
| `parseRequirement` | `parseRequirement(raw: string, knownCodes?: Set<string> \| null): Requirement` | `src/lib/requirements.ts:341` |
| `evaluate` | `evaluate(node: Node, taken: Set<string>): Tri` | `src/lib/requirements.ts:417` |
| `RequirementCheck` | `type RequirementCheck = { ruledOut, prereqStatus, coreqStatus, prereqText, coreqText }` | `src/lib/requirements.ts:439` |
| `evaluateRequirement` | `evaluateRequirement(requirement, taken, committed?): RequirementCheck` | `src/lib/requirements.ts:461` |
| `checkRequirement` | `checkRequirement(raw, taken, options?): RequirementCheck` | `src/lib/requirements.ts:483` |
| `collectCodes` | `collectCodes(node: Node \| null): string[]` | `src/lib/requirements.ts:496` |

### `src/lib/schedule.ts` — 排课回溯与钉选过滤

| Symbol | Signature | Source |
|---|---|---|
| `Prefs` | `type Prefs = { earliestStart, latestEnd, avoidLunch, dayOff }` | `src/lib/schedule.ts:3` |
| `NO_PREFS` | `const NO_PREFS: Prefs` | `src/lib/schedule.ts:10` |
| `Combo` | `type Combo = Section[]` | `src/lib/schedule.ts:16` |
| `Plan` | `type Plan = { id: string; entries: Array<{ course; section }>; units: number; teachingDays: number[] }` | `src/lib/schedule.ts:18` |
| `overlaps` | `overlaps(left: Meeting, right: Meeting): boolean` | `src/lib/schedule.ts:25` |
| `TimeWindow` | `type TimeWindow = { start: number \| null; end: number \| null }` | `src/lib/schedule.ts:31` |
| `meetingsFitWindow` | `meetingsFitWindow(meetings: Meeting[], window: TimeWindow): boolean` | `src/lib/schedule.ts:35` |
| `comboMeetings` | `comboMeetings(combo: Combo): Meeting[]` | `src/lib/schedule.ts:44` |
| `meetingsClash` | `meetingsClash(left: Meeting[], right: Meeting[]): boolean` | `src/lib/schedule.ts:48` |
| `Pins` | `type Pins = Record<string, Record<string, string>>` | `src/lib/schedule.ts:84` |
| `courseCombos` | `courseCombos(course: Course, prefs: Prefs, pin?): Combo[]` | `src/lib/schedule.ts:87` |
| `courseFitsWindow` | `courseFitsWindow(course: Course, window: TimeWindow): boolean` | `src/lib/schedule.ts:122` |
| `generatePlans` | `generatePlans(courses: Course[], prefs: Prefs, pins?: Pins): Plan[]` | `src/lib/schedule.ts:135` |
| `planFitsWindow` | `planFitsWindow(plan: Plan, window: TimeWindow): boolean` | `src/lib/schedule.ts:178` |
| `planMatchesPins` | `planMatchesPins(plan: Plan, pins: Pins): boolean` | `src/lib/schedule.ts:195` |
| `planSectionMap` | `planSectionMap(plan: Plan): Pins` | `src/lib/schedule.ts:206` |
| `Clash` | `type Clash = { codes: [string, string]; dayIndex; start; end }` | `src/lib/schedule.ts:235` |
| `findClashes` | `findClashes(courses: Course[], prefs: Prefs, pins?: Pins): Clash[]` | `src/lib/schedule.ts:243` |
| `blockedByPrefs` | `blockedByPrefs(courses: Course[], prefs: Prefs, pins?: Pins): string[]` | `src/lib/schedule.ts:276` |

### `src/lib/candidates.ts` · `overlap.ts` · `search.ts` · `programChoose.ts`

| Symbol | Signature | Source |
|---|---|---|
| `CandidateStatus` | `type CandidateStatus = 'open' \| 'rearrange' \| 'conflict' \| 'tba'` | `src/lib/candidates.ts:14` |
| `Candidate` | `type Candidate = { course, status, slots, instructors, prereqStatus, prereqText }` | `src/lib/candidates.ts:16` |
| `CandidateSummary` | `type CandidateSummary = { open, rearrange, conflict, tba, taken, ruledOut }` | `src/lib/candidates.ts:28` |
| `CandidateResult` | `type CandidateResult = { rows: Candidate[]; summary: CandidateSummary }` | `src/lib/candidates.ts:37` |
| `evaluateCandidates` | `evaluateCandidates(params): CandidateResult` | `src/lib/candidates.ts:43` |
| `TimeSpan` | `type TimeSpan = { start: number; end: number }` | `src/lib/overlap.ts:5` |
| `overlapMidpoints` | `overlapMidpoints<T extends TimeSpan>(spans: T[]): number[]` | `src/lib/overlap.ts:7` |
| `parseCourseCodes` | `parseCourseCodes(value: string): string[]` | `src/lib/search.ts:7` |
| `scoreCourse` | `scoreCourse(course: Course, query: string): number` | `src/lib/search.ts:23` |
| `searchCourses` | `searchCourses(courses: Course[], query: string, limit?: number): Course[]` | `src/lib/search.ts:51` |
| `ChooseRule` | `type ChooseRule = pick-one \| pick-n \| pick-units` | `src/lib/programChoose.ts:21` |
| `detectChooseRule` | `detectChooseRule(node: SectionNode): ChooseRule \| null` | `src/lib/programChoose.ts:115` |

### `src/lib/color.ts` · `time.ts` · `subjectNames.ts` · `buildingAbbrev.ts` — 展示层纯值

| Symbol | Signature | Source |
|---|---|---|
| `colorKey` | `colorKey(subjectOrCode: string): string` | `src/lib/color.ts:12` |
| `subjectHue` | `subjectHue(subjectOrCode: string): number` | `src/lib/color.ts:30` |
| `subjectShade` | `subjectShade(subjectOrCode: string): number` | `src/lib/color.ts:42` |
| `courseColor` | `courseColor(subjectOrCode: string): CSSProperties` | `src/lib/color.ts:49` |
| `CanvasPaint` | `type CanvasPaint = { fill: string; edge: string; text: string }` | `src/lib/color.ts:57` |
| `PaintTheme` | `type PaintTheme = 'light' \| 'mid' \| 'dark'` | `src/lib/color.ts:61` |
| `activeTheme` | `activeTheme(): PaintTheme` | `src/lib/color.ts:67` |
| `huePaint` | `huePaint(hue: number, shade?: number, theme?: PaintTheme): CanvasPaint` | `src/lib/color.ts:123` |
| `subjectPaint` | `subjectPaint(subjectOrCode: string, theme?: PaintTheme): CanvasPaint` | `src/lib/color.ts:138` |
| `TIMETABLE_PALETTE` | `const TIMETABLE_PALETTE: number[]` — 追加式色相槽,顺序即分配 | `src/lib/color.ts:153` |
| `courseColorPalette` | `courseColorPalette(keys: string[]): (key: string) => CSSProperties` | `src/lib/color.ts:157` |
| `hhmm` | `hhmm(minutes: number): string` | `src/lib/time.ts:1` |
| `parseHHMM` | `parseHHMM(value: string): number \| null` | `src/lib/time.ts:10` |
| `displayEndMinutes` | `displayEndMinutes(minutes: number): number` — 仅供显示,勿用于排课 | `src/lib/time.ts:22` |
| `durationTag` | `durationTag(startMin: number, endMin: number): string` — 恒 4 字符 | `src/lib/time.ts:29` |
| `DAY_SHORT` | `const DAY_SHORT: string[]` | `src/lib/time.ts:37` |
| `SUBJECT_ZH` | `const SUBJECT_ZH: Record<string, string>` | `src/lib/subjectNames.ts:7` |
| `subjectBlurb` | `subjectBlurb(code: string, englishTitle: string \| undefined): string` | `src/lib/subjectNames.ts:217` |
| `abbreviateLocation` | `abbreviateLocation(raw: string): string` | `src/lib/buildingAbbrev.ts:197` |

### `src/lib/programs.ts` — 培养方案数据与分类

| Symbol | Signature | Source |
|---|---|---|
| `ProgramStream` | `type ProgramStream = { name: string; courses: string[] }` | `src/lib/programs.ts:27` |
| `ProgramCourse` | `type ProgramCourse = { code: string; alts: string[] }` | `src/lib/programs.ts:39` |
| `SectionNode` | `type SectionNode = { marker, title, units, note, rule?, courses, children, kind? }` | `src/lib/programs.ts:50` |
| `ProgramParseStatus` | `type ProgramParseStatus = 'full' \| 'prose_only' \| 'partial' \| 'empty'` | `src/lib/programs.ts:81` |
| `Program` | `type Program = { id, year, name_en, name_chi, faculty, faculties, degree, total_units, parse_status, required, elective, streams, all, structure }` | `src/lib/programs.ts:83` |
| `ProgramBundle` | `type ProgramBundle = { years: string[]; program_count: number; programs: Program[] }` | `src/lib/programs.ts:113` |
| `loadPrograms` | `loadPrograms(): Promise<Program[]>` | `src/lib/programs.ts:128` |
| `listYears` | `listYears(programs: Program[]): string[]` | `src/lib/programs.ts:148` |
| `getProgram` | `getProgram(programs: Program[], id: string): Program \| undefined` | `src/lib/programs.ts:152` |
| `nearestDataYear` | `nearestDataYear(programs: Program[], year?: string): string \| undefined` | `src/lib/programs.ts:164` |
| `SubjectTitle` | `type SubjectTitle = { code: string; title: string }` | `src/lib/programs.ts:184` |
| `searchPrograms` | `searchPrograms(programs, query, opts?): Program[]` | `src/lib/programs.ts:186` |
| `canonicalSubject` | `canonicalSubject(p: Program, subjects: SubjectTitle[]): string \| null` | `src/lib/programs.ts:266` |
| `CourseScope` | `type CourseScope = { electives?: boolean; streams?: boolean }` | `src/lib/programs.ts:305` |
| `programCourseKeys` | `programCourseKeys(program: Program, scope?: CourseScope): Set<string>` | `src/lib/programs.ts:317` |
| `requiredCourseKeys` | `requiredCourseKeys(program: Program): Set<string>` | `src/lib/programs.ts:326` |
| `allCourseKeys` | `allCourseKeys(program: Program): Set<string>` | `src/lib/programs.ts:331` |
| `StandingKind` | `type StandingKind = 'required' \| 'elective' \| 'free'` | `src/lib/programs.ts:338` |
| `BiLabel` | `type BiLabel = { zh: string; en: string }` | `src/lib/programs.ts:342` |
| `CourseStanding` | `type CourseStanding = required \| elective \| free（带 section 标签）` | `src/lib/programs.ts:349` |
| `STANDING_LABEL` | `const STANDING_LABEL: Record<StandingKind, BiLabel>` | `src/lib/programs.ts:355` |
| `glossSection` | `glossSection(title: string): BiLabel` | `src/lib/programs.ts:374` |
| `classifyPrograms` | `classifyPrograms(program: Program): Map<string, CourseStanding>` | `src/lib/programs.ts:388` |

### `src/lib/programProgress.ts` — 学分进度归并

| Symbol | Signature | Source |
|---|---|---|
| `SectionProgress` | `type SectionProgress = { marker, title, note, earned, required, count, estimated, countable }` | `src/lib/programProgress.ts:73` |
| `CreditBucket` | `type CreditBucket = { earned: number; count: number; estimated: number }` | `src/lib/programProgress.ts:93` |
| `ProgramProgress` | `type ProgramProgress = { sections, inProgram, unplaced, outside, totalRequired, reconciled }` | `src/lib/programProgress.ts:95` |
| `computeProgramProgress` | `computeProgramProgress(program, takenKeys, unitsFor): ProgramProgress` | `src/lib/programProgress.ts:160` |

### `src/lib/configMd.ts` · `cloud.ts` — `.md` 备份与云存档

| Symbol | Signature | Source |
|---|---|---|
| `ConfigMdState` | `type ConfigMdState = { termSlug, committed, taken, cart, pins, 9 个开关, programScope, workStart, workEnd }` | `src/lib/configMd.ts:16` |
| `ConfigMdOptions` | `type ConfigMdOptions = { termName?: string; titleFor?: (code) => string \| undefined }` | `src/lib/configMd.ts:37` |
| `todayLabel` | `todayLabel(date?: Date): string` | `src/lib/configMd.ts:54` |
| `configMdFilename` | `configMdFilename(date?: Date): string` | `src/lib/configMd.ts:59` |
| `encodeConfigMd` | `encodeConfigMd(state: ConfigMdState, options?: ConfigMdOptions): string` | `src/lib/configMd.ts:86` |
| `sanitizeConfigState` | `sanitizeConfigState(parsed: unknown): ConfigMdState \| null` | `src/lib/configMd.ts:131` |
| `decodeConfigMd` | `decodeConfigMd(text: string): ConfigMdState \| null` | `src/lib/configMd.ts:204` |
| `PlanSigs` | `type PlanSigs = { solo, a, b: string \| null }` | `src/lib/cloud.ts:14` |
| `CloudConfig` | `type CloudConfig = ConfigMdState & { enrollYear; programId; planSigs }` | `src/lib/cloud.ts:16` |
| `CloudCreds` | `type CloudCreds = { username: string; password: string }` | `src/lib/cloud.ts:22` |
| `USERNAME_RE` | `const USERNAME_RE = /^[A-Za-z0-9_.-]{2,32}$/` | `src/lib/cloud.ts:25` |
| `loadCreds` | `loadCreds(): CloudCreds \| null` | `src/lib/cloud.ts:27` |
| `saveCreds` | `saveCreds(creds: CloudCreds): void` | `src/lib/cloud.ts:42` |
| `clearCreds` | `clearCreds(): void` | `src/lib/cloud.ts:50` |
| `sanitizeCloudConfig` | `sanitizeCloudConfig(value: unknown): CloudConfig \| null` | `src/lib/cloud.ts:59` |
| `CloudError` | `class CloudError extends Error { code: string }` | `src/lib/cloud.ts:75` |
| `cloudErrorText` | `cloudErrorText(cause: unknown): string` | `src/lib/cloud.ts:83` |
| `isAuthError` | `isAuthError(cause: unknown): boolean` | `src/lib/cloud.ts:103` |
| `cloudAuth` | `cloudAuth(creds): Promise<{ created: boolean; hasConfig: boolean }>` | `src/lib/cloud.ts:135` |
| `cloudLoad` | `cloudLoad(creds): Promise<{ config: CloudConfig \| null; updatedAt: string \| null }>` | `src/lib/cloud.ts:144` |
| `cloudSave` | `cloudSave(creds, config): Promise<string \| null>` | `src/lib/cloud.ts:156` |

### `src/lib/shareLink.ts` · `shareStore.ts` · `clipboard.ts` — 链接分享

| Symbol | Signature | Source |
|---|---|---|
| `SharePayload` | `type SharePayload = { termSlug, committed, taken, pins }` | `src/lib/shareLink.ts:11` |
| `utf8ToBase64` | `utf8ToBase64(text: string): string` | `src/lib/shareLink.ts:28` |
| `base64ToUtf8` | `base64ToUtf8(base64: string): string` | `src/lib/shareLink.ts:32` |
| `encodeShare` | `encodeShare(payload: SharePayload): string` | `src/lib/shareLink.ts:36` |
| `decodeShare` | `decodeShare(hash: string): SharePayload \| null` | `src/lib/shareLink.ts:51` |
| `LiveState` | `type LiveState = SharePayload & { page?, 9 个开关, programScope, workStart, workEnd }` | `src/lib/shareLink.ts:82` |
| `encodeLiveState` | `encodeLiveState(state: LiveState): string` | `src/lib/shareLink.ts:106` |
| `decodeLiveState` | `decodeLiveState(hash: string): LiveState \| null` | `src/lib/shareLink.ts:121` |
| `copyShareLink` | `copyShareLink(payload): Promise<{ copied: boolean; url: string }>` | `src/lib/shareLink.ts:164` |
| `ShareInstance` | `type ShareInstance = { termSlug, termName, committed, taken, pins }` | `src/lib/shareStore.ts:14` |
| `readShareId` | `readShareId(): string \| null` | `src/lib/shareStore.ts:25` |
| `shareUrl` | `shareUrl(id: string): string` | `src/lib/shareStore.ts:35` |
| `CreateResult` | `type CreateResult = ok(id,url,expiresAt) \| fail(reason)` | `src/lib/shareStore.ts:39` |
| `createShare` | `createShare(instance: ShareInstance): Promise<CreateResult>` | `src/lib/shareStore.ts:43` |
| `LoadResult` | `type LoadResult = ok(instance,expiresAt) \| fail('not_found' \| 'error')` | `src/lib/shareStore.ts:59` |
| `loadShare` | `loadShare(id: string): Promise<LoadResult>` | `src/lib/shareStore.ts:63` |
| `copyText` | `copyText(text: string): Promise<boolean>` | `src/lib/clipboard.ts:14` |

### `src/lib/export*.ts` · `ics.ts` — 导出

| Symbol | Signature | Source |
|---|---|---|
| `ExportFormat` | `type ExportFormat = 'ics' \| 'image' \| 'pdf' \| 'wallpaper' \| 'html'` | `src/lib/exportPlan.ts:8` |
| `ExportRequest` | `type ExportRequest = { format, plan, termName, termSlug?, planLabel?, paint?, aspect? }` | `src/lib/exportPlan.ts:10` |
| `ExportResult` | `type ExportResult = ok(note) \| fail(reason)` | `src/lib/exportPlan.ts:27` |
| `exportPlan` | `exportPlan(request: ExportRequest): Promise<ExportResult>` | `src/lib/exportPlan.ts:38` |
| `PaintFn` | `type PaintFn = (code, subject, theme?) => CanvasPaint` | `src/lib/exportImage.ts:11` |
| `Aspect` | `type Aspect = { w: number; h: number }` | `src/lib/exportImage.ts:33` |
| `canvasSize` | `canvasSize(aspect: Aspect): { W: number; H: number }` | `src/lib/exportImage.ts:41` |
| `slugTerm` | `slugTerm(name: string): string` | `src/lib/exportImage.ts:469` |
| `downloadBlob` | `downloadBlob(blob: Blob, filename: string): void` | `src/lib/exportImage.ts:476` |
| `deliverImage` | `deliverImage(blob, filename): Promise<'shared' \| 'downloaded' \| 'cancelled'>` | `src/lib/exportImage.ts:502` |
| `ThemeInk` | `type ThemeInk = { page, ink, faint, faintHalf, muted }` | `src/lib/exportImage.ts:302` |
| `DrawFrame` | `type DrawFrame = { bare?: boolean; ink?: ThemeInk }` | `src/lib/exportImage.ts:312` |
| `draw` | `draw(ctx, plan, termName, paint, theme?, W?, H?, frame?): void` | `src/lib/exportImage.ts:317` |
| `ensureExportFonts` | `ensureExportFonts(): Promise<void>` | `src/lib/exportImage.ts:123` |
| `exportImage` | `exportImage(plan, termName, paint?, aspect?, theme?): Promise<string>` | `src/lib/exportImage.ts:543` |
| `exportPdf` | `exportPdf(plan, termName, paint?): Promise<string>` | `src/lib/exportImage.ts:574` |
| `buildScheduleHtml` | `buildScheduleHtml(plan, termName, paint?, planLabel?): string` | `src/lib/exportHtml.ts:83` |
| `exportHtmlFile` | `exportHtmlFile(plan, termName, paint?, planLabel?): string` | `src/lib/exportHtml.ts:478` |
| `exportWallpaper` | `exportWallpaper(plan, termName, paint?, planLabel?): Promise<string>` | `src/lib/exportWallpaper.ts:94` |
| `IcsOptions` | `type IcsOptions = { termSlug?, planLabel?, now? }` | `src/lib/ics.ts:74` |
| `buildIcs` | `buildIcs(plan: Plan, termName: string, options?: IcsOptions): string` | `src/lib/ics.ts:82` |
| `exportIcs` | `exportIcs(plan: Plan, termName: string, options?: IcsOptions): string` | `src/lib/ics.ts:158` |
| `TermCalendar` | `type TermCalendar = { start, end, noClass: Array<string \| [string, string]> }` | `src/lib/termCalendar.ts:10` |
| `TERM_CALENDARS` | `const TERM_CALENDARS: Record<termSlug, TermCalendar>`(官方校历) | `src/lib/termCalendar.ts:20` |
| `parseLocalDate` | `parseLocalDate(value: 'YYYY-MM-DD'): Date` | `src/lib/termCalendar.ts:45` |
| `noClassDates` | `noClassDates(calendar: TermCalendar): Date[]` | `src/lib/termCalendar.ts:51` |
| `termCalendarFor` | `termCalendarFor(termSlug): TermCalendar \| null` | `src/lib/termCalendar.ts:65` |

### `src/i18n/index.ts` — 三语

| Symbol | Signature | Source |
|---|---|---|
| `Lang` | `type Lang = 'zh' \| 'zht' \| 'en'` | `src/i18n/index.ts:14` |
| `LANGS` | `const LANGS: Lang[]` | `src/i18n/index.ts:16` |
| `LANG_LABEL` | `const LANG_LABEL: Record<Lang, string>` | `src/i18n/index.ts:17` |
| `setLang` | `setLang(lang: Lang): void` | `src/i18n/index.ts:27` |
| `getLang` | `getLang(): Lang` | `src/i18n/index.ts:31` |
| `nextLang` | `nextLang(lang: Lang): Lang` | `src/i18n/index.ts:35` |
| `t` | `t(src: string, vars?: Record<string, string \| number>): string` | `src/i18n/index.ts:43` |

### React 组件面(props 即契约)

| Symbol | Signature | Source |
|---|---|---|
| `App` | `export default function App()` — 根组件,无 props | `src/App.tsx:584` |
| `AppendixPage` | `({ siblings })` | `src/components/AppendixPage.tsx:204` |
| `CodeInput` | `({ codes, onChange, courses, placeholder, variant })` | `src/components/CodeInput.tsx:7` |
| `CommittedList` | `({ codes, byCode, onRemove?, pins?, onPin?, … })` | `src/components/CommittedList.tsx:196` |
| `CourseModal` | `({ course, standing, isTaken, isCommitted, isCart, blockedReason, onToggle*, onClose })` | `src/components/CourseModal.tsx:29` |
| `ProgramPicker` | `({ programs, subjects, selectedId, year?, onChange })` | `src/components/ProgramPicker.tsx:36` |
| `ProgramProgress` | `({ data, takenTotal })` | `src/components/ProgramProgress.tsx:112` |
| `ProgramTable` | `({ program, catalogByKey, takenSet, onToggleTaken, onBulkTaken })` | `src/components/ProgramTable.tsx:389` |
| `UnitPick` | `type UnitPick = '1' \| '2' \| '3' \| '4plus'` | `src/components/SearchResults.tsx:14` |
| `LevelBucket` | `type LevelBucket = '1' \| '2' \| '3' \| '4plus'` | `src/components/SearchResults.tsx:16` |
| `LecBusy` | `type LecBusy = { dayIndex: number; start: number; end: number }` | `src/components/SearchResults.tsx:19` |
| `SearchFilters` | `type SearchFilters = { query, includeSubjects, excludeSubjects, …(15 项) }` | `src/components/SearchResults.tsx:21` |
| `PrereqInfo` | `type PrereqInfo = { status: RequirementStatus; text: string }` | `src/components/SearchResults.tsx:111` |
| `SearchResults` | `({ offerings, statusByCode, prereqByCode, …(18 props) })` | `src/components/SearchResults.tsx:113` |
| `ShareView` | `({ id }: { id: string })` | `src/components/ShareView.tsx:56` |
| `SubjectPicker` | `({ subjects, selected, onChange, variant?, placeholder?, single? })` | `src/components/SubjectPicker.tsx:7` |
| `GhostBlock` | `type GhostBlock = Omit<Block, 'lane' \| 'lanes'>` | `src/components/TimetableCompare.tsx:29` |
| `Guide` | `type Guide = { minutes: number; label: string; tone: 'am' \| 'pm' }` | `src/components/TimetableCompare.tsx:165` |
| `TimetableCompare` | `({ planA, planB, emptyMessage, colorForCode, guides?, … })` | `src/components/TimetableCompare.tsx:167` |
| `Timetable` | `({ plan, emptyMessage, colorForCode?, portrait? })` | `src/components/Timetable.tsx:46` |

### `scripts/parse_programs.py` — 培养方案解析器(公开面 = 顶层非下划线 def)

| Symbol | Signature | Source |
|---|---|---|
| `norm` | `def norm(t: str) -> str` | `scripts/parse_programs.py:129` |
| `extract_courses` | `def extract_courses(text: str) -> list[dict]` | `scripts/parse_programs.py:210` |
| `find_sections` | `def find_sections(text: str) -> list[tuple[int, str]]` | `scripts/parse_programs.py:258` |
| `marker_level` | `def marker_level(marker: str) -> int` | `scripts/parse_programs.py:289` |
| `marker_level_ctx` | `def marker_level_ctx(marker, prev_marker) -> int` | `scripts/parse_programs.py:306` |
| `bucket_for` | `def bucket_for(group_title, ancestors) -> tuple[str, str \| None]` | `scripts/parse_programs.py:313` |
| `parse_requirements` | `def parse_requirements(block: str) -> tuple[list[dict], list[dict]]` | `scripts/parse_programs.py:328` |
| `list_prose` | `def list_prose(text: str) -> str \| None` | `scripts/parse_programs.py:487` |
| `normalize_label` | `def normalize_label(text: str) -> str` | `scripts/parse_programs.py:583` |
| `strip_units` | `def strip_units(text: str) -> tuple[int \| None, str]` | `scripts/parse_programs.py:592` |
| `to_program_courses` | `def to_program_courses(refs: list[dict]) -> list[dict]` | `scripts/parse_programs.py:601` |
| `build_structure` | `def build_structure(block: str) -> list[dict]` | `scripts/parse_programs.py:976` |
| `build_fallback_node` | `def build_fallback_node(block, structure) -> dict \| None` | `scripts/parse_programs.py:992` |
| `parse_concentration` | `def parse_concentration(block: str) -> dict \| None` | `scripts/parse_programs.py:1231` |
| `parse_streams` | `def parse_streams(block: str) -> dict \| None` | `scripts/parse_programs.py:1269` |
| `parse_program` | `def parse_program(rec: dict) -> dict` | `scripts/parse_programs.py:1308` |

### `scripts/data_utils.py` — 抓取侧共用工具

| Symbol | Signature | Source |
|---|---|---|
| `clean_word_html` | `def clean_word_html(html_content: str) -> str` | `scripts/data_utils.py:33` |
| `normalize_markdown_whitespace` | `def normalize_markdown_whitespace(text: str) -> str` | `scripts/data_utils.py:102` |
| `fix_table_headers` | `def fix_table_headers(markdown_text: str) -> str` | `scripts/data_utils.py:164` |
| `html_to_plain_text` | `def html_to_plain_text(html_content: str) -> str` | `scripts/data_utils.py:210` |
| `html_to_clean_markdown` | `def html_to_clean_markdown(html_content: str) -> Tuple[str, bool]` | `scripts/data_utils.py:238` |
| `convert_html_to_markdown` | `def convert_html_to_markdown(html_content: str) -> str` | `scripts/data_utils.py:285` |
| `utc_now_iso` | `def utc_now_iso() -> str` | `scripts/data_utils.py:299` |
| `utc_to_hkt` | `def utc_to_hkt() -> str` | `scripts/data_utils.py:315` |
| `clean_class_attributes` | `def clean_class_attributes(class_attrs, course_attrs) -> str` | `scripts/data_utils.py:331` |
| `clean_html_text` | `def clean_html_text(text: str) -> str` | `scripts/data_utils.py:370` |
| `parse_enrollment_status_from_image` | `def parse_enrollment_status_from_image(img_src: str) -> str` | `scripts/data_utils.py:404` |
| `calculate_duration_seconds` | `def calculate_duration_seconds(started_at_iso: str) -> Optional[int]` | `scripts/data_utils.py:442` |
| `format_duration_human` | `def format_duration_human(seconds: int) -> str` | `scripts/data_utils.py:474` |
| `save_json_with_newline` | `def save_json_with_newline(filepath: str, data: Any) -> None` | `scripts/data_utils.py:522` |
| `get_academic_year` | `def get_academic_year(term_name: str) -> Optional[str]` | `scripts/data_utils.py:529` |
| `year_dirs` | `def year_dirs(data_root: Path) -> list[Path]` | `scripts/data_utils.py:541` |
| `partition_subject_by_year` | `def partition_subject_by_year(subject_data: dict) -> dict` | `scripts/data_utils.py:546` |
| `collect_terms_by_year` | `def collect_terms_by_year(year_dir: Path) -> dict[str, list[str]]` | `scripts/data_utils.py:590` |
| `render_terms_module` | `def render_terms_module(terms_by_year: dict) -> str` | `scripts/data_utils.py:613` |
| `diff_term_names` | `def diff_term_names(old_content, new_content) -> Tuple[set, set]` | `scripts/data_utils.py:635` |

### `scripts/*scrape*.py` · 诊断脚本 — 抓取与核对

| Symbol | Signature | Source |
|---|---|---|
| `ScrapingConfig` | `@dataclass class ScrapingConfig` | `scripts/cuhk_scraper.py:45` |
| `TermInfo` | `@dataclass class TermInfo` | `scripts/cuhk_scraper.py:94` |
| `Course` | `@dataclass class Course` | `scripts/cuhk_scraper.py:106` |
| `ScrapingProgressTracker` | `class ScrapingProgressTracker` | `scripts/cuhk_scraper.py:149` |
| `CuhkScraper` | `class CuhkScraper` | `scripts/cuhk_scraper.py:355` |
| `log` | `def log(msg: str) -> None` | `scripts/scrape_programs.py:85` |
| `utc_now` | `def utc_now() -> str` | `scripts/scrape_programs.py:89` |
| `slugify` | `def slugify(name: str) -> str` | `scripts/scrape_programs.py:93` |
| `faculty_short` | `def faculty_short(faculty: str) -> str` | `scripts/scrape_programs.py:98` |
| `ProgramScraper` | `class ProgramScraper` | `scripts/scrape_programs.py:102` |
| `scrape` | `def scrape(years: list[str], force: bool) -> None` | `scripts/scrape_programs.py:307` |
| `load_raw_codes` | `def load_raw_codes(year: str, subject: str) -> list[str]` | `scripts/verify_catalog_parity.py:33` |
| `load_codes` | `def load_codes(year: str) -> dict[str, str]` | `scripts/verify_serper.py:36` |
| `classify` | `def classify(code: str, organic: list[dict]) -> str` | `scripts/verify_serper.py:46` |
| `query_one` | `def query_one(key: str, code: str, title: str) -> dict` | `scripts/verify_serper.py:62` |

### 测试夹具与生成产物(公开面,但不是给产品代码用的)

| Symbol | Signature | Source |
|---|---|---|
| `mkMeeting` | `mkMeeting(dayIndex, start, end, location?): Meeting` — 单测夹具 | `src/lib/testFixtures.ts:11` |
| `mkSection` | `mkSection(id, partial?): Section` — 单测夹具 | `src/lib/testFixtures.ts:15` |
| `mkCourse` | `mkCourse(code, sections, extra?): Course` — 单测夹具 | `src/lib/testFixtures.ts:32` |
| `planIsConflictFree` | `planIsConflictFree(meetings: Meeting[]): boolean` — 单测断言助手(收的是摊平后的 Meeting 数组,不是 Plan) | `src/lib/testFixtures.ts:62` |
| `RED_HAT_MONO_WOFF2_DATA_URI` | `const RED_HAT_MONO_WOFF2_DATA_URI: string` — `gen-font-inline.mjs` 生成,勿手改 | `src/fonts/redHatMonoInline.ts:4` |
| `TERMS_BY_YEAR` | `const TERMS_BY_YEAR: Record<string, readonly string[]>` — `render_terms_module` 生成的模块符号,此处是测试钉住的期望形状 | `scripts/tests/test_data_utils.py:135` |
| `meta` | `export const meta` — i18n 包裹工作流的 Workflow 元信息 | `scripts/i18n-wrap.workflow.mjs:1` |

### `scripts/` CLI 入口与管线自测(Python 顶层 def = 公开面)

| Symbol | Signature | Source |
|---|---|---|
| `main` | `def main()` — 每个管线脚本的 CLI 入口(scrape_all_subjects / scrape_programs / cuhk_scraper / parse_programs / verify_catalog_parity / verify_serper / adjudicate_missing 各有一个) | `scripts/parse_programs.py:1418` |
| `scraper` | `@pytest.fixture def scraper()` — 抓取器自测的共用夹具 | `scripts/tests/test_cuhk_scraper.py:19` |
| `test_writes_one_file_per_year_plus_no_terms` | 抓取落盘:每学年一个文件 + no-terms 分支 | `scripts/tests/test_cuhk_scraper.py:31` |
| `test_no_terms_file_removed_when_course_becomes_offered` | 课程重新开课时清掉 no-terms 文件 | `scripts/tests/test_cuhk_scraper.py:42` |
| `test_empty_subject_writes_no_file_but_reports_success` | 空学科不落文件但算成功 | `scripts/tests/test_cuhk_scraper.py:53` |
| `test_get_academic_year` | 学期名 → 学年推导 | `scripts/tests/test_data_utils.py:21` |
| `test_partition_splits_a_multi_year_course_into_each_year` | 跨学年课程按学年切片 | `scripts/tests/test_data_utils.py:29` |
| `test_partition_recomputes_total_courses_per_slice` | 切片后重算课程总数 | `scripts/tests/test_data_utils.py:53` |
| `test_partition_empty_subject_yields_no_slices` | 空学科不产生切片 | `scripts/tests/test_data_utils.py:67` |
| `test_collect_terms_sorts_by_teaching_calendar_order` | 学期按教学日历顺序排 | `scripts/tests/test_data_utils.py:81` |
| `test_collect_terms_dedupes_across_subjects` | 跨学科学期去重 | `scripts/tests/test_data_utils.py:100` |
| `test_collect_terms_excludes_terms_with_no_recognizable_year` | 无法识别学年的学期被排除 | `scripts/tests/test_data_utils.py:109` |
| `test_collect_terms_raises_on_unrecognized_suffix` | 未知后缀直接抛错(不静默吞) | `scripts/tests/test_data_utils.py:117` |
| `test_render_terms_module_output` | 生成的 terms 模块文本形状 | `scripts/tests/test_data_utils.py:126` |
| `test_diff_term_names_reports_added_and_removed` | 学期增删 diff | `scripts/tests/test_data_utils.py:145` |
| `test_diff_term_names_reports_nothing_when_unchanged` | 无变化时不报 | `scripts/tests/test_data_utils.py:155` |
| `test_diff_term_names_ignores_year_keys_on_new_year` | 新学年不误报 | `scripts/tests/test_data_utils.py:164` |

## Intentionally internal (excluded from coverage)

下列符号是**顶层但未导出**的实现细节——机器门的弱启发式(无 `export` 的顶层 `function`/
Python 顶层 `def`)会把它们算进公开面,但它们不是契约。按文件分组,理由同组共用。

**`scripts/adjudicate_missing.py`** — CLI 脚本内部函数,该文件没有模块导出


**`scripts/i18n-extract.mjs`** — CLI 脚本内部函数,该文件没有模块导出

- `walk`

**`scripts/i18n-gen.mjs`** — CLI 脚本内部函数,该文件没有模块导出

- `genEn`
- `genZht`

**`scripts/i18n-wrap.workflow.mjs`** — CLI 脚本内部函数,该文件没有模块导出

- `prompt`

**`scripts/tests/test_cuhk_scraper.py`** — pytest 用例/夹具,不是管线公开面


**`scripts/tests/test_data_utils.py`** — pytest 用例/夹具,不是管线公开面


**`server/index.mjs`** — 自执行服务脚本的内部函数,该文件没有模块导出

- `makeId`
- `readBody`
- `sendJson`
- `sweep`

**`server/private-api.mjs`** — 自执行服务脚本的内部函数,该文件没有模块导出

- `clientIp`
- `failGate`
- `getDb`
- `hashPassword`
- `recordFail`
- `verifyBasic`

**`src/App.tsx`** — App 内部助手,未导出

- `PlanStripRail`
- `Sheet`
- `useIsMobile`
- `Toggle`
- `loadLang`
- `loadSaved`
- `loadTheme`
- `loadWorkEnd`
- `loadWorkLocked`
- `loadWorkStart`
- `nextTheme`
- `pageFromPathname`
- `planHasConflict`
- `readLive`
- `readShared`
- `toggleValue`
- `usePlanStripPan`

**`src/components/AppendixPage.tsx`** — AppendixPage 的内部子组件/助手,未导出

- `DocIcon`
- `EnrolCards`
- `EssentialAppCard`

**`src/components/CommittedList.tsx`** — CommittedList 的内部子组件/助手,未导出

- `CoursePicker`
- `EyeIcon`
- `FoldIcon`
- `courseLines`
- `groupByComponent`
- `sectionChipState`
- `sectionLabel`
- `sectionTimes`

**`src/components/CourseModal.tsx`** — CourseModal 的内部子组件/助手,未导出

- `sectionTimeLines`

**`src/components/ProgramPicker.tsx`** — ProgramPicker 的内部子组件/助手,未导出

- `toTraditional`

**`src/components/ProgramProgress.tsx`** — ProgramProgress 的内部子组件/助手,未导出

- `Bar`
- `EstimateHint`
- `Nums`
- `SectionName`
- `SectionRow`
- `pct`

**`src/components/ProgramTable.tsx`** — ProgramTable 的内部子组件/助手,未导出

- `CourseGrid`
- `LeafCard`
- `LeafText`
- `NoteContent`
- `NoteLine`
- `SectionBlock`
- `TitleLabel`
- `collectCourses`
- `courseDone`
- `dominantCourseColor`
- `emphasizeUnits`
- `groupLeafRuns`
- `isLeafRequirement`
- `pickHintText`

**`src/components/SearchResults.tsx`** — SearchResults 的内部子组件/助手,未导出

- `cardSummary`
- `meetingText`
- `flagFor`

**`src/components/ShareView.tsx`** — ShareView 的内部子组件/助手,未导出

- `applyTheme`

**`src/components/Timetable.tsx`** — Timetable 的内部子组件/助手,未导出

- `layOutDay`

**`src/components/TimetableCompare.tsx`** — TimetableCompare 的内部子组件/助手,未导出

- `Column`
- `blocksOf`

**`src/lib/buildingAbbrev.ts`** — buildingAbbrev 的模块内实现,未导出

- `buildAliases`
- `normalizeWord`
- `tokenize`

**`src/lib/candidates.test.ts`** — 单测内部助手,不是产品接口

- `committedFixture`
- `run`

**`src/lib/candidates.ts`** — candidates 的模块内实现,未导出

- `planMeetings`

**`src/lib/clipboard.ts`** — clipboard 的模块内实现,未导出

- `legacyCopy`

**`src/lib/cloud.ts`** — cloud 的模块内实现,未导出

- `api`
- `basicHeader`

**`src/lib/color.ts`** — color 的模块内实现,未导出

- `hash`
- `parsePercent`
- `readThemeVars`

**`src/lib/configMd.ts`** — configMd 的模块内实现,未导出

- `asBool`
- `asMinutes`
- `courseLine`
- `courseSection`
- `decodeFromProse`
- `isPins`
- `isStringArray`
- `pad2`
- `pinsSection`
- `readMachineState`

**`src/lib/courseKey.ts`** — courseKey 的模块内实现,未导出

- `clean`

**`src/lib/data.ts`** — data 的模块内实现,未导出

- `dataUrl`
- `fetchJson`
- `fetchManifest`
- `fetchYearIndex`
- `toCourse`
- `toSection`

**`src/lib/exportHtml.ts`** — exportHtml 的模块内实现,未导出

- `escapeHtml`

**`src/lib/exportImage.ts`** — exportImage 的模块内实现,未导出

- `base64ToBytes`
- `blockFontSize`
- `buildImagePdf`
- `canvasToJpegBytes`
- `drawBlockText`
- `drawBlockTextPortrait`
- `isTouchDevice`
- `renderTimetable`
- `roundRect`
- `themeInk`
- `withAlpha`

**`src/lib/exportWallpaper.ts`** — exportWallpaper 的模块内实现,未导出

- `canvasToPng`
- `freshCanvas`
- `paintBackground`

**`src/lib/ics.ts`** — ics 的模块内实现,未导出

- `escapeText`
- `fold`
- `localStamp`
- `nextDateFor`
- `pad`
- `utcStamp`

**`src/lib/programChoose.ts`** — programChoose 的模块内实现,未导出

- `matchPickN`

**`src/lib/programs.test.ts`** — 单测内部助手,不是产品接口

- `prog`

**`src/lib/programProgress.test.ts`** — 单测内部助手,不是产品接口

- `node`
- `program`

**`src/lib/programProgress.ts`** — programProgress 的模块内实现,未导出

- `bucketOf`
- `courseGroup`
- `listsAnyCourse`
- `matchCourse`
- `requiredUnits`
- `tally`
- `unitsOfGroup`

**`src/lib/programs.ts`** — programs 的模块内实现,未导出

- `escapeRegExp`
- `nameScore`
- `scoreProgram`
- `subjectRanking`
- `subjectScore`

**`src/lib/requirements.ts`** — requirements 的模块内实现,未导出

- `cleanRegion`
- `combineAnd`
- `expandNumberedList`
- `findAnchors`
- `hasCode`
- `inCourseRange`
- `insertImplicitAnd`
- `markGradeSensitive`
- `parseExpression`
- `parseTokens`
- `resolveCommas`
- `statusOf`

**`src/lib/schedule.test.ts`** — 单测内部助手,不是产品接口

- `cohortCourse`

**`src/lib/schedule.ts`** — schedule 的模块内实现,未导出

- `cohortsAgree`
- `comboSelfConsistent`
- `toPlan`
- `violatesPrefs`

<!-- 合计 167 条;占抽出面 167/414 ≈ 40%,低于 50% 上限 -->
