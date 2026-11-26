import { sql } from 'drizzle-orm'
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { lmsConnections } from './lms-connections'

export const subjects = pgTable(
  'subjects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lmsConnectionId: uuid('lms_connection_id').notNull().references(() => lmsConnections.id, { onDelete: 'cascade' }),
    externalSubjectId: text('external_subject_id').notNull(),
    name: text('name').notNull(),
    gradeLabel: text('grade_label'),
    sectionLabel: text('section_label'),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('subjects_connection_external_unique').on(table.lmsConnectionId, table.externalSubjectId)],
)

export const assessments = pgTable(
  'assessments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    subjectId: uuid('subject_id').notNull().references(() => subjects.id, { onDelete: 'cascade' }),
    externalAssessmentId: text('external_assessment_id').notNull(),
    title: text('title').notNull(),
    assessmentType: text('assessment_type'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    sourceStatus: text('source_status'),
    timedQuizStatus: text('timed_quiz_status').notNull().default('unknown'),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull(),
    safeMetadata: jsonb('safe_metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('assessments_subject_external_unique').on(table.subjectId, table.externalAssessmentId),
    index('assessments_subject_due_idx').on(table.subjectId, table.dueAt),
    check('assessments_timed_status_check', sql`${table.timedQuizStatus} in ('yes','no','unknown')`),
  ],
)
