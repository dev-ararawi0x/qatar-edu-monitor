import { describe, expect, it } from 'vitest'
import { ProcessSolveJob } from '../../src/solving/process-solve-job'
import type { JobQuestionSnapshot, SolveJobProcessingRepositoryPort } from '../../src/solving/processing'
import type { ClaimedSolveJob } from '../../src/solving/ports'
import type { NormalizedQuestion } from '@hallili/domain'

const manifest: NormalizedQuestion[] = [
  { externalQuestionId: 'q1', fingerprint: null, type: 'single_choice', prompt: 'Pick', options: [{ id: 'a', label: 'A' }] },
  { externalQuestionId: 'q2', fingerprint: null, type: 'text', prompt: 'Write', options: [] },
]
function claimed(manifestStatus: 'pending'|'ready' = 'pending'): ClaimedSolveJob {
  const now = new Date()
  return { id: 'job-1', userId: 'user-1', attemptId: 'attempt-1', lmsQuizId: 'quiz', lmsResultsId: 'results', status: 'running', questionManifestStatus: manifestStatus, pauseReason: null, lastErrorCode: null, userMessage: null, currentQuestionPosition: null, totalQuestions: 0, completedQuestions: 0, attemptCount: 1, maxAttempts: 3, availableAt: now, idempotencyKey: null, createdAt: now, updatedAt: now, lockedBy: 'worker-1', leaseExpiresAt: now, heartbeatAt: now }
}
function memoryProcessing(rows: JobQuestionSnapshot[] = []) {
  const state = { manifestCalls: 0, saved: [] as string[], paused: [] as string[], rows }
  const port: SolveJobProcessingRepositoryPort = {
    async findExecutionContext() { return { jobUserId: 'user-1', lmsConnectionId: 'connection-1' } },
    async persistManifest(jobId, questions) {
      state.manifestCalls += 1
      if (state.rows.length === 0) state.rows = questions.map((question, index) => ({ id: `row-${index+1}`, jobId, externalQuestionId: question.externalQuestionId, position: index+1, questionType: question.type, status: 'pending', pauseReason: null, questionFingerprint: question.fingerprint, normalizedQuestion: question, parserVersion: 'fixture-v1' }))
    },
    async listQuestions() { return state.rows },
    async heartbeat() { return true },
    async requeueIfLeaseExpired() { return false },
    async recoverExpiredLeases() { return 0 },
    async markQuestionProcessing(id) { const row=state.rows.find(r=>r.id===id); if(row) row.status='processing' },
    async saveDraftCheckpoint(input) { state.saved.push(input.jobQuestionId); const row=state.rows.find(r=>r.id===input.jobQuestionId); if(row) row.status='draft_saved' },
    async markManualInputRequired(input) { const row=state.rows.find(r=>r.id===input.jobQuestionId); if(row) row.status='manual_input_required' },
    async pauseJob(input) { state.paused.push(input.reason) },
    async completeJob() { return undefined },
    async requeueJob() { return undefined },
  }
  return { state, port }
}
const connectionRepo = { findByUserId: async () => ({ id: 'connection-1', userId: 'user-1', status: 'valid' as const, credentialExpiresAt: null, lastValidatedAt: null, lastRotatedAt: null, revokedAt: null, encryptedCredential: { ciphertext: new Uint8Array([1]), nonce: new Uint8Array(12), authTag: new Uint8Array(16), keyVersion: 1 } }), save: async () => { throw new Error('unused') }, markValidated: async () => undefined, revoke: async () => undefined }
const cipher = { encrypt: () => { throw new Error('unused') }, decrypt: () => 'credential' }
const lease = { acquire: async () => true, heartbeat: async () => true, release: async () => undefined }
const rate = { acquire: async () => ({ allowed: true, retryAfterMs: null }) }
const lms = { validateSession: async () => ({ kind: 'valid' as const }), listSubjects: async () => [], listAssessments: async () => [], fetchQuestionManifest: async () => manifest }
const ai = { generate: async ({ question }: { question: NormalizedQuestion }) => question.type === 'text' ? { answer: { kind: 'text' as const, value: 'draft' }, explanation: null, confidence: 0.8, provider: 'fake', model: 'fake' } : { answer: { kind: 'choice' as const, selectedOptionIds: ['a'] }, explanation: null, confidence: 0.8, provider: 'fake', model: 'fake' } }

describe('ProcessSolveJob', () => {
  it('validates and persists the manifest once, then checkpoints questions sequentially', async () => {
    const memory = memoryProcessing()
    const processor = new ProcessSolveJob(memory.port, connectionRepo, cipher, lms, ai, lease, rate, { now: () => new Date() }, { uuid: () => 'lease-token' })
    expect(await processor.execute(claimed())).toBe('completed')
    expect(memory.state.manifestCalls).toBe(1)
    expect(memory.state.saved).toEqual(['row-1', 'row-2'])
  })

  it('skips durable questions when resumed', async () => {
    const rows: JobQuestionSnapshot[] = [
      { id: 'row-1', jobId: 'job-1', externalQuestionId: 'q1', position: 1, questionType: 'single_choice', status: 'draft_saved', pauseReason: null, questionFingerprint: null, normalizedQuestion: manifest[0]!, parserVersion: 'fixture-v1' },
      { id: 'row-2', jobId: 'job-1', externalQuestionId: 'q2', position: 2, questionType: 'text', status: 'pending', pauseReason: null, questionFingerprint: null, normalizedQuestion: manifest[1]!, parserVersion: 'fixture-v1' },
    ]
    const memory = memoryProcessing(rows)
    const processor = new ProcessSolveJob(memory.port, connectionRepo, cipher, lms, ai, lease, rate, { now: () => new Date() }, { uuid: () => 'lease-token' })
    expect(await processor.execute(claimed('ready'))).toBe('completed')
    expect(memory.state.manifestCalls).toBe(0)
    expect(memory.state.saved).toEqual(['row-2'])
  })
})
