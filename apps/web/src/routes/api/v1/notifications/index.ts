import { createFileRoute } from '@tanstack/react-router'
import { handleApiRoute } from '~/server/api-route'
import { notificationUseCases } from '~/server/composition/lms'
import { jsonResponse } from '~/server/http'

export const Route = createFileRoute('/api/v1/notifications/')({
  server: {
    handlers: {
      GET: ({ request }) => handleApiRoute(request, async (actor) => jsonResponse(await notificationUseCases.list.execute(actor))),
    },
  },
})
