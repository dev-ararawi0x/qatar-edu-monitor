import { describe, expect, it } from 'vitest'
import { AesGcmCredentialCipher } from '../../src/encryption/aes-gcm-credential-cipher'

const key = Buffer.alloc(32, 7).toString('base64')

describe('AesGcmCredentialCipher', () => {
  it('roundtrips plaintext with owner-bound AAD', () => {
    const cipher = new AesGcmCredentialCipher(key)
    const encrypted = cipher.encrypt('secret-cookie', 'user-1:connection-1')
    expect(encrypted.nonce).toHaveLength(12)
    expect(cipher.decrypt(encrypted, 'user-1:connection-1')).toBe('secret-cookie')
  })

  it('rejects tampering and wrong AAD', () => {
    const cipher = new AesGcmCredentialCipher(key)
    const encrypted = cipher.encrypt('secret-cookie', 'user-1:connection-1')
    expect(() => cipher.decrypt(encrypted, 'user-2:connection-1')).toThrow()
    const tampered = { ...encrypted, ciphertext: Buffer.from(encrypted.ciphertext).map((v, i) => (i === 0 ? v ^ 1 : v)) }
    expect(() => cipher.decrypt(tampered, 'user-1:connection-1')).toThrow()
  })

  it('uses unique nonces and rejects wrong key versions', () => {
    const cipher = new AesGcmCredentialCipher(key)
    const one = cipher.encrypt('same', 'aad')
    const two = cipher.encrypt('same', 'aad')
    expect(Buffer.from(one.nonce).equals(Buffer.from(two.nonce))).toBe(false)
    expect(() => cipher.decrypt({ ...one, keyVersion: 2 }, 'aad')).toThrow(/key version/)
  })
})
