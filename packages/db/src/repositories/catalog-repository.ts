import type { CatalogRepositoryPort } from '@hallili/application'
import type { AssessmentSnapshot, SubjectSnapshot, TimedQuizStatus } from '@hallili/domain'
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import type { HalliliDatabase } from '../client'
import { assessments, subjects } from '../schema/catalog'
import { lmsConnections } from '../schema/lms-connections'

type SubjectRow = typeof subjects.$inferSelect
type AssessmentRow = typeof assessments.$inferSelect

function subject(row: SubjectRow): SubjectSnapshot {
  return { id: row.id, externalId: row.externalSubjectId, name: row.name, gradeLabel: row.gradeLabel, sectionLabel: row.sectionLabel, lastSyncedAt: row.lastSyncedAt }
}
function assessment(row: AssessmentRow): AssessmentSnapshot {
  return { id: row.id, externalId: row.externalAssessmentId, subjectId: row.subjectId, title: row.title, type: row.assessmentType, dueAt: row.dueAt, sourceStatus: row.sourceStatus, timedQuizStatus: row.timedQuizStatus as TimedQuizStatus, lastSyncedAt: row.lastSyncedAt }
}

export class DrizzleCatalogRepository implements CatalogRepositoryPort {
  constructor(private readonly db: HalliliDatabase) {}

  async listSubjects(userId: string) {
    const rows = await this.db.select({ subject: subjects }).from(subjects).innerJoin(lmsConnections, eq(subjects.lmsConnectionId, lmsConnections.id)).where(eq(lmsConnections.userId, userId)).orderBy(asc(subjects.name))
    return rows.map((row) => subject(row.subject))
  }

  async upsertSubjects(connectionId: string, items: Array<{ externalId: string; name: string; gradeLabel: string | null; sectionLabel: string | null; syncedAt: Date }>) {
    if (items.length === 0) return []
    const rows = await this.db.insert(subjects).values(items.map((item) => ({ lmsConnectionId: connectionId, externalSubjectId: item.externalId, name: item.name, gradeLabel: item.gradeLabel, sectionLabel: item.sectionLabel, lastSyncedAt: item.syncedAt, updatedAt: item.syncedAt }))).onConflictDoUpdate({ target: [subjects.lmsConnectionId, subjects.externalSubjectId], set: { name: sqlExcluded('name'), gradeLabel: sqlExcluded('grade_label'), sectionLabel: sqlExcluded('section_label'), lastSyncedAt: sqlExcluded('last_synced_at'), updatedAt: sqlExcluded('updated_at') } }).returning()
    return rows.map(subject)
  }

  async findOwnedSubject(userId: string, subjectId: string) {
    const rows = await this.db.select({ subject: subjects }).from(subjects).innerJoin(lmsConnections, eq(subjects.lmsConnectionId, lmsConnections.id)).where(and(eq(subjects.id, subjectId), eq(lmsConnections.userId, userId))).limit(1)
    const row = rows[0]?.subject
    return row ? { ...subject(row), externalConnectionId: row.lmsConnectionId } : null
  }

  async listAssessments(userId: string, subjectId: string, dueOnly: boolean) {
    const owned = await this.findOwnedSubject(userId, subjectId)
    if (!owned) return []
    const conditions = dueOnly ? and(eq(assessments.subjectId, subjectId), isNotNull(assessments.dueAt)) : eq(assessments.subjectId, subjectId)
    const rows = await this.db.select().from(assessments).where(conditions).orderBy(asc(assessments.dueAt))
    return rows.map(assessment)
  }

  async upsertAssessments(subjectId: string, items: Array<{ externalId: string; title: string; type: string | null; dueAt: Date | null; sourceStatus: string | null; timedQuizStatus: TimedQuizStatus; syncedAt: Date }>) {
    if (items.length === 0) return []
    const rows = await this.db.insert(assessments).values(items.map((item) => ({ subjectId, externalAssessmentId: item.externalId, title: item.title, assessmentType: item.type, dueAt: item.dueAt, sourceStatus: item.sourceStatus, timedQuizStatus: item.timedQuizStatus, lastSyncedAt: item.syncedAt, updatedAt: item.syncedAt, safeMetadata: {} }))).onConflictDoUpdate({ target: [assessments.subjectId, assessments.externalAssessmentId], set: { title: sqlExcluded('title'), assessmentType: sqlExcluded('assessment_type'), dueAt: sqlExcluded('due_at'), sourceStatus: sqlExcluded('source_status'), timedQuizStatus: sqlExcluded('timed_quiz_status'), lastSyncedAt: sqlExcluded('last_synced_at'), updatedAt: sqlExcluded('updated_at') } }).returning()
    return rows.map(assessment)
  }
}

function sqlExcluded(column: string) {
  // Drizzle's excluded proxy is intentionally avoided here in favor of raw SQL fragments
  return sql.raw(`excluded.${column}`) as never
}
