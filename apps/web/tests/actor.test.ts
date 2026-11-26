import { describe, expect, it } from 'vitest'
import { requireActorFromRequest, resolveActor } from '../src/server/actor'

describe('actor resolution', () => {
  it('returns null when signed out', async () => {
    await expect(resolveActor(new Headers(), { getSession: async () => null })).resolves.toBeNull()
  })

  it('creates an actor context from a server-side session', async () => {
    await expect(
      requireActorFromRequest(new Request('http://x'), {
        getSession: async () => ({ user: { id: 'user-1' } }),
      }),
    ).resolves.toEqual({ userId: 'user-1' })
  })

  it('rejects protected operations when signed out', async () => {
    await expect(
      requireActorFromRequest(new Request('http://x'), { getSession: async () => null }),
    ).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    })
  })
})
