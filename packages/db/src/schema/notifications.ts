import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('notifications_user_idempotency_unique').on(table.userId, table.idempotencyKey),
    index('notifications_user_created_idx').on(table.userId, table.createdAt),
    index('notifications_user_unread_idx').on(table.userId, table.readAt),
    check('notifications_type_check', sql`${table.type} in ('job_completed','job_paused','job_failed')`),
  ],
)
