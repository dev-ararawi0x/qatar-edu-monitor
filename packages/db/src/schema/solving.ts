import { sql } from 'drizzle-orm'
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { assessments } from './catalog'

export const assessmentAttempts = pgTable(
  'assessment_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id').notNull().references(() => assessments.id, { onDelete: 'cascade' }),
    lmsQuizId: text('lms_quiz_id').notNull(),
    lmsResultsId: text('lms_results_id').notNull(),
    timedQuizStatus: text('timed_quiz_status').notNull().default('unknown'),
    sourceStatus: text('source_status'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('assessment_attempts_identity_unique').on(table.userId, table.lmsQuizId, table.lmsResultsId),
    index('assessment_attempts_assessment_seen_idx').on(table.assessmentId, table.lastSeenAt),
    check('assessment_attempts_timed_status_check', sql`${table.timedQuizStatus} in ('yes','no','unknown')`),
  ],
)

export const solveJobs = pgTable(
  'solve_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    attemptId: uuid('attempt_id').notNull().references(() => assessmentAttempts.id, { onDelete: 'cascade' }),
    lmsQuizId: text('lms_quiz_id').notNull(),
    lmsResultsId: text('lms_results_id').notNull(),
    status: text('status').notNull().default('queued'),
    questionManifestStatus: text('question_manifest_status').notNull().default('pending'),
    questionManifestLoadedAt: timestamp('question_manifest_loaded_at', { withTimezone: true }),
    pauseReason: text('pause_reason'),
    lastErrorCode: text('last_error_code'),
    userMessage: text('user_message'),
    currentQuestionPosition: integer('current_question_position'),
    totalQuestions: integer('total_questions').notNull().default(0),
    completedQuestions: integer('completed_questions').notNull().default(0),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text('locked_by'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('solve_jobs_status_check', sql`${table.status} in ('queued','running','paused','completed','failed')`),
    check('solve_jobs_manifest_status_check', sql`${table.questionManifestStatus} in ('pending','ready','failed')`),
    check('solve_jobs_counts_check', sql`${table.totalQuestions} >= 0 and ${table.completedQuestions} >= 0 and ${table.completedQuestions} <= ${table.totalQuestions}`),
    check('solve_jobs_attempts_check', sql`${table.attemptCount} >= 0 and ${table.maxAttempts} > 0`),
    uniqueIndex('solve_jobs_active_tuple_unique').on(table.userId, table.lmsQuizId, table.lmsResultsId).where(sql`${table.status} in ('queued','running','paused')`),
    index('solve_jobs_queue_claim_idx').on(table.availableAt, table.createdAt).where(sql`${table.status} = 'queued'`),
    index('solve_jobs_owner_created_idx').on(table.userId, table.createdAt),
    index('solve_jobs_lease_recovery_idx').on(table.leaseExpiresAt).where(sql`${table.status} = 'running'`),
  ],
)

export const jobQuestions = pgTable(
  'job_questions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobId: uuid('job_id').notNull().references(() => solveJobs.id, { onDelete: 'cascade' }),
    externalQuestionId: text('external_question_id'),
    position: integer('position').notNull(),
    questionType: text('question_type'),
    status: text('status').notNull().default('pending'),
    pauseReason: text('pause_reason'),
    questionFingerprint: text('question_fingerprint'),
    normalizedQuestion: jsonb('normalized_question'),
    parserVersion: text('parser_version'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('job_questions_identity_check', sql`${table.externalQuestionId} is not null or ${table.questionFingerprint} is not null`),
    check('job_questions_position_check', sql`${table.position} > 0`),
    check('job_questions_status_check', sql`${table.status} in ('pending','processing','draft_saved','manual_input_required','failed','skipped')`),
    uniqueIndex('job_questions_job_position_unique').on(table.jobId, table.position),
    uniqueIndex('job_questions_external_unique').on(table.jobId, table.externalQuestionId).where(sql`${table.externalQuestionId} is not null`),
    uniqueIndex('job_questions_fingerprint_unique').on(table.jobId, table.questionFingerprint).where(sql`${table.questionFingerprint} is not null`),
    index('job_questions_job_position_idx').on(table.jobId, table.position),
    index('job_questions_job_status_idx').on(table.jobId, table.status),
  ],
)
