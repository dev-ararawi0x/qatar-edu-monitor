import { describe, expect, it } from 'vitest'
import { CreateSolveJobs } from '../../src/solving/use-cases'
import type { AssessmentAttemptSnapshot, SolveJobRepositoryPort, SolveJobSnapshot } from '../../src/solving/ports'

function attempt(id: string, timed: 'yes'|'no'|'unknown' = 'no'): AssessmentAttemptSnapshot {
  return { id, userId: 'user-1', assessmentId: 'assessment-1', lmsQuizId: `quiz-${id}`, lmsResultsId: `results-${id}`, timedQuizStatus: timed, sourceStatus: null, lastSeenAt: new Date() }
}
function jobFor(item: AssessmentAttemptSnapshot): SolveJobSnapshot {
  const now = new Date()
  return { id: `job-${item.id}`, userId: item.userId, attemptId: item.id, lmsQuizId: item.lmsQuizId, lmsResultsId: item.lmsResultsId, status: 'queued', questionManifestStatus: 'pending', pauseReason: null, lastErrorCode: null, userMessage: null, currentQuestionPosition: null, totalQuestions: 0, completedQuestions: 0, attemptCount: 0, maxAttempts: 3, availableAt: now, idempotencyKey: null, createdAt: now, updatedAt: now }
}
function repository(attempts: AssessmentAttemptSnapshot[]): SolveJobRepositoryPort & { calls: number } {
  const state = { calls: 0 }
  return {
    get calls() { return state.calls },
    async findAttemptsForUser(userId, ids) { return attempts.filter((item) => item.userId === userId && ids.includes(item.id)) },
    async createJobsAtomically(input) {
      state.calls += 1
      return input.attempts.map((item) => ({ job: jobFor(item), existing: false }))
    },
    async listJobs() { return [] },
    async findOwnedJob() { return null },
    async resumePausedJob() { return true },
  }
}
const actor = { userId: 'user-1' as never }

describe('CreateSolveJobs', () => {
  it('creates queued jobs in one atomic application operation', async () => {
    const repo = repository([attempt('00000000-0000-4000-8000-000000000001')])
    const result = await new CreateSolveJobs(repo, { now: () => new Date() }).execute(actor, { attemptIds: ['00000000-0000-4000-8000-000000000001'], idempotencyKey: 'client-key-1' })
    expect(result.jobs[0]?.status).toBe('queued')
    expect(repo.calls).toBe(1)
  })

  it('rejects duplicate attempt IDs consistently', async () => {
    const repo = repository([attempt('a')])
    await expect(new CreateSolveJobs(repo, { now: () => new Date() }).execute(actor, { attemptIds: ['a', 'a'], idempotencyKey: 'client-key-1' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('denies yes and unknown timed statuses by default', async () => {
    for (const timed of ['yes', 'unknown'] as const) {
      const repo = repository([attempt('a', timed)])
      await expect(new CreateSolveJobs(repo, { now: () => new Date() }).execute(actor, { attemptIds: ['a'], idempotencyKey: 'client-key-1' })).rejects.toMatchObject({ code: 'POLICY_BLOCKED' })
      expect(repo.calls).toBe(0)
    }
  })
})
