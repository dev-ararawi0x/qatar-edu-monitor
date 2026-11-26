import { numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { lmsConnections } from './lms-connections'

export const lmsAccountLeases = pgTable('lms_account_leases', {
  lmsConnectionId: uuid('lms_connection_id').primaryKey().references(() => lmsConnections.id, { onDelete: 'cascade' }),
  ownerToken: uuid('owner_token').notNull(),
  workerId: text('worker_id').notNull(),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }).notNull(),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const integrationRateLimitState = pgTable('integration_rate_limit_state', {
  bucketKey: text('bucket_key').primaryKey(),
  tokens: numeric('tokens', { precision: 12, scale: 4 }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  blockedUntil: timestamp('blocked_until', { withTimezone: true }),
})
