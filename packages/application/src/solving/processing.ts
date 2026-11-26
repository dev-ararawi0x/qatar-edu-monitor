import type { AnswerPayload, NormalizedQuestion, PauseReason } from '@hallili/domain'

export interface JobQuestionSnapshot {
  id: string
  jobId: string
  externalQuestionId: string | null
  position: number
  questionType: string | null
  status: 'pending' | 'processing' | 'draft_saved' | 'manual_input_required' | 'failed' | 'skipped'
  pauseReason: string | null
  questionFingerprint: string | null
  normalizedQuestion: NormalizedQuestion | null
  parserVersion: string | null
}

export interface SolveJobProcessingRepositoryPort {
  findExecutionContext(jobId: string): Promise<{ jobUserId: string; lmsConnectionId: string } | null>
  persistManifest(jobId: string, questions: NormalizedQuestion[], now: Date): Promise<void>
  listQuestions(jobId: string): Promise<JobQuestionSnapshot[]>
  heartbeat(jobId: string, workerId: string, now: Date, leaseMs: number): Promise<boolean>
  requeueIfLeaseExpired(jobId: string, workerId: string, now: Date): Promise<boolean>
  recoverExpiredLeases(now: Date): Promise<number>
  markQuestionProcessing(jobQuestionId: string, now: Date): Promise<void>
  saveDraftCheckpoint(input: {
    jobId: string
    jobQuestionId: string
    position: number
    answer: AnswerPayload
    explanation: string | null
    confidence: number | null
    now: Date
  }): Promise<void>
  markManualInputRequired(input: { jobId: string; jobQuestionId: string; now: Date; message: string }): Promise<void>
  pauseJob(input: { jobId: string; reason: PauseReason; message: string; now: Date }): Promise<void>
  completeJob(jobId: string, now: Date): Promise<void>
  requeueJob(jobId: string, availableAt: Date, now: Date): Promise<void>
}

export interface LmsAccountLeasePort {
  acquire(input: { connectionId: string; workerId: string; ownerToken: string; now: Date; leaseMs: number }): Promise<boolean>
  heartbeat(input: { connectionId: string; ownerToken: string; now: Date; leaseMs: number }): Promise<boolean>
  release(input: { connectionId: string; ownerToken: string }): Promise<void>
}

export interface LmsRateLimitPort {
  acquire(input: { bucketKey: string; now: Date; capacity: number; refillPerSecond: number }): Promise<{ allowed: boolean; retryAfterMs: number | null }>
}
