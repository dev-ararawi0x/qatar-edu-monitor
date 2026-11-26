import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import { createDatabase } from './client'

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run migrations.')
  }

  const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url))
  const connection = createDatabase(databaseUrl)
  try {
    await migrate(connection.db, { migrationsFolder })
    console.log('Database migrations applied.')
  } finally {
    await connection.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Migration failed.')
  process.exit(1)
})
