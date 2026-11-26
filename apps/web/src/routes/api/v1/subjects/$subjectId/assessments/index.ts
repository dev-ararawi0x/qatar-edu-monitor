import { createFileRoute } from '@tanstack/react-router'
import { assessmentListQuerySchema } from '@hallili/contracts'
import { handleApiRoute } from '~/server/api-route'
import { catalogUseCases } from '~/server/composition/lms'
import { jsonResponse } from '~/server/http'

export const Route = createFileRoute('/api/v1/subjects/$subjectId/assessments/')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleApiRoute(request, async (actor) => {
          const query = assessmentListQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
          return jsonResponse(await catalogUseCases.listAssessments.execute(actor, { subjectId: params.subjectId, dueOnly: query.dueOnly }))
        }),
    },
  },
})
