import { describe, expect, it } from 'vitest'
import { requireActor } from '../src/index'

describe('requireActor', () => {
  it('rejects absent actors with a stable unauthenticated error', () => {
    expect(() => requireActor(null)).toThrowError(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }),
    )
  })
})
