import type { LmsCredentialRepositoryPort, StoredLmsConnection } from '@hallili/application'
import type { EncryptedCredentialMaterial, LmsConnectionStatus } from '@hallili/domain'
import { eq } from 'drizzle-orm'
import type { HalliliDatabase } from '../client'
import { lmsConnections } from '../schema/lms-connections'

type Row = typeof lmsConnections.$inferSelect

function materialFromRow(row: Row): EncryptedCredentialMaterial | null {
  if (!row.cookieCiphertext || !row.cookieNonce || !row.cookieAuthTag || row.keyVersion == null) return null
  return {
    ciphertext: row.cookieCiphertext,
    nonce: row.cookieNonce,
    authTag: row.cookieAuthTag,
    keyVersion: row.keyVersion,
  }
}

function toStored(row: Row): StoredLmsConnection {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status as LmsConnectionStatus,
    credentialExpiresAt: row.credentialExpiresAt,
    lastValidatedAt: row.lastValidatedAt,
    lastRotatedAt: row.lastRotatedAt,
    revokedAt: row.revokedAt,
    encryptedCredential: materialFromRow(row),
  }
}

export class DrizzleLmsCredentialRepository implements LmsCredentialRepositoryPort {
  constructor(private readonly db: HalliliDatabase) {}

  async findByUserId(userId: string) {
    const rows = await this.db.select().from(lmsConnections).where(eq(lmsConnections.userId, userId)).limit(1)
    return rows[0] ? toStored(rows[0]) : null
  }

  async save(input: {
    userId: string
    encryptedCredential: EncryptedCredentialMaterial
    status: LmsConnectionStatus
  }) {
    const now = new Date()
    const values = {
      userId: input.userId,
      status: input.status,
      cookieCiphertext: Buffer.from(input.encryptedCredential.ciphertext),
      cookieNonce: Buffer.from(input.encryptedCredential.nonce),
      cookieAuthTag: Buffer.from(input.encryptedCredential.authTag),
      keyVersion: input.encryptedCredential.keyVersion,
      updatedAt: now,
      revokedAt: null,
    }
    const rows = await this.db
      .insert(lmsConnections)
      .values(values)
      .onConflictDoUpdate({
        target: lmsConnections.userId,
        set: {
          status: values.status,
          cookieCiphertext: values.cookieCiphertext,
          cookieNonce: values.cookieNonce,
          cookieAuthTag: values.cookieAuthTag,
          keyVersion: values.keyVersion,
          revokedAt: null,
          updatedAt: now,
        },
      })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('LMS connection save returned no row.')
    return toStored(row)
  }

  async markValidated(input: {
    userId: string
    status: 'valid' | 'expired' | 'blocked' | 'unknown'
    validatedAt: Date
  }) {
    await this.db
      .update(lmsConnections)
      .set({ status: input.status, lastValidatedAt: input.validatedAt, updatedAt: input.validatedAt })
      .where(eq(lmsConnections.userId, input.userId))
  }

  async revoke(userId: string, revokedAt: Date) {
    await this.db
      .update(lmsConnections)
      .set({
        status: 'revoked',
        cookieCiphertext: null,
        cookieNonce: null,
        cookieAuthTag: null,
        keyVersion: null,
        revokedAt,
        updatedAt: revokedAt,
      })
      .where(eq(lmsConnections.userId, userId))
  }
}
