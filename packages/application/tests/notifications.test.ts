import { describe, expect, it } from 'vitest'
import { ListNotifications, MarkNotificationRead, RecordJobNotification, ownershipFixture, type NotificationRepositoryPort, type NotificationSnapshot } from '../src'

class MemoryNotifications implements NotificationRepositoryPort {
  readonly items: NotificationSnapshot[] = []
  async createIfAbsent(input: Parameters<NotificationRepositoryPort['createIfAbsent']>[0]) {
    const existing = this.items.find((item) => item.userId === input.userId && item.idempotencyKey === input.idempotencyKey)
    if (existing) return existing
    const row: NotificationSnapshot = { id: crypto.randomUUID(), ...input, readAt: null, createdAt: input.now }
    this.items.push(row)
    return row
  }
  async listForUser(userId: string) { return this.items.filter((item) => item.userId === userId) }
  async markRead(userId: string, notificationId: string, now: Date) {
    const row = this.items.find((item) => item.userId === userId && item.id === notificationId)
    if (!row) return null
    row.readAt ??= now
    return row
  }
}

const { actor } = ownershipFixture('user-a')
const clock = { now: () => new Date('2026-01-02T00:00:00.000Z') }

describe('notification use cases', () => {
  it('creates idempotent completion notifications without mutating job state', async () => {
    const repository = new MemoryNotifications()
    const useCase = new RecordJobNotification(repository, clock)
    const jobId = crypto.randomUUID()
    await useCase.execute({ userId: actor.userId, jobId, outcome: 'completed' })
    await useCase.execute({ userId: actor.userId, jobId, outcome: 'completed' })
    expect(repository.items).toHaveLength(1)
    expect(repository.items[0]?.type).toBe('job_completed')
    expect(repository.items[0]?.targetId).toBe(jobId)
  })

  it('lists only owner notifications and marks them read once', async () => {
    const repository = new MemoryNotifications()
    const created = await new RecordJobNotification(repository, clock).execute({ userId: actor.userId, jobId: crypto.randomUUID(), outcome: 'paused' })
    const list = await new ListNotifications(repository).execute(actor)
    expect(list.unreadCount).toBe(1)
    const read = await new MarkNotificationRead(repository, clock).execute(actor, created.notification.id)
    expect(read.notification.readAt).toBe('2026-01-02T00:00:00.000Z')
    await expect(new MarkNotificationRead(repository, clock).execute(ownershipFixture('user-b').actor, created.notification.id)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })
})
