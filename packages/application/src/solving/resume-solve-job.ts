import { assertSolveJobTransition } from '@hallili/domain'
import { ApplicationError, type ActorContext, type ClockPort } from '../index'
import type { LmsCredentialRepositoryPort } from '../lms/ports'
import type { SolveJobRepositoryPort } from './ports'

export class ResumeSolveJob {
  constructor(
    private readonly jobs: SolveJobRepositoryPort,
    private readonly connections: LmsCredentialRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: ActorContext, jobId: string) {
    const job = await this.jobs.findOwnedJob(actor.userId, jobId)
    if (!job) throw new ApplicationError('NOT_FOUND', 'The requested job was not found.', 404)
    if (job.status !== 'paused') throw new ApplicationError('CONFLICT', 'Only a paused job can be resumed.', 409)
    assertSolveJobTransition('paused', 'queued')
    if (job.pauseReason === 'SESSION_EXPIRED') {
      const connection = await this.connections.findByUserId(actor.userId)
      if (!connection?.encryptedCredential || connection.status === 'revoked' || connection.status === 'expired') {
        throw new ApplicationError('BLOCKER_NOT_RESOLVED', 'Reconnect and validate the LMS session before resuming this job.', 422)
      }
    }
    if (job.pauseReason === 'MANUAL_INPUT_REQUIRED') {
      throw new ApplicationError('BLOCKER_NOT_RESOLVED', 'Manual input must be recorded before this job can resume.', 422)
    }
    const now = this.clock.now()
    const updated = await this.jobs.resumePausedJob(actor.userId, jobId, now)
    if (!updated) throw new ApplicationError('CONFLICT', 'The job state changed before it could be resumed.', 409)
    return { jobId, status: 'queued' as const }
  }
}
