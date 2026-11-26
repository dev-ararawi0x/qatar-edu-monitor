import { createFileRoute } from '@tanstack/react-router'
import { handleApiRoute } from '~/server/api-route'
import { notificationUseCases } from '~/server/composition/lms'
import { assertJsonMutationOrigin, jsonResponse } from '~/server/http'

export const Route = createFileRoute('/api/v1/notifications/$notificationId/read')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleApiRoute(request, async (actor) => {
          assertJsonMutationOrigin(request, process.env.WEB_ORIGIN)
          return jsonResponse(await notificationUseCases.markRead.execute(actor, params.notificationId))
        }),
    },
  },
})
