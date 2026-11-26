import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { createDatabase } from '@hallili/db'
import { betterAuth } from 'better-auth'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value || value === 'VALUES') {
    throw new Error(`${name} must be configured before authentication starts.`)
  }
  return value
}

function microsoftProviderConfig() {
  if (process.env.MICROSOFT_SIGNIN_ENABLED !== 'true') return undefined

  const tenantId = requiredEnv('MICROSOFT_TENANT_ID')
  if (tenantId === 'common' && process.env.MICROSOFT_ALLOW_COMMON_TENANT !== 'true') {
    throw new Error(
      'MICROSOFT_TENANT_ID=common is not permitted unless MICROSOFT_ALLOW_COMMON_TENANT=true is explicitly configured after tenant policy approval.',
    )
  }

  return {
    microsoft: {
      clientId: requiredEnv('MICROSOFT_CLIENT_ID'),
      clientSecret: requiredEnv('MICROSOFT_CLIENT_SECRET'),
      tenantId,
      prompt: 'select_account' as const,
    },
  }
}

const databaseUrl = requiredEnv('DATABASE_URL')
const { db } = createDatabase(databaseUrl)

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  secret: requiredEnv('BETTER_AUTH_SECRET'),
  baseURL: process.env.BETTER_AUTH_URL,
  socialProviders: microsoftProviderConfig(),
  plugins: [tanstackStartCookies()],
})
