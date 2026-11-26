import { describe, expect, it } from 'vitest'
import { apiErrorEnvelopeSchema } from '../src/index'

describe('API error contract', () => {
  it('accepts the documented safe error envelope', () => {
    expect(
      apiErrorEnvelopeSchema.parse({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields are invalid.',
          requestId: 'req_test',
        },
      }).error.code,
    ).toBe('VALIDATION_ERROR')
  })
})
