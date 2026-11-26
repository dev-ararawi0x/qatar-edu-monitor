import { describe, expect, it } from 'vitest'
import { DomainError } from '../src/index'

describe('DomainError', () => {
  it('carries a stable machine-readable code', () => {
    const error = new DomainError('EXAMPLE', 'safe message')
    expect(error.code).toBe('EXAMPLE')
    expect(error.message).toBe('safe message')
  })
})
