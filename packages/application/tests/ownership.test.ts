import { describe, expect, it } from 'vitest'
import { assertResourceOwner, ownershipFixture } from '../src/ownership'

describe('ownership test helpers', () => {
  it('allows matching owners', () => {
    const { actor, ownerUserId } = ownershipFixture('user-a')
    expect(() => assertResourceOwner(actor, ownerUserId)).not.toThrow()
  })

  it('uses not-found for cross-user access to avoid disclosure', () => {
    const { actor } = ownershipFixture('user-a')
    expect(() => assertResourceOwner(actor, 'user-b')).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND', status: 404 }),
    )
  })
})
