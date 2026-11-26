import { createFileRoute } from '@tanstack/react-router'
import { reviewDraftBodySchema } from '@hallili/contracts'
import { handleApiRoute } from '~/server/api-route'
import { draftUseCases } from '~/server/composition/lms'
import { assertJsonMutationOrigin, jsonResponse, parseJsonBody } from '~/server/http'

export const Route = createFileRoute('/api/v1/drafts/$draftId/review')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleApiRoute(request, async (actor) => {
          assertJsonMutationOrigin(request, process.env.WEB_ORIGIN)
          const body = reviewDraftBodySchema.parse(await parseJsonBody(request, 4_096))
          return jsonResponse(await draftUseCases.review.execute(actor, { draftId: params.draftId, ...body }))
        }),
    },
  },
})
