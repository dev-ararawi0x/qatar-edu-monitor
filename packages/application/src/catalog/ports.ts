import type { AssessmentSnapshot, SubjectSnapshot, TimedQuizStatus } from '@hallili/domain'

export interface CatalogRepositoryPort {
  listSubjects(userId: string): Promise<SubjectSnapshot[]>
  upsertSubjects(connectionId: string, items: Array<{
    externalId: string
    name: string
    gradeLabel: string | null
    sectionLabel: string | null
    syncedAt: Date
  }>): Promise<SubjectSnapshot[]>
  findOwnedSubject(userId: string, subjectId: string): Promise<SubjectSnapshot & { externalConnectionId: string } | null>
  listAssessments(userId: string, subjectId: string, dueOnly: boolean): Promise<AssessmentSnapshot[]>
  upsertAssessments(subjectId: string, items: Array<{
    externalId: string
    title: string
    type: string | null
    dueAt: Date | null
    sourceStatus: string | null
    timedQuizStatus: TimedQuizStatus
    syncedAt: Date
  }>): Promise<AssessmentSnapshot[]>
  upsertAttempts(userId: string, items: Array<{
    assessmentId: string
    lmsQuizId: string
    lmsResultsId: string
    timedQuizStatus: TimedQuizStatus
    sourceStatus: string | null
    seenAt: Date
  }>): Promise<void>
}
