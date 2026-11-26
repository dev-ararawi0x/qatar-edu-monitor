import type { LmsAssessmentOutput, LmsSubjectOutput } from '@hallili/application'

function decodeEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function requireFixtureMarker(html: string, marker: string) {
  if (!html.includes(marker)) throw new Error('PARSER_MISMATCH')
}

export function normalizeSubjectsHtml(html: string): LmsSubjectOutput[] {
  requireFixtureMarker(html, 'data-hallili-fixture="subjects-v1"')
  const rows = [...html.matchAll(/<tr[^>]*data-subject-id="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)]
  if (rows.length === 0) throw new Error('PARSER_MISMATCH')
  return rows.map((row) => {
    const cells = [...row[2]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => decodeEntities(cell[1]!.replace(/<[^>]+>/g, '')))
    const name = cells[0]
    if (!name) throw new Error('PARSER_MISMATCH')
    return {
      externalId: decodeEntities(row[1]!),
      name,
      gradeLabel: cells[1] || null,
      sectionLabel: cells[2] || null,
    }
  })
}

export function normalizeAssessmentsHtml(html: string): LmsAssessmentOutput[] {
  requireFixtureMarker(html, 'data-hallili-fixture="assessments-v1"')
  const rows = [...html.matchAll(/<tr[^>]*data-assessment-id="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)]
  if (rows.length === 0) throw new Error('PARSER_MISMATCH')
  return rows.map((row) => {
    const source = row[2]!
    const cells = [...source.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => decodeEntities(cell[1]!.replace(/<[^>]+>/g, '')))
    const title = cells[0]
    if (!title) throw new Error('PARSER_MISMATCH')
    const quizId = source.match(/data-quiz-id="([^"]+)"/)?.[1] ?? null
    const resultsId = source.match(/data-results-id="([^"]+)"/)?.[1] ?? null
    return {
      externalId: decodeEntities(row[1]!),
      title,
      type: cells[1] || null,
      dueAt: cells[2] ? new Date(cells[2]) : null,
      sourceStatus: cells[3] || null,
      timedQuizStatus: cells[4] === 'yes' ? 'yes' : cells[4] === 'no' ? 'no' : 'unknown',
      quizId,
      resultsId,
    }
  })
}
