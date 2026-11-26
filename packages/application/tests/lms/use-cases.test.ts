import { describe, expect, it } from 'vitest'
import { RevokeLmsConnection, SaveLmsCredential, ValidateLmsConnection } from '../../src/lms/use-cases'
import type { LmsCredentialRepositoryPort, StoredLmsConnection } from '../../src/lms/ports'

class MemoryRepository implements LmsCredentialRepositoryPort {
  row: StoredLmsConnection | null = null
  async findByUserId(userId: string) { return this.row?.userId === userId ? this.row : null }
  async save(input: Parameters<LmsCredentialRepositoryPort['save']>[0]) {
    this.row = {
      id: 'connection-1', userId: input.userId, status: input.status,
      credentialExpiresAt: null, lastValidatedAt: null, lastRotatedAt: null, revokedAt: null,
      encryptedCredential: input.encryptedCredential,
    }
    return this.row
  }
  async markValidated(input: { userId: string; status: 'valid' | 'expired' | 'blocked' | 'unknown'; validatedAt: Date }) {
    if (this.row) { this.row.status = input.status; this.row.lastValidatedAt = input.validatedAt }
  }
  async revoke(userId: string, revokedAt: Date) {
    if (this.row?.userId === userId) { this.row.status = 'revoked'; this.row.revokedAt = revokedAt; this.row.encryptedCredential = null }
  }
}

const cipher = {
  encrypt: (value: string) => ({ ciphertext: new TextEncoder().encode(value), nonce: new Uint8Array(12), authTag: new Uint8Array(16), keyVersion: 1 }),
  decrypt: (material: { ciphertext: Uint8Array }) => new TextDecoder().decode(material.ciphertext),
}
const actor = { userId: 'user-1' as never }

describe('LMS connection use cases', () => {
  it('encrypts and never returns credential material', async () => {
    const repo = new MemoryRepository()
    const result = await new SaveLmsCredential(repo, cipher, { uuid: () => 'connection-1' }).execute(actor, { cookieValue: 'secret' })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(repo.row?.encryptedCredential).toBeTruthy()
  })

  it('validates through the narrow LMS port and stores only metadata', async () => {
    const repo = new MemoryRepository()
    await new SaveLmsCredential(repo, cipher, { uuid: () => 'connection-1' }).execute(actor, { cookieValue: 'secret' })
    const result = await new ValidateLmsConnection(repo, cipher, { validateSession: async () => ({ kind: 'valid' }), listSubjects: async () => [], listAssessments: async () => [] }, { now: () => new Date('2030-01-01T00:00:00Z') }).execute(actor)
    expect(result.status).toBe('valid')
    expect(repo.row?.status).toBe('valid')
  })

  it('revokes and wipes ciphertext', async () => {
    const repo = new MemoryRepository()
    await new SaveLmsCredential(repo, cipher, { uuid: () => 'connection-1' }).execute(actor, { cookieValue: 'secret' })
    await new RevokeLmsConnection(repo, { now: () => new Date() }).execute(actor)
    expect(repo.row?.encryptedCredential).toBeNull()
    expect(repo.row?.status).toBe('revoked')
  })
})
