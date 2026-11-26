import { createFileRoute } from '@tanstack/react-router'
import { jobListQuerySchema } from '@hallili/contracts'
import { handleApiRoute } from '~/server/api-route'
import { solvingUseCases } from '~/server/composition/lms'
import { jsonResponse } from '~/server/http'

export const Route = createFileRoute('/api/v1/jobs/')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handleApiRoute(request, async (actor) => {
          const query = jobListQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
          return jsonResponse(await solvingUseCases.list.execute(actor, { status: query.status }))
        }),
    },
  },
})
