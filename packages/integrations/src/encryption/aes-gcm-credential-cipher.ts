import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { CredentialCipherPort } from '@hallili/application'
import type { EncryptedCredentialMaterial } from '@hallili/domain'

function decodeKey(value: string): Buffer {
  const base64 = Buffer.from(value, 'base64')
  if (base64.length === 32 && base64.toString('base64').replaceAll('=', '') === value.replaceAll('=', '')) return base64
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex')
  throw new Error('ENCRYPTION_KEY must be a base64 or hex encoded 32-byte key.')
}

export class AesGcmCredentialCipher implements CredentialCipherPort {
  constructor(
    keyValue: string,
    private readonly keyVersion = 1,
  ) {
    this.key = decodeKey(keyValue)
  }
  private readonly key: Buffer

  encrypt(plaintext: string, aad: string): EncryptedCredentialMaterial {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce)
    cipher.setAAD(Buffer.from(aad, 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return {
      ciphertext,
      nonce,
      authTag: cipher.getAuthTag(),
      keyVersion: this.keyVersion,
    }
  }

  decrypt(material: EncryptedCredentialMaterial, aad: string): string {
    if (material.keyVersion !== this.keyVersion) throw new Error('Unsupported credential key version.')
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(material.nonce))
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(Buffer.from(material.authTag))
    return Buffer.concat([decipher.update(Buffer.from(material.ciphertext)), decipher.final()]).toString('utf8')
  }
}
