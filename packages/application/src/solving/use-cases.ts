import { ApplicationError, type ActorContext, type ClockPort } from '../index'
import type { SolveJobRepositoryPort, SolveJobSnapshot } from './ports'

function jobDto(job: SolveJobSnapshot) {
  const active = job.status === 'queued' || job.status === 'running'
  return {
    id: job.id,
    attemptId: job.attemptId,
    status: job.status,
    pauseReason: job.pauseReason,
    message: job.userMessage,
    currentQuestionPosition: job.currentQuestionPosition,
    totalQuestions: job.totalQuestions,
    completedQuestions: job.completedQuestions,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    pollAfterMs: active ? 2_000 : null,
  }
}

export class CreateSolveJobs {
  constructor(
    private readonly jobs: SolveJobRepositoryPort,
    private readonly clock: ClockPort,
    private readonly quotaLimit = 50,
  ) {}

  async execute(actor: ActorContext, input: { attemptIds: string[]; idempotencyKey: string; timedAssessmentAcknowledgement?: boolean }) {
    const uniqueIds = new Set(input.attemptIds)
    if (uniqueIds.size !== input.attemptIds.length) throw new ApplicationError('VALIDATION_ERROR', 'Duplicate attempt IDs are not allowed.', 400)
    const attempts = await this.jobs.findAttemptsForUser(actor.userId, input.attemptIds)
    if (attempts.length !== input.attemptIds.length) throw new ApplicationError('NOT_FOUND', 'One or more attempts were not found.', 404)
    if (attempts.some((attempt) => attempt.timedQuizStatus !== 'no')) {
      throw new ApplicationError('POLICY_BLOCKED', 'Timed or unknown-time assessments are blocked by default pending policy approval.', 422)
    }
    const receipts = await this.jobs.createJobsAtomically({
      userId: actor.userId,
      idempotencyKey: input.idempotencyKey,
      attempts,
      now: this.clock.now(),
      quotaLimit: this.quotaLimit,
    })
    return {
      jobs: receipts.map(({ job, existing }) => ({
        jobId: job.id,
        attemptId: job.attemptId,
        status: job.status,
        existing,
        createdAt: job.createdAt.toISOString(),
      })),
    }
  }
}

export class ListSolveJobs {
  constructor(private readonly jobs: SolveJobRepositoryPort) {}
  async execute(actor: ActorContext, input: { status?: Parameters<SolveJobRepositoryPort['listJobs']>[1] } = {}) {
    const jobs = await this.jobs.listJobs(actor.userId, input.status)
    return { items: jobs.map(jobDto), nextCursor: null }
  }
}

export class GetSolveJob {
  constructor(private readonly jobs: SolveJobRepositoryPort) {}
  async execute(actor: ActorContext, jobId: string) {
    const job = await this.jobs.findOwnedJob(actor.userId, jobId)
    if (!job) throw new ApplicationError('NOT_FOUND', 'The requested job was not found.', 404)
    return { job: jobDto(job) }
  }
}
