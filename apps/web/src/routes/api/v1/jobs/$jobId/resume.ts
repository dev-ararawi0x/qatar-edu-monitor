import { createFileRoute } from '@tanstack/react-router'
import { handleApiRoute } from '~/server/api-route'
import { solvingUseCases } from '~/server/composition/lms'
import { assertJsonMutationOrigin, jsonResponse } from '~/server/http'

export const Route = createFileRoute('/api/v1/jobs/$jobId/resume')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleApiRoute(request, async (actor) => {
          assertJsonMutationOrigin(request, process.env.WEB_ORIGIN)
          return jsonResponse(await solvingUseCases.resume.execute(actor, params.jobId), 202)
        }),
    },
  },
})
