import { createFileRoute } from '@tanstack/react-router'
import { handleApiRoute } from '~/server/api-route'
import { catalogUseCases } from '~/server/composition/lms'
import { assertJsonMutationOrigin, jsonResponse } from '~/server/http'

export const Route = createFileRoute('/api/v1/subjects/$subjectId/assessments/refresh')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleApiRoute(request, async (actor) => {
          assertJsonMutationOrigin(request, process.env.WEB_ORIGIN)
          return jsonResponse(await catalogUseCases.refreshAssessments.execute(actor, { subjectId: params.subjectId }))
        }),
    },
  },
})
