import { createFileRoute } from '@tanstack/react-router'
import { handleApiRoute } from '~/server/api-route'
import { draftUseCases } from '~/server/composition/lms'
import { jsonResponse } from '~/server/http'

export const Route = createFileRoute('/api/v1/jobs/$jobId/questions')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleApiRoute(request, async (actor) => jsonResponse(await draftUseCases.questions.execute(actor, params.jobId))),
    },
  },
})
