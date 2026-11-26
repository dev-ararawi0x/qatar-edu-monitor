import { createFileRoute } from '@tanstack/react-router'
import { putLmsConnectionBodySchema } from '@hallili/contracts'
import { handleApiRoute } from '~/server/api-route'
import { lmsConnectionUseCases } from '~/server/composition/lms'
import { assertJsonMutationOrigin, jsonResponse, parseJsonBody } from '~/server/http'

export const Route = createFileRoute('/api/v1/lms-connection/')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handleApiRoute(request, async (actor) => {
          const result = await lmsConnectionUseCases.get.execute(actor)
          return jsonResponse(result)
        }),
      PUT: ({ request }) =>
        handleApiRoute(request, async (actor) => {
          assertJsonMutationOrigin(request, process.env.WEB_ORIGIN)
          const body = putLmsConnectionBodySchema.parse(await parseJsonBody(request, 8_192))
          await lmsConnectionUseCases.save.execute(actor, body)
          return new Response(null, { status: 204 })
        }),
      DELETE: ({ request }) =>
        handleApiRoute(request, async (actor) => {
          assertJsonMutationOrigin(request, process.env.WEB_ORIGIN)
          await lmsConnectionUseCases.revoke.execute(actor)
          return new Response(null, { status: 204 })
        }),
    },
  },
})
