import type { PauseReason, SolveJobStatus, TimedQuizStatus } from '@hallili/domain'

export interface AssessmentAttemptSnapshot {
  id: string
  userId: string
  assessmentId: string
  lmsQuizId: string
  lmsResultsId: string
  timedQuizStatus: TimedQuizStatus
  sourceStatus: string | null
  lastSeenAt: Date
}

export interface SolveJobSnapshot {
  id: string
  userId: string
  attemptId: string
  lmsQuizId: string
  lmsResultsId: string
  status: SolveJobStatus
  questionManifestStatus: 'pending' | 'ready' | 'failed'
  pauseReason: PauseReason | null
  lastErrorCode: string | null
  userMessage: string | null
  currentQuestionPosition: number | null
  totalQuestions: number
  completedQuestions: number
  attemptCount: number
  maxAttempts: number
  availableAt: Date
  idempotencyKey: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateJobReceipt {
  job: SolveJobSnapshot
  existing: boolean
}

export interface SolveJobRepositoryPort {
  findAttemptsForUser(userId: string, attemptIds: string[]): Promise<AssessmentAttemptSnapshot[]>
  createJobsAtomically(input: {
    userId: string
    idempotencyKey: string
    attempts: AssessmentAttemptSnapshot[]
    now: Date
    quotaLimit: number
  }): Promise<CreateJobReceipt[]>
  listJobs(userId: string, status?: SolveJobStatus): Promise<SolveJobSnapshot[]>
  findOwnedJob(userId: string, jobId: string): Promise<SolveJobSnapshot | null>
  resumePausedJob(userId: string, jobId: string, now: Date): Promise<boolean>
}

export interface ClaimedSolveJob extends SolveJobSnapshot {
  lockedBy: string
  leaseExpiresAt: Date
  heartbeatAt: Date
}

export interface JobQueuePort {
  claimNext(input: { workerId: string; now: Date; leaseMs: number }): Promise<ClaimedSolveJob | null>
}
