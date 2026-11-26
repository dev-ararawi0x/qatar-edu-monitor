import { describe, expect, it } from 'vitest'
import { ResumeSolveJob } from '../../src/solving/resume-solve-job'
import type { SolveJobRepositoryPort, SolveJobSnapshot } from '../../src/solving/ports'

function job(pauseReason: SolveJobSnapshot['pauseReason']): SolveJobSnapshot {
  const now = new Date()
  return { id: 'job-1', userId: 'user-1', attemptId: 'attempt-1', lmsQuizId: 'q', lmsResultsId: 'r', status: 'paused', questionManifestStatus: 'ready', pauseReason, lastErrorCode: null, userMessage: null, currentQuestionPosition: 1, totalQuestions: 2, completedQuestions: 1, attemptCount: 1, maxAttempts: 3, availableAt: now, idempotencyKey: null, createdAt: now, updatedAt: now }
}
function repo(snapshot: SolveJobSnapshot): SolveJobRepositoryPort {
  return { findAttemptsForUser: async () => [], createJobsAtomically: async () => [], listJobs: async () => [], findOwnedJob: async () => snapshot, resumePausedJob: async () => true }
}
const connectionRepo = { findByUserId: async () => ({ id: 'c', userId: 'user-1', status: 'valid' as const, credentialExpiresAt: null, lastValidatedAt: null, lastRotatedAt: null, revokedAt: null, encryptedCredential: { ciphertext: new Uint8Array([1]), nonce: new Uint8Array(12), authTag: new Uint8Array(16), keyVersion: 1 } }), save: async () => { throw new Error('unused') }, markValidated: async () => undefined, revoke: async () => undefined }
const actor = { userId: 'user-1' as never }

describe('ResumeSolveJob', () => {
  it('returns a paused job to queued without accepting a browser running state', async () => {
    const result = await new ResumeSolveJob(repo(job('SESSION_EXPIRED')), connectionRepo, { now: () => new Date() }).execute(actor, 'job-1')
    expect(result).toEqual({ jobId: 'job-1', status: 'queued' })
  })
  it('rejects unresolved manual input blockers', async () => {
    await expect(new ResumeSolveJob(repo(job('MANUAL_INPUT_REQUIRED')), connectionRepo, { now: () => new Date() }).execute(actor, 'job-1')).rejects.toMatchObject({ code: 'BLOCKER_NOT_RESOLVED' })
  })
})
