import { writeFile } from 'node:fs/promises'

export class WorkerMetrics {
  private readonly counters: Record<string, number> = {}
  constructor(private readonly path: string) {}
  increment(name: string, amount = 1) { this.counters[name] = (this.counters[name] ?? 0) + amount }
  async flush(workerId: string) {
    await writeFile(this.path, JSON.stringify({ service: 'worker', workerId, updatedAt: new Date().toISOString(), metrics: this.counters }, null, 2))
  }
}
