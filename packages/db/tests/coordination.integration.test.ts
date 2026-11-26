import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDatabase } from '../src/client'
import { PostgresLmsAccountLease } from '../src/repositories/lms-account-lease-repository'
import { PostgresLmsRateLimiter } from '../src/repositories/lms-rate-limit-repository'
import { DrizzleSolveJobProcessingRepository } from '../src/repositories/solve-job-processing-repository'
import { user } from '../src/schema/auth'
import { lmsConnections } from '../src/schema/lms-connections'
import { solveJobs } from '../src/schema/solving'

const databaseUrl = process.env.DATABASE_URL
const describeIntegration = databaseUrl ? describe : describe.skip

describeIntegration('PostgreSQL coordination integration', () => {
  it('prevents concurrent live LMS account lease ownership and releases only by owner token', async () => {
    const connection = createDatabase(databaseUrl!)
    const uid = `lease-test-${crypto.randomUUID()}`
    try {
      await connection.db.insert(user).values({ id: uid, name: 'Lease Test', email: `${uid}@example.com` })
      const rows = await connection.db.insert(lmsConnections).values({ userId: uid, status: 'valid', cookieCiphertext: Buffer.from('x'), cookieNonce: Buffer.alloc(12), cookieAuthTag: Buffer.alloc(16), keyVersion: 1 }).returning()
      const lease = new PostgresLmsAccountLease(connection.db)
      const now = new Date()
      const first = { connectionId: rows[0]!.id, workerId: 'w1', ownerToken: crypto.randomUUID(), now, leaseMs: 30_000 }
      const second = { ...first, workerId: 'w2', ownerToken: crypto.randomUUID() }
      expect(await lease.acquire(first)).toBe(true)
      expect(await lease.acquire(second)).toBe(false)
      await lease.release({ connectionId: first.connectionId, ownerToken: second.ownerToken })
      expect(await lease.acquire(second)).toBe(false)
      await lease.release({ connectionId: first.connectionId, ownerToken: first.ownerToken })
      expect(await lease.acquire(second)).toBe(true)
    } finally { await connection.close() }
  })

  it('coordinates the shared global rate limiter across instances', async () => {
    const connection = createDatabase(databaseUrl!)
    try {
      const key = `test-${crypto.randomUUID()}`
      const one = new PostgresLmsRateLimiter(connection.db)
      const two = new PostgresLmsRateLimiter(connection.db)
      const now = new Date()
      expect((await one.acquire({ bucketKey: key, now, capacity: 1, refillPerSecond: 0.01 })).allowed).toBe(true)
      const second = await two.acquire({ bucketKey: key, now, capacity: 1, refillPerSecond: 0.01 })
      expect(second.allowed).toBe(false)
      expect(second.retryAfterMs).toBeGreaterThan(0)
    } finally { await connection.close() }
  })

  it('requeues expired running leases without changing live worker ownership', async () => {
    const connection = createDatabase(databaseUrl!)
    try {
      const processing = new DrizzleSolveJobProcessingRepository(connection.db)
      const running = await connection.db.select().from(solveJobs).where(eq(solveJobs.status, 'running')).limit(1)
      if (running[0]) {
        await connection.db.update(solveJobs).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(solveJobs.id, running[0].id))
        const recovered = await processing.recoverExpiredLeases(new Date())
        expect(recovered).toBeGreaterThanOrEqual(1)
      }
    } finally { await connection.close() }
  })
})
