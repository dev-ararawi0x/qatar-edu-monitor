import { describe, expect, it } from 'vitest'
import { parseRuntimeEnv } from '../src/runtime/env'

describe('parseRuntimeEnv', () => {
  it('fails closed when critical configuration is missing', () => {
    expect(() => parseRuntimeEnv({})).toThrow(/DATABASE_URL|ENCRYPTION_KEY/)
  })

  it('accepts complete safe configuration', () => {
    expect(
      parseRuntimeEnv({
        DATABASE_URL: 'postgres://hallili:hallili@localhost:5432/hallili',
        ENCRYPTION_KEY: 'local-test-key',
      }).AI_PROVIDER,
    ).toBe('fake')
  })
})
