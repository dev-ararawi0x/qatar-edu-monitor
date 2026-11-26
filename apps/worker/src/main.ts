import { ProcessSolveJob } from '@hallili/application'
import { createDatabase, DrizzleLmsCredentialRepository, DrizzleSolveJobProcessingRepository, PostgresJobQueue, PostgresLmsAccountLease, PostgresLmsRateLimiter } from '@hallili/db'
import { AesGcmCredentialCipher, FakeAiDraftGenerator, FakeLmsAdapter } from '@hallili/integrations'
import { createSecretSafeLogger, loadLocalEnv, parseWorkerEnv } from '@hallili/integrations/runtime'
import { WorkerRuntime } from './runtime/worker-runtime'

async function main() {
  loadLocalEnv()
  const env = parseWorkerEnv()
  const logger = createSecretSafeLogger('worker')
  const database = createDatabase(env.DATABASE_URL)
  const queue = new PostgresJobQueue(database.db)
  const processingRepository = new DrizzleSolveJobProcessingRepository(database.db)
  const processor = new ProcessSolveJob(
    processingRepository,
    new DrizzleLmsCredentialRepository(database.db),
    new AesGcmCredentialCipher(env.ENCRYPTION_KEY),
    new FakeLmsAdapter(),
    new FakeAiDraftGenerator(),
    new PostgresLmsAccountLease(database.db),
    new PostgresLmsRateLimiter(database.db),
    { now: () => new Date() },
    { uuid: () => crypto.randomUUID() },
  )
  const workerId = `worker-${process.pid}`

  const runtime = new WorkerRuntime({
    workerId,
    pollIntervalMs: 1_000,
    logger,
    onTick: async () => {
      const now = new Date()
      const recovered = await processingRepository.recoverExpiredLeases(now)
      if (recovered > 0) logger.warn('worker_recovered_expired_leases', { workerId, recovered })
      const job = await queue.claimNext({ workerId, now, leaseMs: 30_000 })
      if (!job) return
      logger.info('worker_job_claimed', { workerId, jobId: job.id })
      const outcome = await processor.execute(job)
      logger.info('worker_job_finished_unit', { workerId, jobId: job.id, outcome })
    },
  })

  runtime.start()

  const shutdown = async () => {
    await runtime.stop()
    await database.close()
    process.exit(0)
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'worker_start_failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }),
  )
  process.exit(1)
})
