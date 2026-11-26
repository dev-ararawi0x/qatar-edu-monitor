import { describe, expect, it } from 'vitest'
import { createDatabase } from '../src/client'
import { DrizzleNotificationRepository } from '../src/repositories/notification-repository'
import { user } from '../src/schema/auth'

const databaseUrl = process.env.DATABASE_URL
const describeIntegration = databaseUrl ? describe : describe.skip

describeIntegration('notification repository integration', () => {
  it('stores owner-scoped notifications idempotently and marks them read', async () => {
    const connection = createDatabase(databaseUrl!)
    const suffix = crypto.randomUUID()
    const uid = `notification-test-${suffix}`
    try {
      await connection.db.insert(user).values({ id: uid, name: 'Notification Test', email: `${uid}@example.com` })
      const repository = new DrizzleNotificationRepository(connection.db)
      const input = { userId: uid, type: 'job_completed' as const, title: 'Drafts ready', body: 'Review drafts.', targetType: 'solve_job', targetId: crypto.randomUUID(), idempotencyKey: `test-${suffix}`, now: new Date() }
      const first = await repository.createIfAbsent(input)
      const second = await repository.createIfAbsent(input)
      expect(second.id).toBe(first.id)
      expect((await repository.listForUser(uid)).length).toBe(1)
      const read = await repository.markRead(uid, first.id, new Date())
      expect(read?.readAt).toBeTruthy()
      expect(await repository.markRead(`other-${uid}`, first.id, new Date())).toBeNull()
    } finally {
      await connection.close()
    }
  }, 15_000)
})
