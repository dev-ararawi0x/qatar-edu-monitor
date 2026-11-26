import { createFileRoute } from '@tanstack/react-router'
import { handleApiRoute } from '~/server/api-route'
import { lmsConnectionUseCases } from '~/server/composition/lms'
import { assertJsonMutationOrigin, jsonResponse } from '~/server/http'

export const Route = createFileRoute('/api/v1/lms-connection/validate')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleApiRoute(request, async (actor) => {
          assertJsonMutationOrigin(request, process.env.WEB_ORIGIN)
          const result = await lmsConnectionUseCases.validate.execute(actor)
          return jsonResponse(result)
        }),
    },
  },
})
