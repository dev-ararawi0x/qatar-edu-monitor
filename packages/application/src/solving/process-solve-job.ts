import { validateAnswerForQuestion, type NormalizedQuestion } from '@hallili/domain'
import { ApplicationError, type ClockPort, type IdGenerator } from '../index'
import type { CredentialCipherPort, LmsCredentialRepositoryPort, LmsReadPort } from '../lms/ports'
import type { AiDraftGenerationPort } from './ai'
import type { ClaimedSolveJob } from './ports'
import type { LmsAccountLeasePort, LmsRateLimitPort, SolveJobProcessingRepositoryPort } from './processing'

function validateManifest(questions: NormalizedQuestion[]): void {
  if (questions.length === 0) throw new Error('PARSER_MISMATCH')
  for (const question of questions) {
    if (!question.externalQuestionId && !question.fingerprint) throw new Error('PARSER_MISMATCH')
  }
}

function isDurable(status: string): boolean {
  return status === 'draft_saved' || status === 'manual_input_required' || status === 'skipped'
}

export class ProcessSolveJob {
  constructor(
    private readonly processing: SolveJobProcessingRepositoryPort,
    private readonly connections: LmsCredentialRepositoryPort,
    private readonly cipher: CredentialCipherPort,
    private readonly lms: LmsReadPort,
    private readonly ai: AiDraftGenerationPort,
    private readonly accountLeases: LmsAccountLeasePort,
    private readonly rateLimiter: LmsRateLimitPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGenerator,
  ) {}

  async execute(job: ClaimedSolveJob): Promise<'completed' | 'paused' | 'requeued'> {
    const context = await this.processing.findExecutionContext(job.id)
    if (!context) throw new ApplicationError('NOT_FOUND', 'The job execution context was not found.', 404)
    const ownerToken = this.ids.uuid()
    const now = this.clock.now()
    const acquired = await this.accountLeases.acquire({ connectionId: context.lmsConnectionId, workerId: job.lockedBy, ownerToken, now, leaseMs: 30_000 })
    if (!acquired) {
      await this.processing.requeueJob(job.id, new Date(now.getTime() + 1_000), now)
      return 'requeued'
    }

    try {
      const connection = await this.connections.findByUserId(context.jobUserId)
      if (!connection?.encryptedCredential) {
        await this.processing.pauseJob({ jobId: job.id, reason: 'SESSION_EXPIRED', message: 'Reconnect your LMS session, then resume this job.', now: this.clock.now() })
        return 'paused'
      }
      const credential = await this.cipher.decrypt(connection.encryptedCredential, `${connection.userId}:${connection.id}`)

      if (job.questionManifestStatus === 'pending') {
        await this.acquireRateSlot()
        if (!this.lms.fetchQuestionManifest) throw new Error('PARSER_MISMATCH')
        const questions = await this.lms.fetchQuestionManifest(credential, job.lmsQuizId, job.lmsResultsId)
        validateManifest(questions)
        await this.processing.persistManifest(job.id, questions, this.clock.now())
      }

      const questions = await this.processing.listQuestions(job.id)
      for (const row of questions) {
        if (isDurable(row.status)) continue
        const question = row.normalizedQuestion
        if (!question) {
          await this.processing.pauseJob({ jobId: job.id, reason: 'PARSER_MISMATCH', message: 'A question could not be understood safely.', now: this.clock.now() })
          return 'paused'
        }
        if (question.type === 'file_upload') {
          await this.processing.markManualInputRequired({ jobId: job.id, jobQuestionId: row.id, now: this.clock.now(), message: 'This question requires manual student input.' })
          await this.processing.pauseJob({ jobId: job.id, reason: 'MANUAL_INPUT_REQUIRED', message: 'A question requires manual student input before the job can continue.', now: this.clock.now() })
          return 'paused'
        }
        await this.processing.markQuestionProcessing(row.id, this.clock.now())
        try {
          const candidate = await this.ai.generate({ question, language: 'auto' })
          if (!validateAnswerForQuestion(candidate.answer, question)) throw new Error('AI_SCHEMA_INVALID')
          await this.processing.saveDraftCheckpoint({ jobId: job.id, jobQuestionId: row.id, position: row.position, answer: candidate.answer, explanation: candidate.explanation, confidence: candidate.confidence, now: this.clock.now() })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'PROVIDER_UNAVAILABLE'
          const reason = message === 'MANUAL_INPUT_REQUIRED' ? 'MANUAL_INPUT_REQUIRED' : message.includes('RATE') ? 'PROVIDER_RATE_LIMITED' : message.includes('SCHEMA') ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE'
          await this.processing.pauseJob({ jobId: job.id, reason, message: 'Draft generation paused safely. Resume after the provider or input issue is resolved.', now: this.clock.now() })
          return 'paused'
        }
      }
      await this.processing.completeJob(job.id, this.clock.now())
      return 'completed'
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('PARSER_MISMATCH')) {
        await this.processing.pauseJob({ jobId: job.id, reason: 'PARSER_MISMATCH', message: 'The LMS page structure changed or is unsupported.', now: this.clock.now() })
        return 'paused'
      }
      if (message.includes('LMS_EXPIRED')) {
        await this.processing.pauseJob({ jobId: job.id, reason: 'SESSION_EXPIRED', message: 'Reconnect your LMS session, then resume this job.', now: this.clock.now() })
        return 'paused'
      }
      throw error
    } finally {
      await this.accountLeases.release({ connectionId: context.lmsConnectionId, ownerToken })
    }
  }

  private async acquireRateSlot(): Promise<void> {
    const result = await this.rateLimiter.acquire({ bucketKey: 'lms-global', now: this.clock.now(), capacity: 2, refillPerSecond: 0.5 })
    if (!result.allowed) throw new Error('LMS_RATE_LIMITED')
  }
}
