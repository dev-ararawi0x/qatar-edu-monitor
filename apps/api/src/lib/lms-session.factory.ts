import { eq } from "drizzle-orm";
import {
  LmsHttpClient,
  SessionCookieJar,
  validateAllowedLmsBaseUrl,
} from "@qatar-edu/core";
import { db, type Db } from "../db/client.js";
import { userLmsCredentials } from "../db/schema/index.js";
import { decryptSecret, encryptSecret } from "./crypto-vault.js";
import { getEnv } from "../env.js";
import { LmsSessionExpiredError } from "./errors.js";

const SESSION_EXPIRED_MARKER = "[LMS Session Expired]";

export function isLmsSessionExpiredError(err: unknown): boolean {
  return (
    err instanceof Error && err.message.includes(SESSION_EXPIRED_MARKER)
  );
}

export interface WithLmsSessionOptions {
  /** Ephemeral cookie override (e.g., batch-level temporary session). */
  cookieOverride?: string;
  /** Optional per-call base URL override (validated against allowlist). */
  baseUrlOverride?: string;
  /** When true, rotated cookies are NOT persisted back to the DB. */
  ephemeral?: boolean;
}

/**
 * Runs `fn` with an authenticated `LmsHttpClient` for the given user.
 *
 * - Decrypts the user's stored LMS cookie (or uses `cookieOverride`).
 * - After `fn` completes, persists any rotated `Set-Cookie` values back to
 *   `user_lms_credentials` (encrypted) so sessions stay fresh.
 * - Marks the stored session `expired` when the LMS rejects it.
 */
export async function withLmsSession<T>(
  database: Db,
  userId: string,
  fn: (client: LmsHttpClient) => Promise<T>,
  options: WithLmsSessionOptions = {},
): Promise<T> {
  const creds = await database.query.userLmsCredentials.findFirst({
    where: eq(userLmsCredentials.userId, userId),
  });

  const envBaseUrl = getEnv().LMS_BASE_URL;
  const baseUrl = validateAllowedLmsBaseUrl(
    options.baseUrlOverride ??
      creds?.lmsBaseUrl ??
      envBaseUrl ??
      (() => {
        throw new LmsSessionExpiredError(
          "[LMS Session Expired] No LMS base URL configured. Set LMS_BASE_URL or provide one when saving your cookie.",
        );
      })(),
  );

  const cookieHeader =
    options.cookieOverride ??
    (creds ? decryptSecret(creds.encryptedCookie) : undefined);

  if (!cookieHeader || cookieHeader.trim() === "" || cookieHeader === "VALUES") {
    throw new LmsSessionExpiredError(
      "[LMS Session Expired] No LMS session cookie configured. Please save your cookie in Settings first.",
    );
  }

  const client = new LmsHttpClient(baseUrl, cookieHeader, true);

  try {
    const result = await fn(client);
    await persistRotatedCookies(
      database,
      userId,
      client,
      cookieHeader,
      baseUrl,
      options.ephemeral === true,
    );
    return result;
  } catch (err) {
    if (isLmsSessionExpiredError(err) && creds && !options.ephemeral) {
      await database
        .update(userLmsCredentials)
        .set({
          sessionStatus: "expired",
          updatedAt: new Date(),
        })
        .where(eq(userLmsCredentials.userId, userId));
    }
    throw err;
  }
}

async function persistRotatedCookies(
  database: Db,
  userId: string,
  client: LmsHttpClient,
  originalCookieHeader: string,
  baseUrl: string,
  ephemeral: boolean,
): Promise<void> {
  if (ephemeral || !client.cookieJar.hasRealCookies()) return;

  const newHeader = client.cookieJar.toCookieHeader();
  const cookieNames = client.cookieJar.getCookieNames();
  const now = new Date();

  if (newHeader === originalCookieHeader) {
    // Cookies unchanged — just refresh verification metadata if we have a row.
    await database
      .update(userLmsCredentials)
      .set({
        sessionStatus: "active",
        lastVerifiedAt: now,
        updatedAt: now,
      })
      .where(eq(userLmsCredentials.userId, userId));
    return;
  }

  const encrypted = encryptSecret(newHeader);
  await database
    .insert(userLmsCredentials)
    .values({
      userId,
      lmsBaseUrl: baseUrl,
      encryptedCookie: encrypted,
      cookieNames,
      sessionStatus: "active",
      lastVerifiedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userLmsCredentials.userId,
      set: {
        lmsBaseUrl: baseUrl,
        encryptedCookie: encrypted,
        cookieNames,
        sessionStatus: "active",
        lastVerifiedAt: now,
        updatedAt: now,
      },
    });
}

/** Convenience wrapper using the shared app db (route handlers). */
export function withUserLmsSession<T>(
  userId: string,
  fn: (client: LmsHttpClient) => Promise<T>,
  options?: WithLmsSessionOptions,
): Promise<T> {
  return withLmsSession(db, userId, fn, options);
}
