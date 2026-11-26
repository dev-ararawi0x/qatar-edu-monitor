import { createFileRoute } from '@tanstack/react-router'
import { handleApiRoute } from '~/server/api-route'
import { catalogUseCases } from '~/server/composition/lms'
import { jsonResponse } from '~/server/http'

export const Route = createFileRoute('/api/v1/subjects/')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handleApiRoute(request, async (actor) => jsonResponse(await catalogUseCases.listSubjects.execute(actor))),
    },
  },
})
