import type { ClaimedSolveJob, JobQueuePort } from '@hallili/application'
import type { PauseReason, SolveJobStatus } from '@hallili/domain'
import { sql } from 'drizzle-orm'
import type { HalliliDatabase } from '../client'
import { solveJobs } from '../schema/solving'

type JobRow = typeof solveJobs.$inferSelect

function claimed(row: JobRow): ClaimedSolveJob {
  if (!row.lockedBy || !row.leaseExpiresAt || !row.heartbeatAt) throw new Error('Claimed job is missing lease fields.')
  return {
    id: row.id,
    userId: row.userId,
    attemptId: row.attemptId,
    lmsQuizId: row.lmsQuizId,
    lmsResultsId: row.lmsResultsId,
    status: row.status as SolveJobStatus,
    questionManifestStatus: row.questionManifestStatus as 'pending'|'ready'|'failed',
    pauseReason: row.pauseReason as PauseReason | null,
    lastErrorCode: row.lastErrorCode,
    userMessage: row.userMessage,
    currentQuestionPosition: row.currentQuestionPosition,
    totalQuestions: row.totalQuestions,
    completedQuestions: row.completedQuestions,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    availableAt: row.availableAt,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lockedBy: row.lockedBy,
    leaseExpiresAt: row.leaseExpiresAt,
    heartbeatAt: row.heartbeatAt,
  }
}

export class PostgresJobQueue implements JobQueuePort {
  constructor(private readonly db: HalliliDatabase) {}

  async claimNext(input: { workerId: string; now: Date; leaseMs: number }): Promise<ClaimedSolveJob | null> {
    return this.db.transaction(async (tx) => {
      const candidates = await tx.execute(sql`
        select id from solve_jobs
        where status = 'queued' and available_at <= ${input.now.toISOString()}
        order by available_at asc, created_at asc
        limit 1
        for update skip locked
      `)
      const candidate = (candidates as unknown as Array<{ id: string }>)[0]
      if (!candidate) return null
      const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs)
      const rows = await tx.update(solveJobs).set({
        status: 'running',
        lockedBy: input.workerId,
        leaseExpiresAt,
        heartbeatAt: input.now,
        startedAt: input.now,
        attemptCount: sql`${solveJobs.attemptCount} + 1`,
        updatedAt: input.now,
      }).where(sql`${solveJobs.id} = ${candidate.id}`).returning()
      return rows[0] ? claimed(rows[0]) : null
    })
  }
}
