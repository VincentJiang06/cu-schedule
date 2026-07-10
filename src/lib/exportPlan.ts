import type { Plan } from './schedule.ts'

export type ExportFormat = 'ics' | 'image' | 'link'

export type ExportRequest = {
  format: ExportFormat
  /** The two compared timetables; B may be absent when only one plan exists. */
  planA: Plan
  planB: Plan | null
  termName: string
}

export type ExportResult = { ok: true; note: string } | { ok: false; reason: string }

/**
 * Export interface stub. The A/B timetable comparison will eventually be exportable
 * as an .ics calendar feed, a shareable image, or a permalink. The real encoders
 * are not built yet — this fixes the call site and payload shape so the UI can wire
 * the button now and the implementation can drop in later without touching callers.
 */
export function exportPlan(request: ExportRequest): ExportResult {
  // TODO: implement ics / image / link encoders.
  return {
    ok: false,
    reason: `导出（${request.format}）功能开发中：${request.termName} · 排法 A${request.planB ? ' / B' : ''}`,
  }
}
