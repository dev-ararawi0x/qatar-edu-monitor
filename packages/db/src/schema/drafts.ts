import { sql } from 'drizzle-orm'
import { check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { jobQuestions } from './solving'

export const answerDrafts = pgTable(
  'answer_drafts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobQuestionId: uuid('job_question_id').notNull().references(() => jobQuestions.id, { onDelete: 'cascade' }),
    answerPayload: jsonb('answer_payload').notNull(),
    explanation: text('explanation'),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    remoteSaveStatus: text('remote_save_status').notNull().default('not_enabled'),
    externalDraftId: text('external_draft_id'),
    origin: text('origin').notNull(),
    version: integer('version').notNull().default(1),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    updatedByUserId: text('updated_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('answer_drafts_question_unique').on(table.jobQuestionId),
    check('answer_drafts_confidence_check', sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`),
    check('answer_drafts_version_check', sql`${table.version} > 0`),
    check('answer_drafts_remote_status_check', sql`${table.remoteSaveStatus} in ('not_enabled','not_started','pending','saved','ambiguous','failed')`),
    check('answer_drafts_origin_check', sql`${table.origin} in ('ai_generated','user_entered','edited')`),
  ],
)

export const draftRevisions = pgTable(
  'draft_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    draftId: uuid('draft_id').notNull().references(() => answerDrafts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    answerPayload: jsonb('answer_payload').notNull(),
    actorType: text('actor_type').notNull(),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    changeReason: text('change_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('draft_revisions_draft_version_unique').on(table.draftId, table.version),
    index('draft_revisions_draft_created_idx').on(table.draftId, table.createdAt),
    check('draft_revisions_actor_type_check', sql`${table.actorType} in ('system','user')`),
  ],
)
