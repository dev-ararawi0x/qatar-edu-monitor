import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, {
    max: 10,
    prepare: false,
  })
  const db = drizzle(client, { schema })

  return {
    db,
    close: () => client.end(),
  }
}

export type HalliliDatabase = ReturnType<typeof createDatabase>['db']
