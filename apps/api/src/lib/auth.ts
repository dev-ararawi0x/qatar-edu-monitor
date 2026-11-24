import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/client.js";
import * as schema from "../db/schema/index.js";
import { getEnv } from "../env.js";

const env = getEnv();

const hasMicrosoftCredentials = Boolean(
  env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET,
);

// When the SPA is hosted on a different origin than the API (e.g. web on
// Cloudflare Pages / Vercel, API on Render), session cookies must be
// SameSite=None + Secure or browsers will not send them on cross-site fetch.
const isCrossSite =
  new URL(env.WEB_ORIGIN).origin !== new URL(env.BETTER_AUTH_URL).origin;

export const auth = betterAuth({
  appName: "Qatar Education Monitor",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_ORIGIN],
  advanced: isCrossSite
    ? {
        defaultCookieAttributes: {
          sameSite: "none",
          secure: env.BETTER_AUTH_URL.startsWith("https://"),
        },
      }
    : {},
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
  },
  ...(hasMicrosoftCredentials
    ? {
        socialProviders: {
          microsoft: {
            clientId: env.MICROSOFT_CLIENT_ID!,
            clientSecret: env.MICROSOFT_CLIENT_SECRET!,
            tenantId: env.MICROSOFT_TENANT_ID,
          },
        },
      }
    : {}),
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
});

export type Auth = typeof auth;
