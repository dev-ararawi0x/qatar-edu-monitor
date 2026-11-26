import { createFileRoute } from '@tanstack/react-router'
import { createSolveJobsBodySchema, idempotencyKeyHeaderSchema } from '@hallili/contracts'
import { ApplicationError } from '@hallili/application'
import { handleApiRoute } from '~/server/api-route'
import { solvingUseCases } from '~/server/composition/lms'
import { assertJsonMutationOrigin, jsonResponse, parseJsonBody } from '~/server/http'

export const Route = createFileRoute('/api/v1/jobs/solve')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleApiRoute(request, async (actor) => {
          assertJsonMutationOrigin(request, process.env.WEB_ORIGIN)
          const idempotencyKey = request.headers.get('idempotency-key')
          if (!idempotencyKey || !idempotencyKeyHeaderSchema.safeParse(idempotencyKey).success) {
            throw new ApplicationError('VALIDATION_ERROR', 'A valid Idempotency-Key header is required.', 400)
          }
          const body = createSolveJobsBodySchema.parse(await parseJsonBody(request, 8_192))
          const result = await solvingUseCases.create.execute(actor, { attemptIds: body.attemptIds, idempotencyKey, timedAssessmentAcknowledgement: body.timedAssessmentAcknowledgement })
          return jsonResponse(result, 202)
        }),
    },
  },
})
