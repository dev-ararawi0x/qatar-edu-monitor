import type { NotificationRepositoryPort, NotificationSnapshot } from '@hallili/application'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { HalliliDatabase } from '../client'
import { notifications } from '../schema/notifications'

type Row = typeof notifications.$inferSelect
function snapshot(row: Row): NotificationSnapshot {
  return { id: row.id, userId: row.userId, type: row.type as NotificationSnapshot['type'], title: row.title, body: row.body, targetType: row.targetType, targetId: row.targetId, idempotencyKey: row.idempotencyKey, readAt: row.readAt, createdAt: row.createdAt }
}

export class DrizzleNotificationRepository implements NotificationRepositoryPort {
  constructor(private readonly db: HalliliDatabase) {}

  async createIfAbsent(input: Parameters<NotificationRepositoryPort['createIfAbsent']>[0]) {
    const inserted = await this.db.insert(notifications).values({ userId: input.userId, type: input.type, title: input.title, body: input.body, targetType: input.targetType, targetId: input.targetId, idempotencyKey: input.idempotencyKey, createdAt: input.now }).onConflictDoNothing().returning()
    const row = inserted[0] ?? (await this.db.select().from(notifications).where(and(eq(notifications.userId, input.userId), eq(notifications.idempotencyKey, input.idempotencyKey))).limit(1))[0]
    if (!row) throw new Error('Notification could not be persisted.')
    return snapshot(row)
  }

  async listForUser(userId: string) {
    const rows = await this.db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(100)
    return rows.map(snapshot)
  }

  async markRead(userId: string, notificationId: string, now: Date) {
    const rows = await this.db.update(notifications).set({ readAt: now }).where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId), isNull(notifications.readAt))).returning()
    const row = rows[0] ?? (await this.db.select().from(notifications).where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId))).limit(1))[0]
    return row ? snapshot(row) : null
  }
}
