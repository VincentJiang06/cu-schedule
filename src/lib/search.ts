import type { Course } from './types.ts'

/** Whole-word course codes typed into the chip inputs, e.g. "math2050, CSCI 2100". */
export function parseCourseCodes(value: string): string[] {
  return [
    ...new Set(
      value
        .toUpperCase()
        .replace(/([A-Z]{4})\s+(\d{4})/g, '$1$2')
        .split(/[^A-Z0-9]+/)
        .filter((token) => /^[A-Z]{4}\d{4}$/.test(token)),
    ),
  ]
}

/**
 * Scores by where the query lands: an exact code beats a code prefix, which beats a
 * title word start, which beats a loose substring anywhere in the searchable text.
 */
export function scoreCourse(course: Course, query: string): number {
  const needle = query.trim().toLowerCase()
  if (!needle) return 0

  const code = course.code.toLowerCase()
  const compact = needle.replace(/\s+/g, '')

  if (code === compact) return 1000
  if (code.startsWith(compact)) return 700
  if (course.subject.toLowerCase() === compact) return 600

  const title = course.title.toLowerCase()
  let score = 0
  for (const token of needle.split(/\s+/).filter(Boolean)) {
    if (code.includes(token)) score += 200
    else if (title.startsWith(token)) score += 120
    else if (new RegExp(`\\b${escapeRegExp(token)}`).test(title)) score += 90
    else if (title.includes(token)) score += 45
    else if (course.searchText.includes(token)) score += 20
    else return 0
  }
  return score
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function searchCourses(courses: Course[], query: string, limit = 8): Course[] {
  if (!query.trim()) return []
  return courses
    .map((course) => ({ course, score: scoreCourse(course, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.course.code.localeCompare(b.course.code))
    .slice(0, limit)
    .map((entry) => entry.course)
}
