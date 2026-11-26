import { ApplicationError } from '@hallili/application'
import { apiErrorEnvelopeSchema } from '@hallili/contracts'
import { ZodError } from 'zod'

const requestIdPattern = /^[A-Za-z0-9_-]{8,80}$/

export function getRequestId(request: Request): string {
  const candidate = request.headers.get('x-request-id')
  if (candidate && requestIdPattern.test(candidate)) return candidate
  return `req_${crypto.randomUUID().replaceAll('-', '')}`
}

export function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  })
}

export function apiErrorResponse(error: unknown, requestId: string): Response {
  if (error instanceof ApplicationError) {
    return jsonResponse(
      apiErrorEnvelopeSchema.parse({
        error: { code: error.code, message: error.message, requestId },
      }),
      error.status,
    )
  }

  if (error instanceof ZodError) {
    const flattened = error.flatten()
    return jsonResponse(
      apiErrorEnvelopeSchema.parse({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields are invalid.',
          requestId,
          fieldErrors: flattened.fieldErrors,
        },
      }),
      400,
    )
  }

  return jsonResponse(
    apiErrorEnvelopeSchema.parse({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The request could not be completed safely.',
        requestId,
      },
    }),
    500,
  )
}

export async function parseJsonBody(request: Request, maximumBytes = 16_384): Promise<unknown> {
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number(contentLength) > maximumBytes) {
    throw new ApplicationError('BAD_REQUEST', 'The request body is too large.', 400)
  }
  try {
    return await request.json()
  } catch {
    throw new ApplicationError('BAD_REQUEST', 'The request body must be valid JSON.', 400)
  }
}

export function assertJsonMutationOrigin(request: Request, allowedOrigin: string | undefined) {
  if (!allowedOrigin) return
  const origin = request.headers.get('origin')
  if (origin && origin !== allowedOrigin) {
    throw new ApplicationError('FORBIDDEN', 'The request origin is not allowed.', 403)
  }
}
