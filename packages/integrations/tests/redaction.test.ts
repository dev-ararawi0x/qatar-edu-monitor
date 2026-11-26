import { describe, expect, it } from 'vitest'
import { redactSecrets } from '../src/runtime/redaction'

describe('redactSecrets', () => {
  it('redacts sensitive keys recursively', () => {
    expect(
      redactSecrets({
        cookieValue: 'secret-cookie',
        nested: { csrfToken: 'csrf', safe: 'visible' },
      }),
    ).toEqual({
      cookieValue: 'VALUES',
      nested: { csrfToken: 'VALUES', safe: 'visible' },
    })
  })

  it('does not leak nested credential-like keys in arrays', () => {
    expect(redactSecrets({ items: [{ password: 'pw' }] })).toEqual({
      items: [{ password: 'VALUES' }],
    })
  })
})
