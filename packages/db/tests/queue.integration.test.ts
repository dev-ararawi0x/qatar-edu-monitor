import { describe, expect, it } from 'vitest'
import { createDatabase } from '../src/client'
import { PostgresJobQueue } from '../src/queue/postgres-job-queue'
import { DrizzleSolveJobRepository } from '../src/repositories/solve-job-repository'
import { user } from '../src/schema/auth'
import { subjects, assessments } from '../src/schema/catalog'
import { lmsConnections } from '../src/schema/lms-connections'
import { assessmentAttempts } from '../src/schema/solving'

const databaseUrl = process.env.DATABASE_URL
const describeIntegration = databaseUrl ? describe : describe.skip

describeIntegration('PostgreSQL job queue integration', () => {
  it('claims one job for only one concurrent worker', async () => {
    const connection = createDatabase(databaseUrl!)
    const suffix = crypto.randomUUID()
    const uid = `queue-test-${suffix}`
    try {
      await connection.db.insert(user).values({ id: uid, name: 'Queue Test', email: `${uid}@example.com` })
      const conn = await connection.db.insert(lmsConnections).values({ userId: uid, status: 'valid', cookieCiphertext: Buffer.from('x'), cookieNonce: Buffer.alloc(12), cookieAuthTag: Buffer.alloc(16), keyVersion: 1 }).returning()
      const subj = await connection.db.insert(subjects).values({ lmsConnectionId: conn[0]!.id, externalSubjectId: `s-${suffix}`, name: 'Queue Subject', lastSyncedAt: new Date() }).returning()
      const assess = await connection.db.insert(assessments).values({ subjectId: subj[0]!.id, externalAssessmentId: `a-${suffix}`, title: 'Queue Assessment', timedQuizStatus: 'no', lastSyncedAt: new Date(), safeMetadata: {} }).returning()
      const att = await connection.db.insert(assessmentAttempts).values({ userId: uid, assessmentId: assess[0]!.id, lmsQuizId: `q-${suffix}`, lmsResultsId: `r-${suffix}`, timedQuizStatus: 'no', lastSeenAt: new Date() }).returning()
      const repository = new DrizzleSolveJobRepository(connection.db)
      await repository.createJobsAtomically({ userId: uid, idempotencyKey: `test-${suffix}`, attempts: [{ id: att[0]!.id, userId: uid, assessmentId: assess[0]!.id, lmsQuizId: `q-${suffix}`, lmsResultsId: `r-${suffix}`, timedQuizStatus: 'no', sourceStatus: null, lastSeenAt: new Date() }], now: new Date(), quotaLimit: 10 })
      const queue = new PostgresJobQueue(connection.db)
      const [one, two] = await Promise.all([
        queue.claimNext({ workerId: 'worker-a', now: new Date(), leaseMs: 30_000 }),
        queue.claimNext({ workerId: 'worker-b', now: new Date(), leaseMs: 30_000 }),
      ])
      if (one && two) expect(one.id).not.toBe(two.id)
      expect(one ?? two).toBeTruthy()
    } finally {
      await connection.close()
    }
  }, 15_000)

  it('does not oversubscribe quota under concurrent reservation', async () => {
    const connection = createDatabase(databaseUrl!)
    const suffix = crypto.randomUUID()
    const uid = `quota-test-${suffix}`
    try {
      await connection.db.insert(user).values({ id: uid, name: 'Quota Test', email: `${uid}@example.com` })
      const conn = await connection.db.insert(lmsConnections).values({ userId: uid, status: 'valid', cookieCiphertext: Buffer.from('x'), cookieNonce: Buffer.alloc(12), cookieAuthTag: Buffer.alloc(16), keyVersion: 1 }).returning()
      const subj = await connection.db.insert(subjects).values({ lmsConnectionId: conn[0]!.id, externalSubjectId: `s-${suffix}`, name: 'Quota Subject', lastSyncedAt: new Date() }).returning()
      const assess = await connection.db.insert(assessments).values({ subjectId: subj[0]!.id, externalAssessmentId: `a-${suffix}`, title: 'Quota Assessment', timedQuizStatus: 'no', lastSyncedAt: new Date(), safeMetadata: {} }).returning()
      const attempts = []
      for (const number of [1, 2]) {
        const rows = await connection.db.insert(assessmentAttempts).values({ userId: uid, assessmentId: assess[0]!.id, lmsQuizId: `q-${suffix}-${number}`, lmsResultsId: `r-${suffix}-${number}`, timedQuizStatus: 'no', lastSeenAt: new Date() }).returning()
        attempts.push({ id: rows[0]!.id, userId: uid, assessmentId: assess[0]!.id, lmsQuizId: `q-${suffix}-${number}`, lmsResultsId: `r-${suffix}-${number}`, timedQuizStatus: 'no' as const, sourceStatus: null, lastSeenAt: new Date() })
      }
      const repository = new DrizzleSolveJobRepository(connection.db)
      const results = await Promise.allSettled(attempts.map((item, index) => repository.createJobsAtomically({ userId: uid, idempotencyKey: `quota-${suffix}-${index}`, attempts: [item], now: new Date(), quotaLimit: 1 })))
      expect(results.filter((result) => result.status === 'fulfilled').length).toBeLessThanOrEqual(1)
      expect(results.some((result) => result.status === 'rejected')).toBe(true)
    } finally {
      await connection.close()
    }
  }, 15_000)
})
