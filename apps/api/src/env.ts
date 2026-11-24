import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { z } from "zod";

// Load .env from the API dir first, then the monorepo root, so the API
// works regardless of the process cwd. Skipped under `node --test`
// (NODE_TEST_CONTEXT is set by the test runner) to keep tests isolated
// from local secrets. dotenv never overrides vars already in process.env.
if (!process.env.NODE_TEST_CONTEXT) {
  for (const envPath of [
    new URL("../.env", import.meta.url).pathname, // apps/api/.env
    new URL("../../../.env", import.meta.url).pathname, // <monorepo root>/.env
  ]) {
    if (existsSync(envPath)) {
      loadDotenv({ path: envPath });
    }
  }
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3001),

  // PostgreSQL
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // better-auth
  BETTER_AUTH_SECRET: z.string().min(16, "BETTER_AUTH_SECRET must be >= 16 chars"),
  BETTER_AUTH_URL: z.url().default("http://localhost:3001"),
  WEB_ORIGIN: z.url().default("http://localhost:5173"),

  // Microsoft Entra ID (Azure AD) OAuth
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT_ID: z.string().default("common"),

  // AES-256-GCM vault key: 64 hex chars (32 bytes)
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be 64 hex chars (32 bytes)")
    .optional(),

  // Default LMS configuration (server-side fallback)
  LMS_BASE_URL: z.url().optional(),

  // Default LLM provider configuration
  LLM_PROVIDER: z
    .enum(["gemini", "openai", "anthropic", "mock"])
    .default("gemini"),
  LLM_MODEL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().optional(),
  LLM_FALLBACK_MODELS: z.string().optional(),

  // Embedded background worker toggle
  ENABLE_EMBEDDED_WORKER: z
    .enum(["true", "false"])
    .default("true"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Parses and validates process.env. Throws a descriptive error on failure. */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[Env] Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

/** Returns the validated env, parsed once and cached. */
export function getEnv(): Env {
  if (!cached) {
    cached = parseEnv();
  }
  return cached;
}

/** Test helper: resets the cached env (never used in production paths). */
export function resetEnvCache(): void {
  cached = undefined;
}
