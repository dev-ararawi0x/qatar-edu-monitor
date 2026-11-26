import type { JobQuestionSnapshot, SolveJobProcessingRepositoryPort } from '@hallili/application'
import type { AnswerPayload, NormalizedQuestion } from '@hallili/domain'
import { and, asc, eq, lt, sql } from 'drizzle-orm'
import type { HalliliDatabase } from '../client'
import { assessments, subjects } from '../schema/catalog'
import { answerDrafts, draftRevisions } from '../schema/drafts'
import { assessmentAttempts, jobQuestions, solveJobs } from '../schema/solving'
import { quotaBuckets, quotaEvents } from '../schema/usage'

type QuestionRow = typeof jobQuestions.$inferSelect

function question(row: QuestionRow): JobQuestionSnapshot {
  return {
    id: row.id,
    jobId: row.jobId,
    externalQuestionId: row.externalQuestionId,
    position: row.position,
    questionType: row.questionType,
    status: row.status as JobQuestionSnapshot['status'],
    pauseReason: row.pauseReason,
    questionFingerprint: row.questionFingerprint,
    normalizedQuestion: row.normalizedQuestion as NormalizedQuestion | null,
    parserVersion: row.parserVersion,
  }
}

export class DrizzleSolveJobProcessingRepository implements SolveJobProcessingRepositoryPort {
  constructor(private readonly db: HalliliDatabase) {}

  async findExecutionContext(jobId: string) {
    const rows = await this.db.select({ jobUserId: solveJobs.userId, lmsConnectionId: subjects.lmsConnectionId }).from(solveJobs).innerJoin(assessmentAttempts, eq(solveJobs.attemptId, assessmentAttempts.id)).innerJoin(assessments, eq(assessmentAttempts.assessmentId, assessments.id)).innerJoin(subjects, eq(assessments.subjectId, subjects.id)).where(eq(solveJobs.id, jobId)).limit(1)
    return rows[0] ?? null
  }

  async persistManifest(jobId: string, questions: NormalizedQuestion[], now: Date) {
    await this.db.transaction(async (tx) => {
      for (const [index, item] of questions.entries()) {
        await tx.insert(jobQuestions).values({
          jobId,
          externalQuestionId: item.externalQuestionId,
          questionFingerprint: item.fingerprint,
          position: index + 1,
          questionType: item.type,
          status: 'pending',
          normalizedQuestion: item,
          parserVersion: 'fixture-v1',
          createdAt: now,
          updatedAt: now,
        }).onConflictDoNothing()
      }
      await tx.update(solveJobs).set({ questionManifestStatus: 'ready', questionManifestLoadedAt: now, totalQuestions: questions.length, updatedAt: now }).where(eq(solveJobs.id, jobId))
    })
  }

  async listQuestions(jobId: string) {
    const rows = await this.db.select().from(jobQuestions).where(eq(jobQuestions.jobId, jobId)).orderBy(asc(jobQuestions.position))
    return rows.map(question)
  }

