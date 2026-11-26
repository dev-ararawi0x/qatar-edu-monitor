import { ApplicationError } from '@hallili/application'
import { describe, expect, it } from 'vitest'
import { apiErrorResponse, getRequestId } from '../src/server/http'

describe('API error envelope', () => {
  it('maps application errors to stable safe envelopes', async () => {
    const response = apiErrorResponse(
      new ApplicationError('FORBIDDEN', 'Not allowed.', 403),
      'req_test',
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'FORBIDDEN', message: 'Not allowed.', requestId: 'req_test' },
    })
  })

  it('hides raw internal exception details', async () => {
    const response = apiErrorResponse(new Error('database password=secret'), 'req_test')
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(body)).not.toContain('secret')
  })

  it('accepts safe incoming request IDs and generates missing ones', () => {
    expect(
      getRequestId(new Request('http://x', { headers: { 'x-request-id': 'req_abcd1234' } })),
    ).toBe('req_abcd1234')
    expect(getRequestId(new Request('http://x'))).toMatch(/^req_[a-f0-9]{32}$/)
  })
})
