import { config as loadDotenvConfig } from 'dotenv'
import { z } from 'zod'

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url().startsWith('postgres'),
  ENCRYPTION_KEY: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(1).optional(),
  BETTER_AUTH_URL: z.url().optional(),
  WEB_ORIGIN: z.url().optional(),
  MICROSOFT_SIGNIN_ENABLED: z.enum(['true', 'false']).default('false'),
  MICROSOFT_ALLOW_COMMON_TENANT: z.enum(['true', 'false']).default('false'),
  LMS_INTEGRATION_ENABLED: z.enum(['true', 'false']).default('false'),
  LMS_REMOTE_DRAFTS_ENABLED: z.enum(['true', 'false']).default('false'),
  AI_PROVIDER: z.enum(['fake', 'openai-compatible']).default('fake'),
  AI_BASE_URL: z.url().optional(),
  AI_MODEL: z.string().min(1).optional(),
  AI_API_KEY: z.string().min(1).optional(),
})

export type RuntimeEnv = z.infer<typeof baseEnvSchema>

export function loadLocalEnv(path = '.env') {
  loadDotenvConfig({ path, override: false })
}

export function parseRuntimeEnv(source: NodeJS.ProcessEnv = process.env): RuntimeEnv {
  const parsed = baseEnvSchema.safeParse(source)
  if (!parsed.success) {
    const fields = Object.keys(z.flattenError(parsed.error).fieldErrors).sort()
    throw new Error(`Missing or invalid runtime configuration: ${fields.join(', ')}`)
  }
  if (parsed.data.ENCRYPTION_KEY === 'VALUES') {
    throw new Error('ENCRYPTION_KEY must be replaced with a real server-side secret.')
  }
  return parsed.data
}

export function parseWorkerEnv(source: NodeJS.ProcessEnv = process.env): RuntimeEnv {
  return parseRuntimeEnv(source)
}
