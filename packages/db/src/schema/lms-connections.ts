import { sql } from 'drizzle-orm'
import { check, customType, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

export const lmsConnections = pgTable(
  'lms_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('unverified'),
    cookieCiphertext: bytea('cookie_ciphertext'),
    cookieNonce: bytea('cookie_nonce'),
    cookieAuthTag: bytea('cookie_auth_tag'),
    keyVersion: integer('key_version'),
    credentialExpiresAt: timestamp('credential_expires_at', { withTimezone: true }),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
    lastRotatedAt: timestamp('last_rotated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('lms_connections_user_id_unique').on(table.userId),
    check(
      'lms_connections_status_check',
      sql`${table.status} in ('unverified','valid','expired','blocked','revoked','unknown')`,
    ),
    check(
      'lms_connections_encrypted_all_or_none',
      sql`((${table.cookieCiphertext} is null and ${table.cookieNonce} is null and ${table.cookieAuthTag} is null and ${table.keyVersion} is null) or (${table.cookieCiphertext} is not null and ${table.cookieNonce} is not null and ${table.cookieAuthTag} is not null and ${table.keyVersion} is not null))`,
    ),
  ],
)
