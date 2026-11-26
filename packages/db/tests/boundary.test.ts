import { describe, expect, it } from 'vitest'
import { databasePackageBoundary } from '../src/index'

describe('database package', () => {
  it('has a stable package boundary marker during foundation setup', () => {
    expect(databasePackageBoundary).toBe('@hallili/db')
  })
})
