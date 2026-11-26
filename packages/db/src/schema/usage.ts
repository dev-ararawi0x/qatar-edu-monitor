import { sql } from 'drizzle-orm'
import { bigint, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'

export const quotaBuckets = pgTable(
  'quota_buckets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    metric: text('metric').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    limitUnits: bigint('limit_units', { mode: 'number' }).notNull(),
    reservedUnits: bigint('reserved_units', { mode: 'number' }).notNull().default(0),
    consumedUnits: bigint('consumed_units', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('quota_buckets_user_metric_period_unique').on(table.userId, table.metric, table.periodStart),
    check('quota_buckets_nonnegative_check', sql`${table.limitUnits} >= 0 and ${table.reservedUnits} >= 0 and ${table.consumedUnits} >= 0`),
    check('quota_buckets_period_check', sql`${table.periodEnd} > ${table.periodStart}`),
  ],
)

export const quotaEvents = pgTable(
  'quota_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bucketId: uuid('bucket_id').notNull().references(() => quotaBuckets.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    referenceType: text('reference_type').notNull(),
    referenceId: uuid('reference_id').notNull(),
    eventType: text('event_type').notNull(),
    units: bigint('units', { mode: 'number' }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('quota_events_user_idempotency_unique').on(table.userId, table.idempotencyKey),
    check('quota_events_units_check', sql`${table.units} > 0`),
    check('quota_events_type_check', sql`${table.eventType} in ('reserve','consume','release','adjust')`),
    index('quota_events_user_created_idx').on(table.userId, table.createdAt),
  ],
)
