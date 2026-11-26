import { describe, expect, it } from 'vitest'
import { createDatabase } from '../src/index'

describe('database package', () => {
  it('creates a lazy PostgreSQL client boundary without connecting during construction', () => {
    const connection = createDatabase('postgres://hallili:hallili@localhost:5432/hallili')
    expect(connection.db).toBeDefined()
    return connection.close()
  })
})
