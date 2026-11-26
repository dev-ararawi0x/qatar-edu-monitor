import type { LmsRateLimitPort } from '@hallili/application'
import { sql } from 'drizzle-orm'
import type { HalliliDatabase } from '../client'

export class PostgresLmsRateLimiter implements LmsRateLimitPort {
  constructor(private readonly db: HalliliDatabase) {}

  async acquire(input: { bucketKey: string; now: Date; capacity: number; refillPerSecond: number }) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`insert into integration_rate_limit_state (bucket_key, tokens, updated_at) values (${input.bucketKey}, ${input.capacity}, ${input.now.toISOString()}) on conflict (bucket_key) do nothing`)
      const rows = await tx.execute(sql`select tokens, updated_at, blocked_until from integration_rate_limit_state where bucket_key = ${input.bucketKey} for update`)
      const row = (rows as unknown as Array<{ tokens: string; updated_at: Date; blocked_until: Date | null }>)[0]
      if (!row) throw new Error('Rate-limit state could not be locked.')
      const blockedUntil = row.blocked_until ? new Date(row.blocked_until) : null
      const updatedAt = new Date(row.updated_at)
      if (blockedUntil && blockedUntil.getTime() > input.now.getTime()) return { allowed: false, retryAfterMs: blockedUntil.getTime() - input.now.getTime() }
      const elapsedSeconds = Math.max(0, (input.now.getTime() - updatedAt.getTime()) / 1000)
      const tokens = Math.min(input.capacity, Number(row.tokens) + elapsedSeconds * input.refillPerSecond)
      if (tokens < 1) {
        const retryAfterMs = Math.ceil(((1 - tokens) / input.refillPerSecond) * 1000)
        await tx.execute(sql`update integration_rate_limit_state set tokens = ${tokens}, updated_at = ${input.now.toISOString()} where bucket_key = ${input.bucketKey}`)
        return { allowed: false, retryAfterMs }
      }
      await tx.execute(sql`update integration_rate_limit_state set tokens = ${tokens - 1}, updated_at = ${input.now.toISOString()} where bucket_key = ${input.bucketKey}`)
      return { allowed: true, retryAfterMs: null }
    })
  }
}
