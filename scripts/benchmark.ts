import { performance } from 'node:perf_hooks'
import { writeFile } from 'node:fs/promises'
import { createDatabase, PostgresJobQueue, DrizzleSolveJobRepository, schema } from '@hallili/db'

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0
}
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required for benchmarks.')
const connection = createDatabase(databaseUrl)
const suffix = crypto.randomUUID()
const uid = `bench-${suffix}`
try {
  await connection.db.insert(schema.user).values({ id: uid, name: 'Benchmark', email: `${uid}@example.com` })
  const conn = await connection.db.insert(schema.lmsConnections).values({ userId: uid, status: 'valid', cookieCiphertext: Buffer.from('x'), cookieNonce: Buffer.alloc(12), cookieAuthTag: Buffer.alloc(16), keyVersion: 1 }).returning()
  const subj = await connection.db.insert(schema.subjects).values({ lmsConnectionId: conn[0]!.id, externalSubjectId: `s-${suffix}`, name: 'Benchmark Subject', lastSyncedAt: new Date() }).returning()
  const assess = await connection.db.insert(schema.assessments).values({ subjectId: subj[0]!.id, externalAssessmentId: `a-${suffix}`, title: 'Benchmark Assessment', timedQuizStatus: 'no', lastSyncedAt: new Date(), safeMetadata: {} }).returning()
  const attempts = []
  for (let index = 0; index < 20; index += 1) {
    const rows = await connection.db.insert(schema.assessmentAttempts).values({ userId: uid, assessmentId: assess[0]!.id, lmsQuizId: `q-${suffix}-${index}`, lmsResultsId: `r-${suffix}-${index}`, timedQuizStatus: 'no', lastSeenAt: new Date() }).returning()
    attempts.push({ id: rows[0]!.id, userId: uid, assessmentId: assess[0]!.id, lmsQuizId: `q-${suffix}-${index}`, lmsResultsId: `r-${suffix}-${index}`, timedQuizStatus: 'no' as const, sourceStatus: null, lastSeenAt: new Date() })
  }
  const repository = new DrizzleSolveJobRepository(connection.db)
  const createStart = performance.now()
  const receipts = await repository.createJobsAtomically({ userId: uid, idempotencyKey: `bench-${suffix}`, attempts, now: new Date(), quotaLimit: 100 })
  const createMs = performance.now() - createStart
  const queue = new PostgresJobQueue(connection.db)
  const claimLatencies: number[] = []
  for (const receipt of receipts) {
    const start = performance.now()
    const claimed = await queue.claimNext({ workerId: 'benchmark-worker', now: new Date(), leaseMs: 30_000 })
    claimLatencies.push(performance.now() - start)
    if (!claimed || claimed.id !== receipt.job.id) throw new Error('Benchmark claim order mismatch.')
  }
  const readLatencies: number[] = []
  for (const receipt of receipts) {
    const start = performance.now()
    await repository.findOwnedJob(uid, receipt.job.id)
    readLatencies.push(performance.now() - start)
  }
  const result = {
    profile: 'local single PostgreSQL container, Node 22, fake fixture workload, 20 assessments',
    measuredAt: new Date().toISOString(),
    transactionalCreate20JobsMs: Number(createMs.toFixed(2)),
    queueClaimMs: { p50: Number(percentile(claimLatencies, 50).toFixed(2)), p95: Number(percentile(claimLatencies, 95).toFixed(2)), p99: Number(percentile(claimLatencies, 99).toFixed(2)) },
    ownerJobReadMs: { p50: Number(percentile(readLatencies, 50).toFixed(2)), p95: Number(percentile(readLatencies, 95).toFixed(2)), p99: Number(percentile(readLatencies, 99).toFixed(2)) },
    nfrAssessment: {
      enqueueHttp300ms: 'not-proven: measured transactional repository create, not HTTP request-to-202',
      statusRead300ms: 'not-proven: measured owner repository read, not authenticated HTTP response',
      tenQuestionJob45s: 'blocked: requires approved provider/workload profile and representative fixtures',
      extraction98Percent: 'blocked: H-083 approved fixture corpus is unavailable',
    },
    caveat: 'Local-container baseline only; production NFR sign-off requires HTTP, provider, deployment-environment, and approved-fixture measurement.',
  }
  await writeFile('docs/operations/benchmark-results.json', JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally {
  await connection.close()
}