  async heartbeat(jobId: string, workerId: string, now: Date, leaseMs: number) {
    const rows = await this.db.update(solveJobs).set({ heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + leaseMs), updatedAt: now }).where(and(eq(solveJobs.id, jobId), eq(solveJobs.lockedBy, workerId))).returning({ id: solveJobs.id })
    return rows.length > 0
  }

  async requeueIfLeaseExpired(jobId: string, workerId: string, now: Date) {
    const rows = await this.db.update(solveJobs).set({ status: 'queued', lockedBy: null, leaseExpiresAt: null, heartbeatAt: null, lastErrorCode: 'WORKER_LEASE_EXPIRED', availableAt: now, updatedAt: now }).where(and(eq(solveJobs.id, jobId), eq(solveJobs.lockedBy, workerId), lt(solveJobs.leaseExpiresAt, now))).returning({ id: solveJobs.id })
    return rows.length > 0
  }

  async recoverExpiredLeases(now: Date) {
    const rows = await this.db.update(solveJobs).set({ status: 'queued', lockedBy: null, leaseExpiresAt: null, heartbeatAt: null, lastErrorCode: 'WORKER_LEASE_EXPIRED', updatedAt: now }).where(and(eq(solveJobs.status, 'running'), lt(solveJobs.leaseExpiresAt, now))).returning({ id: solveJobs.id })
    return rows.length
  }

  async markQuestionProcessing(jobQuestionId: string, now: Date) {
    await this.db.update(jobQuestions).set({ status: 'processing', startedAt: now, updatedAt: now }).where(eq(jobQuestions.id, jobQuestionId))
  }

  async saveDraftCheckpoint(input: { jobId: string; jobQuestionId: string; position: number; answer: AnswerPayload; explanation: string | null; confidence: number | null; now: Date }) {
    await this.db.transaction(async (tx) => {
      const drafts = await tx.insert(answerDrafts).values({ jobQuestionId: input.jobQuestionId, answerPayload: input.answer, explanation: input.explanation, confidence: input.confidence == null ? null : String(input.confidence), remoteSaveStatus: 'not_enabled', origin: 'ai_generated', version: 1, createdAt: input.now, updatedAt: input.now }).onConflictDoNothing().returning()
      const draft = drafts[0] ?? (await tx.select().from(answerDrafts).where(eq(answerDrafts.jobQuestionId, input.jobQuestionId)).limit(1))[0]
      if (!draft) throw new Error('Draft checkpoint could not be persisted.')
      await tx.insert(draftRevisions).values({ draftId: draft.id, version: 1, answerPayload: input.answer, actorType: 'system', changeReason: 'ai_generated', createdAt: input.now }).onConflictDoNothing()
      await tx.update(jobQuestions).set({ status: 'draft_saved', completedAt: input.now, updatedAt: input.now }).where(eq(jobQuestions.id, input.jobQuestionId))
      await tx.update(solveJobs).set({ completedQuestions: sql`${solveJobs.completedQuestions} + 1`, currentQuestionPosition: input.position, updatedAt: input.now }).where(eq(solveJobs.id, input.jobId))
    })
  }

  async markManualInputRequired(input: { jobId: string; jobQuestionId: string; now: Date; message: string }) {
    await this.db.transaction(async (tx) => {
      await tx.update(jobQuestions).set({ status: 'manual_input_required', pauseReason: 'MANUAL_INPUT_REQUIRED', completedAt: input.now, updatedAt: input.now }).where(eq(jobQuestions.id, input.jobQuestionId))
      await tx.update(solveJobs).set({ currentQuestionPosition: sql`(select position from job_questions where id = ${input.jobQuestionId})`, updatedAt: input.now }).where(eq(solveJobs.id, input.jobId))
    })
  }

  async pauseJob(input: { jobId: string; reason: Parameters<SolveJobProcessingRepositoryPort['pauseJob']>[0]['reason']; message: string; now: Date }) {
    await this.db.update(solveJobs).set({ status: 'paused', pauseReason: input.reason, userMessage: input.message, lockedBy: null, leaseExpiresAt: null, heartbeatAt: null, updatedAt: input.now }).where(eq(solveJobs.id, input.jobId))
  }

  async completeJob(jobId: string, now: Date) {
    await this.db.transaction(async (tx) => {
      const rows = await tx.update(solveJobs).set({ status: 'completed', finishedAt: now, lockedBy: null, leaseExpiresAt: null, heartbeatAt: null, updatedAt: now }).where(eq(solveJobs.id, jobId)).returning({ userId: solveJobs.userId })
      const row = rows[0]
      if (!row) return
      const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      const buckets = await tx.select().from(quotaBuckets).where(and(eq(quotaBuckets.userId, row.userId), eq(quotaBuckets.metric, 'assessment'), eq(quotaBuckets.periodStart, periodStart))).limit(1)
      const bucket = buckets[0]
      if (bucket) {
        await tx.update(quotaBuckets).set({ reservedUnits: sql`greatest(${quotaBuckets.reservedUnits} - 1, 0)`, consumedUnits: sql`${quotaBuckets.consumedUnits} + 1`, updatedAt: now }).where(eq(quotaBuckets.id, bucket.id))
        await tx.insert(quotaEvents).values({ bucketId: bucket.id, userId: row.userId, referenceType: 'solve_job', referenceId: jobId, eventType: 'consume', units: 1, idempotencyKey: `consume:${jobId}`, createdAt: now }).onConflictDoNothing()
      }
    })
  }

  async requeueJob(jobId: string, availableAt: Date, now: Date) {
    await this.db.update(solveJobs).set({ status: 'queued', availableAt, lockedBy: null, leaseExpiresAt: null, heartbeatAt: null, updatedAt: now }).where(eq(solveJobs.id, jobId))
  }
}
