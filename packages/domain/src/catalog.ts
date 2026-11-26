export type TimedQuizStatus = 'yes' | 'no' | 'unknown'
export type AssessmentDisplayStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'DRAFT_READY' | 'SUBMITTED'

export interface SubjectSnapshot {
  id: string
  externalId: string
  name: string
  gradeLabel: string | null
  sectionLabel: string | null
  lastSyncedAt: Date
}

export interface AssessmentSnapshot {
  id: string
  externalId: string
  subjectId: string
  title: string
  type: string | null
  dueAt: Date | null
  sourceStatus: string | null
  timedQuizStatus: TimedQuizStatus
  lastSyncedAt: Date
}

export function deriveAssessmentDisplayStatus(input: {
  sourceStatus: string | null
  hasLocalDraft: boolean
  confirmedSubmitted: boolean
}): AssessmentDisplayStatus {
  if (input.confirmedSubmitted) return 'SUBMITTED'
  if (input.hasLocalDraft) return 'DRAFT_READY'
  const normalized = input.sourceStatus?.trim().toLowerCase() ?? ''
  if (normalized.includes('progress') || normalized.includes('started') || normalized.includes('resum')) return 'IN_PROGRESS'
  return 'NOT_STARTED'
}
