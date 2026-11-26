import type { ActorContext } from './index'
import { ApplicationError } from './index'

export function assertResourceOwner(actor: ActorContext, ownerUserId: string): void {
  if (actor.userId !== ownerUserId) {
    throw new ApplicationError('NOT_FOUND', 'The requested resource was not found.', 404)
  }
}

export function ownershipFixture(actorUserId: string, resourceOwnerId = actorUserId) {
  return {
    actor: { userId: actorUserId as ActorContext['userId'] },
    ownerUserId: resourceOwnerId,
  }
}
