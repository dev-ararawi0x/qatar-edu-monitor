import { createFileRoute } from '@tanstack/react-router'
import { updateDraftBodySchema } from '@hallili/contracts'
import { handleApiRoute } from '~/server/api-route'
import { draftUseCases } from '~/server/composition/lms'
import { assertJsonMutationOrigin, jsonResponse, parseJsonBody } from '~/server/http'

export const Route = createFileRoute('/api/v1/drafts/$draftId/')({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        handleApiRoute(request, async (actor) => {
          assertJsonMutationOrigin(request, process.env.WEB_ORIGIN)
          const body = updateDraftBodySchema.parse(await parseJsonBody(request, 16_384))
          return jsonResponse(await draftUseCases.update.execute(actor, { draftId: params.draftId, ...body }))
        }),
    },
  },
})
