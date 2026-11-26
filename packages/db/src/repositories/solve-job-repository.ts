import { ApplicationError, type AssessmentAttemptSnapshot, type CreateJobReceipt, type SolveJobRepositoryPort, type SolveJobSnapshot } from '@hallili/application'
import type { PauseReason, SolveJobStatus, TimedQuizStatus } from '@hallili/domain'
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import type { HalliliDatabase } from '../client'
import { assessmentAttempts, solveJobs } from '../schema/solving'
import { quotaBuckets, quotaEvents } from '../schema/usage'

type AttemptRow = typeof assessmentAttempts.$inferSelect
type JobRow = typeof solveJobs.$inferSelect

function attempt(row: AttemptRow): AssessmentAttemptSnapshot {
  return { id: row.id, userId: row.userId, assessmentId: row.assessmentId, lmsQuizId: row.lmsQuizId, lmsResultsId: row.lmsResultsId, timedQuizStatus: row.timedQuizStatus as TimedQuizStatus, sourceStatus: row.sourceStatus, lastSeenAt: row.lastSeenAt }
}
function job(row: JobRow): SolveJobSnapshot {
  return { id: row.id, userId: row.userId, attemptId: row.attemptId, lmsQuizId: row.lmsQuizId, lmsResultsId: row.lmsResultsId, status: row.status as SolveJobStatus, questionManifestStatus: row.questionManifestStatus as 'pending'|'ready'|'failed', pauseReason: row.pauseReason as PauseReason | null, lastErrorCode: row.lastErrorCode, userMessage: row.userMessage, currentQuestionPosition: row.currentQuestionPosition, totalQuestions: row.totalQuestions, completedQuestions: row.completedQuestions, attemptCount: row.attemptCount, maxAttempts: row.maxAttempts, availableAt: row.availableAt, idempotencyKey: row.idempotencyKey, createdAt: row.createdAt, updatedAt: row.updatedAt }
}

function periodFor(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { start, end }
}

export class DrizzleSolveJobRepository implements SolveJobRepositoryPort {
  constructor(private readonly db: HalliliDatabase) {}

  async findAttemptsForUser(userId: string, attemptIds: string[]) {
    if (attemptIds.length === 0) return []
    const rows = await this.db.select().from(assessmentAttempts).where(and(eq(assessmentAttempts.userId, userId), inArray(assessmentAttempts.id, attemptIds)))
    return rows.map(attempt)
  }

  async createJobsAtomically(input: { userId: string; idempotencyKey: string; attempts: AssessmentAttemptSnapshot[]; now: Date; quotaLimit: number }): Promise<CreateJobReceipt[]> {
    return this.db.transaction(async (tx) => {
      const receipts: CreateJobReceipt[] = []
      const newAttempts: AssessmentAttemptSnapshot[] = []
      for (const item of input.attempts) {
        const existingRows = await tx.select().from(solveJobs).where(and(eq(solveJobs.userId, input.userId), eq(solveJobs.lmsQuizId, item.lmsQuizId), eq(solveJobs.lmsResultsId, item.lmsResultsId), inArray(solveJobs.status, ['queued','running','paused']))).limit(1)
        const existing = existingRows[0]
        if (existing) receipts.push({ job: job(existing), existing: true })
        else newAttempts.push(item)
      }

      if (newAttempts.length > 0) {
        const period = periodFor(input.now)
        await tx.insert(quotaBuckets).values({ userId: input.userId, metric: 'assessment', periodStart: period.start, periodEnd: period.end, limitUnits: input.quotaLimit, reservedUnits: 0, consumedUnits: 0, updatedAt: input.now }).onConflictDoNothing()
        const selected = await tx.select().from(quotaBuckets).where(and(eq(quotaBuckets.userId, input.userId), eq(quotaBuckets.metric, 'assessment'), eq(quotaBuckets.periodStart, period.start))).limit(1)
        const bucket = selected[0]
        if (!bucket) throw new Error('Quota bucket could not be loaded.')
        const updated = await tx.update(quotaBuckets).set({ reservedUnits: sql`${quotaBuckets.reservedUnits} + ${newAttempts.length}`, updatedAt: input.now }).where(and(eq(quotaBuckets.id, bucket.id), sql`${quotaBuckets.consumedUnits} + ${quotaBuckets.reservedUnits} + ${newAttempts.length} <= ${quotaBuckets.limitUnits}`)).returning({ id: quotaBuckets.id })
        if (updated.length === 0) {
          throw new ApplicationError('QUOTA_EXCEEDED', 'The requested work exceeds the configured quota.', 422)
        }

        for (const item of newAttempts) {
          const inserted = await tx.insert(solveJobs).values({ userId: input.userId, attemptId: item.id, lmsQuizId: item.lmsQuizId, lmsResultsId: item.lmsResultsId, status: 'queued', questionManifestStatus: 'pending', availableAt: input.now, idempotencyKey: `${input.idempotencyKey}:${item.id}`, createdAt: input.now, updatedAt: input.now }).returning()
          const row = inserted[0]
          if (!row) throw new Error('Solve job insert returned no row.')
          await tx.insert(quotaEvents).values({ bucketId: bucket.id, userId: input.userId, referenceType: 'solve_job', referenceId: row.id, eventType: 'reserve', units: 1, idempotencyKey: `reserve:${input.idempotencyKey}:${item.id}`, createdAt: input.now }).onConflictDoNothing()
          receipts.push({ job: job(row), existing: false })
        }
      }

      const byAttempt = new Map(receipts.map((receipt) => [receipt.job.attemptId, receipt]))
      return input.attempts.map((item) => byAttempt.get(item.id)).filter((receipt): receipt is CreateJobReceipt => Boolean(receipt))
    })
  }

  async listJobs(userId: string, status?: SolveJobStatus) {
    const conditions: SQL[] = [eq(solveJobs.userId, userId)]
    if (status) conditions.push(eq(solveJobs.status, status))
    const rows = await this.db.select().from(solveJobs).where(and(...conditions)).orderBy(desc(solveJobs.createdAt)).limit(100)
    return rows.map(job)
  }

  async findOwnedJob(userId: string, jobId: string) {
    const rows = await this.db.select().from(solveJobs).where(and(eq(solveJobs.id, jobId), eq(solveJobs.userId, userId))).limit(1)
    return rows[0] ? job(rows[0]) : null
  }
}
