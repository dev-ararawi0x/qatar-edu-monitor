import { createFileRoute } from '@tanstack/react-router'
import { handleApiRoute } from '~/server/api-route'
import { solvingUseCases } from '~/server/composition/lms'
import { jsonResponse } from '~/server/http'

export const Route = createFileRoute('/api/v1/jobs/$jobId/')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleApiRoute(request, async (actor) => jsonResponse(await solvingUseCases.get.execute(actor, params.jobId))),
    },
  },
})
