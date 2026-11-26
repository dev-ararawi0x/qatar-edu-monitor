import type { LoggerPort } from '@hallili/application'

export interface WorkerRuntimeOptions {
  workerId: string
  pollIntervalMs: number
  logger: LoggerPort
  onTick?: () => Promise<void> | void
}

export class WorkerRuntime {
  private timer: NodeJS.Timeout | null = null
  private stopping = false
  private runningTick: Promise<void> | null = null

  constructor(private readonly options: WorkerRuntimeOptions) {}

  start() {
    if (this.timer) return
    this.options.logger.info('worker_started', { workerId: this.options.workerId })
    this.timer = setInterval(() => {
      if (this.stopping || this.runningTick) return
      this.runningTick = Promise.resolve(this.options.onTick?.()).catch((error) => {
        this.options.logger.error('worker_tick_failed', {
          workerId: this.options.workerId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        })
      }).finally(() => {
        this.runningTick = null
      })
    }, this.options.pollIntervalMs)
  }

  async stop() {
    this.stopping = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.runningTick) await this.runningTick
    this.options.logger.info('worker_stopped', { workerId: this.options.workerId })
  }
}
