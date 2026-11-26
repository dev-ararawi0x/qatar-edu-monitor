import { ProcessSolveJob } from '@hallili/application'
import { createDatabase, DrizzleLmsCredentialRepository, DrizzleSolveJobProcessingRepository, PostgresJobQueue, PostgresLmsAccountLease, PostgresLmsRateLimiter } from '@hallili/db'
import { AesGcmCredentialCipher, FakeAiDraftGenerator, FakeLmsAdapter, OpenAiCompatibleDraftGenerator, RetryingAiDraftGenerator } from '@hallili/integrations'
import { createSecretSafeLogger, loadLocalEnv, parseWorkerEnv } from '@hallili/integrations/runtime'
import { WorkerRuntime } from './runtime/worker-runtime'
import { WorkerMetrics } from './runtime/metrics'

async function main() {
  loadLocalEnv()
  const env = parseWorkerEnv()
  const logger = createSecretSafeLogger('worker')
  const database = createDatabase(env.DATABASE_URL)
  const queue = new PostgresJobQueue(database.db)
  const processingRepository = new DrizzleSolveJobProcessingRepository(database.db)
  const fakeAi = new FakeAiDraftGenerator()
  const ai = env.AI_PROVIDER === 'openai-compatible'
    ? new RetryingAiDraftGenerator(
        new OpenAiCompatibleDraftGenerator({
          baseUrl: env.AI_BASE_URL ?? (() => { throw new Error('AI_BASE_URL is required for the configured AI provider.') })(),
          apiKey: env.AI_API_KEY ?? (() => { throw new Error('AI_API_KEY is required for the configured AI provider.') })(),
          model: env.AI_MODEL ?? (() => { throw new Error('AI_MODEL is required for the configured AI provider.') })(),
        }),
        fakeAi,
      )
    : fakeAi
  const processor = new ProcessSolveJob(
    processingRepository,
    new DrizzleLmsCredentialRepository(database.db),
    new AesGcmCredentialCipher(env.ENCRYPTION_KEY),
    new FakeLmsAdapter(),
    ai,
    new PostgresLmsAccountLease(database.db),
    new PostgresLmsRateLimiter(database.db),
    { now: () => new Date() },
    { uuid: () => crypto.randomUUID() },
  )
  const workerId = `worker-${process.pid}`
  const metrics = new WorkerMetrics(process.env.WORKER_METRICS_PATH ?? ".worker-metrics.json")

  const runtime = new WorkerRuntime({
    workerId,
    pollIntervalMs: 1_000,
    logger,
    onTick: async () => {
      const now = new Date()
      const recovered = await processingRepository.recoverExpiredLeases(now)
      if (recovered > 0) metrics.increment('expired_leases_recovered', recovered)
      if (recovered > 0) logger.warn('worker_recovered_expired_leases', { workerId, recovered })
      const job = await queue.claimNext({ workerId, now, leaseMs: 30_000 })
      if (!job) return
      metrics.increment('jobs_claimed')
      logger.info('worker_job_claimed', { workerId, jobId: job.id })
      const outcome = await processor.execute(job)
      metrics.increment(`jobs_${outcome}`)
      await metrics.flush(workerId)
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
