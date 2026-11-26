import type { ApplicationError } from '@hallili/application'
import { apiErrorResponse, getRequestId } from './http'
import { requireBetterAuthActor } from './actor'

export async function handleApiRoute(
  request: Request,
  handler: (actor: Awaited<ReturnType<typeof requireBetterAuthActor>>) => Promise<Response>,
): Promise<Response> {
  const requestId = getRequestId(request)
  try {
    const actor = await requireBetterAuthActor(request)
    return await handler(actor)
  } catch (error) {
    return apiErrorResponse(error as ApplicationError, requestId)
  }
}
