import { createSecretSafeLogger, loadLocalEnv, parseWorkerEnv } from '@hallili/integrations/runtime'
import { WorkerRuntime } from './runtime/worker-runtime'

async function main() {
  loadLocalEnv()
  parseWorkerEnv()
  const logger = createSecretSafeLogger('worker')
  const workerId = `worker-${process.pid}`
  const runtime = new WorkerRuntime({
    workerId,
    pollIntervalMs: 1_000,
    logger,
    onTick: () => {
      logger.info('worker_heartbeat', { workerId })
    },
  })

  runtime.start()

  const shutdown = async () => {
    await runtime.stop()
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
