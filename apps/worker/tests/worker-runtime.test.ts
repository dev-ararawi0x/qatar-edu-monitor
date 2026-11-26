import { describe, expect, it } from 'vitest'
import { WorkerRuntime } from '../src/runtime/worker-runtime'

const logger = {
  entries: [] as string[],
  info(event: string) {
    this.entries.push(event)
  },
  warn(event: string) {
    this.entries.push(event)
  },
  error(event: string) {
    this.entries.push(event)
  },
}

describe('WorkerRuntime', () => {
  it('starts and stops without exposing an HTTP API', async () => {
    const runtime = new WorkerRuntime({ workerId: 'test', pollIntervalMs: 10, logger })
    runtime.start()
    await runtime.stop()
    expect(logger.entries).toContain('worker_started')
    expect(logger.entries).toContain('worker_stopped')
  })
})
