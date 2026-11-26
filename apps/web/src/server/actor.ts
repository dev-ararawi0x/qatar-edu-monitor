import type { ActorContext } from '@hallili/application'
import { ApplicationError, requireActor } from '@hallili/application'
import type { UserId } from '@hallili/domain'

export interface SessionLookup {
  getSession(input: { headers: Headers }): Promise<{ user?: { id?: string } } | null>
}

export async function resolveActor(
  headers: Headers,
  lookup: SessionLookup,
): Promise<ActorContext | null> {
  const session = await lookup.getSession({ headers })
  const userId = session?.user?.id
  return userId ? { userId: userId as UserId } : null
}

export async function requireActorFromRequest(
  request: Request,
  lookup: SessionLookup,
): Promise<ActorContext> {
  const actor = await resolveActor(request.headers, lookup)
  if (!actor) {
    throw new ApplicationError('UNAUTHENTICATED', 'Authentication is required.', 401)
  }
  return requireActor(actor)
}

export async function requireBetterAuthActor(request: Request): Promise<ActorContext> {
  const { auth } = await import('./auth')
  return requireActorFromRequest(request, auth.api)
}
