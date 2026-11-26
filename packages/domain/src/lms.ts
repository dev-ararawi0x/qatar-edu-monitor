export const lmsConnectionStatuses = [
  'unverified',
  'valid',
  'expired',
  'blocked',
  'revoked',
  'unknown',
] as const
export type LmsConnectionStatus = (typeof lmsConnectionStatuses)[number]

export interface EncryptedCredentialMaterial {
  ciphertext: Uint8Array
  nonce: Uint8Array
  authTag: Uint8Array
  keyVersion: number
}

export interface LmsConnectionSnapshot {
  id: string
  userId: string
  status: LmsConnectionStatus
  credentialExpiresAt: Date | null
  lastValidatedAt: Date | null
  lastRotatedAt: Date | null
  revokedAt: Date | null
}
